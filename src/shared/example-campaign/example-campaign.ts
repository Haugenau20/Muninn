// src/shared/example-campaign/example-campaign.ts
import type {
  NPC,
  Quest,
  Location,
  Rumor,
} from "features/campaign-entities";
import type { ChapterReadState } from "features/storytelling";

/*
  What each example record is, and what it is not. Every shape is cut from the
  real record with `Pick`, so it holds only what the signed-out pages show --
  and none of them can hold an author. The product's credibility rests on
  attribution being real, so an example that credits an invented person would
  undermine exactly what it is advertising (T150, after Home's
  `ExampleUpdate`). Adding one means changing a type here, in review.
*/

/** One person in the example's NPC list. */
export type ExampleNPC = Readonly<
  Pick<
    NPC,
    "id" | "name" | "title" | "status" | "relationship" | "occupation" | "race" | "description"
  > & {
    /** Where they were met: one of the example's locations. Absent, they sit under "Location unknown". */
    locationId?: string;
  }
>;

/** One objective of an example quest. */
export interface ExampleObjective {
  readonly description: string;
  readonly completed: boolean;
}

/** One quest in the example's quest list. */
export type ExampleQuest = Readonly<
  Pick<Quest, "id" | "title" | "status" | "description"> & {
    /** Where it happens: one of the example's locations. */
    locationId: string;
    objectives: readonly ExampleObjective[];
    /** The quest's people: ids of the example's NPCs. */
    relatedNPCIds: readonly string[];
  }
>;

/** One place in the example's location tree. */
export type ExampleLocation = Readonly<
  Pick<Location, "id" | "name" | "type" | "status" | "parentId" | "description">
>;

/** One rumour in the example's rumour list. */
export type ExampleRumour = Readonly<
  Pick<Rumor, "id" | "title" | "status" | "sourceName" | "content"> & {
    sourceType: NonNullable<Rumor["sourceType"]>;
    /** The example quest this rumour became, if it became one. */
    convertedToQuestId?: string;
    /** The people the rumour is about: ids of the example's NPCs. */
    relatedNPCIds?: readonly string[];
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

/** A name the example note's scan found that the campaign does not hold yet. */
export interface ExampleDetection {
  readonly id: string;
  readonly text: string;
  readonly type: "npc" | "location" | "quest" | "rumor";
  /** From 0 to 1, as extraction reports it. */
  readonly confidence: number;
}

/**
 * One player's session note, already scanned: what the notes page shows a
 * signed-out visitor. Its scan is part of the fixture, so nothing is ever
 * sent anywhere to produce it.
 */
export interface ExampleNote {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  /** The example's people and places the note names: their ids. */
  readonly references: readonly string[];
  /** What the scan found that is not in the campaign yet. */
  readonly detections: readonly ExampleDetection[];
}

/** The whole example campaign, in one value. */
export interface ExampleCampaign {
  readonly npcs: readonly ExampleNPC[];
  readonly quests: readonly ExampleQuest[];
  readonly locations: readonly ExampleLocation[];
  readonly rumours: readonly ExampleRumour[];
  readonly chapters: readonly ExampleChapter[];
  readonly note: ExampleNote;
}

/**
 * Freeze a value and everything inside it: `Object.freeze` alone is shallow,
 * and a quest's objectives are an array inside a row.
 */
const deepFrozen = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFrozen);
    Object.freeze(value);
  }
  return value;
};

/** The example's places, by a short name, so the rows below can point at them. */
const PLACE = {
  vale: "example-location-vale",
  cinderford: "example-location-cinderford",
  tallow: "example-location-tallow-cup",
  ferry: "example-location-cinderford-ferry",
  chapel: "example-location-vale-chapel",
  ford: "example-location-greywater-ford",
  fen: "example-location-saltmarsh-fen",
  archive: "example-location-drowned-archive",
  harrowgate: "example-location-harrowgate",
  ironmouth: "example-location-ironmouth-pass",
} as const;

/** The example's people, by a short name. */
const PERSON = {
  odile: "example-npc-odile",
  vesk: "example-npc-vesk",
  fenn: "example-npc-fenn",
  marta: "example-npc-marta",
  pell: "example-npc-pell",
  aldous: "example-npc-aldous",
  wren: "example-npc-wren",
  toll: "example-npc-toll",
  hale: "example-npc-hale",
  ash: "example-npc-ash",
} as const;

