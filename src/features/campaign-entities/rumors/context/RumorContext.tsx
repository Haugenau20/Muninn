// src/features/campaign-entities/rumors/context/RumorContext.tsx - updating rumor context to use character names
import React, { createContext, useContext, useCallback, useMemo, useRef } from 'react';
import { Rumor, RumorStatus, RumorNote, RumorContextValue, JoinOptions } from '../types';
import { DomainData, IdentifiableContent, RecordChange, CreateAlongside, CreateOptions, ContentAttribution } from 'core/types/common';
import { useRumorData } from '../hooks/useRumorData';
import { useFirebaseData } from 'shared/hooks/useFirebaseData';
import { writeRecordChange } from '../../shared/writeRecordChange';
import { useCampaignCollectionPath } from 'shared/hooks/useCampaignCollectionPath';
import { useAuth, useUser, useFirestore } from 'features/user-management';
import { buildCreationAttribution, buildModificationAttribution, modificationTimes } from 'core/attribution';
import { createWithUniqueEntityId } from 'core/utils/entity-id';
import { rumorParagraph } from '../utils/rumor-title';
import { createListenerDemandContext, useListenerDemand, ListReaderOptions } from 'shared/hooks/useListenerDemand';
import { commitEntityWrites, EntityBatchWrite, MAX_BATCH_WRITES } from '../../shared/commitEntityWrites';
import { locationIdsOfRumor } from '../../shared/links';
import { addRecordNote, deleteRecordNotes } from '../../shared/recordNotes';
import { assertNoSameNamed, stopOnSameNamed } from '../../shared/sameName';
import { usePrivateRouting } from '../../shared/private/usePrivateRouting';
import { usePrivateRecords, useHoldPrivateRecords } from '../../shared/private/PrivateRecordsContext';
import { mergeNote, planMerge } from '../../shared/mergeRecords';
import firebaseServices from 'core/services/firebase';
import { getActiveCharacterName, getUserName } from 'core/utils/user-utils';

const RumorContext = createContext<RumorContextValue | undefined>(undefined);

/**
 * Hands a ready value to everything under it, in place of
 * `RumorProvider`'s own: the example campaign's records, for a page drawn from
 * it (`../../example/ExampleCampaignProvider`).
 */
export const RumorContextValueProvider = RumorContext.Provider;

/**
 * Most rumours one conversion or combination can take. Each costs two writes,
 * its mark and the note saying what happened (a document of its own since
 * T133), beside the new record and, when combining, that record's own note.
 */
const MAX_RUMOURS_PER_COMMIT = Math.floor((MAX_BATCH_WRITES - 2) / 2);

/**
 * Refuses a conversion or combination before anything is written when one
 * transaction could not hold it (DATA-005). Checked after the commit instead,
 * the new record was already there and every retry made another.
 */
const assertFitsOneCommit = (rumorCount: number): void => {
  if (rumorCount > MAX_RUMOURS_PER_COMMIT) {
    throw new Error(`One action can change at most ${MAX_RUMOURS_PER_COMMIT} rumours at once.`);
  }
};

/**
 * Reads every rumour of a conversion inside its transaction, as the server
 * holds it, refusing if one has gone since the page's copy was taken.
 */
const readAll = async (
  read: (id: string) => Promise<Rumor | undefined>,
  rumorIds: string[]
): Promise<Rumor[]> => {
  const current = await Promise.all(rumorIds.map(id => read(id)));
  if (current.some(rumor => !rumor)) {
    throw new Error('One or more rumours not found');
  }
  return current as Rumor[];
};

/**
 * Who is reading this provider's list right now (T032, `PERF-03`): the
 * listener is open only while some component that called `useRumors()` is
 * mounted, and for a while after. See `useListenerDemand`.
 */
const { DemandProvider: RumorDemandProvider, useDemand: useRumorDemand } = createListenerDemandContext();

