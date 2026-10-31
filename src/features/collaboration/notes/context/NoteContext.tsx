// src/features/collaboration/notes/context/NoteContext.tsx - Complete Fixed Version
import React, { createContext, useContext, useCallback, useState, useEffect, useMemo, useRef } from "react";
import { TEXT_LIMITS } from "core/constants/textLimits";
import { Note, NoteContextValue, EntityType, UnsavedNoteEdit, SameNameAnswer } from "../types";
import DocumentService from "core/services/firebase/data/DocumentService";
import { useAuth, useGroups, useCampaigns, useUser } from "features/user-management";
import { useRumors, useMergeIntoRecord } from "features/campaign-entities";
import { useCampaignContextStatus } from "shared/hooks/useCampaignContextStatus";
import { buildCreationAttribution } from "core/attribution";
import { useNavigate } from 'react-router-dom';
import { where } from "firebase/firestore";
import type { CreateAlongside } from "core/types/common";
import { createListenerDemandContext, useListenerDemand, ListReaderOptions } from "shared/hooks/useListenerDemand";

// Create the context with initial undefined value
const NoteContext = createContext<NoteContextValue | undefined>(undefined);

/**
 * Who is reading this provider's list right now (T032, `PERF-03`): the
 * listener is open only while some component that called `useNotes()` is
 * mounted, and for a while after. See `useListenerDemand`.
 */
const { DemandProvider: NoteDemandProvider, useDemand: useNoteDemand } = createListenerDemandContext();

/**
 * Provider component for note-related state and functionality
 */
