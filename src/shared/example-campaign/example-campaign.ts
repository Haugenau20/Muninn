// src/shared/example-campaign/example-campaign.ts
import type {
  NPC,
  Quest,
  Location,
  Rumor,
} from "features/campaign-entities";
import type { ChapterReadState } from "features/storytelling";

/*
  What each example row is, and what it is not. Every shape is cut from the
  real record with `Pick`, so it holds only what a collapsed row shows -- and
  none of them can hold an author. The product's credibility rests on
  attribution being real, so an example that credits an invented person would
  undermine exactly what it is advertising (T150, after Home's
  `ExampleUpdate`). Adding one means changing a type here, in review.
*/

/** One person in the example's NPC list. */
export type ExampleNPC = Readonly<
  Pick<NPC, "id" | "name" | "title" | "status" | "relationship" | "occupation"> & {
    /** Where they were met: one of the example's locations. */
    locationId: string;
  }
>;

/** One quest in the example's quest list. */
export type ExampleQuest = Readonly<
  Pick<Quest, "id" | "title" | "status"> & {
    /** Where it happens: one of the example's locations. */
    locationId: string;
    objectivesDone: number;
    objectivesTotal: number;
  }
>;

/** One place in the example's location tree. */
export type ExampleLocation = Readonly<
  Pick<Location, "id" | "name" | "type" | "status" | "parentId">
>;

/** One rumour in the example's rumour list. */
export type ExampleRumour = Readonly<
  Pick<Rumor, "id" | "title" | "status" | "sourceName"> & {
    sourceType: NonNullable<Rumor["sourceType"]>;
  }
>;

/** One chapter in the example's chronicle. */
export interface ExampleChapter {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly summary: string;
  readonly state: ChapterReadState;
  /** The chapter the reader is in, drawn promoted, as the real list draws it. */
  readonly isCurrent: boolean;
  readonly percentRead: number;
}

/** The whole example campaign, in one value. */
export interface ExampleCampaign {
  readonly npcs: readonly ExampleNPC[];
  readonly quests: readonly ExampleQuest[];
  readonly locations: readonly ExampleLocation[];
  readonly rumours: readonly ExampleRumour[];
  readonly chapters: readonly ExampleChapter[];
}

/** Freeze an array and each row in it: `Object.freeze` alone is shallow. */
const frozen = <T extends object>(rows: T[]): readonly T[] =>
  Object.freeze(rows.map((row) => Object.freeze(row)));

/**
 * The rows shown under an empty collection's empty state, on the NPC, quest,
 * location, rumour and chapter pages, while the campaign has none of them.
 *
 * Invented, and one setting throughout: the quests happen in the example's
 * places, the rumours come from its people, and the chronicle tells the same
 * story. Not from a published adventure (signed-out Home's *Sunless Citadel*
 * raises that question, T123), and it shares no name with the e2e fixtures.
 *
 * Ids start `example-`: the row's mark takes its hue from the id, so the
 * example keeps its colours, and no real Firestore id has that shape. Never
 * derived from live data and never fetched: if it drifts from what the rows
 * render, that is a bug in this file.
 */
export const EXAMPLE_CAMPAIGN: ExampleCampaign = Object.freeze({
  locations: frozen<ExampleLocation>([
    {
      id: "example-location-vale",
      name: "The Ashen Vale",
      type: "region",
      status: "explored",
    },
    {
      id: "example-location-cinderford",
      name: "Cinderford",
      type: "town",
      status: "visited",
      parentId: "example-location-vale",
    },
  ]),
  npcs: frozen<ExampleNPC>([
    {
      id: "example-npc-odile",
      name: "Odile Marrow",
      title: "Keeper of the Cinderford crossing",
      status: "alive",
      relationship: "friendly",
      occupation: "Ferrywoman",
      locationId: "example-location-cinderford",
    },
    {
      id: "example-npc-aldous",
      name: "Brother Aldous",
      title: "Archivist of the Vale chapel",
      status: "missing",
      relationship: "neutral",
      occupation: "Priest",
      locationId: "example-location-vale",
    },
    {
      id: "example-npc-vesk",
      name: "Vesk Harrow",
      title: "Wanted in three towns",
      status: "alive",
      relationship: "hostile",
      occupation: "Smuggler",
      locationId: "example-location-cinderford",
    },
  ]),
  quests: frozen<ExampleQuest>([
    {
      id: "example-quest-ledger",
      title: "Recover the drowned ledger",
      status: "active",
      locationId: "example-location-cinderford",
      objectivesDone: 1,
      objectivesTotal: 3,
    },
    {
      id: "example-quest-aldous",
      title: "Find Brother Aldous",
      status: "completed",
      locationId: "example-location-vale",
      objectivesDone: 2,
      objectivesTotal: 2,
    },
  ]),
  rumours: frozen<ExampleRumour>([
    {
      id: "example-rumour-ferry",
      title: "The ferry crosses at night for those who never paid",
      status: "confirmed",
      sourceType: "npc",
      sourceName: "Vesk Harrow",
    },
    {
      id: "example-rumour-drowned",
      title: "Brother Aldous drowned at the ford",
      status: "false",
      sourceType: "tavern",
      sourceName: "The Tallow Cup",
    },
  ]),
  chapters: frozen<ExampleChapter>([
    {
      id: "example-chapter-1",
      order: 1,
      title: "The Crossing at Cinderford",
      summary: "We paid the ferrywoman in salt and learned why nobody crosses after dark.",
      state: "read",
      isCurrent: false,
      percentRead: 100,
    },
    {
      id: "example-chapter-2",
      order: 2,
      title: "Ashes on the Water",
      summary: "The ledger was not where Harrow said it would be, and neither was the boat.",
      state: "reading",
      isCurrent: true,
      percentRead: 40,
    },
  ]),
});

export default EXAMPLE_CAMPAIGN;