export const RumorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const demand = useListenerDemand();
  // The author's private records are part of this list: open with it (T163).
  useHoldPrivateRecords(demand.wanted);
  const { rumors, loading, error } = useRumorData({ enabled: demand.wanted });
  // This second `useFirebaseData` instance is the one whose writes (addData/updateData/
  // deleteData) can actually fail; its `error` is renamed on destructure (`writeError`)
  // because the read instance above already binds the name `error`. Previously this
  // instance's error was never read anywhere, so write failures were invisible (bug #1401).
  //
  // `autoFetch: false` because nothing renders off its `data`: the list comes
  // from `useRumorData()` above.
  // Writes name this render's campaign by full path, so one started here
  // lands here even if the player switches campaign before it runs -- a
  // conversion's quest and its rumour updates included (T082).
  const rumorsPath = useCampaignCollectionPath('rumors');
  const questsPath = useCampaignCollectionPath('quests');
  const { addData, updateData, updateDataAfterReading, deleteData, error: writeError } = useFirebaseData<Rumor>({
    collection: rumorsPath,
    autoFetch: false
  });
  // A private rumour's writes go to its author's private space (T163).
  const sharedWriters = useMemo(
    () => ({ updateData, updateDataAfterReading, deleteData, addData }),
    [updateData, updateDataAfterReading, deleteData, addData]
  );
  const routing = usePrivateRouting<Rumor>('rumor', rumorsPath, sharedWriters);
  const { paths: privatePaths, isPrivate: isPrivateRecord } = usePrivateRecords({ subscribe: false });

  /**
   * Where a combine or a conversion of these rumours writes (T163): private
   * rumours combine into a private rumour and convert into a private quest,
   * shared ones as before, and the two are never mixed.
   */
  const joinScope = useCallback((rumorIds: string[]) => {
    const own = rumorIds.filter(id => routing.isOwn(id));
    if (own.length && own.length !== rumorIds.length) {
      throw new Error('Private and shared rumours cannot be combined or converted together.');
    }
    return own.length
      ? { isPrivate: true, rumors: privatePaths.rumor, quests: privatePaths.quest }
      : { isPrivate: false, rumors: rumorsPath, quests: questsPath };
  }, [routing, privatePaths, rumorsPath, questsPath]);
  const { user } = useAuth();
  const { userProfile, activeGroupUserProfile } = useUser();
  const { createDocumentWithUpdates } = useFirestore();

  /**
   * Writes to several rumours, committed as one batch (T032, `PERF-06`): one
   * round trip instead of one per rumour, and all or nothing, so a batch
   * action can never stop halfway through the selection.
   */
  const commitRumorWrites = useCallback(
    (writes: EntityBatchWrite<Rumor>[]) => commitEntityWrites(rumorsPath, 'rumors', writes),
    [rumorsPath]
  );

  // Get rumor by ID
  const getRumorById = useCallback((id: string) => {
    return rumors.find(rumor => rumor.id === id);
  }, [rumors]);

  // Get rumors by status
  const getRumorsByStatus = useCallback((status: RumorStatus) => {
    return rumors.filter(rumor => rumor.status === status);
  }, [rumors]);

  // Get rumors by location: the one it was heard in (`locationId`) and the
  // places it concerns (`relatedLocations`, T131). Free text in `location`
  // names no record; see the contract on `NPC.location`.
  const getRumorsByLocation = useCallback((locationId: string) => {
    return rumors.filter(rumor => locationIdsOfRumor(rumor).includes(locationId));
  }, [rumors]);

  // Get rumors by NPC
  const getRumorsByNPC = useCallback((npcId: string) => {
    return rumors.filter(rumor => 
      rumor.sourceNpcId === npcId || rumor.relatedNPCs.includes(npcId)
    );
  }, [rumors]);

  // Update rumor status
  const updateRumorStatus = useCallback(async (rumorId: string, status: RumorStatus) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update rumour status');
    }

    if (!getRumorById(rumorId)) {
      throw new Error('Rumour not found');
    }

    const modificationAttribution = buildModificationAttribution({ uid: user.uid, activeGroupUserProfile });

    await routing.writersFor(rumorId).updateData(rumorId, { status, ...modificationAttribution, ...modificationTimes() });
  }, [user, userProfile, activeGroupUserProfile, getRumorById, routing]);

  // Update rumor note
  const updateRumorNote = useCallback(async (rumorId: string, note: DomainData<RumorNote> & IdentifiableContent) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to add notes');
    }

    const rumor = getRumorById(rumorId);
    if (!rumor) {
      throw new Error('Rumour not found');
    }

    // A note of its own (T133), attributed by the write like any document.
    const path = routing.pathFor(rumorId);
    if (!path) throw new Error('No campaign selected');
    await addRecordNote(path, rumorId, { content: note.content });
  }, [user, userProfile, getRumorById, routing]);

  // Ids issued during this session but not yet reflected in `rumors` (loaded
  // state). Two rumors can be created back-to-back within a single `act()` /
  // event handler before the first create's write has come back through
  // the listener and re-rendered this provider -- a collision check
  // against `getRumorById` alone would miss that first id and silently let
  // the second create overwrite it. This ref is the second source of truth
  // `isTaken` below consults, alongside already-loaded data. Shared across
  // addRumor and combineRumors since both write into the same `rumors`
  // collection/id-space.
  const issuedIds = useRef<Set<string>>(new Set());

  // The same bookkeeping for the `quests` collection, which convertToQuest
  // writes into: a separate id-space from the rumors above.
  const issuedQuestIds = useRef<Set<string>>(new Set());

  const isRumorLoaded = useCallback(
    (candidateId: string) => Boolean(getRumorById(candidateId)),
    [getRumorById]
  );

  // Add rumor
  const addRumor = useCallback(async (
    rumorData: DomainData<Rumor>,
    alongside?: CreateAlongside,
    options: CreateOptions = {}
  ) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to add rumours');
    }

    const creationAttribution = buildCreationAttribution({ uid: user.uid, activeGroupUserProfile });

    // Create the complete rumor object including the id
    const buildRumor = (candidateId: string): Rumor => ({
      id: candidateId,  // Include the ID in the object
      ...rumorData,
      ...creationAttribution,
      // Ensure arrays are properly initialized
      relatedNPCs: rumorData.relatedNPCs || [],
      relatedLocations: rumorData.relatedLocations || [],
      notes: rumorData.notes || []
    });

    // Generate ID from title, disambiguating on collision -- including with a
    // rumor another session wrote that the listener has not delivered yet (#1402) -- and add the
    // document with the explicit ID
    // A record already carrying the name stops here when the caller asks
    // (T163): one the client holds, or one that took the id a moment ago.
    if (options.askOnSameName) assertNoSameNamed('rumor', rumorData.title, rumors);
    // Private, it goes to the author's own space (T163).
    const writers = options.private ? routing.privately : routing.shared;
    const path = options.private ? routing.privatePath : rumorsPath;
    if (options.private && !path) throw new Error('No campaign selected');
    const id = await createWithUniqueEntityId({
      name: rumorData.title,
      issuedIds: issuedIds.current,
      isLoaded: isRumorLoaded,
      write: (candidateId) => writers.addData(buildRumor(candidateId), candidateId, alongside),
      onRefused: options.askOnSameName && path ? stopOnSameNamed('rumor', path, rumorData.title) : undefined
    });
    return id;
  }, [user, userProfile, activeGroupUserProfile, isRumorLoaded, rumors, rumorsPath, routing]);

  // Update an existing rumour: only what `change` names; see `RecordChange` (T083)
  const updateRumor = useCallback(async (rumorId: string, change: RecordChange<Rumor>) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update rumours');
    }

    const modificationAttribution = buildModificationAttribution({ uid: user.uid, activeGroupUserProfile });

    await writeRecordChange(
      routing.writersFor(rumorId), rumorId, change, 'Rumour not found', modificationAttribution
    );
  }, [user, userProfile, activeGroupUserProfile, routing]);

  // Delete rumor
  const deleteRumor = useCallback(async (rumorId: string) => {
    if (!user) {
      throw new Error('User must be authenticated to delete rumours');
    }

    // Its notes first (T133): a record's subcollection outlives the record.
    const path = routing.pathFor(rumorId);
    if (path) await deleteRecordNotes(path, [rumorId]);
    await routing.writersFor(rumorId).deleteData(rumorId);
    // And the links held for it (T163).
    await routing.afterDelete([rumorId]);
  }, [user, routing]);

  /** Set the status of several rumours at once, in one batch. */
  const updateRumorsStatus = useCallback(async (rumorIds: string[], status: RumorStatus) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update rumour status');
    }
    if (rumorIds.some(id => !getRumorById(id))) {
      throw new Error('One or more rumours not found');
    }

    const modificationAttribution = buildModificationAttribution({ uid: user.uid, activeGroupUserProfile });
    await commitRumorWrites(rumorIds.map(id => ({
      type: 'update' as const,
      id,
      collection: routing.pathFor(id),
      data: { status, ...modificationAttribution, ...modificationTimes() }
    })));
  }, [user, userProfile, activeGroupUserProfile, getRumorById, commitRumorWrites, routing]);

  /** Delete several rumours at once, in one batch. */
  const deleteRumors = useCallback(async (rumorIds: string[]) => {
    if (!user) {
      throw new Error('User must be authenticated to delete rumours');
    }

    for (const [path, ids] of routing.byPath(rumorIds)) {
      await deleteRecordNotes(path, ids);
    }
    await commitRumorWrites(rumorIds.map(id => ({ type: 'delete' as const, id, collection: routing.pathFor(id) })));
    await routing.afterDelete(rumorIds);
  }, [user, commitRumorWrites, routing]);

  // Combine multiple rumors into one
  const combineRumors = useCallback(async (
    rumorIds: string[],
    newRumorData: Partial<Rumor>,
    options: JoinOptions = {}
  ) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to combine rumours');
    }
    assertFitsOneCommit(rumorIds.length);

    if (rumorIds.some(id => !getRumorById(id))) {
      throw new Error('One or more rumours not found');
    }
    // Private rumours combine into a private one (T163).
    const scope = joinScope(rumorIds);
    const joinPath = scope.rumors;
    if (joinPath === null) {
      throw new Error('No campaign selected');
    }
    if (options.into && routing.isOwn(options.into) !== scope.isPrivate) {
      throw new Error('Private and shared rumours cannot be combined together.');
    }

    // Use the provided title or generate one
    const title = newRumorData.title || `Combined Rumour (${new Date().toLocaleDateString()})`;

    /*
      Into a rumour of the same title (T163): it takes what the combined one
      would have said -- empty fields filled, people and places joined, a
      text that differs kept in a note -- and the sources are marked as
      combined into it. One of the sources may be that rumour: it is not
      marked as combined into itself.
    */
    if (options.into) {
      const into = options.into;
      const sources = rumorIds.filter(id => id !== into);
      const fromNoteId = crypto.randomUUID();
      const differingNoteId = crypto.randomUUID();
      const sourceNoteIds = new Map(sources.map(id => [id, crypto.randomUUID()]));
      await firebaseServices.document.mergeIntoDocument<Rumor, Rumor>(
        joinPath, into, joinPath, async (target, read) => {
          const merging = await readAll(read, sources);
          const everyone = [target, ...merging];
          const incoming = {
            title,
            content: newRumorData.content ||
              merging.map(rumor => rumorParagraph(rumor, { attributed: true })).join('\n\n'),
            status: newRumorData.status,
            sourceType: newRumorData.sourceType,
            sourceName: newRumorData.sourceName,
            relatedNPCs: [...new Set(everyone.flatMap(rumor => rumor.relatedNPCs ?? []))],
            relatedLocations: [...new Set(everyone.flatMap(rumor => rumor.relatedLocations ?? []))],
          };
          const plan = planMerge('rumor', target, incoming);
          const differing = mergeNote('rumor', title, plan.differing);
          return {
            fields: plan.fields as Partial<Rumor>,
            updates: merging.map(rumor => ({ id: rumor.id, data: { status: 'confirmed' as RumorStatus } })),
            notes: [
              ...(sources.length
                ? [{ under: 'target' as const, id: fromNoteId, data: { content: `Combined from rumours: ${sources.join(', ')}` } }]
                : []),
              ...(differing ? [{ under: 'target' as const, id: differingNoteId, data: differing }] : []),
              ...merging.map(rumor => ({
                under: { updated: rumor.id },
                id: sourceNoteIds.get(rumor.id)!,
                data: { content: `Combined into rumour: ${into}` }
              }))
            ]
          };
        }
      );
      return into;
    }
    if (options.askOnSameName) assertNoSameNamed('rumor', title, rumors);

    // Fixed once, so a retried transaction writes the same notes, not more.
    // Every document, the notes included, is attributed by the write.
    const combinedNoteId = crypto.randomUUID();
    const sourceNoteIds = new Map(rumorIds.map(id => [id, crypto.randomUUID()]));

    /**
     * The combined rumour and the marks on its sources, worked out from the
     * sources as the server holds them (T088): their notes, links and text as
     * they are at the commit, not as this page last saw them.
     */
    const decide = (candidateId: string) => async (read: (id: string) => Promise<Rumor | undefined>) => {
      const rumorsToMerge = await readAll(read, rumorIds);

      const combinedContent = newRumorData.content ||
        rumorsToMerge.map(rumor => rumorParagraph(rumor, { attributed: true })).join('\n\n');
      const relatedNPCs = [...new Set(
        rumorsToMerge.flatMap(rumor => Array.isArray(rumor.relatedNPCs) ? rumor.relatedNPCs : [])
      )];
      const relatedLocations = [...new Set(
        rumorsToMerge.flatMap(rumor => Array.isArray(rumor.relatedLocations) ? rumor.relatedLocations : [])
      )];

      const create = {
        id: candidateId,
        title,
        content: combinedContent,
        status: newRumorData.status || 'unconfirmed',
        sourceType: newRumorData.sourceType || 'other',
        sourceName: newRumorData.sourceName || 'Multiple Sources',
        relatedNPCs,
        relatedLocations,
        notes: []
        // Attributed by the write, as every created document is.
      } satisfies Omit<Rumor, keyof ContentAttribution>;

      // Each original is confirmed and linked to the new one. Only the
      // fields that change are written.
      const updates = rumorsToMerge.map(rumor => ({
        id: rumor.id,
        data: { status: 'confirmed' as RumorStatus }
      }));
      // What happened, as notes of their own (T133), in the same commit.
      const notes = [
        { under: 'created' as const, id: combinedNoteId, data: { content: `Combined from rumours: ${rumorIds.join(', ')}` } },
        ...rumorsToMerge.map(rumor => ({
          under: { updated: rumor.id },
          id: sourceNoteIds.get(rumor.id)!,
          data: { content: `Combined into rumour: ${candidateId}` }
        }))
      ];
      return { create, updates, notes };
    };

    // The new rumour and the marks commit together (DATA-005), under an id
    // from the title, disambiguated on collision -- including with a rumour
    // another session wrote that the listener has not delivered yet (#1402).
    return createWithUniqueEntityId({
      name: title,
      issuedIds: issuedIds.current,
      isLoaded: isRumorLoaded,
      write: (candidateId) => createDocumentWithUpdates<Omit<Rumor, keyof ContentAttribution>, Rumor>(
        joinPath, candidateId, joinPath, decide(candidateId)
      ),
      onRefused: options.askOnSameName ? stopOnSameNamed('rumor', joinPath, title) : undefined
    });
  }, [user, userProfile, getRumorById, createDocumentWithUpdates, isRumorLoaded, rumors, joinScope, routing]);

  // Convert rumors to quest
  const convertToQuest = useCallback(async (rumorIds: string[], questData: any, options: JoinOptions = {}) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to convert rumours to quest');
    }
    assertFitsOneCommit(rumorIds.length);

    if (rumorIds.some(id => !getRumorById(id))) {
      throw new Error('One or more rumours not found');
    }
    // Private rumours convert into a private quest (T163).
    const scope = joinScope(rumorIds);
    const joinRumors = scope.rumors;
    const joinQuests = scope.quests;
    if (joinQuests === null || joinRumors === null) {
      throw new Error('No campaign selected');
    }
    if (options.into && isPrivateRecord('quest', options.into) !== scope.isPrivate) {
      throw new Error('Private rumours convert into a private quest, and shared ones into a shared quest.');
    }

    // Fixed once, as in `combineRumors`.
    const noteIds = new Map(rumorIds.map(id => [id, crypto.randomUUID()]));

    /*
      Into a quest of the same title (T163): it takes what the new quest
      would have said, as "Add what you know to it" does anywhere, and every
      rumour is marked as converted into it.
    */
    if (options.into) {
      const into = options.into;
      const differingNoteId = crypto.randomUUID();
      const author = getActiveCharacterName(activeGroupUserProfile) || getUserName(activeGroupUserProfile) || undefined;
      await firebaseServices.document.mergeIntoDocument<Record<string, unknown>, Rumor>(
        joinQuests, into, joinRumors, async (target, read) => {
          const rumorsToConvert = await readAll(read, rumorIds);
          const plan = planMerge('quest', target, questData);
          const differing = mergeNote('quest', questData.title || '', plan.differing, author);
          return {
            fields: plan.fields,
            updates: rumorsToConvert.map(rumor => ({ id: rumor.id, data: { convertedToQuestId: into } })),
            notes: [
              ...rumorsToConvert.map(rumor => ({
                under: { updated: rumor.id },
                id: noteIds.get(rumor.id)!,
                data: { content: `Converted to quest: ${into}` }
              })),
              ...(differing ? [{ under: 'target' as const, id: differingNoteId, data: differing }] : [])
            ]
          };
        }
      );
      return into;
    }

    /**
     * The quest, and every rumour marked as converted into it, from the
     * rumours as the server holds them (T088). Only the fields that change
     * are written.
     */
    const decide = (questId: string) => async (read: (id: string) => Promise<Rumor | undefined>) => {
      const rumorsToConvert = await readAll(read, rumorIds);
      return {
        create: { ...questData, id: questId },
        updates: rumorsToConvert.map(rumor => ({
          id: rumor.id,
          data: { convertedToQuestId: questId }
        })),
        // What happened, as a note of its own on each rumour (T133).
        notes: rumorsToConvert.map(rumor => ({
          under: { updated: rumor.id },
          id: noteIds.get(rumor.id)!,
          data: { content: `Converted to quest: ${questId}` }
        }))
      };
    };

    // The quest and the marks commit together (DATA-005). The ID comes from
    // the title. This writes into the `quests` collection, a different
    // id-space than this context loads, so there is no loaded-state lookup to
    // consult (never was): `issuedQuestIds` and the write's refusal of a taken
    // id are all that tell a taken quest slug apart. A title that slugifies to
    // a non-empty string keeps that slug unless it is taken, and an
    // empty/missing title falls back to a random id.
    return createWithUniqueEntityId({
      name: questData.title || '',
      issuedIds: issuedQuestIds.current,
      isLoaded: () => false,
      write: (questId) => createDocumentWithUpdates<Record<string, unknown>, Rumor>(
        joinQuests, questId, joinRumors, decide(questId)
      ),
      // The quests are not this context's list: the caller checks the ones it
      // holds, and a quest taken a moment ago stops here.
      onRefused: options.askOnSameName ? stopOnSameNamed('quest', joinQuests, questData.title || '') : undefined
    });
  }, [user, userProfile, activeGroupUserProfile, getRumorById, createDocumentWithUpdates, joinScope, isPrivateRecord]);

  const value: RumorContextValue = {
    rumors,
    isLoading: loading,
    // Trailing `|| null` normalizes the type. The real `useFirebaseData` declares
    // `useState<string | null>(null)`, so `writeError` is never `undefined` in
    // production -- but suites that mock the hook return an object with no `error`
    // key at all, which makes this expression `undefined` and violates the
    // `string | null` contract consumers rely on. Cheap to keep, and it means the
    // contract holds regardless of how the hook is supplied.
    error: error || writeError || null,
    // The read alone: a rejected write must not take the page down (T085).
    loadError: error || null,
    getRumorById,
    getRumorsByStatus,
    getRumorsByLocation,
    getRumorsByNPC,
    updateRumorStatus,
    updateRumorNote,
    addRumor,
    updateRumor,
    deleteRumor,
    updateRumorsStatus,
    deleteRumors,
    combineRumors,
    convertToQuest
  };

  return (
    <RumorDemandProvider value={demand.retain}>
      <RumorContext.Provider value={value}>
        {children}
      </RumorContext.Provider>
    </RumorDemandProvider>
  );
};

export const useRumors = (options: ListReaderOptions = {}) => {
  useRumorDemand(options.subscribe ?? true);
  const context = useContext(RumorContext);
  if (context === undefined) {
    throw new Error('useRumors must be used within a RumorProvider');
  }
  return context;
};