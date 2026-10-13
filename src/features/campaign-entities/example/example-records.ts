// src/features/campaign-entities/example/example-records.ts
import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";
import type { NPC } from "../npcs/types";
import type { Location } from "../locations/types";
import type { Quest } from "../quests/types";
import type { Rumor } from "../rumors/types";

/** The example campaign as the records the directories read. */
export interface ExampleRecords {
  readonly npcs: NPC[];
  readonly locations: Location[];
  readonly quests: Quest[];
  readonly rumors: Rumor[];
}

/**
 * Who made an example record: nobody. A record must name its creator; an
 * example must not invent one (`shared/example-campaign`), and "Recorded by"
 * is drawn only for a record that names one.
 */
const NOBODY = { createdBy: "", createdByUsername: "" } as const;

const { npcs, locations, quests, rumours } = EXAMPLE_CAMPAIGN;

/**
 * The example campaign, filled out into the records `NPCDirectory` and its
 * siblings read, with every field the example leaves out empty. Built once:
 * the example never changes.
 */
export const EXAMPLE_RECORDS: ExampleRecords = {
  npcs: npcs.map((npc) => ({
    ...NOBODY,
    id: npc.id,
    name: npc.name,
    title: npc.title,
    status: npc.status,
    relationship: npc.relationship,
    occupation: npc.occupation,
    race: npc.race,
    description: npc.description,
    connections: { relatedNPCs: [], affiliations: [] },
    notes: [],
  })),
  locations: locations.map((place) => ({
    ...NOBODY,
    id: place.id,
    name: place.name,
    type: place.type,
    status: place.status,
    parentId: place.parentId,
    description: place.description,
    // A place lists its people (T131): whoever the example met there.
    connectedNPCs: npcs.filter((npc) => npc.locationId === place.id).map((npc) => npc.id),
  })),
  quests: quests.map((quest) => ({
    ...NOBODY,
    id: quest.id,
    title: quest.title,
    status: quest.status,
    description: quest.description,
    locationId: quest.locationId,
    objectives: quest.objectives.map((objective, index) => ({
      id: `${quest.id}-objective-${index + 1}`,
      description: objective.description,
      completed: objective.completed,
    })),
    relatedNPCIds: [...quest.relatedNPCIds],
  })),
  rumors: rumours.map((rumour) => ({
    ...NOBODY,
    id: rumour.id,
    title: rumour.title,
    content: rumour.content,
    status: rumour.status,
    sourceType: rumour.sourceType,
    sourceName: rumour.sourceName,
    sourceNpcId: npcs.find((npc) => rumour.sourceType === "npc" && npc.name === rumour.sourceName)?.id,
    convertedToQuestId: rumour.convertedToQuestId,
    relatedNPCs: [...(rumour.relatedNPCIds ?? [])],
    relatedLocations: [],
    notes: [],
  })),
};

export default EXAMPLE_RECORDS;
