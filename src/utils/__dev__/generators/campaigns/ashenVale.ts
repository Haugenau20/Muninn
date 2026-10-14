// src/utils/__dev__/generators/campaigns/ashenVale.ts

// Relative, not `shared/...` or `core/...`: this runs under ts-node, which ignores baseUrl.
import { EXAMPLE_CAMPAIGN } from "../../../../shared/example-campaign/example-campaign";
import { slugifyEntityName } from "../../../../core/utils/entity-id";
import type { CampaignSeed, LocationSeed, NpcSeed, QuestSeed, RumorSeed } from "./types";

/*
  Campaign 1-1 is the site's own example campaign, the Ashen Vale
  (`shared/example-campaign`), as a group would have recorded it: the same
  people, places, quests, rumours and chapters, in the same states, with
  everything the example leaves out filled in (who wrote what, chapter text,
  notes, the links between records).

  The records are read from the example rather than copied, so the two cannot
  drift apart; only what the example lacks is written here. Ids are slugs of
  each record's name, as the app makes them (`slugifyEntityName`), not the
  example's `example-` ids.
*/

const { npcs, locations, quests, rumours, chapters } = EXAMPLE_CAMPAIGN;

/** Each example id's id in the sample data. */
const ID = new Map<string, string>([
  ...locations.map((place) => [place.id, slugifyEntityName(place.name)] as const),
  ...npcs.map((npc) => [npc.id, slugifyEntityName(npc.name)] as const),
  ...quests.map((quest) => [quest.id, slugifyEntityName(quest.title)] as const),
  ...rumours.map((rumour) => [rumour.id, slugifyEntityName(rumour.title)] as const),
]);

const idOf = (exampleId: string): string => {
  const id = ID.get(exampleId);
  if (!id) throw new Error(`The example has no record ${exampleId}`);
  return id;
};

/**
 * What the sample data adds to an example record, by the record's sample id.
 * A key that names no record is an error, not a silent no-op.
 */
const withExtras = <T extends { id: string }>(records: T[], extras: Record<string, Partial<T>>): T[] => {
  const unknown = Object.keys(extras).filter((id) => !records.some((record) => record.id === id));
  if (unknown.length > 0) throw new Error(`Extras for records the Ashen Vale lacks: ${unknown.join(", ")}`);
  return records.map((record) => ({ ...record, ...extras[record.id] }));
};