/** Objectives from their text, the first `done` of them ticked. */
const objectives = (done: number, ...descriptions: string[]): ExampleObjective[] =>
  descriptions.map((description, index) => ({ description, completed: index < done }));

/** The chronicle's titles and summaries, in play order. */
const CHRONICLE: ReadonlyArray<readonly [string, string]> = [
  ["The Crossing at Cinderford", "We paid the ferrywoman in salt and learned why nobody crosses after dark."],
  ["Ashes on the Water", "The ledger was not where Harrow said it would be, and neither was the boat."],
  ["The Tallow Cup", "Marta poured, Vesk talked, and nobody believed a word of it."],
  ["A Warrant from Harrowgate", "Hale wants Vesk alive. Vesk would rather not be wanted at all."],
  ["Night Ferry", "We crossed after dark. Captain Fenn did not come back with us."],
  ["What Pell Saw", "An old fisherman, a sunk boat, and a story he would only tell once."],
  ["Salt and Silver", "The ferry has its price, and the magistrate has his."],
  ["The Vale Chapel", "Aldous’s desk was cleared out. Someone wanted us to find it that way."],
  ["Sister Wren’s Story", "She never met Aldous. She also knew where he kept his pens."],
  ["Low Water", "The river dropped a foot overnight, and the ford started talking."],
  ["Greywater Ford", "We asked the Toll-Keeper its name. It asked for ours."],
  ["The Toll Is Paid", "We paid, and it cost more than coin. Pell was found in the fen."],
  ["Into the Fen", "Wren’s map was half right. The half that was wrong had teeth."],
  ["The Drowned Archive", ""],
];

/** The chapter the reader is in: the second to last, partly read. */
const CURRENT_CHAPTER = CHRONICLE.length - 2;

/**
 * The campaign a signed-out visitor sees on the NPC, quest, location, rumour,
 * chapter and notes pages (T150), and whose numbers signed-out Home quotes,
 * so a stranger can see what each page holds. Members never see it.
 *
 * Invented, and one setting throughout: the quests happen in the example's
 * places, the rumours come from its people, the chronicle and the note tell
 * the same story. Not from a published adventure (T123), and it shares no
 * name with the e2e fixtures. `example-campaign.test.ts` holds it to that.
 *
 * Ids start `example-`: the row's mark takes its hue from the id, so the
 * example keeps its colours, and no real Firestore id has that shape. Never
 * derived from live data and never fetched: if it drifts from what the pages
 * render, that is a bug in this file.
 */
