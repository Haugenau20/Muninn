// PROPOSED replacement for src/shared/example-campaign/example-campaign.ts
//
// Type changes needed (in review, as the file's header asks):
//   - ExampleNPC   += "description" | "race" in its Pick  (shown when an example row expands)
//   - ExampleRumour += convertedToQuest: boolean          (RumorRowCells' last cell)
//   - ExampleQuest  unchanged (objectivesDone/Total already exist)
// Still no author field anywhere. Ids keep the `example-` prefix.
// Correction: "Find Brother Aldous" is now `active` (Aldous is `missing`).

const L = {
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

export const EXAMPLE_CAMPAIGN = {
  // Parents before children.
  locations: [
    { id: L.vale, name: "The Ashen Vale", type: "region", status: "explored" },
    { id: L.cinderford, name: "Cinderford", type: "town", status: "visited", parentId: L.vale },
    { id: L.tallow, name: "The Tallow Cup", type: "building", status: "explored", parentId: L.cinderford },
    { id: L.ferry, name: "Cinderford Ferry", type: "poi", status: "explored", parentId: L.cinderford },
    { id: L.chapel, name: "The Vale Chapel", type: "building", status: "explored", parentId: L.vale },
    { id: L.ford, name: "Greywater Ford", type: "landmark", status: "visited", parentId: L.vale },
    { id: L.fen, name: "Saltmarsh Fen", type: "village", status: "known", parentId: L.vale },
    { id: L.archive, name: "The Drowned Archive", type: "dungeon", status: "known", parentId: L.fen },
    { id: L.harrowgate, name: "Harrowgate", type: "city", status: "visited" },
    { id: L.ironmouth, name: "Ironmouth Pass", type: "landmark", status: "known" },
  ],
  npcs: [
    { id: "example-npc-odile", name: "Odile Marrow", title: "Keeper of the Cinderford crossing", status: "alive", relationship: "friendly", occupation: "Ferrywoman", race: "Human", locationId: L.cinderford,
      description: "Takes payment in salt, never coin. Will not cross after dark, and will not say why." },
    { id: "example-npc-vesk", name: "Vesk Harrow", title: "Wanted in three towns", status: "alive", relationship: "hostile", occupation: "Smuggler", race: "Half-elf", locationId: L.cinderford,
      description: "Told us the ledger was under the ferry landing. It was not. Owes the party forty silver and an explanation." },
    { id: "example-npc-fenn", name: "Idris Fenn", title: "Went down with the ledger", status: "deceased", relationship: "friendly", occupation: "Ferry captain", race: "Human", locationId: L.cinderford,
      description: "Captained the night ferry. His boat was found empty at Greywater Ford." },
    { id: "example-npc-marta", name: "Marta Tallow", title: "Keeps the Tallow Cup", status: "alive", relationship: "friendly", occupation: "Innkeeper", race: "Halfling", locationId: L.tallow,
      description: "Hears everything said over her bar and repeats about half of it." },
    { id: "example-npc-pell", name: "Old Pell", title: "Saw the boat go under", status: "deceased", relationship: "neutral", occupation: "Fisherman", race: "Human", locationId: L.tallow,
      description: "Swore the ferry sank on its own. Found in the fen two days later." },
    { id: "example-npc-aldous", name: "Brother Aldous", title: "Archivist of the Vale chapel", status: "missing", relationship: "neutral", occupation: "Priest", race: "Human", locationId: L.chapel,
      description: "Copied the ledger before it vanished. Nobody has seen him since the flood." },
    { id: "example-npc-wren", name: "Sister Wren", title: "Says she never met Aldous", status: "alive", relationship: "unknown", occupation: "Acolyte", race: "Elf", locationId: L.chapel,
      description: "Keeps the chapel. Her story about Aldous changes each time we ask." },
    { id: "example-npc-toll", name: "The Toll-Keeper", title: "Nobody has seen its face", status: "unknown", relationship: "hostile", occupation: "", race: "", locationId: L.ford,
      description: "Demands a toll at the ford, in a voice from under the water." },
    { id: "example-npc-hale", name: "Corvin Hale", title: "Magistrate of Harrowgate", status: "alive", relationship: "neutral", occupation: "Magistrate", race: "Human", locationId: L.harrowgate,
      description: "Signed the warrant for Vesk. Offered a reward, then halved it." },
    // No locationId: renders under the muted "Location unknown" group.
    // Requires ExampleNPC.locationId to become optional.
    { id: "example-npc-ash", name: "Ash-Tongue", title: "Sells names by the letter", status: "alive", relationship: "unknown", occupation: "Informant", race: "Tiefling",
      description: "Turns up wherever the party has just been. Knew our names before we gave them." },
  ],
  quests: [
    { id: "example-quest-ledger", title: "Recover the drowned ledger", status: "active", locationId: L.cinderford, objectivesDone: 1, objectivesTotal: 3 },
    { id: "example-quest-aldous", title: "Find Brother Aldous", status: "active", locationId: L.chapel, objectivesDone: 1, objectivesTotal: 2 },
    { id: "example-quest-toll", title: "Pay the Toll-Keeper, or don’t", status: "active", locationId: L.ford, objectivesDone: 0, objectivesTotal: 2 },
    { id: "example-quest-vesk", title: "Bring Vesk Harrow to Harrowgate", status: "active", locationId: L.harrowgate, objectivesDone: 1, objectivesTotal: 4 },
    { id: "example-quest-fen", title: "Map the Saltmarsh Fen", status: "active", locationId: L.fen, objectivesDone: 0, objectivesTotal: 0 },
    { id: "example-quest-crossing", title: "Cross at Cinderford after dark", status: "completed", locationId: L.ferry, objectivesDone: 3, objectivesTotal: 3 },
    { id: "example-quest-salt", title: "Deliver the salt to Odile Marrow", status: "completed", locationId: L.cinderford, objectivesDone: 1, objectivesTotal: 1 },
    { id: "example-quest-escort", title: "Escort the magistrate home", status: "completed", locationId: L.harrowgate, objectivesDone: 2, objectivesTotal: 2 },
    { id: "example-quest-ferry", title: "Save the night ferry", status: "failed", locationId: L.ferry, objectivesDone: 1, objectivesTotal: 3 },
    { id: "example-quest-pell", title: "Keep Old Pell alive", status: "failed", locationId: L.tallow, objectivesDone: 0, objectivesTotal: 1 },
  ],
  rumours: [
    { id: "example-rumour-buried", title: "Harrow buried the ledger, he never lost it", status: "unconfirmed", sourceType: "npc", sourceName: "Marta Tallow", convertedToQuest: false },
    { id: "example-rumour-under-ford", title: "Something lives under Greywater Ford", status: "unconfirmed", sourceType: "tavern", sourceName: "The Tallow Cup", convertedToQuest: false },
    { id: "example-rumour-low-tide", title: "The Drowned Archive opens at low tide", status: "unconfirmed", sourceType: "npc", sourceName: "Sister Wren", convertedToQuest: true },
    { id: "example-rumour-reward", title: "Harrowgate pays for Vesk only if he’s alive", status: "unconfirmed", sourceType: "notice", sourceName: "Harrowgate notice board", convertedToQuest: false },
    { id: "example-rumour-magistrate", title: "The magistrate owes the smugglers", status: "unconfirmed", sourceType: "traveler", sourceName: "A drover on the Ironmouth road", convertedToQuest: false },
    { id: "example-rumour-ferry", title: "The ferry crosses at night for those who never paid", status: "confirmed", sourceType: "npc", sourceName: "Vesk Harrow", convertedToQuest: true },
    { id: "example-rumour-copied", title: "Aldous copied the ledger before it vanished", status: "confirmed", sourceType: "npc", sourceName: "Old Pell", convertedToQuest: true },
    { id: "example-rumour-salt", title: "Salt, not silver, pays the ferry", status: "confirmed", sourceType: "tavern", sourceName: "The Tallow Cup", convertedToQuest: false },
    { id: "example-rumour-drowned", title: "Brother Aldous drowned at the ford", status: "false", sourceType: "tavern", sourceName: "The Tallow Cup", convertedToQuest: false },
    { id: "example-rumour-ghost", title: "The Toll-Keeper is Captain Fenn’s ghost", status: "false", sourceType: "npc", sourceName: "Ash-Tongue", convertedToQuest: false },
  ],
  chapters: [
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
  ].map(([title, summary], i) => ({
    id: `example-chapter-${i + 1}`,
    order: i + 1,
    title,
    summary,
    state: i < 12 ? "read" : i === 12 ? "reading" : "unread",
    isCurrent: i === 12,
    percentRead: i < 12 ? 100 : i === 12 ? 40 : 0,
  })),
};
// Wrap with the existing `frozen(...)` / Object.freeze and the typed shapes when porting.