const NPC_EXTRAS: Record<string, Partial<NpcSeed>> = {
  "odile-marrow": {
    appearance: "Broad-shouldered, grey braid tied back with ferry rope, hands like knotted wood.",
    personality: "Patient, blunt, and immovable on the subject of crossing after dark.",
    background: "Has worked the Cinderford crossing for thirty years. Her mother worked it before her, back when there was a first Cinderford.",
    knows: ["idris-fenn", "marta-tallow"],
    affiliations: ["Cinderford Ferry"],
    notes: [
      "Keeps a jar of salt by the winch. Takes a pinch from every payment and throws it in the river.",
      "Would not say Fenn's name out loud. Called him \"the captain\".",
    ],
    tags: ["ferry", "salt"],
    by: "Tamsin",
  },
  "vesk-harrow": {
    appearance: "Thin, quick, a silver ring in each ear and river mud on his boots whatever the weather.",
    personality: "Charming until he is cornered, then charming faster.",
    background: "Ran cargo on Fenn's night ferry for years. Wanted in Harrowgate, Ironmouth and somewhere he will not name.",
    knows: ["idris-fenn", "corvin-hale"],
    affiliations: ["The river trade"],
    notes: [
      "Owes the party forty silver. Says he will pay when the ledger turns up.",
      "Flinched when Brannoc mentioned the magistrate's new roof.",
    ],
    tags: ["smuggler", "liar"],
    by: "Brannoc",
  },
  "idris-fenn": {
    appearance: "Remembered as a big man with a captain's coat two sizes too small.",
    personality: "By every account careful, quiet, and good at forgetting what was in his hold.",
    background: "Captained the night ferry across the Grey and kept a ledger of every crossing.",
    affiliations: ["Cinderford Ferry"],
    notes: ["His boat is still in the reeds at Greywater Ford. He was not aboard when it got there."],
  },
  "marta-tallow": {
    appearance: "Halfling, flour to the elbows, a candle stub tucked behind one ear.",
    personality: "Warm, nosy, and generous with stories that are about half true.",
    background: "Inherited the Tallow Cup from an aunt who made candles for the whole vale.",
    knows: ["old-pell"],
    affiliations: ["The Tallow Cup"],
    notes: ["Gives the party a room at half price as long as we tell her where we have been."],
    tags: ["innkeeper", "gossip"],
    by: "Merrit",
  },
  "old-pell": {
    appearance: "Bent, bearded, smelled of eels and pipe smoke.",
    personality: "Stubborn, and certain of what he saw.",
    background: "Fished the Grey below Cinderford all his life.",
    notes: [
      "Told us the ferry went down on its own, with nothing near it.",
      "Found in Saltmarsh Fen two days after he told the whole Tallow Cup.",
    ],
  },
  "brother-aldous": {
    appearance: "Ink-stained fingers, a scholar's stoop, spectacles mended with thread (from his portrait in the chapel).",
    personality: "Wren says he was meticulous. Then she says she never met him.",
    background: "Archivist of the Vale Chapel. Copied the ledger the day before the ferry sank.",
    knows: ["sister-wren"],
    affiliations: ["The Vale Chapel"],
    notes: ["His desk was emptied after the flood, by someone who stayed dry."],
    tags: ["missing", "ledger"],
  },
  "sister-wren": {
    appearance: "Elf, young for one, a grey habit and very clean hands.",
    personality: "Polite, evasive, and quick to change the subject.",
    background: "Keeps the Vale Chapel alone since Aldous vanished.",
    notes: ["Drew us a map of the fen. The causeway on it does not exist."],
  },
  "the-toll-keeper": {
    personality: "Patient. Very patient.",
    background: "Asking tolls at Greywater Ford since before Cinderford burned, if Marta is right.",
    notes: [
      "Asked for our names. Rowan gave a false one and it laughed.",
      "Paid once. It made clear that was one crossing, not all of them.",
    ],
    by: "Rowan",
  },
  "corvin-hale": {
    appearance: "Tall, grey-whiskered, a magistrate's chain he never takes off.",
    personality: "Courteous, tight-fisted, and very interested in that ledger.",
    background: "Magistrate of Harrowgate for twelve years. Lately had a new roof put on his house.",
    affiliations: ["Harrowgate"],
    notes: ["Halved the reward for Vesk the day after we brought up the ledger."],
    tags: ["magistrate", "patron"],
  },
  "ash-tongue": {
    appearance: "Tiefling, ash-grey skin, a forked tongue he shows off when he lies.",
    personality: "Amused by everything, especially us.",
    background: "Nobody knows. He sells names by the letter and never runs out.",
    knows: ["vesk-harrow"],
    notes: ["Knew all our names before we gave them. Charged us for them anyway."],
    by: "Elspeth",
  },
};

const LOCATION_EXTRAS: Record<string, Partial<LocationSeed>> = {
  "the-ashen-vale": {
    features: ["The Grey river", "Burnt orchards", "Ash in every ploughed field"],
    tags: ["region", "fire"],
    notes: ["Nobody under fifty will say what burned. Nobody over fifty will say anything else."],
    by: "DungeonMaster",
  },
  cinderford: {
    features: ["The ferry landing", "Ash-brick houses", "The old town's chimneys, still standing"],
    tags: ["town", "river"],
    notes: ["Built on top of the first Cinderford. You can see its chimneys at low water."],
  },
  "the-tallow-cup": {
    features: ["Candles on every table", "Rooms over the bar", "A back door onto the river"],
    tags: ["inn"],
  },
  "cinderford-ferry": {
    features: ["Rope ferry", "Winch house", "Odile's salt jar"],
    tags: ["ferry", "crossing"],
    notes: ["Runs by day for coin and by night for salt, and Odile only works the day shift."],
  },
  "the-vale-chapel": {
    features: ["A library too big for the building", "Aldous's desk", "A bell nobody rings"],
    tags: ["chapel", "library"],
  },
  "greywater-ford": {
    features: ["Stepping stones", "Fenn's boat, still in the reeds", "A voice under the water"],
    tags: ["ford", "danger"],
    notes: ["Water drops a foot overnight before the Toll-Keeper speaks."],
  },
  "saltmarsh-fen": {
    features: ["Stilt houses", "Eel traps", "A causeway that is not on Wren's map"],
    tags: ["marsh", "village"],
  },
  "the-drowned-archive": {
    features: ["A sunken abbey", "Shelves above the waterline", "A door that clears the water at low tide"],
    tags: ["dungeon", "library"],
    notes: ["The river has to be below the third post. It was at the fifth."],
  },
  harrowgate: {
    features: ["Walled city", "The magistrate's court", "A notice board full of warrants"],
    tags: ["city", "law"],
  },
  "ironmouth-pass": {
    features: ["Drovers' road", "A toll gate that is actually a toll gate"],
    tags: ["road", "pass"],
  },
};

