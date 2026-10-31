// src/core/services/firebase/data/DocumentService.ts
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  QueryConstraint,
  DocumentData,
  WithFieldValue,
  DocumentReference,
  writeBatch,
  onSnapshot,
  runTransaction,
  Unsubscribe
} from 'firebase/firestore';
import BaseFirebaseService from '../core/BaseFirebaseService';
import {
  buildCreationAttribution,
  buildModificationAttribution,
  creationTimes,
  modificationTimes,
} from '../../../attribution';
import { DocumentAlreadyExistsError } from './DocumentAlreadyExistsError';
import { createDocumentIfAbsent } from './createDocumentIfAbsent';
import { assertTextFits } from './TextTooLongError';
import { RECORD_TEXT_LIMITS, SUBCOLLECTION_TEXT_LIMITS } from '../../../constants/textLimits';

/**
 * DocumentService provides generic CRUD operations for Firestore documents
 * with automatic group and campaign context handling and attribution metadata
 */
class DocumentService extends BaseFirebaseService {
  private static instance: DocumentService;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance of DocumentService
   */
  public static getInstance(): DocumentService {
    if (!DocumentService.instance) {
      DocumentService.instance = new DocumentService();
    }
    return DocumentService.instance;
  }
  
  /**
   * Get collection reference - handles different path formats
   * @param collectionPath Full collection path or collection name
   * @returns Firestore collection reference with proper path
   */
  private getCollectionRef(collectionPath: string) {
    // If path already contains '/', it's a full path - use directly
    if (collectionPath.includes('/')) {
      return collection(this.db, collectionPath);
    }
    
    // Otherwise, construct path with group/campaign context
    const activeGroupId = this.getActiveGroupId();
    const activeCampaignId = this.getActiveCampaignId();
    
    if (!activeGroupId) {
      throw new Error('No active group selected');
    }
    
    if (activeCampaignId) {
      // Campaign-specific collections
      return collection(
        this.db,
        'groups',
        activeGroupId,
        'campaigns',
        activeCampaignId,
        collectionPath
      );
    } else {
      // Group-level collections
      return collection(
        this.db,
        'groups',
        activeGroupId,
        collectionPath
      );
    }
  }

  /**
   * The group a collection belongs to, read from its path: the group the
   * write lands in, and so the profile its attribution must come from. Taken
   * from the path rather than the active group, which a switch can change
   * while a write is in flight (T082).
   *
   * @param collectionRef The collection being written
   * @returns The group's id
   */
  private groupOf(collectionRef: { path: string }): string {
    const [root, groupId] = collectionRef.path.split('/');
    if (root === 'groups' && groupId) {
      return groupId;
    }
    const activeGroupId = this.getActiveGroupId();
    if (!activeGroupId) {
      throw new Error('No active group selected');
    }
    return activeGroupId;
  }

  /**
   * Refuses a write that puts more text in a campaign record's field than the
   * production rules accept (T119), before anything is sent, so the player
   * reads which field is too long instead of "permission denied". Only the
   * records directly under a campaign are capped (`RECORD_TEXT_LIMITS`).
   *
   * @param collectionRef The collection being written
   * @param data The fields about to be written
   * @throws {TextTooLongError} naming the first field that is too long
   */
  private assertTextFits(collectionRef: { path: string }, data: unknown): void {
    const [root, , campaigns, , recordType, ...deeper] = collectionRef.path.split('/');
    if (root !== 'groups' || campaigns !== 'campaigns' || !recordType) {
      return;
    }
    // A record's own notes (T133) and a chapter's body (T134),
    // `{record}/{id}/{subcollection}`, are capped document by document.
    const subcollection = deeper.length === 2 ? SUBCOLLECTION_TEXT_LIMITS[deeper[1]] : undefined;
    if (deeper.length > 0 && !subcollection) {
      return;
    }
    const limits = subcollection ?? RECORD_TEXT_LIMITS[recordType];
    if (limits && typeof data === 'object' && data !== null) {
      assertTextFits(limits, data as Record<string, unknown>);
    }
  }

  /**
   * Get attribution metadata for document creation
   * Includes the active character information at creation time, and the
   * server-clock `createdAt` and `modifiedAt` (T132)
   * @param groupId The group the document is written in
   * @returns Attribution metadata object
   */
  private async getCreationAttribution(groupId: string): Promise<DocumentData> {
    const userId = this.getCurrentUser()?.uid;
    if (!userId) {
      throw new Error('Not authenticated');
    }

    try {
      // The user's username and active character, cached across writes
      const userProfile = await this.cachedGroupProfile(groupId, userId);

      if (!userProfile) {
        throw new Error('User profile not found');
      }

      return {
        ...buildCreationAttribution({ uid: userId, activeGroupUserProfile: userProfile }),
        ...creationTimes(),
      };
    } catch (error) {
      console.error('Error getting attribution metadata:', error);
      throw error;
    }
  }
  
