// src/features/campaign-entities/quests/types.ts
import { BaseContent, DomainData, RecordChange, CreateAlongside } from 'core/types/common';
import { Location } from '../locations/types';
import type { EntityNote } from 'shared/utils/entity-notes';

export type QuestStatus = 'active' | 'completed' | 'failed';

export interface QuestObjective {
  id: string;
  description: string;
  completed: boolean;
}

/**
 * A place inside a quest: free text, a prep note about somewhere the party has
 * mostly not been. Promoting one creates a Location and takes it off the quest.
 */
export interface QuestLocation {
  name: string;
  description: string;
  /**
   * The Location this place already is, stored when a place is added under
   * the name of one (#1421) so the link survives a rename. Places added
   * before that resolve by `name` alone (`resolveKeyPlace`).
   */
  locationId?: string;
}

/**
 * A note on a quest, a document of its own under it (`quests/{id}/notes`,
 * T163), in the shape a person's and a place's notes take.
 */
export type QuestNote = EntityNote;

/**
 * Represents a quest in the game world
 */
export interface Quest extends BaseContent {
  title: string;
  description: string;
  status: QuestStatus;
  background?: string;
  objectives: QuestObjective[];
  leads?: string[];
  keyLocations?: QuestLocation[];
  /**
   * The quest's people, as ids into the NPC directory.
   *
   * The one relation list (`D15.7`). A second field -- `importantNPCs`, free
   * text `{name, description}` -- used to sit beside this one and was rendered
   * beside it too, which is why the same people appeared twice on one
   * quest card. `15-5` deleted it: two fields for one relationship cannot be
   * kept in agreement, and only this one can be resolved to a record, a page
   * and an occupation.
   *
   * Documents written before that keep whatever `importantNPCs` they carry --
   * every write goes through `updateDoc`, which merges field by field and
   * never removes one. Nothing reads it, and nothing migrates it: names this
   * list does not already carry were judged not worth keeping (2026-10-02).
   */
  relatedNPCIds?: string[];
  complications?: string[];
  rewards?: string[];
  /**
   * See the `location`/`locationId` contract documented on `NPC.location` in
   * `features/campaign-entities/npcs/types.ts` -- shared verbatim here.
   */
  location?: string;
  /** See the `location`/`locationId` contract documented on `NPC.location`. */
  locationId?: string;
  levelRange?: string;
  dateCompleted?: string;
}

// Context types
export interface QuestContextState {
  quests: Quest[];
  isLoading: boolean;
  /**
   * The last failure, a read or a write. A write failure is reported here as
   * well as rejected (#1401), so it is observable, but it says nothing about
   * whether the page can show its records: gate on `loadError` for that.
   */
  error: string | null;
  /**
   * Why the records could not be loaded, or null. Only this may replace a page
   * with its error state: a rejected write leaves the loaded records, and the
   * editor holding the unsaved text, on screen (T085, REACT-002).
   */
  loadError: string | null;
}

export interface QuestContextValue extends QuestContextState {
  getQuestById: (id: string) => Quest | undefined;
  getQuestsByStatus: (status: QuestStatus) => Quest[];
  getQuestsByLocation: (location: Location) => Quest[];
  getQuestsByNPC: (npcId: string) => Quest[];
  updateQuestStatus: (questId: string, status: QuestStatus) => Promise<void>;
  updateQuestObjective: (questId: string, objectiveId: string, completed: boolean) => Promise<void>;
  addQuestObjective: (questId: string, description: string) => Promise<void>;
  /**
   * Reword an objective. With `openedWith` -- the wording the editor started
   * from -- it refuses with an `EditConflictError` when someone else reworded
   * it since (T083).
   */
  editQuestObjective: (questId: string, objectiveId: string, description: string, openedWith?: string) => Promise<void>;
  moveQuestObjective: (questId: string, objectiveId: string, direction: 'up' | 'down') => Promise<void>;
  /** Add a note to the quest, as a document of its own (T163). */
  addQuestNote: (questId: string, note: QuestNote) => Promise<void>;
  /** `alongside`: a change to another record that commits with this one (T088). */
  addQuest: (quest: DomainData<Quest>, alongside?: CreateAlongside) => Promise<string>;
  /**
   * Write `change` to the quest: the fields it names, and nothing else
   * (T083). Never the whole record -- a copy from the listener can be behind
   * the server. A list worked out from the old one goes as a function; see
   * `RecordChange`.
   */
  updateQuest: (questId: string, change: RecordChange<Quest>) => Promise<void>;
  deleteQuest: (questId: string) => Promise<void>;
  /** Sets the status of several quests, committed as one batch. */
  updateQuestsStatus: (questIds: string[], status: QuestStatus) => Promise<void>;
  /** Deletes several quests, committed as one batch. */
  deleteQuests: (questIds: string[]) => Promise<void>;
  markQuestCompleted: (questId: string, dateCompleted?: string) => Promise<void>;
  markQuestFailed: (questId: string) => Promise<void>;
  /**
   * Retry after a failed load: reopens the quest listener if Firestore closed
   * it after an error (T032). Writes never need it -- the listener already
   * carries them -- and a healthy listener answers without a read.
   *
   * `Promise<void>`, unlike `useQuestData().refreshQuests`: the provider wraps
   * it in a callback that awaits it and returns nothing.
   */
  refreshQuests: () => Promise<void>;
  /** Whether a group and a campaign are both selected. */
  hasRequiredContext: boolean;
}