const QUEST_EXTRAS: Record<string, Partial<QuestSeed>> = {
  "recover-the-drowned-ledger": {
    background: "Fenn wrote down every crossing the night ferry made, and who paid for it. Half of Cinderford is in that book.",
    leads: ["Aldous made a copy", "Vesk was at the landing the night it sank"],
    keyLocations: [
      { name: "Cinderford Ferry", description: "Where the ledger was last seen", locationId: "cinderford-ferry" },
      { name: "The Vale Chapel", description: "Where Aldous copied it", locationId: "the-vale-chapel" },
    ],
    complications: ["Corvin Hale wants it more than he admits", "Vesk wants it to stay lost"],
    rewards: ["Whatever Hale will pay", "The truth about the night ferry"],
    levelRange: "3-5",
  },
  "find-brother-aldous": {
    background: "Aldous vanished the night of the flood, and so did his copy of the ledger.",
    leads: ["Wren knows more than she says", "His pens are gone too"],
    complications: ["Wren's story changes each time"],
    levelRange: "3-5",
  },
  "pay-the-toll-keeper-or-don-t": {
    background: "Whatever lives under Greywater Ford asks a toll of everyone who crosses, and never the same toll twice.",
    complications: ["What it asks for is never coin"],
    levelRange: "4-6",
  },
  "bring-vesk-harrow-to-harrowgate": {
    background: "Corvin Hale's warrant for the smuggler. Alive, in large letters.",
    keyLocations: [
      { name: "Ironmouth Pass", description: "The only road to Harrowgate", locationId: "ironmouth-pass" },
    ],
    rewards: ["Half of what Hale first promised"],
    levelRange: "3-5",
  },
  "cross-at-cinderford-after-dark": {
    rewards: ["The far bank", "A good idea of why nobody does it"],
  },
  "save-the-night-ferry": {
    background: "Fenn asked us aboard for one crossing. He would not say what he was carrying.",
    complications: ["Something under the ford"],
  },
};

const RUMOUR_EXTRAS: Record<string, Partial<RumorSeed>> = {
  "harrow-buried-the-ledger-he-never-lost-it": {
    locationId: "the-tallow-cup",
    notes: [{ content: "New silver, the night the ferry sank. Where from?", by: "Brannoc" }],
    by: "Merrit",
  },
  "something-lives-under-greywater-ford": {
    locationId: "the-tallow-cup",
    places: ["greywater-ford"],
    notes: [{ content: "It does. We have heard it.", by: "Rowan" }],
  },
  "the-drowned-archive-opens-at-low-tide": {
    locationId: "the-vale-chapel",
    places: ["the-drowned-archive"],
    by: "Tamsin",
  },
  "harrowgate-pays-for-vesk-only-if-he-s-alive": {
    locationId: "harrowgate",
  },
  "the-magistrate-owes-the-smugglers": {
    locationId: "ironmouth-pass",
    places: ["harrowgate"],
    notes: [
      { content: "Would explain the halved reward.", by: "Elspeth" },
      { content: "Or he is just mean.", by: "Brannoc" },
    ],
  },
  "the-ferry-crosses-at-night-for-those-who-never-paid": {
    locationId: "cinderford",
    places: ["cinderford-ferry"],
  },
  "aldous-copied-the-ledger-before-it-vanished": {
    locationId: "the-tallow-cup",
    places: ["the-vale-chapel"],
  },
  "salt-not-silver-pays-the-ferry": {
    locationId: "the-tallow-cup",
    places: ["cinderford-ferry"],
  },
  "brother-aldous-drowned-at-the-ford": {
    locationId: "the-tallow-cup",
    places: ["greywater-ford"],
    notes: [{ content: "Someone wanted this believed.", by: "Tamsin" }],
  },
};