export const EXAMPLE_CAMPAIGN: ExampleCampaign = deepFrozen<ExampleCampaign>({
  // Parents before children: the tree hangs each place on one already listed.
  locations: [
    { id: PLACE.vale, name: "The Ashen Vale", type: "region", status: "explored",
      description: "A river valley still grey from a fire nobody will talk about." },
    { id: PLACE.cinderford, name: "Cinderford", type: "town", status: "visited", parentId: PLACE.vale,
      description: "The last town before the ford, built on the ashes of the first one." },
    { id: PLACE.tallow, name: "The Tallow Cup", type: "building", status: "explored", parentId: PLACE.cinderford,
      description: "Cinderford’s only inn. Candles on every table, and every one of them listening." },
    { id: PLACE.ferry, name: "Cinderford Ferry", type: "poi", status: "explored", parentId: PLACE.cinderford,
      description: "A rope ferry across the Grey. It runs by day for coin and by night for salt." },
    { id: PLACE.chapel, name: "The Vale Chapel", type: "building", status: "explored", parentId: PLACE.vale,
      description: "A small stone chapel with a library far too big for it." },
    { id: PLACE.ford, name: "Greywater Ford", type: "landmark", status: "visited", parentId: PLACE.vale,
      description: "Shallow enough to wade in summer. Something under it asks a toll all year round." },
    { id: PLACE.fen, name: "Saltmarsh Fen", type: "village", status: "known", parentId: PLACE.vale,
      description: "Stilt houses and eel traps where the river gives up and spreads out." },
    { id: PLACE.archive, name: "The Drowned Archive", type: "dungeon", status: "known", parentId: PLACE.fen,
      description: "A library that sank with its abbey. Said to surface at low water." },
    { id: PLACE.harrowgate, name: "Harrowgate", type: "city", status: "visited",
      description: "A walled city upriver, where the magistrate sits and the warrants are signed." },
    { id: PLACE.ironmouth, name: "Ironmouth Pass", type: "landmark", status: "known",
      description: "The road over the hills to Harrowgate. Drovers use it; smugglers avoid it." },
  ],
  npcs: [
    { id: PERSON.odile, name: "Odile Marrow", title: "Keeper of the Cinderford crossing", status: "alive",
      relationship: "friendly", occupation: "Ferrywoman", race: "Human", locationId: PLACE.cinderford,
      description: "Takes payment in salt, never coin. Will not cross after dark, and will not say why." },
    { id: PERSON.vesk, name: "Vesk Harrow", title: "Wanted in three towns", status: "alive",
      relationship: "hostile", occupation: "Smuggler", race: "Half-elf", locationId: PLACE.cinderford,
      description: "Told us the ledger was under the ferry landing. It was not. Owes the party forty silver and an explanation." },
    { id: PERSON.fenn, name: "Idris Fenn", title: "Went down with the ledger", status: "deceased",
      relationship: "friendly", occupation: "Ferry captain", race: "Human", locationId: PLACE.cinderford,
      description: "Captained the night ferry. His boat was found empty at Greywater Ford." },
    { id: PERSON.marta, name: "Marta Tallow", title: "Keeps the Tallow Cup", status: "alive",
      relationship: "friendly", occupation: "Innkeeper", race: "Halfling", locationId: PLACE.tallow,
      description: "Hears everything said over her bar and repeats about half of it." },
    { id: PERSON.pell, name: "Old Pell", title: "Saw the boat go under", status: "deceased",
      relationship: "neutral", occupation: "Fisherman", race: "Human", locationId: PLACE.tallow,
      description: "Swore the ferry sank on its own. Found in the fen two days later." },
    { id: PERSON.aldous, name: "Brother Aldous", title: "Archivist of the Vale chapel", status: "missing",
      relationship: "neutral", occupation: "Priest", race: "Human", locationId: PLACE.chapel,
      description: "Copied the ledger before it vanished. Nobody has seen him since the flood." },
    { id: PERSON.wren, name: "Sister Wren", title: "Says she never met Aldous", status: "alive",
      relationship: "unknown", occupation: "Acolyte", race: "Elf", locationId: PLACE.chapel,
      description: "Keeps the chapel. Her story about Aldous changes each time we ask." },
    { id: PERSON.toll, name: "The Toll-Keeper", title: "Nobody has seen its face", status: "unknown",
      relationship: "hostile", occupation: "", race: "", locationId: PLACE.ford,
      description: "Demands a toll at the ford, in a voice from under the water." },
    { id: PERSON.hale, name: "Corvin Hale", title: "Magistrate of Harrowgate", status: "alive",
      relationship: "neutral", occupation: "Magistrate", race: "Human", locationId: PLACE.harrowgate,
      description: "Signed the warrant for Vesk. Offered a reward, then halved it." },
    // No place: drawn under the muted "Location unknown" group.
    { id: PERSON.ash, name: "Ash-Tongue", title: "Sells names by the letter", status: "alive",
      relationship: "unknown", occupation: "Informant", race: "Tiefling",
      description: "Turns up wherever the party has just been. Knew our names before we gave them." },
  ],
  quests: [
    { id: "example-quest-ledger", title: "Recover the drowned ledger", status: "active", locationId: PLACE.cinderford,
      description: "Idris Fenn’s ledger went into the river with his ferry. Half of Cinderford wants it found, and the other half wants it to stay lost.",
      objectives: objectives(1, "Search under the ferry landing", "Find out who Fenn was carrying it for", "Get hold of the copy Aldous made"),
      relatedNPCIds: [PERSON.vesk, PERSON.fenn, PERSON.aldous] },
    { id: "example-quest-aldous", title: "Find Brother Aldous", status: "active", locationId: PLACE.chapel,
      description: "The chapel’s archivist vanished the night of the flood, and his copy of the ledger with him.",
      objectives: objectives(1, "Search his desk at the chapel", "Find where he went after the flood"),
      relatedNPCIds: [PERSON.aldous, PERSON.wren] },
    { id: "example-quest-toll", title: "Pay the Toll-Keeper, or don’t", status: "active", locationId: PLACE.ford,
      description: "Nothing crosses Greywater Ford without paying. What it asks for is never the same twice.",
      objectives: objectives(0, "Learn what the Toll-Keeper wants", "Decide whether to pay"),
      relatedNPCIds: [PERSON.toll] },
    { id: "example-quest-vesk", title: "Bring Vesk Harrow to Harrowgate", status: "active", locationId: PLACE.harrowgate,
      description: "Corvin Hale’s warrant, and his reward, for the smuggler. Alive.",
      objectives: objectives(1, "Find Vesk in Cinderford", "Take him without a fight", "Cross the Ironmouth Pass", "Hand him to Corvin Hale"),
      relatedNPCIds: [PERSON.vesk, PERSON.hale] },
    { id: "example-quest-fen", title: "Map the Saltmarsh Fen", status: "active", locationId: PLACE.fen,
      description: "Wren’s map of the fen is wrong in ways that matter. Nobody has written down the right one yet.",
      objectives: [], relatedNPCIds: [] },
    { id: "example-quest-crossing", title: "Cross at Cinderford after dark", status: "completed", locationId: PLACE.ferry,
      description: "Odile would not take us over at night, so we found out why.",
      objectives: objectives(3, "Pay the ferrywoman in salt", "Cross after dark", "Reach the far bank"),
      relatedNPCIds: [PERSON.odile] },
    { id: "example-quest-salt", title: "Deliver the salt to Odile Marrow", status: "completed", locationId: PLACE.cinderford,
      description: "A sack of salt, owed for a crossing, carried the long way round.",
      objectives: objectives(1, "Bring a sack of salt to the ferry"),
      relatedNPCIds: [PERSON.odile] },
    { id: "example-quest-escort", title: "Escort the magistrate home", status: "completed", locationId: PLACE.harrowgate,
      description: "Hale paid well to be walked home over the pass, and complained about the pace the whole way.",
      objectives: objectives(2, "Meet Hale at the Ironmouth Pass", "See him through the gate at Harrowgate"),
      relatedNPCIds: [PERSON.hale] },
    { id: "example-quest-ferry", title: "Save the night ferry", status: "failed", locationId: PLACE.ferry,
      description: "Captain Fenn asked us aboard for one night. The boat did not make it.",
      objectives: objectives(1, "Board the night ferry", "Keep Captain Fenn aboard", "Bring the boat back"),
      relatedNPCIds: [PERSON.fenn] },
    { id: "example-quest-pell", title: "Keep Old Pell alive", status: "failed", locationId: PLACE.tallow,
      description: "Pell had seen too much and said so in the wrong inn.",
      objectives: objectives(0, "Get Old Pell out of Cinderford"),
      relatedNPCIds: [PERSON.pell] },
  ],
  rumours: [
    { id: "example-rumour-buried", title: "Harrow buried the ledger, he never lost it", status: "unconfirmed",
      sourceType: "npc", sourceName: "Marta Tallow", relatedNPCIds: [PERSON.vesk],
      content: "Marta says Vesk came in the night the ferry sank with mud to his knees and paid for his drinks in new silver." },
    { id: "example-rumour-under-ford", title: "Something lives under Greywater Ford", status: "unconfirmed",
      sourceType: "tavern", sourceName: "The Tallow Cup", relatedNPCIds: [PERSON.toll],
      content: "Everyone at the Tallow Cup has a cousin who heard it speak. Nobody has a cousin who saw it." },
    { id: "example-rumour-low-tide", title: "The Drowned Archive opens at low tide", status: "unconfirmed",
      sourceType: "npc", sourceName: "Sister Wren", convertedToQuestId: "example-quest-fen",
      content: "Wren let slip that the archive’s door stands clear of the water when the river is low enough." },
    { id: "example-rumour-reward", title: "Harrowgate pays for Vesk only if he’s alive", status: "unconfirmed",
      sourceType: "notice", sourceName: "Harrowgate notice board", relatedNPCIds: [PERSON.vesk, PERSON.hale],
      content: "The warrant on the board says alive in letters bigger than the reward." },
    { id: "example-rumour-magistrate", title: "The magistrate owes the smugglers", status: "unconfirmed",
      sourceType: "traveler", sourceName: "A drover on the Ironmouth road", relatedNPCIds: [PERSON.hale],
      content: "The drover says Hale’s new roof was paid for with river money, and that is why the reward was halved." },
    { id: "example-rumour-ferry", title: "The ferry crosses at night for those who never paid", status: "confirmed",
      sourceType: "npc", sourceName: "Vesk Harrow", convertedToQuestId: "example-quest-crossing", relatedNPCIds: [PERSON.odile],
      content: "Vesk swore the night ferry takes anyone who has never paid a toll at the ford. We crossed, so it does." },
    { id: "example-rumour-copied", title: "Aldous copied the ledger before it vanished", status: "confirmed",
      sourceType: "npc", sourceName: "Old Pell", convertedToQuestId: "example-quest-aldous", relatedNPCIds: [PERSON.aldous],
      content: "Pell saw Aldous at the landing with ink on his hands the day before the ferry sank. His desk proved it." },
    { id: "example-rumour-salt", title: "Salt, not silver, pays the ferry", status: "confirmed",
      sourceType: "tavern", sourceName: "The Tallow Cup", relatedNPCIds: [PERSON.odile],
      content: "Said at every table in the inn, and true: Odile turned down our coin and took the salt." },
    { id: "example-rumour-drowned", title: "Brother Aldous drowned at the ford", status: "false",
      sourceType: "tavern", sourceName: "The Tallow Cup", relatedNPCIds: [PERSON.aldous],
      content: "The story went round the inn the morning after the flood. His desk was emptied after that, by someone dry." },
    { id: "example-rumour-ghost", title: "The Toll-Keeper is Captain Fenn’s ghost", status: "false",
      sourceType: "npc", sourceName: "Ash-Tongue", relatedNPCIds: [PERSON.toll, PERSON.fenn],
      content: "Ash-Tongue sold us this for five silver. The Toll-Keeper was asking for tolls long before Fenn drowned." },
  ],
  chapters: CHRONICLE.map(([title, summary], index) => ({
    id: `example-chapter-${index + 1}`,
    order: index + 1,
    title,
    summary,
    state: (index < CURRENT_CHAPTER ? "read" : index === CURRENT_CHAPTER ? "reading" : "unread") as ChapterReadState,
    isCurrent: index === CURRENT_CHAPTER,
    percentRead: index < CURRENT_CHAPTER ? 100 : index === CURRENT_CHAPTER ? 40 : 0,
  })),
  note: {
    id: "example-note-fen",
    title: "Session 13 — Into the Fen",
    paragraphs: [
      "Left Cinderford at first light. Odile wouldn’t take us past the ford, so we walked the last stretch through Saltmarsh Fen.",
      "Sister Wren’s map is wrong about the causeway. Lost half a day. Found a hut on stilts. The man there calls himself Gully Thrane, eel-catcher, and says he knew Old Pell.",
      "Cold, wet, and everyone in a bad mood. Lunch was the last of the bread from Cinderford, and it had gone soft in the pack.",
      "Gully says the Drowned Archive only opens when the water is below the third post. Today it was at the fifth.",
      "Spent the afternoon drying out by his stove. He cooked eels. Nobody asked what kind.",
      "Ash-Tongue was waiting at the hut. Of course he was. Sold us a name for ten silver: Mother Reedy. No idea who that is yet.",
      "Walked back the long way so we wouldn’t pass the ford after dark. Odile was right about that much.",
      "Come back with rope and a proper boat, not one of Vesk’s. Someone should ask Corvin Hale about the reward again.",
      "Long day. Everyone was too tired to argue about who keeps the map.",
    ],
    references: [
      PERSON.odile, PERSON.wren, PERSON.pell, PERSON.ash, PERSON.vesk, PERSON.hale,
      PLACE.cinderford, PLACE.fen, PLACE.archive,
    ],
    detections: [
      { id: "example-detection-gully", text: "Gully Thrane", type: "npc", confidence: 0.97 },
      { id: "example-detection-reedy", text: "Mother Reedy", type: "npc", confidence: 0.88 },
      { id: "example-detection-hut", text: "Eel-catcher’s hut", type: "location", confidence: 0.81 },
      { id: "example-detection-post", text: "The Archive opens below the third post", type: "rumor", confidence: 0.9 },
      { id: "example-detection-boat", text: "Return to the Archive with a boat", type: "quest", confidence: 0.76 },
    ],
  },
});

export default EXAMPLE_CAMPAIGN;