export const NoteProvider: React.FC<{ children: React.ReactNode }> = ({ 
  children 
}) => {
  /**
   * The active campaign's saved notes, as the listener last delivered them,
   * tagged with the subscription they came from so a switch never shows the
   * previous campaign's notes. `null` until the first snapshot.
   */
  const [stored, setStored] = useState<{ key: string; notes: Note[] } | null>(null);
  /**
   * Notes created here but not saved yet (`isUnsaved`). They exist only in
   * this provider until their first save creates the document; from then on
   * the listener's copy is the note.
   */
  const [drafts, setDrafts] = useState<Note[]>([]);
  /**
   * Edits whose save failed after their editor had gone (T085): leaving a
   * note saves it, and the page that held it is no longer there to say the
   * save failed. Memory only -- nothing a note says is kept in the browser --
   * and a ref, because only an editor opening that note reads it.
   */
  const unsavedEditsRef = useRef<Map<string, UnsavedNoteEdit>>(new Map());
  const [error, setError] = useState<string | null>(null);
  /**
   * Bumped by `retry` to reopen a listener that failed. A failed listener is
   * closed for good, and nothing else changes the subscription's key on an
   * ordinary return to the page (RECOVERY-003).
   */
  const [attempt, setAttempt] = useState(0);
  const demand = useListenerDemand();
  const { user } = useAuth();
  const { activeGroupId } = useGroups();
  const { activeCampaignId } = useCampaigns();
  /**
   * Writing a rumour is part of converting one out of a note, because a
   * rumour has no create page to hand that job to. `RumorProvider` therefore
   * has to sit above `NoteProvider`, which it already does in `app/App.tsx`.
   */
  //
  // Write-only use, so it does not hold the rumour listener open (`PERF-03`):
  // this provider is mounted on every route.
  const { addRumor } = useRumors({ subscribe: false });
  const mergeIntoRecord = useMergeIntoRecord();
  const { activeGroupUserProfile } = useUser();
  // Single shared source of truth for "still resolving vs. genuinely no
  // selection" (bug #1413) -- see the hook's doc comment. Folded into
  // `isLoading` below so `NotesList`'s existing loading-before-"no campaign"
  // ordering holds on a fresh page load instead of briefly showing "No
  // Campaign Selected" while auth/group/campaign are still restoring.
  const { isResolving } = useCampaignContextStatus();
  const documentService = DocumentService.getInstance();
  const navigate = useNavigate();

  // Notes live flat at groups/{groupId}/users/{userId}/notes, joined to a
  // campaign by `campaignId`. No campaign, no listener: the group resolves
  // before the campaign does, and listening on the group alone would read
  // every campaign's notes for nothing (T029).
  const notesCollection = user?.uid && activeGroupId
    ? `groups/${activeGroupId}/users/${user.uid}/notes`
    : null;
  const scopeKey = notesCollection && activeCampaignId
    ? `${notesCollection}?campaignId=${activeCampaignId}`
    : null;
  // Open only while something reads the notes (`PERF-03`).
  const subscriptionKey = demand.wanted ? scopeKey : null;

  /*
    One listener on the active campaign's notes (T032). It delivers this
    client's own saves and deletes before their promises resolve, and edits
    made on another device, so nothing here re-reads the collection after a
    write. Constrained to the campaign, so its cost follows that campaign, not
    every campaign the user has played.
  */
  useEffect(() => {
    if (!notesCollection || !activeCampaignId || !subscriptionKey) {
      return;
    }
    setError(null);
    return documentService.subscribeToCollection<Note>(
      notesCollection,
      (documents) => setStored({ key: subscriptionKey, notes: documents }),
      (err) => {
        console.error("Error listening to notes:", err);
        setError("Failed to fetch notes");
        setStored({ key: subscriptionKey, notes: [] });
      },
      [where("campaignId", "==", activeCampaignId)]
    );
  }, [notesCollection, activeCampaignId, subscriptionKey, documentService, attempt]);

  /**
   * Reopen the listener after it failed. The failed snapshot is dropped, so
   * the list reads as loading until the new one arrives, not as empty.
   */
  const retry = useCallback(() => {
    setError(null);
    setStored(null);
    setAttempt((current) => current + 1);
  }, []);

  /*
    Switching campaign (or group, or user) drops the drafts made under the
    previous one. Saved notes need no clearing: `notes` below only uses a
    snapshot from the current subscription.
  */
  useEffect(() => {
    setDrafts([]);
    unsavedEditsRef.current.clear();
  }, [user?.uid, activeGroupId, activeCampaignId]);

  /** Saved notes and drafts together, most recently updated first. */
  const notes = useMemo(() => {
    if (!scopeKey) {
      return [];
    }
    // Drafts stay even while no listener is open; saved notes need one.
    const saved = subscriptionKey && stored?.key === subscriptionKey
      // The query already did this; kept so a note from another campaign can
      // never reach the list whatever the read layer returns.
      ? stored.notes
        .filter(note => note.campaignId === activeCampaignId)
        // Everything the listener delivers has a document, by definition.
        .map(note => ({ ...note, isUnsaved: false }))
      : [];
    const savedIds = new Set(saved.map(note => note.id));
    return [...drafts.filter(draft => !savedIds.has(draft.id)), ...saved].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [scopeKey, subscriptionKey, stored, drafts, activeCampaignId]);

  /**
   * Nothing delivered yet for the current campaign -- including while no
   * listener is open, which the component that reads the notes fixes on mount.
   */
  const loading = scopeKey !== null && stored?.key !== subscriptionKey;

  /**
   * Ids of notes whose document this provider has created, recorded the moment
   * the create resolves. `notes` only catches up on the next render, so a save
   * made from a context captured before then still sees `isUnsaved` -- and the
   * editor queues saves behind one in flight, so that is the normal case for a
   * new note's second save (T072). Without this, the second save creates the
   * document again (refused as "already exists") or `updateNote` keeps the
   * edit in memory only.
   */
  const createdIdsRef = useRef<Set<string>>(new Set());

  /** Whether the note has no Firestore document yet. */
  const isNotYetCreated = useCallback(
    (note: Note) => !!note.isUnsaved && !createdIdsRef.current.has(note.id),
    []
  );

  /**
   * Get a note by its ID
   */
  const getNoteById = useCallback((id: string) => {
    return notes.find(note => note.id === id);
  }, [notes]);

  /**
   * A new note's id: `note-` and a random suffix.
   *
   * Ids used to be sequential (`note-N`), allocated against every note in the
   * user's collection across all campaigns (bug #1422) -- which meant reading
   * all of them just to count. With the read constrained to one campaign that
   * count is no longer available, so an id no longer depends on what else
   * exists (T029). Old `note-N` ids and their URLs are untouched, and
   * `createDocument` still refuses to overwrite an id that is taken.
   */
  const generateNoteId = useCallback((): string =>
    `note-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  []);

  /**
   * Create a new note locally (not saved to Firebase until saveNote is called)
   */
  const createNote = useCallback(async (title: string, content: string): Promise<string> => {
    if (!user || !activeGroupId) throw new Error("User not authenticated or no active group");
    
    if (!activeCampaignId) {
      throw new Error("No active campaign selected. Please select a campaign before creating notes.");
    }
    
    const noteId = generateNoteId();
    const now = new Date().toISOString();
    const attribution = buildCreationAttribution({ uid: user.uid, activeGroupUserProfile });

    // Create note object locally only - don't save to Firebase yet
    const newNote: Note = {
      id: noteId,
      title,
      content,
      extractedEntities: [],
      status: "active",
      tags: [],
      updatedAt: now,
      ...attribution,
      campaignId: activeCampaignId,
      isUnsaved: true, // Mark as unsaved
    };
    
    // Add to local state immediately for instant feedback
    setDrafts(prevDrafts => [newNote, ...prevDrafts]);

    return noteId;
  }, [user, activeGroupId, activeCampaignId, generateNoteId, activeGroupUserProfile]);

  /**
   * Save a note to Firebase (handles both new and existing notes)
   */
  const saveNote = useCallback(async (noteId: string, updates: Partial<Note> = {}) => {
    if (!notesCollection) {
      throw new Error("User not authenticated or no active group");
    }

    const note = getNoteById(noteId);
    if (!note) throw new Error("Note not found");

    const now = new Date().toISOString();

    const updatedFields = {
      ...updates,
      updatedAt: now,
      // Don't include isUnsaved in updates - we'll handle it separately
    };

    if (isNotYetCreated(note)) {
      // First save - create document (exclude isUnsaved field entirely)
      const noteToSave = { ...note, ...updatedFields };
      delete noteToSave.isUnsaved; // Remove before saving

      await documentService.createDocument(notesCollection, noteToSave, noteId);
      createdIdsRef.current.add(noteId);
      // The listener already holds the created document; the draft is done.
      setDrafts(prevDrafts => prevDrafts.filter(draft => draft.id !== noteId));
    } else {
      // Update existing document (don't send isUnsaved field). Attribution
      // is now stamped by DocumentService itself, not hand-rolled here. The
      // listener carries the change back; nothing is patched locally.
      await documentService.updateDocumentWithAttribution(notesCollection, noteId, updatedFields);
    }
  }, [notesCollection, documentService, getNoteById, isNotYetCreated]);

  /**
   * Update a note (now calls saveNote internally for saved notes, updates locally for unsaved)
   */
  const updateNote = useCallback(async (noteId: string, updates: Partial<Note>) => {
    const note = getNoteById(noteId);
    if (!note) throw new Error("Note not found");
    
    if (isNotYetCreated(note)) {
      // Just update local state for unsaved notes (don't save to Firebase yet)
      const now = new Date().toISOString();
      const updatedLocalFields = {
        ...updates,
        updatedAt: now,
        // Keep isUnsaved: true for local notes
      };
      
      setDrafts(prevDrafts =>
        prevDrafts.map(draft =>
          draft.id === noteId
            ? { ...draft, ...updatedLocalFields }
            : draft
        )
      );
    } else {
      // Save immediately for existing notes (this will remove isUnsaved if present)
      await saveNote(noteId, updates);
    }
  }, [getNoteById, saveNote, isNotYetCreated]);
  
  /**
   * Mark an entity as converted in the note
   * This is called after the user successfully creates the campaign element
   */
  const markEntityAsConverted = useCallback(async (
    noteId: string,
    entityId: string,
    createdId: string
  ): Promise<void> => {
    const note = getNoteById(noteId);
    if (!note) throw new Error("Note not found");

    const mark = (entities: Note['extractedEntities']) =>
      (entities ?? []).map(e =>
        e.id === entityId ? { ...e, isConverted: true, convertedToId: createdId } : e
      );

    // A draft lives only in this provider's state: marked in that state as it
    // is now, not in the copy this render saw, for the same reason as below.
    if (isNotYetCreated(note)) {
      const now = new Date().toISOString();
      setDrafts(prevDrafts =>
        prevDrafts.map(draft =>
          draft.id === noteId
            ? { ...draft, extractedEntities: mark(draft.extractedEntities), updatedAt: now }
            : draft
        )
      );
      return;
    }

    if (!notesCollection) {
      throw new Error("User not authenticated or no active group");
    }

    // Marked in the list as stored, read in a transaction (T083): converting
    // the next entity before the listener has delivered this one's mark would
    // otherwise write the unmarked list back over it.
    await documentService.updateDocumentAfterReading<Note>(notesCollection, noteId, async (read) => {
      const current = await read(noteId);
      if (!current) throw new Error("Note not found");
      return { extractedEntities: mark(current.extractedEntities), updatedAt: new Date().toISOString() };
    });
  }, [getNoteById, isNotYetCreated, documentService, notesCollection]);
  
  /**
   * Create the record an extracted entity becomes, and mark the entity
   * converted into it, as one commit (T088, DATA-005).
   *
   * A saved note's mark goes to `create` as the change that commits with the
   * record: created first and marked after, a failed mark left the record
   * behind while the note still offered to convert it again. The mark is
   * worked out from the note as the server holds it, and refuses an entity
   * that is already converted, so a retry after an unseen success makes
   * nothing. A draft exists only in this provider's state, with nothing
   * stored to commit with: it is marked here once the record exists.
   */
  const convertInto = useCallback(async (
    noteId: string,
    entityId: string,
    create: (alongside?: CreateAlongside<Note>) => Promise<string>
  ): Promise<string> => {
    const note = getNoteById(noteId);
    if (!note) throw new Error("Note not found");

    if (isNotYetCreated(note)) {
      const createdId = await create();
      await markEntityAsConverted(noteId, entityId, createdId);
      return createdId;
    }

    if (!notesCollection) {
      throw new Error("User not authenticated or no active group");
    }

    return create({
      collection: notesCollection,
      id: noteId,
      change: (current, createdId) => {
        if (!current) throw new Error("Note not found");
        const entities = current.extractedEntities ?? [];
        const target = entities.find(e => e.id === entityId);
        if (!target) throw new Error("Entity not found in note");
        if (target.isConverted) throw new Error("This has already been converted");
        return {
          extractedEntities: entities.map(e =>
            e.id === entityId ? { ...e, isConverted: true, convertedToId: createdId } : e
          ),
          updatedAt: new Date().toISOString(),
        };
      },
    });
  }, [getNoteById, isNotYetCreated, markEntityAsConverted, notesCollection]);

  /**
   * Convert an extracted entity to a campaign element.
   *
   * Three of the four navigate to a create page with the extracted fields in
   * router state, and the form there writes the record.
   *
   * **The rumour does not, because a rumour has no page**.
   * `/rumors/create` existed only to receive
   * this navigation -- the campaign-entities barrel said so in as many words
   * -- and what it offered was a form for reviewing five fields that were
   * already complete before it opened. The rumour is written here instead,
   * and the list opens its row, which is the same surface every other rumour
   * is edited in. That is what retired `RumorForm` and the page around it.
   *
   * It is also the only branch that returns a real id rather than `""`; the
   * other three cannot, because nothing is created until their form is
   * submitted.
   */
  const convertEntity = useCallback(async (
    noteId: string,
    entityId: string,
    type: EntityType,
    sameName?: SameNameAnswer,
    options: { private?: boolean } = {}
  ): Promise<string> => {
    const note = getNoteById(noteId);
    if (!note) throw new Error("Note not found");
    
    const entity = note.extractedEntities.find(e => e.id === entityId);
    if (!entity) throw new Error("Entity not found");
    
    // Parse extra data from entity if available
    const extraData = entity.extraData || {};
    
    // Prepare initial data for the create form based on entity type
    let initialData: any = {};
    const provenance = `Created from note: ${note.title || note.id}`;

    /**
     * The note's own sentence about this entity, kept rather than dropped.
     *
     * `context` is the line the extractor read the entity out of, and it used
     * to survive only when the model returned no `description` -- the moment
     * it wrote one, the sentence the fact actually came from was discarded,
     * along with the note it came from. That is the opposite of the useful
     * case: a described entity is exactly the one worth being able to trace.
     *
     * Both are kept now, with the model's description first because it is the
     * summary, and the quoted sentence under it because it is the evidence.
     */
    const withContext = (modelDescription?: string): string => {
      const body = modelDescription?.trim() || provenance;
      const context = extraData.context?.trim();
      if (!context || body.includes(context)) return body;
      return `${body}\n\nContext: ${context}`;
    };

    switch (type) {
      case "npc":
        initialData = {
          // Use proper name field, fall back to text if not available
          name: extraData.name || entity.text,
          title: extraData.title || undefined,
          race: extraData.race || undefined,
          occupation: extraData.occupation || undefined,
          location: extraData.location || undefined,
          relationship: extraData.relationship || undefined,
          description: withContext(extraData.description),
        };
        break;

      case "location":
        initialData = {
          // Use proper name field, fall back to text if not available
          name: extraData.name || entity.text,
          type: extraData.locationType || undefined,
          description: withContext(extraData.description),
          parentId: extraData.parentLocation || undefined,
        };
        break;

      case "quest": {
        /*
          `relatedNPCNames`, which is what the schema now asks for and what the
          model was always answering. They are carried as *names* and become
          ids at the write boundary, where the NPC collection is loaded
          (`resolveCarriedNames`). This used to read `relatedNPCIds` and store
          the names under that key, so every one of them resolved to nothing on
          the quest card and rendered as "Someone no longer in the directory".

          They are no longer pasted into the description either. That was a
          workaround for the ids not resolving -- the names went into the prose
          so the reader could at least see them -- and now that the relation
          itself works, keeping it would print every person twice.
        */
        const relatedNPCNames: string[] = extraData.relatedNPCNames || [];

        initialData = {
          // Use proper title field, fall back to text if not available
          title: extraData.title || entity.text,
          description: withContext(extraData.description),
          // `string[]` from the schema; `normaliseObjectives` at the write
          // boundary turns it into the `QuestObjective[]` a quest stores.
          objectives: extraData.objectives || [],
          relatedNPCNames,
          location: extraData.locationName || undefined,
        };
        break;
      }
        
      case "rumor": {
        // Map sourceType to valid values. Anything unrecognised is left unset
        // rather than coerced to 'other' -- since `15-9` that means "heard
        // from none of the other four", a real answer, and the extractor
        // guessing it would be answering on the reader's behalf.
        const validSourceTypes = ['npc', 'tavern', 'notice', 'traveler', 'other'];
        const sourceType =
          extraData.sourceType && validSourceTypes.includes(extraData.sourceType)
            ? extraData.sourceType
            : undefined;

        // Whitelisted, exactly as the source kind above is. The extraction
        // function's JSON schema offers a fourth status, "unknown", that
        // `RumorStatus` does not have -- and a rumour nobody has verified is
        // precisely what "unconfirmed" already names. This was taken on trust
        // until a converted note wrote `status: "unknown"` into Firestore,
        // where the rumours list could not group it and silently dropped the
        // row. `RumorForm`'s `<select>` had been sanitising it by accident.
        const validStatuses = ['confirmed', 'unconfirmed', 'false'];
        const status = validStatuses.includes(extraData.status)
          ? extraData.status
          : 'unconfirmed';

        const rumor = {
          // A passage can be longer than a title may be (T119); the content keeps all of it.
          title: (extraData.title || entity.text).slice(0, TEXT_LIMITS.line),
          content: extraData.content || '',
          status,
          ...(sourceType ? { sourceType } : {}),
          /*
            The extractor's own `sourceName` ("Gaffer Gamgee"), which this
            ignored: it wrote `sourceType` into the name, so a converted
            rumour's source read "npc" under a source kind of NPC -- the same
            fact twice, once in the wrong field. The raw `sourceType` is still
            the fallback, but only when it was not a recognised kind, which is
            the case that fallback was actually for: an unrecognised value is
            usually the source's *name* in the wrong field.
          */
          sourceName: extraData.sourceName || (sourceType ? '' : extraData.sourceType || ''),
          relatedNPCs: [],
          relatedLocations: [],
          notes: [],
        };
        // The rumour and the note's mark commit together (T088). A draft
        // note has no mark to send; it is marked once the rumour exists.
        // A title a rumour already carries stops the write (T163) until the
        // caller brings the player's answer: add to that rumour, whose id
        // the mark then names, or create under the name given.
        const rumorId = await convertInto(noteId, entityId, (alongside) => {
          if (sameName && "merge" in sameName) {
            return mergeIntoRecord('rumor', sameName.merge, rumor, alongside);
          }
          const named = sameName ? { ...rumor, title: sameName.createAs } : rumor;
          return addRumor(named, alongside, {
            askOnSameName: !sameName?.anyway,
            // Kept to the player, when they added it as private (T163).
            ...(options.private ? { private: true } : {}),
          });
        });

        navigate(`/rumors?highlight=${rumorId}`);
        return rumorId;
      }
    }

    // Navigate to the appropriate create page with the initial data
    switch (type) {
      case "npc":
        navigate('/npcs/create', { 
          state: { 
            initialData,
            noteId, 
            entityId,
            ...(options.private ? { private: true } : {}),
          } 
        });
        break;
      case "location":
        navigate('/locations/create', { 
          state: { 
            initialData,
            noteId, 
            entityId,
            ...(options.private ? { private: true } : {}),
          } 
        });
        break;
      case "quest":
        navigate('/quests/create', { 
          state: { 
            initialData,
            noteId, 
            entityId,
            ...(options.private ? { private: true } : {}),
          } 
        });
        break;
    }
    
    // Return empty string since we're not creating immediately. The rumour
    // branch returned above, with a real id.
    return "";
  }, [getNoteById, navigate, addRumor, convertInto, mergeIntoRecord]);
  
  /**
   * Archive a note
   */
  const archiveNote = useCallback(async (noteId: string) => {
    await updateNote(noteId, { status: "archived" });
  }, [updateNote]);
  
  /**
   * Delete a note
   */
  const deleteNote = useCallback(async (noteId: string) => {
    if (!notesCollection) {
      throw new Error("User not authenticated or no active group");
    }

    // A draft has no document to delete.
    setDrafts(prevDrafts => prevDrafts.filter(draft => draft.id !== noteId));
    await documentService.deleteDocument(notesCollection, noteId);
  }, [notesCollection, documentService]);
  
  const getUnsavedEdit = useCallback(
    (noteId: string) => unsavedEditsRef.current.get(noteId),
    []
  );

  const setUnsavedEdit = useCallback((noteId: string, edit: UnsavedNoteEdit | undefined) => {
    if (edit) unsavedEditsRef.current.set(noteId, edit);
    else unsavedEditsRef.current.delete(noteId);
  }, []);

  // Create context value
  const value: NoteContextValue = {
    notes,
    /*
      `isLoading` means "there is nothing to show yet", never "a read is in
      flight" (T044): `NotesPage` and `NotePage` gate on it, and the raw flag
      once swapped the page for its skeleton on every delete. See
      `useCampaignCollection` for the full reasoning. The `isResolving` half
      (bug #1413) stays unconditional.
    */
    isLoading: (loading && notes.length === 0) || isResolving,
    error,
    retry,
    getNoteById,
    createNote,
    saveNote, // Add saveNote to context
    convertEntity,
    updateNote,
    getUnsavedEdit,
    setUnsavedEdit,
    archiveNote,
    deleteNote,
    markEntityAsConverted,
    convertInto,
  };
  
  return (
    <NoteDemandProvider value={demand.retain}>
      <NoteContext.Provider value={value}>
        {children}
      </NoteContext.Provider>
    </NoteDemandProvider>
  );
};

/**
 * Custom hook to use the note context
 * @throws Error if used outside of NoteProvider
 */
export const useNotes = (options: ListReaderOptions = {}): NoteContextValue => {
  useNoteDemand(options.subscribe ?? true);
  const context = useContext(NoteContext);
  if (context === undefined) {
    throw new Error("useNotes must be used within a NoteProvider");
  }
  return context;
};