/** Each example chapter's text, by its place in the chronicle. */
const CHAPTER_TEXT: readonly string[] = [
  // 1 The Crossing at Cinderford
  "We came down into the Ashen Vale on the old drovers' road, and the first thing everyone noticed was the colour. The fields are grey, the orchards are black stumps, and the river is called the Grey for reasons that become obvious.\n\nOdile Marrow runs the ferry at Cinderford. She would not take our coin. She wanted salt, a sack of it, and Merrit had to walk back to the last farm to buy one. When we asked about crossing after dark she simply stopped the winch until we changed the subject.",
  // 2 Ashes on the Water
  "Vesk Harrow found us before we found him. He said Captain Fenn kept his ledger hidden under the ferry landing, wrapped in oilcloth, and that it was worth a great deal to the right people.\n\nBrannoc went in after it. There was mud, an old anchor and a great many eels, and no ledger. When he came back up, Fenn's boat was gone from its mooring, and Vesk was gone with the forty silver we had advanced him.",
  // 3 The Tallow Cup
  "Marta Tallow put us up for half price on the condition that we tell her everything. In return she told us a great deal, of which perhaps half was true.\n\nVesk turned up at the bar that evening as if nothing had happened, bought a round on credit, and told a long story about a sea serpent in the Grey. Nobody believed him. Tamsin kept count of the lies and stopped at eleven.",
  // 4 A Warrant from Harrowgate
  "A rider came down from Harrowgate with a warrant for Vesk Harrow, signed by Magistrate Corvin Hale, and a reward large enough to make Rowan go quiet.\n\nThe warrant says alive in letters bigger than the reward. Vesk read it over Elspeth's shoulder and said he would rather not be wanted at all, thank you, and was out of the back door before anyone stood up.",
  // 5 Night Ferry
  "Captain Fenn asked us aboard the night ferry for one crossing. He would not say what was in the hold, and he kept a ledger open on his knee the whole way, writing.\n\nHalfway across, at Greywater Ford, the water went very still. Something spoke from under the boat. When the lantern came back on, Fenn was gone, and so was the ledger. The boat was taking water; we swam for the far bank and left her in the reeds. Odile was on the far landing in the morning with blankets, and did not say a word.",
  // 6 What Pell Saw
  "Old Pell fishes below the ford. He swore the night ferry went under on its own, with nothing near it. We were aboard, and we know better, but he would not hear it.\n\nHe told the story once, loudly, in the Tallow Cup, and would not tell it again. Marta says that was a mistake, and would not say why.",
  // 7 Salt and Silver
  "The ferry has its price: salt by night, silver by day. So does the magistrate. Hale came down to Cinderford himself, asked about the ledger three times while pretending not to, and halved the reward for Vesk before he left.\n\nOn the way out of town he paid a carter in salt. Elspeth noticed. Nobody else did.",
  // 8 The Vale Chapel
  "Brother Aldous kept the chapel's library, which is far too big for the chapel. His desk had been cleared out down to the bare wood, very neatly, as if someone wanted us to find it exactly that way.\n\nUnder the blotter, Tamsin found a single page of Fenn's ledger, copied out in Aldous's hand. He had been making a copy.",
  // 9 Sister Wren's Story
  "Sister Wren keeps the chapel now. She says she never met Brother Aldous; she arrived after the flood. She also knew which drawer he kept his pens in, and that he liked the green ink.\n\nWe did not press her. Rowan thinks she is protecting him. Brannoc thinks she is protecting herself. She gave us a map of Saltmarsh Fen and wished us a safe journey in a way that sounded final.",
  // 10 Low Water
  "The Grey dropped a foot overnight. Nobody in Cinderford seemed surprised, and nobody would go near the river.\n\nAt dusk we heard it from the landing: a voice from the direction of Greywater Ford, too low to make out, going on and on like someone reading a list.",
  // 11 Greywater Ford
  "We went to the ford at noon, on the theory that nothing talks at noon. It talked. We asked the Toll-Keeper its name, and it asked for ours.\n\nRowan gave a false one. It laughed. Fenn's boat is still in the reeds where we left it.",
  // 12 The Toll Is Paid
  "We paid. It did not want coin. It is not in these notes because Merrit asked that it not be, and the rest of us agreed.\n\nOn the far side we heard that Old Pell had been found in Saltmarsh Fen, two days after his story at the Tallow Cup. The fen is a long way from his river.",
  // 13 Into the Fen
  "Wren's map was half right. The half that was wrong had teeth, and a causeway that is not there, and a great deal of water.\n\nWe spent the night with an eel-catcher on stilts who knew Pell. Ash-Tongue was waiting there for us. He always is.",
  // 14 The Drowned Archive
  "The river was at the fifth post, and the archive needs it below the third. We waited two days on the bank, eating eels, until it dropped.\n\nThe door was clear of the water by a hand's width. Inside, the shelves above the waterline are dry, and somebody has been reading them.",
];

