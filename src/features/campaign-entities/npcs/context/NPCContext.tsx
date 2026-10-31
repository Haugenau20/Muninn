// src/features/campaign-entities/npcs/context/NPCContext.tsx
import React, { createContext, useContext, useCallback, useRef } from 'react';
import { NPC, NPCContextValue, NPCRelationship, NPCNote, NPCStatus } from '../types';
import { DomainData, RecordChange, CreateAlongside, CreateOptions } from 'core/types/common';
import { useNPCData } from '../hooks/useNPCData';
import { useFirebaseData } from 'shared/hooks/useFirebaseData';
import { writeRecordChange } from '../../shared/writeRecordChange';
import { useCampaignCollectionPath } from 'shared/hooks/useCampaignCollectionPath';
import { useAuth, useUser } from 'features/user-management';
import { createWithUniqueEntityId } from 'core/utils/entity-id';
import { buildModificationAttribution, modificationTimes } from 'core/attribution';
import { commitEntityWrites } from '../../shared/commitEntityWrites';
import { unlinkDeletedQuietly, useCampaignRecordPaths } from '../../shared/unlinkDeleted';
import { addRecordNote, deleteRecordNotes } from '../../shared/recordNotes';
import { assertNoSameNamed, stopOnSameNamed } from '../../shared/sameName';
import { releaseImage } from 'shared/hooks/useImageAttachment';
import { createListenerDemandContext, useListenerDemand, ListReaderOptions } from 'shared/hooks/useListenerDemand';

const NPCContext = createContext<NPCContextValue | undefined>(undefined);

/**
 * Hands a ready value to everything under it, in place of
 * `NPCProvider`'s own: the example campaign's records, for a page drawn from
 * it (`../../example/ExampleCampaignProvider`).
 */
export const NPCContextValueProvider = NPCContext.Provider;

/**
 * Who is reading this provider's list right now (T032, `PERF-03`): the
 * listener is open only while some component that called `useNPCs()` is
 * mounted, and for a while after. See `useListenerDemand`.
 */
const { DemandProvider: NPCDemandProvider, useDemand: useNPCDemand } = createListenerDemandContext();

