// src/features/campaign-entities/quests/context/QuestContext.tsx
import React, { createContext, useContext, useCallback, useMemo, useRef } from 'react';
import { Quest, QuestStatus, QuestContextValue, QuestNote } from '../types';
import { DomainData, RecordChange, CreateAlongside, CreateOptions } from 'core/types/common';
import { useQuestData } from '../hooks/useQuestData';
import { useFirebaseData } from 'shared/hooks/useFirebaseData';
import { writeRecordChange } from '../../shared/writeRecordChange';
import { useCampaignCollectionPath } from 'shared/hooks/useCampaignCollectionPath';
import { useAuth, useUser, useGroups, useCampaigns } from 'features/user-management';
import { createWithUniqueEntityId } from 'core/utils/entity-id';
import { buildModificationAttribution, modificationTimes } from 'core/attribution';
import { commitEntityWrites } from '../../shared/commitEntityWrites';
import { unlinkDeletedQuietly, useCampaignRecordPaths } from '../../shared/unlinkDeleted';
import { keyPlaceIsLocation, referencesLocation } from '../../locations/utils/location-display';
import { moveObjective } from '../utils/quest-presentation';
import { normaliseObjectives } from '../utils/quest-objectives';
import { addRecordNote, deleteRecordNotes } from '../../shared/recordNotes';
import { assertNoSameNamed, stopOnSameNamed } from '../../shared/sameName';
import { usePrivateRouting } from '../../shared/private/usePrivateRouting';
import { assertUnchanged } from 'shared/utils/edit-conflict';
import { Location } from '../../locations/types';
import { createListenerDemandContext, useListenerDemand, ListReaderOptions } from 'shared/hooks/useListenerDemand';

// Create the context but DON'T export it (to match NPCContext pattern)
const QuestContext = createContext<QuestContextValue | undefined>(undefined);

/**
 * Hands a ready value to everything under it, in place of
 * `QuestProvider`'s own: the example campaign's records, for a page drawn from
 * it (`../../example/ExampleCampaignProvider`).
 */
export const QuestContextValueProvider = QuestContext.Provider;

/**
 * Who is reading this provider's list right now (T032, `PERF-03`): the
 * listener is open only while some component that called `useQuests()` is
 * mounted, and for a while after. See `useListenerDemand`.
 */
const { DemandProvider: QuestDemandProvider, useDemand: useQuestDemand } = createListenerDemandContext();