/** The campaign's people: the example's, filled out. */
const NPCS: NpcSeed[] = withExtras(
  npcs.map((npc) => ({
    id: idOf(npc.id),
    name: npc.name,
    title: npc.title,
    status: npc.status,
    relationship: npc.relationship,
    race: npc.race,
    occupation: npc.occupation,
    description: npc.description,
  })),
  NPC_EXTRAS
);

/** The campaign's places: the example's, each listing the people met there. */
const LOCATIONS: LocationSeed[] = withExtras(
  locations.map((place) => ({
    id: idOf(place.id),
    name: place.name,
    type: place.type,
    status: place.status,
    description: place.description,
    parentId: place.parentId ? idOf(place.parentId) : undefined,
    people: npcs.filter((npc) => npc.locationId === place.id).map((npc) => idOf(npc.id)),
    visited: place.status !== "known",
  })),
  LOCATION_EXTRAS
);

/** The campaign's quests: the example's, filled out. */
const QUESTS: QuestSeed[] = withExtras(
  quests.map((quest) => ({
    id: idOf(quest.id),
    title: quest.title,
    description: quest.description,
    status: quest.status,
    objectives: quest.objectives.map((objective) => ({ ...objective })),
    people: quest.relatedNPCIds.map(idOf),
    locationId: idOf(quest.locationId),
  })),
  QUEST_EXTRAS
);

/** The campaign's rumours: the example's, with where each was heard. */
const RUMOURS: RumorSeed[] = withExtras(
  rumours.map((rumour) => ({
    id: idOf(rumour.id),
    title: rumour.title,
    content: rumour.content,
    status: rumour.status,
    sourceType: rumour.sourceType,
    sourceName: rumour.sourceName,
    sourceNpcId:
      rumour.sourceType === "npc"
        ? NPCS.find((npc) => npc.name === rumour.sourceName)?.id
        : undefined,
    people: (rumour.relatedNPCIds ?? []).map(idOf),
    convertedToQuestId: rumour.convertedToQuestId ? idOf(rumour.convertedToQuestId) : undefined,
  })),
  RUMOUR_EXTRAS
);

if (CHAPTER_TEXT.length !== chapters.length) {
  throw new Error(`The Ashen Vale has text for ${CHAPTER_TEXT.length} chapters; the example has ${chapters.length}`);
}

/** Campaign 1-1: the example campaign, as group 1 recorded it. */
export const ASHEN_VALE: CampaignSeed = {
  id: "campaign1-1",
  groupId: "group1",
  name: "The Ashen Vale",
  description: "A drowned ledger, a ferry nobody takes after dark, and a valley still grey from a fire nobody will talk about.",
  isActive: true,
  endedDaysAgo: 2,
  chapters: chapters.map((chapter, index) => ({
    title: chapter.title,
    summary: chapter.summary,
    text: CHAPTER_TEXT[index],
  })),
  locations: LOCATIONS,
  npcs: NPCS,
  quests: QUESTS,
  rumors: RUMOURS,
  saga: {
    title: "The Ledger of the Night Ferry",
    content:
      "The Ashen Vale burned a long time ago, and nobody will say how. The town of Cinderford was built on the ashes of the first one, and the river Grey still runs the colour of what was lost.\n\n" +
      "We came for work and found a mystery instead. Captain Idris Fenn kept a ledger of every crossing his night ferry made and who paid for it. The ferry went down at Greywater Ford with Fenn and the ledger aboard, and half the vale has been looking for that book ever since, while the other half hopes it stays at the bottom of the river.\n\n" +
      "Vesk Harrow lied to us about where it was. Corvin Hale, magistrate of Harrowgate, wants Vesk alive and the ledger more than he admits. Brother Aldous made a copy and vanished the night of the flood. And under the ford, something asks a toll of everyone who crosses, and never the same toll twice.\n\n" +
      "Now the river is low, and the Drowned Archive is open.",
  },
};