  /**
   * Get attribution metadata for document modification
   * Includes the active character information at modification time, and the
   * server-clock `modifiedAt` (T132)
   * @param groupId The group the document is written in
   * @returns Attribution metadata object
   */
  private async getModificationAttribution(groupId: string): Promise<DocumentData> {
    const userId = this.getCurrentUser()?.uid;
    if (!userId) {
      throw new Error('Not authenticated');
    }

    try {
      // The user's username and active character, cached across writes
      const userProfile = await this.cachedGroupProfile(groupId, userId);

      if (!userProfile) {
        throw new Error('User profile not found');
      }

      return {
        ...buildModificationAttribution({ uid: userId, activeGroupUserProfile: userProfile }),
        ...modificationTimes(),
      };
    } catch (error) {
      console.error('Error getting modification attribution:', error);
      throw error;
    }
  }

  /**
   * Create a new document with attribution metadata including character information
   *
   * `setDoc` (used below) is a full overwrite: if `id` names a document that
   * already exists, that document is silently destroyed. When no `id` is
   * supplied, a fresh Firestore-generated id is used and collision is
   * impossible, so no check is needed. When the caller *does* supply an
   * explicit `id` (e.g. one derived by slugifying a name), this method creates
   * the document only if nothing is there, in one transaction, and otherwise
   * throws {@link DocumentAlreadyExistsError} — the write-layer guard against
   * the class of bugs where two different inputs slugify to the same id and
   * the second create quietly overwrites the first (#002/#004/#009/#012),
   * including when two members create at the same moment (T081). Re-keying an
   * *existing* document under a new id on purpose must keep going through
   * `setDocument`, not this method.
   *
   * @param collectionName Collection name or full path
   * @param data Document data
   * @param id Optional document ID (generated if not provided)
   * @returns ID of the created document
   */
  public async createDocument<T extends Record<string, any>>(
    collectionName: string,
    data: T,
    id?: string
  ): Promise<string> {
    // Resolved before anything is awaited, so a group or campaign switch while
    // this create is in flight cannot move it (T082).
    const collectionRef = this.getCollectionRef(collectionName);
    const groupId = this.groupOf(collectionRef);
    this.assertTextFits(collectionRef, data);

    /** The document with its creation attribution. */
    const withAttribution = async (): Promise<DocumentData> => ({
      ...data,
      ...(await this.getCreationAttribution(groupId))
    });

    if (!id) {
      // A generated id is fresh, so nothing can be there to overwrite.
      const docRef = doc(collectionRef);
      await setDoc(docRef, await withAttribution());
      return docRef.id;
    }

    // An explicit id was supplied (usually derived from a name) - refuse
    // rather than overwrite an existing document. The check and the write are
    // one transaction: as two steps, two members creating the same name at
    // once both passed the check and one record silently replaced the other
    // (T081). Attribution is fetched only once the id is known to be free, so
    // a collision fails fast without requiring a valid user profile.
    const created = await createDocumentIfAbsent(this.db, doc(collectionRef, id), withAttribution);
    if (!created) {
      // A typed error (same developer message as before) so callers that
      // derived the id from a name can pick the next free one (#1402).
      throw new DocumentAlreadyExistsError(collectionName, id);
    }

    return id;
  }

  /**
   * Create or update a document without attribution metadata
   * Use createDocument or updateDocumentWithAttribution for automatic attribution
   *
   * @param options `{ merge: true }` writes only the fields in `data`, nested
   *   maps included, creating the document if it does not exist -- an upsert
   *   of a patch, where `updateDocument` would fail with NOT_FOUND.
   */
  public async setDocument<T extends Record<string, any>>(
    collectionName: string,
    documentId: string,
    data: T,
    options?: { merge: boolean }
  ): Promise<void> {
    const collectionRef = this.getCollectionRef(collectionName);
    this.assertTextFits(collectionRef, data);
    const docRef = doc(collectionRef, documentId);
    if (options) {
      await setDoc(docRef, data as DocumentData, options);
    } else {
      await setDoc(docRef, data as DocumentData);
    }
  }