export const QuestProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Use the useQuestData hook to handle data fetching
  const demand = useListenerDemand();
  const { quests, loading, error, getQuestById, refreshQuests: fetchQuests, hasRequiredContext } = useQuestData({ enabled: demand.wanted });
  // `autoFetch: false` because nothing renders off this instance's `data`:
  // the list comes from `useQuestData()` above. Its `error` is bound as
  // `writeError` so write failures are not conflated with read failures
  // (bug #1401).
  // Writes name this render's campaign by full path, so one started here
  // lands here even if the player switches campaign before it runs (T082).
  const questsPath = useCampaignCollectionPath('quests');
  const recordPaths = useCampaignRecordPaths();
  const { addData, updateData, updateDataAfterReading, deleteData, error: writeError } = useFirebaseData<Quest>({
    collection: questsPath,
    autoFetch: false
  });
  // A private quest's writes go to its author's private space (T163).
  const sharedWriters = useMemo(
    () => ({ updateData, updateDataAfterReading, deleteData, addData }),
    [updateData, updateDataAfterReading, deleteData, addData]
  );
  const routing = usePrivateRouting<Quest>('quest', questsPath, sharedWriters);
  const { user } = useAuth();
  const { userProfile, activeGroupUserProfile } = useUser();
  const { activeGroupId } = useGroups();
  const { activeCampaignId } = useCampaigns();

  // Create a wrapper for fetchQuests that returns void instead of Quest[]
  const refreshQuests = useCallback(async (): Promise<void> => {
    await fetchQuests();
  }, [fetchQuests]);

  // Get quests by status
  const getQuestsByStatus = useCallback((status: QuestStatus) => {
    return quests.filter(quest => quest.status === status);
  }, [quests]);

  // Get quests by location: those whose `locationId` names it (free text in
  // `location` names no record; see the contract on `NPC.location`). A place
  // inside the quest (`keyLocations`) counts too when it is that Location: by
  // the id it stored, else by its name (#1421, `keyPlaceIsLocation`).
  //
  // Takes the whole `Location`, not a bare id, because a place's name is
  // matched against the Location's name as well as its id.
  const getQuestsByLocation = useCallback((location: Location) => {
    return quests.filter(quest =>
      referencesLocation(quest, location) ||
      quest.keyLocations?.some(place => keyPlaceIsLocation(place, location))
    );
  }, [quests]);

  // Get quests by NPC
  // One relation list (D15.7). This used to also match `importantNPCs` by
  // `npc.name === npcId` -- comparing a free-text name against an id, which
  // could only ever match by accident.
  const getQuestsByNPC = useCallback((npcId: string) => {
    return quests.filter(quest => quest.relatedNPCIds?.includes(npcId));
  }, [quests]);

  // Ids issued during this session but not yet reflected in `quests` (loaded
  // state). Two quests can be created back-to-back within a single `act()` /
  // event handler before the first create's write has come back through
  // the listener and re-rendered this provider -- a collision check
  // against `getQuestById` alone would miss that first id and silently let
  // the second create overwrite it. This ref is the second source of truth
  // `isTaken` below consults, alongside already-loaded data.
  const issuedIds = useRef<Set<string>>(new Set());

  // Update quest status
  const updateQuestStatus = useCallback(async (questId: string, status: QuestStatus) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update quest status');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to update quest status');
    }

    if (!getQuestById(questId)) {
      throw new Error('Quest not found');
    }

    const now = new Date().toISOString();

    // The status alone (T083), and the completion date if completing.
    await routing.writersFor(questId).updateData(questId, {
      status,
      ...(status === 'completed' && { dateCompleted: now })
    });
  }, [user, userProfile, activeGroupId, activeCampaignId, getQuestById, routing]);

  /**
   * The one guard every objective write shares: signed in, a campaign in
   * context, and a quest that exists. Returns the quest so the caller can
   * work from it.
   */
  const questForObjectiveWrite = useCallback((questId: string): Quest => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update objectives');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to update objectives');
    }

    const quest = getQuestById(questId);
    if (!quest) {
      throw new Error('Quest not found');
    }

    return quest;
  }, [user, userProfile, activeGroupId, activeCampaignId, getQuestById]);

  /**
   * Write a new objective list, leaving every other field of the quest alone
   * (T083). Only `objectives` is sent, and `next` works it out from the list
   * the server holds, read in a transaction -- normalised as the listener
   * normalises it -- so two ticks made from copies of the same moment both
   * land instead of the second undoing the first.
   */
  const writeObjectives = useCallback(
    async (questId: string, next: (objectives: Quest['objectives']) => Quest['objectives']) => {
      await writeRecordChange(
        routing.writersFor(questId),
        questId,
        (quest) => ({ objectives: next(normaliseObjectives(quest.objectives)) }),
        'Quest not found'
      );
    },
    [routing]
  );

  /**
   * Tick or untick one objective.
   *
   * **Completing the last objective no longer completes the quest** (`15-5`
   * item 7). It used to, silently: ticking the third of three flipped the
   * status to `completed` and stamped `dateCompleted` in the same write, with
   * nothing on screen saying so. A party that ticks the last objective has
   * usually not finished the quest -- the reward is unclaimed, the patron
   * unvisited -- and a status nobody chose is a status nobody trusts.
   *
   * The offer lives on the page (`QuestObjectives`), which shows *"Every
   * objective is ticked -- mark the quest completed?"* and completes only when
   * asked. `markQuestCompleted` is still the one write that concludes a quest.
   *
   * A ticked objective keeps its place in the list: the array is mapped, never
   * reordered or partitioned, so nothing moves under someone mid-session.
   */
  const updateQuestObjective = useCallback(async (questId: string, objectiveId: string, completed: boolean) => {
    questForObjectiveWrite(questId);

    await writeObjectives(questId, (objectives) => objectives.map(obj =>
      obj.id === objectiveId ? { ...obj, completed } : obj
    ));
  }, [questForObjectiveWrite, writeObjectives]);

  /**
   * Add an objective to the end of the list.
   *
   * Appended, never inserted: the order is the party's plan, and a new
   * objective is the next thing to do rather than a correction to the order of
   * what came before. `crypto.randomUUID` matches how every other nested
   * record in the product (rumour notes, extracted entities) issues an id.
   */
  const addQuestObjective = useCallback(async (questId: string, description: string) => {
    questForObjectiveWrite(questId);
    const trimmed = description.trim();
    if (!trimmed) {
      throw new Error('An objective needs something to say.');
    }

    // Issued once, outside the transaction, so a retried attempt appends the
    // same objective rather than a second one.
    const added = { id: crypto.randomUUID(), description: trimmed, completed: false };
    await writeObjectives(questId, (objectives) => [...objectives, added]);
  }, [questForObjectiveWrite, writeObjectives]);

  /**
   * Reword an objective, keeping whether it is ticked and where it sits.
   *
   * Given `openedWith`, the wording is compared with the one the server holds,
   * in the same transaction (T083): reworded by someone else since, and
   * nothing is written.
   */
  const editQuestObjective = useCallback(async (
    questId: string,
    objectiveId: string,
    description: string,
    openedWith?: string
  ) => {
    questForObjectiveWrite(questId);
    const trimmed = description.trim();
    if (!trimmed) {
      throw new Error('An objective needs something to say.');
    }

    await writeObjectives(questId, (objectives) => objectives.map(obj => {
      if (obj.id !== objectiveId) return obj;
      if (openedWith !== undefined) {
        assertUnchanged(obj.description, openedWith, trimmed);
      }
      return { ...obj, description: trimmed };
    }));
  }, [questForObjectiveWrite, writeObjectives]);

  /**
   * Move one objective one place up or down.
   *
   * A move that would fall off either end writes nothing at all, rather than
   * writing the list back unchanged: a no-op write would still stamp
   * `dateModified` and credit a modification nobody made (§8).
   */
  const moveQuestObjective = useCallback(async (questId: string, objectiveId: string, direction: 'up' | 'down') => {
    const quest = questForObjectiveWrite(questId);
    if (moveObjective(quest.objectives, objectiveId, direction) === quest.objectives) {
      return;
    }

    // Moved again in the list the server holds, where it may sit elsewhere.
    await writeObjectives(questId, (objectives) => moveObjective(objectives, objectiveId, direction));
  }, [questForObjectiveWrite, writeObjectives]);

  /**
   * Add a note to the quest, as a document of its own under it (T163), the
   * way a person's and a place's are (T133).
   */
  const addQuestNote = useCallback(async (questId: string, note: QuestNote) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to add notes');
    }

    const path = routing.pathFor(questId);
    if (!activeGroupId || !activeCampaignId || !path) {
      throw new Error('Group and campaign context must be set to add notes');
    }

    if (!getQuestById(questId)) {
      throw new Error('Quest not found');
    }

    await addRecordNote(path, questId, { ...note });
  }, [user, userProfile, activeGroupId, activeCampaignId, routing, getQuestById]);

  // Add quest
  const addQuest = useCallback(async (
    questData: DomainData<Quest>,
    alongside?: CreateAlongside,
    options: CreateOptions = {}
  ) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to add quests');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to add quests');
    }

    // Not a complete Quest -- attribution is stamped by DocumentService.createDocument,
    // not supplied here. See DomainData's doc comment in core/types/common.ts.
    const buildQuest = (candidateId: string) => ({
      id: candidateId,
      ...questData,
      // Ensure arrays are properly initialized
      objectives: questData.objectives || [],
      relatedNPCIds: questData.relatedNPCIds || [],
      leads: questData.leads || [],
      keyLocations: questData.keyLocations || [],
      complications: questData.complications || [],
      rewards: questData.rewards || []
    });

    // Generate the ID from the title, disambiguating on collision -- including
    // with a quest another session wrote that the listener has not delivered
    // yet (#1402).
    // A record already carrying the name stops here when the caller asks
    // (T163): one the client holds, or one that took the id a moment ago.
    if (options.askOnSameName) assertNoSameNamed('quest', questData.title, quests);
    // Private, it goes to the author's own space (T163).
    const writers = options.private ? routing.privately : routing.shared;
    const path = options.private ? routing.privatePath : questsPath;
    if (options.private && !path) throw new Error('Group and campaign context must be set to add quests');
    const id = await createWithUniqueEntityId({
      name: questData.title,
      issuedIds: issuedIds.current,
      isLoaded: (candidateId) => Boolean(getQuestById(candidateId)),
      write: (candidateId) => writers.addData(buildQuest(candidateId), candidateId, alongside),
      onRefused: options.askOnSameName && path ? stopOnSameNamed('quest', path, questData.title) : undefined
    });

    return id;
  }, [user, userProfile, activeGroupId, activeCampaignId, getQuestById, routing, quests, questsPath]);

  // Update an existing quest: only what `change` names; see `RecordChange` (T083)
  const updateQuest = useCallback(async (questId: string, change: RecordChange<Quest>) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update quests');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to update quests');
    }

    await writeRecordChange(routing.writersFor(questId), questId, change, 'Quest not found');
  }, [user, userProfile, activeGroupId, activeCampaignId, routing]);

  // Delete quest
  const deleteQuest = useCallback(async (questId: string) => {
    if (!user) {
      throw new Error('User must be authenticated to delete quests');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to delete quests');
    }

    // Its notes first: a record's subcollection outlives the record.
    const path = routing.pathFor(questId);
    if (path) await deleteRecordNotes(path, [questId]);
    await routing.writersFor(questId).deleteData(questId);
    // And out of the old halves that still name it (T131), and its held links (T163).
    await unlinkDeletedQuietly(recordPaths, 'quest', [questId]);
    await routing.afterDelete([questId]);
  }, [user, activeGroupId, activeCampaignId, recordPaths, routing]);

  /**
   * Sets the status of several quests in one batch (T017): one round trip, and
   * all or nothing. Completing stamps `dateCompleted`, as `updateQuestStatus`
   * does for one.
   */
  const updateQuestsStatus = useCallback(async (questIds: string[], status: QuestStatus) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to update quest status');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to update quest status');
    }

    if (questIds.some(id => !getQuestById(id))) {
      throw new Error('One or more quests not found');
    }

    const modificationAttribution = buildModificationAttribution({ uid: user.uid, activeGroupUserProfile });
    await commitEntityWrites<Quest>(questsPath, 'quests', questIds.map(id => ({
      type: 'update' as const,
      id,
      collection: routing.pathFor(id),
      data: {
        status,
        ...(status === 'completed' && { dateCompleted: new Date().toISOString() }),
        ...modificationAttribution,
        ...modificationTimes()
      }
    })));
  }, [user, userProfile, activeGroupUserProfile, activeGroupId, activeCampaignId, getQuestById, questsPath, routing]);

  /** Deletes several quests in one batch. */
  const deleteQuests = useCallback(async (questIds: string[]) => {
    if (!user) {
      throw new Error('User must be authenticated to delete quests');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to delete quests');
    }

    for (const [path, ids] of routing.byPath(questIds)) {
      await deleteRecordNotes(path, ids);
    }
    await commitEntityWrites<Quest>(questsPath, 'quests', questIds.map(id => ({
      type: 'delete' as const,
      id,
      collection: routing.pathFor(id),
    })));
    await unlinkDeletedQuietly(recordPaths, 'quest', questIds);
    await routing.afterDelete(questIds);
  }, [user, activeGroupId, activeCampaignId, questsPath, recordPaths, routing]);

  // Mark quest as completed
  const markQuestCompleted = useCallback(async (questId: string, dateCompleted?: string) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to complete quests');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to complete quests');
    }

    const quest = getQuestById(questId);
    if (!quest) {
      throw new Error('Quest not found');
    }

    const now = new Date().toISOString();
    const completionDate = dateCompleted || now;

    // Every objective the server holds is ticked, including one added since
    // this copy was taken (T083).
    await writeRecordChange(
      routing.writersFor(questId),
      questId,
      (current) => ({
        status: 'completed' as QuestStatus,
        dateCompleted: completionDate,
        objectives: normaliseObjectives(current.objectives).map(obj => ({ ...obj, completed: true }))
      }),
      'Quest not found'
    );
  }, [user, userProfile, activeGroupId, activeCampaignId, getQuestById, routing]);

  // Mark quest as failed
  const markQuestFailed = useCallback(async (questId: string) => {
    if (!user || !userProfile) {
      throw new Error('User must be authenticated to mark quests as failed');
    }

    if (!activeGroupId || !activeCampaignId) {
      throw new Error('Group and campaign context must be set to mark quests as failed');
    }

    if (!getQuestById(questId)) {
      throw new Error('Quest not found');
    }

    await routing.writersFor(questId).updateData(questId, { status: 'failed' as QuestStatus });
  }, [user, userProfile, activeGroupId, activeCampaignId, getQuestById, routing]);

  const value: QuestContextValue = {
    quests,
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
    getQuestById,
    getQuestsByStatus,
    getQuestsByLocation,
    getQuestsByNPC,
    updateQuestStatus,
    updateQuestObjective,
    addQuestObjective,
    editQuestObjective,
    moveQuestObjective,
    addQuestNote,
    addQuest,
    updateQuest,
    deleteQuest,
    updateQuestsStatus,
    deleteQuests,
    markQuestCompleted,
    markQuestFailed,
    refreshQuests,
    hasRequiredContext
  };

  return (
    <QuestDemandProvider value={demand.retain}>
      <QuestContext.Provider value={value}>
        {children}
      </QuestContext.Provider>
    </QuestDemandProvider>
  );
};

// Export the hook directly from the context file
export const useQuests = (options: ListReaderOptions = {}) => {
  useQuestDemand(options.subscribe ?? true);
  const context = useContext(QuestContext);
  if (context === undefined) {
    throw new Error('useQuests must be used within a QuestProvider');
  }
  return context;
};