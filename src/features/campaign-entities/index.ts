// src/features/campaign-entities/index.ts
export { NPCProvider, useNPCs } from './npcs/context/NPCContext';
export { useNPCData } from './npcs/hooks/useNPCData';
// Components consumed by pages/npcs/* and other external consumers
export { default as NPCDirectory } from './npcs/components/NPCDirectory';
// Lazy: the example campaign loads only for a signed-out visitor.
export { NPCExample } from './npcs/example';
// NPC types
export type { NPC, NPCStatus, NPCRelationship, NPCNote, NPCConnections, NPCContextState, NPCContextValue } from './npcs/types';

/*
  The create and edit forms are gone. `15-8` took the first three; `15-9` took
  the last one. Every field of every entity is edited where it is read:
  `/quests/:id`, `/locations/:id`, `/npcs/:id` and a rumour's own row.

  `RumorForm` was kept back then because `/rumors/create` was where note
  conversion sent a rumour it had extracted, with a title and a body already
  written. That turned out to be an argument for not needing a form at all:
  the fields were complete before the page opened, so the page was a review
  step for something nobody had to review. `NoteContext` writes the rumour and
  opens its row, which is where every other rumour is edited anyway.
*/

// Quest context and hooks
export { QuestProvider, useQuests } from './quests/context/QuestContext';
export { useQuestData } from './quests/hooks/useQuestData';
// Components consumed by pages/quests/* and other external consumers
export { default as QuestDirectory } from './quests/components/QuestDirectory';
// Lazy: the example campaign loads only for a signed-out visitor.
export { QuestExample } from './quests/example';
export { default as QuestObjectives } from './quests/components/QuestObjectives';
export { default as DeleteQuestDialog } from './quests/components/DeleteQuestDialog';
// How a quest says what it is, shared by the row and the page.
export {
  QUEST_STATUS_OPTIONS,
  formatQuestStatus,
  moveObjective,
  objectiveProgressLabel,
  objectiveProgressOf,
} from './quests/utils/quest-presentation';
export type { ObjectiveProgress } from './quests/utils/quest-presentation';
// Coerces whatever reaches a quest document into `QuestObjective[]`; the
// extractor sends `string[]`, and bare strings used to reach Firestore.
export { normaliseObjectives } from './quests/utils/quest-objectives';
// Quest types
export type { Quest, QuestStatus, QuestObjective, QuestLocation, QuestNote, QuestContextState, QuestContextValue } from './quests/types';

// Location context and hooks
export { LocationProvider, useLocations } from './locations/context/LocationContext';
export { useLocationData } from './locations/hooks/useLocationData';
// Components consumed by pages/locations/* and other external consumers
export { default as LocationDirectory } from './locations/components/LocationDirectory';
// Lazy: the example campaign loads only for a signed-out visitor.
export { LocationExample } from './locations/example';
export { default as WhereThisSits } from './locations/components/WhereThisSits';
export { default as DeleteLocationDialog } from './locations/components/DeleteLocationDialog';
// Location types
export type { Location, LocationType, LocationStatus, LocationNote, LocationChildStrategy, LocationContextState, LocationContextValue } from './locations/types';
// The shared answer to "what location is this entity at?" -- see #1412 for why
// an unresolved reference is shown as itself rather than prettified.
export { resolveLocation, resolveLocationName, referencesLocation, resolveKeyPlace, keyPlaceIsLocation } from './locations/utils/location-display';
export type { LocationReference, KeyPlace } from './locations/utils/location-display';
// Every walk over the tree, guarded. `15-4` makes cycles reachable, so nothing
// outside this module may hand-roll a parent or descendant walk.
export {
  ancestorPathOf,
  buildLocationIndex,
  childrenOf,
  descendantIdsOf,
  insideCountOf,
  invalidParentIdsFor,
  parentIdOf,
  pathLabelOf,
  wouldCreateCycle,
} from './locations/utils/location-tree';
export type { LocationIndex } from './locations/utils/location-tree';
// How a location says what it is, shared by the tree and the page.
export {
  formatLocationType,
  formatLocationStatus,
  KNOWLEDGE_OPTIONS,
  STATUS_ORDER,
  STATUS_TONE,
} from './locations/utils/location-presentation';

// Rumor context and hooks
export { RumorProvider, useRumors } from './rumors/context/RumorContext';
export { useRumorData } from './rumors/hooks/useRumorData';
export { useCreateRumor } from './rumors/hooks/useCreateRumor';
// Components consumed by pages/rumors/* and other external consumers
export { default as RumorDirectory } from './rumors/components/RumorDirectory';
// Lazy: the example campaign loads only for a signed-out visitor.
export { RumorExample } from './rumors/example';
export { default as RumorBatchActions } from './rumors/components/RumorBatchActions';
export { default as CombineRumorsDialog } from './rumors/components/CombineRumorsDialog';
export { default as ConvertToQuestDialog } from './rumors/components/ConvertToQuestDialog';
/*
  How a rumour is named, for the surfaces outside this domain that list one.
  A rumour's title is optional now -- the composer records what was heard and
  the name is derived from it -- so every consumer that prints `rumor.title`
  directly would print a blank for anything created since.
*/
export { rumorDisplayTitle, rumorTitleText, UNTITLED_RUMOR } from './rumors/utils/rumor-title';
// Rumor types
export type { Rumor, RumorStatus, SourceType, RumorNote, RumorContextState, RumorContextValue, JoinOptions } from './rumors/types';

// Links between records (T131): which field owns each, how each side reads
// it, and the one way to add or remove one from any page.
export {
  questIdsOfNpc,
  npcIdsOfQuest,
  locationIdsOfNpc,
  npcIdsOfLocation,
  questNamesLocation,
  questIdsOfLocation,
  locationIdsOfRumor,
  rumorIdsOfLocation,
  npcIdsOfNpc,
  rumorIdsOfNpc,
} from './shared/links';
export { createLinkActions } from './shared/linkActions';
export type { LinkEnd, LinkDeps } from './shared/linkActions';

// A record's notes as documents of their own (T133).
export {
  useRecordNotes,
  editRecordNote,
  deleteRecordNote,
} from './shared/recordNotes';
export type { StoredNote } from './shared/recordNotes';

// "Already exists" (T163): a create stopped at a name a record already
// carries, and what adding to that record writes.
export { SameNameError, isSameName, findSameNamed, nameOf } from './shared/sameName';
export type { SameNameKind } from './shared/sameName';
export { planMerge, describeMerge } from './shared/mergeRecords';
export type { MergePlan } from './shared/mergeRecords';
export { useMergeIntoRecord } from './shared/useMergeIntoRecord';

// Private records (T163): a player's own people, places, quests and rumours,
// beside the campaign's until they publish them.
export {
  PrivateRecordsProvider,
  usePrivateRecords,
} from './shared/private/PrivateRecordsContext';
export type { PrivateKind, HeldLink } from './shared/private/PrivateRecordsContext';
export { useLinkPrivacy } from './shared/private/heldLinks';
export { PrivateLinkError } from './shared/private/usePrivateRouting';
export { useRecordNotesPath } from './shared/private/useRecordNotesPath';
export { usePublish } from './shared/private/usePublish';
export type { PublishListed, PublishSameName, PublishAnswer, PublishQuestions, PublishOutcome } from './shared/private/usePublish';