  /**
   * Update specific fields in a document with attribution metadata
   * @param collectionName Collection name or full path
   * @param documentId ID of the document to update
   * @param data Partial data to update
   * @returns Promise that resolves when update is complete
   */
  public async updateDocumentWithAttribution<T extends DocumentData>(
    collectionName: string,
    documentId: string,
    data: Partial<WithFieldValue<T>>
  ): Promise<void> {
    // The target is resolved before the attribution read is awaited. It was
    // resolved after it, so switching campaign while that read was out sent
    // the edit to a same-id record in the other campaign (T082).
    const collectionRef = this.getCollectionRef(collectionName);
    this.assertTextFits(collectionRef, data);
    const docRef = doc(collectionRef, documentId) as DocumentReference<T>;

    // Get modification attribution metadata with character information
    const attributionMetadata = await this.getModificationAttribution(this.groupOf(collectionRef));

    // Combine data with attribution metadata
    const fullData = {
      ...data,
      ...attributionMetadata
    };

    await updateDoc(docRef, fullData as Partial<DocumentData>);
  }

  /**
   * Update one document from a decision made on documents read in the same
   * transaction, with modification attribution.
   *
   * For a write whose validity depends on other records -- a location's new
   * parent must not already sit inside it. Checked against a list read
   * earlier, two members can each make a move that is valid alone and
   * together form a cycle (DATA-006). Here Firestore notices if anything
   * `decide` read changed before the commit and runs `decide` again against
   * what was committed, so the second move sees the first.
   *
   * `decide` reads by id from the same collection and returns the fields to
   * write; throwing refuses the write. It may run more than once. A query
   * cannot take part: a transaction reads documents, not lists.
   *
   * Needs the server: offline, the transaction fails rather than queueing.
   *
   * @param collectionName Collection name or full path
   * @param documentId The document to update; it must exist
   * @param decide Reads what it needs and returns the fields to write
   */
  public async updateDocumentAfterReading<T extends DocumentData>(
    collectionName: string,
    documentId: string,
    decide: (read: (id: string) => Promise<(T & { id: string }) | undefined>) => Promise<Partial<T>>
  ): Promise<void> {
    // Resolved before any await, as in `updateDocumentWithAttribution` (T082).
    const collectionRef = this.getCollectionRef(collectionName);
    const attributionMetadata = await this.getModificationAttribution(this.groupOf(collectionRef));

    await runTransaction(this.db, async (transaction) => {
      const read = async (id: string) => {
        const snapshot = await transaction.get(doc(collectionRef, id));
        return snapshot.exists() ? ({ ...(snapshot.data() as T), id: snapshot.id }) : undefined;
      };
      const fields = await decide(read);
      this.assertTextFits(collectionRef, fields);
      transaction.update(doc(collectionRef, documentId), {
        ...fields,
        ...attributionMetadata
      } as Partial<DocumentData>);
    });
  }

  /**
   * Update several documents in one collection from a decision made on
   * documents read in the same transaction, each with modification
   * attribution (T088).
   *
   * `updateDocumentAfterReading` for a change that spans documents: marking
   * a location's children for deletion only if each is still inside it.
   * `decide` reads by id and returns the updates, possibly none; throwing
   * refuses them all. It may run more than once. At most 500 updates.
   *
   * Needs the server: offline, the transaction fails rather than queueing.
   *
   * @param collectionName Collection name or full path
   * @param decide Reads what it needs and returns the updates
   */
  public async updateDocumentsAfterReading<T extends DocumentData>(
    collectionName: string,
    decide: (read: (id: string) => Promise<(T & { id: string }) | undefined>) => Promise<Array<{ id: string; data: Partial<T> }>>
  ): Promise<void> {
    // Resolved before any await, as in `updateDocumentWithAttribution` (T082).
    const collectionRef = this.getCollectionRef(collectionName);
    const attributionMetadata = await this.getModificationAttribution(this.groupOf(collectionRef));

    await runTransaction(this.db, async (transaction) => {
      const read = async (id: string) => {
        const snapshot = await transaction.get(doc(collectionRef, id));
        return snapshot.exists() ? ({ ...(snapshot.data() as T), id: snapshot.id }) : undefined;
      };
      const updates = await decide(read);
      updates.forEach((update) => this.assertTextFits(collectionRef, update.data));
      for (const update of updates) {
        transaction.update(doc(collectionRef, update.id), {
          ...update.data,
          ...attributionMetadata
        } as Partial<DocumentData>);
      }
    });
  }

