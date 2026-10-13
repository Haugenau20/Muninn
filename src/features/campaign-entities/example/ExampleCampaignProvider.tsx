// src/features/campaign-entities/example/ExampleCampaignProvider.tsx
import React from "react";
import { InertNavigation } from "shared/context/NavigationContext";
import { NPCContextValueProvider } from "../npcs/context/NPCContext";
import { LocationContextValueProvider } from "../locations/context/LocationContext";
import { QuestContextValueProvider } from "../quests/context/QuestContext";
import { RumorContextValueProvider } from "../rumors/context/RumorContext";
import type { NPCContextValue } from "../npcs/types";
import type { LocationContextValue } from "../locations/types";
import type { QuestContextValue } from "../quests/types";
import type { RumorContextValue } from "../rumors/types";
import { EXAMPLE_RECORDS } from "./example-records";

const { npcs, locations, quests, rumors } = EXAMPLE_RECORDS;

/** A write, answered: it settles and changes nothing. */
const nothing = async (): Promise<void> => undefined;
/** A create, answered: it makes nothing, so it has no id to give back. */
const noId = async (): Promise<string> => "";

/** What every list here shares: loaded, unbroken, and in a campaign. */
const LOADED = { isLoading: false, error: null, loadError: null, hasRequiredContext: true } as const;

const NPC_VALUE: NPCContextValue = {
  ...LOADED,
  npcs,
  getNPCById: (id) => npcs.find((npc) => npc.id === id),
  getNPCsByRelationship: (relationship) => npcs.filter((npc) => npc.relationship === relationship),
  updateNPCNote: () => undefined,
  updateNPCRelationship: nothing,
  addNPC: noId,
  updateNPC: nothing,
  deleteNPC: nothing,
  updateNPCsStatus: nothing,
  deleteNPCs: nothing,
  refreshNPCs: async () => npcs,
};

const LOCATION_VALUE: LocationContextValue = {
  ...LOADED,
  locations,
  getLocationById: (id) => locations.find((place) => place.id === id),
  getLocationsByType: (type) => locations.filter((place) => place.type === type),
  getLocationsByStatus: (status) => locations.filter((place) => place.status === status),
  getChildLocations: (parentId) => locations.filter((place) => place.parentId === parentId),
  getParentLocation: (id) => {
    const parentId = locations.find((place) => place.id === id)?.parentId;
    return parentId ? locations.find((place) => place.id === parentId) : undefined;
  },
  updateLocation: nothing,
  updateLocationNote: nothing,
  updateLocationStatus: nothing,
  updateLocationsStatus: nothing,
  moveLocation: nothing,
  deleteLocation: nothing,
  deleteLocations: nothing,
  createLocation: noId,
  refreshLocations: async () => locations,
};

const QUEST_VALUE: QuestContextValue = {
  ...LOADED,
  quests,
  getQuestById: (id) => quests.find((quest) => quest.id === id),
  getQuestsByStatus: (status) => quests.filter((quest) => quest.status === status),
  getQuestsByLocation: (place) => quests.filter((quest) => quest.locationId === place.id),
  getQuestsByNPC: (npcId) => quests.filter((quest) => (quest.relatedNPCIds ?? []).includes(npcId)),
  updateQuestStatus: nothing,
  updateQuestObjective: nothing,
  addQuestObjective: nothing,
  editQuestObjective: nothing,
  moveQuestObjective: nothing,
  addQuest: noId,
  updateQuest: nothing,
  deleteQuest: nothing,
  updateQuestsStatus: nothing,
  deleteQuests: nothing,
  markQuestCompleted: nothing,
  markQuestFailed: nothing,
  refreshQuests: nothing,
};

const RUMOR_VALUE: RumorContextValue = {
  ...LOADED,
  rumors,
  getRumorById: (id) => rumors.find((rumor) => rumor.id === id),
  getRumorsByStatus: (status) => rumors.filter((rumor) => rumor.status === status),
  getRumorsByLocation: (locationId) => rumors.filter((rumor) => rumor.locationId === locationId),
  getRumorsByNPC: (npcId) => rumors.filter((rumor) => rumor.relatedNPCs.includes(npcId)),
  updateRumorStatus: nothing,
  updateRumorNote: nothing,
  addRumor: noId,
  updateRumor: nothing,
  deleteRumor: nothing,
  updateRumorsStatus: nothing,
  deleteRumors: nothing,
  combineRumors: noId,
  convertToQuest: noId,
};

/**
 * The example campaign, served to everything under it as the campaign's own
 * people, places, quests and rumours (T150's live examples).
 *
 * A directory under it renders exactly as it does for a member -- the same
 * status bar, filters, groups and rows -- because it is the same component
 * reading the same contexts. What it cannot do is change anything: every
 * write here settles and does nothing, and every way out of the page goes
 * nowhere (`InertNavigation`), since the records it would lead to do not
 * exist. Nothing here reaches Firestore.
 */
const ExampleCampaignProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <InertNavigation>
    <NPCContextValueProvider value={NPC_VALUE}>
      <LocationContextValueProvider value={LOCATION_VALUE}>
        <QuestContextValueProvider value={QUEST_VALUE}>
          <RumorContextValueProvider value={RUMOR_VALUE}>{children}</RumorContextValueProvider>
        </QuestContextValueProvider>
      </LocationContextValueProvider>
    </NPCContextValueProvider>
  </InertNavigation>
);

export default ExampleCampaignProvider;