export const NPCProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Use the NPCData hook for basic CRUD operations
  const demand = useListenerDemand();
  const { npcs, loading, error, refreshNPCs, hasRequiredContext } = useNPCData({ enabled: demand.wanted });
  const { user } = useAuth();
  const { userProfile, activeGroupUserProfile } = useUser();
  
  // Additional Firebase hook for specific updates. Its `error` is renamed on
  // destructure (`writeError`) because the read instance above already binds
  // the name `error` -- this second instance is the one whose writes
  // (addData/updateData/deleteData) can actually fail, and its error was
  // previously dropped entirely (bug #1401).
  //
  // `autoFetch: false` because nothing renders off this instance's `data`:
  // the list comes from `useNPCData()` above. It used to fetch the whole
  // collection anyway, so every mount read `npcs` twice.
  //
  // Writes name this render's campaign by full path, so one started here
  // lands here even if the player switches campaign before it runs (T082).
  const npcsPath = useCampaignCollectionPath('npcs');
  const recordPaths = useCampaignRecordPaths();
  const { updateData, updateDataAfterReading, deleteData, addData, error: writeError } = useFirebaseData<NPC>({
    collection: npcsPath,
    autoFetch: false
  });

  // Get NPC by ID
  const getNPCById = useCallback((id: string) => {
    return npcs.find(npc => npc.id === id);
  }, [npcs]);

  // Get NPCs by relationship
  const getNPCsByRelationship = useCallback((relationship: NPCRelationship) => {
    return npcs.filter(npc => 
      npc.relationship === relationship
    );
  }, [npcs]);

  // Update NPC note
  const updateNPCNote = useCallback(async (npcId: string, note: NPCNote) => {
    if (!hasRequiredContext) {
      throw new Error('Cannot update NPC note: No group or campaign selected');
    }

    if (!user || !userProfile) {
      throw new Error('User must be authenticated to add notes');
    }

    const npc = getNPCById(npcId);
    if (!npc) {
      throw new Error('NPC not found');
    }

    // A note of its own (T133), not one more entry in the record.
    if (!npcsPath) throw new Error('No campaign selected');
    await addRecordNote(npcsPath, npcId, { ...note });
  }, [getNPCById, hasRequiredContext, user, userProfile, npcsPath]);

  // Update NPC relationship
  const updateNPCRelationship = useCallback(async (npcId: string, relationship: NPCRelationship) => {
    if (!hasRequiredContext) {
      throw new Error('Cannot update NPC relationship: No group or campaign selected');
    }

    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update relationship');
    }

    if (!getNPCById(npcId)) {
      throw new Error('NPC not found');
    }

    await updateData(npcId, { relationship });
  }, [getNPCById, updateData, hasRequiredContext, user, userProfile]);

  // Ids issued during this session but not yet reflected in `npcs` (loaded
  // state). Two NPCs can be created back-to-back within a single `act()` /
  // event handler before the first create's write has come back through
  // the listener and re-rendered this provider -- a collision check
  // against `npcs`/`getNPCById` alone would miss that first id and silently
  // let the second create overwrite it. This ref is the second source of
  // truth `isTaken` below consults, alongside already-loaded data.
  const issuedIds = useRef<Set<string>>(new Set());

  // Add a new NPC
  const addNPC = useCallback(async (
    npcData: DomainData<NPC>,
    alongside?: CreateAlongside,
    options: CreateOptions = {}
  ): Promise<string> => {
    if (!hasRequiredContext) {
      throw new Error('Cannot add NPC: No group or campaign selected');
    }

    if (!user || !userProfile) {
      throw new Error('User must be authenticated to add an NPC');
    }

    // Not a complete NPC -- attribution is stamped by DocumentService.createDocument,
    // not supplied here. See DomainData's doc comment in core/types/common.ts.
    //
    // The id is derived inside createWithUniqueEntityId, which also takes the
    // next free one if another session has since written the same slug (#1402).
    // A record already carrying the name stops here when the caller asks
    // (T163): one the client holds, or one that took the id a moment ago.
    if (options.askOnSameName) assertNoSameNamed('npc', npcData.name, npcs);
    const id = await createWithUniqueEntityId({
      name: npcData.name,
      issuedIds: issuedIds.current,
      isLoaded: (candidateId) => Boolean(getNPCById(candidateId)),
      write: (candidateId) => addData({ ...npcData, id: candidateId }, candidateId, ...(alongside ? [alongside] : [])),
      onRefused: options.askOnSameName && npcsPath ? stopOnSameNamed('npc', npcsPath, npcData.name) : undefined
    });

    return id;
  }, [hasRequiredContext, user, userProfile, getNPCById, addData, npcs, npcsPath]);

  // Update an existing NPC: only what `change` names; see `RecordChange` (T083)
  const updateNPC = useCallback(async (npcId: string, change: RecordChange<NPC>): Promise<void> => {
    if (!hasRequiredContext) {
      throw new Error('Cannot update NPC: No group or campaign selected');
    }

    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update an NPC');
    }

    if (!getNPCById(npcId)) {
      throw new Error('NPC not found');
    }

    await writeRecordChange({ updateData, updateDataAfterReading }, npcId, change, 'NPC not found');
  }, [hasRequiredContext, user, userProfile, getNPCById, updateData, updateDataAfterReading]);

  // Delete an NPC
  const deleteNPC = useCallback(async (npcId: string): Promise<void> => {
    if (!hasRequiredContext) {
      throw new Error('Cannot delete NPC: No group or campaign selected');
    }

    if (!user) {
      throw new Error('User must be authenticated to delete an NPC');
    }

    const image = getNPCById(npcId)?.image;
    const discard = image ? releaseImage(image.path) : undefined;
    // Its notes first (T133): a record's subcollection outlives the record.
    if (npcsPath) await deleteRecordNotes(npcsPath, [npcId]);
    await deleteData(npcId);
    // After the document: a failure can then only orphan the file, which the
    // released record lets the daily sweep find.
    discard?.();
    // And out of every list that named them (T131).
    await unlinkDeletedQuietly(recordPaths, 'npc', [npcId]);
  }, [hasRequiredContext, user, getNPCById, deleteData, recordPaths, npcsPath]);

  /**
   * Sets the status of several NPCs in one batch (T017): one round trip, and
   * all or nothing, so a batch action never leaves half the selection changed.
   */
  const updateNPCsStatus = useCallback(async (npcIds: string[], status: NPCStatus): Promise<void> => {
    if (!hasRequiredContext) {
      throw new Error('Cannot update NPCs: No group or campaign selected');
    }

    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update NPCs');
    }

    if (npcIds.some(id => !getNPCById(id))) {
      throw new Error('One or more NPCs not found');
    }

    const modificationAttribution = buildModificationAttribution({ uid: user.uid, activeGroupUserProfile });
    await commitEntityWrites<NPC>(npcsPath, 'NPCs', npcIds.map(id => ({
      type: 'update' as const,
      id,
      data: { status, ...modificationAttribution, ...modificationTimes() }
    })));
  }, [hasRequiredContext, user, userProfile, activeGroupUserProfile, getNPCById, npcsPath]);

  /** Deletes several NPCs in one batch, then their portraits, as `deleteNPC` does for one. */
  const deleteNPCs = useCallback(async (npcIds: string[]): Promise<void> => {
    if (!hasRequiredContext) {
      throw new Error('Cannot delete NPCs: No group or campaign selected');
    }

    if (!user) {
      throw new Error('User must be authenticated to delete NPCs');
    }

    const discards = npcIds.flatMap(id => {
      const image = getNPCById(id)?.image;
      return image ? [releaseImage(image.path)] : [];
    });
    if (npcsPath) await deleteRecordNotes(npcsPath, npcIds);
    await commitEntityWrites<NPC>(npcsPath, 'NPCs', npcIds.map(id => ({ type: 'delete' as const, id })));
    // After the documents: a failure can then only orphan files.
    discards.forEach(discard => discard());
    await unlinkDeletedQuietly(recordPaths, 'npc', npcIds);
  }, [hasRequiredContext, user, getNPCById, npcsPath, recordPaths]);

  const value: NPCContextValue = {
    npcs,
    isLoading: loading,
    // Trailing `|| null` normalizes the type. The real `useFirebaseData` declares
    // `useState<string | null>(null)`, so `writeError` is never `undefined` in
    // production -- but suites that mock the hook return an object with no `error`
    // key at all, which makes this expression `undefined` and violates the
    // `string | null` contract consumers rely on. Cheap to keep, and it means the
    // contract holds regardless of how the hook is supplied.
    // Missing group/campaign is a STATE, not an error, and this no longer
    // fabricates a sentence out of it. A context can see that `activeGroupId`
    // is absent, but not WHY -- signed out, still resolving, or simply between
    // campaigns are three different situations needing three different things
    // said, and only the page knows which one it is in. `usePageGate` makes
    // that distinction and `gated-page-copy.ts` holds the words.
    error: error || writeError || null,
    // The read alone: a rejected write must not take the page down (T085).
    loadError: error || null,
    getNPCById,
    getNPCsByRelationship,
    updateNPCNote,
    updateNPCRelationship,
    addNPC,
    updateNPC,
    deleteNPC,
    updateNPCsStatus,
    deleteNPCs,
    refreshNPCs,
    hasRequiredContext
  };

  return (
    <NPCDemandProvider value={demand.retain}>
      <NPCContext.Provider value={value}>
        {children}
      </NPCContext.Provider>
    </NPCDemandProvider>
  );
};

export const useNPCs = (options: ListReaderOptions = {}) => {
  useNPCDemand(options.subscribe ?? true);
  const context = useContext(NPCContext);
  if (context === undefined) {
    throw new Error('useNPCs must be used within an NPCProvider');
  }
  return context;
};