  /**
   * The documents whose `field` equals `value`, as the server holds them now
   * -- never the local cache, which can miss a document another member wrote
   * a moment ago (T088). Offline, it fails.
   *
   * @param collectionName Collection name or full path
   * @param field The field to match
   * @param value The value it must equal, or contain with `array-contains`
   * @param operator `==`, or `array-contains` for a list holding `value` (T131)
   */
  public async queryFromServer<T>(
    collectionName: string,
    field: string,
    value: unknown,
    operator: '==' | 'array-contains' = '=='
  ): Promise<Array<T & { id: string }>> {
    const collectionRef = this.getCollectionRef(collectionName);
    const snapshot = await getDocsFromServer(query(collectionRef, where(field, operator, value)));
    return snapshot.docs.map(document => ({ ...(document.data() as T), id: document.id }));
  }

  /**
   * Every document of a collection, as the server holds it now (T131): for
   * the rare question no query can ask, such as which quests name a place
   * inside a list of objects. Offline, it fails.
   *
   * @param collectionName Collection name or full path
   */
  public async getCollectionFromServer<T>(collectionName: string): Promise<Array<T & { id: string }>> {
    const snapshot = await getDocsFromServer(this.getCollectionRef(collectionName));
    return snapshot.docs.map(document => ({ ...(document.data() as T), id: document.id }));
  }

  /**
   * Create one document under an explicit id and update others, as one
   * transaction, from a decision made on the others as the server holds them.
   *
   * For an operation that turns records into a new one -- rumours into a
   * quest, several rumours into one. Created first and marked after, a failed
   * mark left the new record behind, and every retry made another (DATA-005).
   * Here the new record, the marks and the notes saying what happened (each a
   * document of its own, T133) commit together or not at all, and the marks
   * are decided from the copies the server holds.
   *
   * `decide` reads by id from `sourceCollection` and returns the new document
   * and the updates; throwing refuses the whole operation. It may run more
   * than once. The new document gets creation attribution and each update
   * modification attribution, as `createDocument` and
   * `updateDocumentAfterReading` stamp them.
   *
   * Needs the server: offline, the transaction fails rather than queueing.
   *
   * @param collectionName Where the new document goes: collection name or full path
   * @param id The new document's id
   * @param sourceCollection Where the documents `decide` reads and updates live
   * @param decide Reads what it needs and returns the new document and the updates
   * @throws {DocumentAlreadyExistsError} if `id` is taken; nothing is written
   */
  public async createDocumentWithUpdates<T extends DocumentData, S extends DocumentData>(
    collectionName: string,
    id: string,
    sourceCollection: string,
    decide: (read: (id: string) => Promise<(S & { id: string }) | undefined>) => Promise<{
      create: T;
      updates: Array<{ id: string; data: Partial<S> }>;
      /**
       * Notes to create in the same commit (T133), each a document under the
       * new record (`under: 'created'`) or under one of the updated ones
       * (`under: { updated: id }`). An object, not the bare id: a record's id
       * is a slug of its title, and one may well be `created`.
       */
      notes?: Array<{ under: 'created' | { updated: string }; id: string; data: DocumentData }>;
    }>
  ): Promise<void> {
    // Resolved before any await, as in `createDocument` (T082).
    const collectionRef = this.getCollectionRef(collectionName);
    const sourceRef = this.getCollectionRef(sourceCollection);
    const groupId = this.groupOf(collectionRef);

    const created = await runTransaction(this.db, async (transaction) => {
      const targetRef = doc(collectionRef, id);
      if ((await transaction.get(targetRef)).exists()) {
        return false;
      }
      const read = async (sourceId: string) => {
        const snapshot = await transaction.get(doc(sourceRef, sourceId));
        return snapshot.exists() ? ({ ...(snapshot.data() as S), id: snapshot.id }) : undefined;
      };
      const { create, updates, notes = [] } = await decide(read);
      this.assertTextFits(collectionRef, create);
      updates.forEach((update) => this.assertTextFits(sourceRef, update.data));
      const noteRefs = notes.map((note) => {
        const parent = note.under === 'created' ? targetRef : doc(sourceRef, note.under.updated);
        const notesRef = collection(parent, 'notes');
        this.assertTextFits(notesRef, note.data);
        return doc(notesRef, note.id);
      });
      // Attribution only once the id is known to be free, as in `createDocument`.
      const creation = await this.getCreationAttribution(groupId);
      const modification = await this.getModificationAttribution(groupId);

      transaction.set(targetRef, { ...create, ...creation });
      for (const update of updates) {
        transaction.update(doc(sourceRef, update.id), {
          ...update.data,
          ...modification
        } as Partial<DocumentData>);
      }
      notes.forEach((note, i) => transaction.set(noteRefs[i], { ...note.data, ...creation }));
      return true;
    });

    if (!created) {
      throw new DocumentAlreadyExistsError(collectionName, id);
    }
  }

  /**
   * Add to one existing document, update others and create notes, as one
   * transaction, from a decision made on them as the server holds them (T163).
   *
   * The "already exists" merge: what a player knew about a record that turned
   * out to exist goes into it -- empty fields filled, lists joined, what
   * differs into a note under it -- together with what pointed at the
   * newcomer (a session note's mark, a combine's or a conversion's sources).
   * `createDocumentWithUpdates` for a target that is already there.
   *
   * `decide` gets the target and a reader for `sourceCollection`, and returns
   * the target's fields, the updates and the notes; throwing refuses it all.
   * It may run more than once. The target and each update get modification
   * attribution, each note creation attribution.
   *
   * Needs the server: offline, the transaction fails rather than queueing.
   *
   * @param collectionName The target's collection: name or full path
   * @param id The target, which must exist
   * @param sourceCollection Where the documents `decide` reads and updates live
   * @param decide Works out the writes from the target and the sources
   * @throws {Error} 'This record was deleted.' when the target has gone
   */
  public async mergeIntoDocument<T extends DocumentData, S extends DocumentData>(
    collectionName: string,
    id: string,
    sourceCollection: string,
    decide: (
      target: T & { id: string },
      read: (id: string) => Promise<(S & { id: string }) | undefined>
    ) => Promise<{
      fields: Partial<T>;
      updates: Array<{ id: string; data: Partial<S> }>;
      /** Notes under the target (`under: 'target'`) or under an updated source. */
      notes?: Array<{ under: 'target' | { updated: string }; id: string; data: DocumentData }>;
    }>
  ): Promise<void> {
    // Resolved before any await, as in `createDocument` (T082).
    const collectionRef = this.getCollectionRef(collectionName);
    const sourceRef = this.getCollectionRef(sourceCollection);
    const groupId = this.groupOf(collectionRef);
    const creation = await this.getCreationAttribution(groupId);
    const modification = await this.getModificationAttribution(groupId);

    await runTransaction(this.db, async (transaction) => {
      const targetRef = doc(collectionRef, id);
      const snapshot = await transaction.get(targetRef);
      if (!snapshot.exists()) {
        throw new Error('This record was deleted.');
      }
      const read = async (sourceId: string) => {
        const source = await transaction.get(doc(sourceRef, sourceId));
        return source.exists() ? ({ ...(source.data() as S), id: source.id }) : undefined;
      };
      const { fields, updates, notes = [] } = await decide({ ...(snapshot.data() as T), id }, read);
      this.assertTextFits(collectionRef, fields);
      updates.forEach((update) => this.assertTextFits(sourceRef, update.data));
      const noteRefs = notes.map((note) => {
        const parent = note.under === 'target' ? targetRef : doc(sourceRef, note.under.updated);
        const notesRef = collection(parent, 'notes');
        this.assertTextFits(notesRef, note.data);
        return doc(notesRef, note.id);
      });

      // Nothing to add to the target writes nothing there: an empty update
      // would still credit it with a change nobody made.
      if (Object.keys(fields).length > 0) {
        transaction.update(targetRef, { ...fields, ...modification } as Partial<DocumentData>);
      }
      for (const update of updates) {
        transaction.update(doc(sourceRef, update.id), {
          ...update.data,
          ...modification
        } as Partial<DocumentData>);
      }
      notes.forEach((note, i) => transaction.set(noteRefs[i], { ...note.data, ...creation }));
    });
  }

  /**
   * Update specific fields in a document without attribution metadata
   * Use updateDocumentWithAttribution for automatic attribution
   */
  public async updateDocument<T extends DocumentData>(
    collectionName: string,
    documentId: string,
    data: Partial<WithFieldValue<T>>
  ): Promise<void> {
    const collectionRef = this.getCollectionRef(collectionName);
    this.assertTextFits(collectionRef, data);
    const docRef = doc(collectionRef, documentId) as DocumentReference<T>;
    await updateDoc(docRef, data as Partial<DocumentData>);
  }

  /**
   * Get a document by ID with or without group/campaign context
   * @param collectionName Collection name or full path
   * @param documentId ID of the document to retrieve
   * @param requireContext Whether to require group/campaign context (default: true)
   * @returns Document data or null if not found
   */
  public async getDocument<T>(
    collectionName: string,
    documentId: string,
    requireContext: boolean = true
  ): Promise<T | null> {
    try {
      // Special case for global collections (like 'users')
      if (!requireContext || (collectionName === 'users' && !collectionName.includes('/'))) {
        // Access these collections directly without group/campaign context
        const docRef = doc(this.db, collectionName, documentId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          return { ...docSnap.data(), id: docSnap.id } as T;
        }
        
        return null;
      }
      
      // For collections that require group/campaign context or use full paths
      const collectionRef = this.getCollectionRef(collectionName);
      const docRef = doc(collectionRef, documentId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { ...docSnap.data(), id: docSnap.id } as T;
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting document ${documentId} from ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Get all documents in a collection with group/campaign context
   * @param collectionName Collection name or full path
   * @param constraints Query constraints to apply
   * @returns Array of documents
   */
  public async getCollection<T>(
    collectionName: string,
    constraints: QueryConstraint[] = []
  ): Promise<T[]> {
    try {
      const collectionRef = this.getCollectionRef(collectionName);
      const q = query(collectionRef, ...constraints);
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as T));
    } catch (error) {
      // If no active group, return empty array
      if (error instanceof Error && error.message === 'No active group selected') {
        console.warn('No active group selected for collection:', collectionName);
        return [];
      }
      
      console.error(`Error getting collection ${collectionName}:`, error);
      return [];
    }
  }

  /**
   * Listen to every document in a collection (T032).
   *
   * Takes an explicit collection path rather than a bare name: a listener
   * outlives the moment it was opened, so it must not resolve its group and
   * campaign from this service's mutable active ids. The caller builds the
   * path from the same state it renders.
   *
   * The first call to `onNext` carries the whole collection; later calls
   * follow every change, including this client's own writes, which arrive
   * before the write's promise resolves (latency compensation).
   *
   * @param collectionPath Full collection path, e.g. `groups/g/campaigns/c/npcs`
   * @param onNext Receives the collection's documents on every change
   * @param onError Receives a listener failure; the listener is closed after it
   * @param constraints Query constraints to apply
   * @returns Function that closes the listener
   */
  public subscribeToCollection<T>(
    collectionPath: string,
    onNext: (documents: T[]) => void,
    onError: (error: Error) => void,
    constraints: QueryConstraint[] = []
  ): Unsubscribe {
    const q = query(collection(this.db, collectionPath), ...constraints);
    return onSnapshot(
      q,
      (snapshot) => {
        onNext(snapshot.docs.map(document => ({
          id: document.id,
          ...document.data()
        } as T)));
      },
      onError
    );
  }

  /**
   * Delete a document with group/campaign context
   */
  public async deleteDocument(
    collectionName: string,
    documentId: string
  ): Promise<void> {
    const collectionRef = this.getCollectionRef(collectionName);
    const docRef = doc(collectionRef, documentId);
    await deleteDoc(docRef);
  }

  /**
   * Query documents in a collection with group/campaign context
   */
  public async queryDocuments<T>(
    collectionName: string,
    field: string,
    operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'array-contains',
    value: any
  ): Promise<T[]> {
    try {
      const collectionRef = this.getCollectionRef(collectionName);
      const q = query(collectionRef, where(field, operator, value));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as T));
    } catch (error) {
      // If no active group, return empty array
      if (error instanceof Error && error.message === 'No active group selected') {
        console.warn('No active group selected for query:', collectionName);
        return [];
      }
      
      console.error(`Error querying collection ${collectionName}:`, error);
      return [];
    }
  }

  /**
   * Perform batch operations with group/campaign context
   * @param operations Array of operations to perform
   */
  public async batchOperations(operations: {
    type: 'set' | 'update' | 'delete';
    collection: string;
    id: string;
    data?: any;
  }[]): Promise<void> {
    const batch = writeBatch(this.db);
    
    for (const op of operations) {
      const collectionRef = this.getCollectionRef(op.collection);
      if (op.type !== 'delete') {
        this.assertTextFits(collectionRef, op.data);
      }
      const docRef = doc(collectionRef, op.id);
      
      switch (op.type) {
        case 'set':
          batch.set(docRef, op.data);
          break;
        case 'update':
          batch.update(docRef, op.data);
          break;
        case 'delete':
          batch.delete(docRef);
          break;
      }
    }
    
    await batch.commit();
  }
}

export default DocumentService;