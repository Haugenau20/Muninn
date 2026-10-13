// src/shared/example-campaign/__tests__/example-campaign.test.ts
import { EXAMPLE_CAMPAIGN } from "../example-campaign";

const { npcs, quests, locations, rumours, chapters, note } = EXAMPLE_CAMPAIGN;

const collections = [
  ["npcs", npcs],
  ["quests", quests],
  ["locations", locations],
  ["rumours", rumours],
  ["chapters", chapters],
] as const;

describe("the example campaign", () => {
  test.each(collections)("its %s are a fixed picture, frozen all the way down", (_name, rows) => {
    expect(Object.isFrozen(EXAMPLE_CAMPAIGN)).toBe(true);
    expect(Object.isFrozen(rows)).toBe(true);
    rows.forEach((row) => expect(Object.isFrozen(row)).toBe(true));
  });

  test("its note is frozen too, down to its lists", () => {
    expect(Object.isFrozen(note)).toBe(true);
    expect(Object.isFrozen(note.paragraphs)).toBe(true);
    expect(Object.isFrozen(note.references)).toBe(true);
    expect(Object.isFrozen(note.detections)).toBe(true);
    note.detections.forEach((detection) => expect(Object.isFrozen(detection)).toBe(true));
  });

  // The signed-out pages render the whole directory from these: a status bar,
  // filters and groups need enough rows to have something to show.
  test("each list is long enough to show its page's furniture", () => {
    expect(npcs).toHaveLength(10);
    expect(locations).toHaveLength(10);
    expect(quests).toHaveLength(10);
    expect(rumours).toHaveLength(10);
    expect(chapters).toHaveLength(14);
  });

  test("no row credits anyone: attribution is the one thing an example must not invent", () => {
    const authorLike = /creat|author|user|character|by$|owner|writer/i;
    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value && typeof value === "object") {
        Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
          keys.push(key);
          walk(child);
        });
      }
    };
    walk(EXAMPLE_CAMPAIGN);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => authorLike.test(key))).toEqual([]);
  });

  test("every id is an example id, and no two rows share one", () => {
    const ids = [...collections.flatMap(([, rows]) => rows.map((row) => row.id)), note.id];
    ids.forEach((id) => expect(id).toMatch(/^example-/));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("it is one setting: every place and person a row names is in the example", () => {
    const locationIds = new Set(locations.map((location) => location.id));
    const npcIds = new Set(npcs.map((npc) => npc.id));
    const npcNames = new Set(npcs.map((npc) => npc.name));
    const questIds = new Set(quests.map((quest) => quest.id));

    npcs
      .filter((npc) => npc.locationId)
      .forEach((npc) => expect(locationIds).toContain(npc.locationId));
    quests.forEach((quest) => {
      expect(locationIds).toContain(quest.locationId);
      quest.relatedNPCIds.forEach((id) => expect(npcIds).toContain(id));
    });
    locations
      .filter((location) => location.parentId)
      .forEach((location) => expect(locationIds).toContain(location.parentId));
    rumours
      .filter((rumour) => rumour.sourceType === "npc")
      .forEach((rumour) => expect(npcNames).toContain(rumour.sourceName));
    rumours
      .filter((rumour) => rumour.convertedToQuestId)
      .forEach((rumour) => expect(questIds).toContain(rumour.convertedToQuestId));
  });

  // The location tree renders in list order, so a child listed before its
  // parent would have nowhere to hang.
  test("parents come before their children", () => {
    const seen = new Set<string>();
    const hungBeforeTheirParent: string[] = [];
    locations.forEach((location) => {
      if (location.parentId && !seen.has(location.parentId)) hungBeforeTheirParent.push(location.id);
      seen.add(location.id);
    });
    expect(hungBeforeTheirParent).toEqual([]);
  });

  // "Find Brother Aldous" was once completed while Aldous was listed missing.
  test("no quest is done while a person its title names is missing", () => {
    const missing = npcs.filter((npc) => npc.status === "missing");
    quests
      .filter((quest) => quest.status === "completed")
      .forEach((quest) => missing.forEach((npc) => expect(quest.title).not.toContain(npc.name)));
  });

  test("a completed quest has every objective done", () => {
    quests
      .filter((quest) => quest.status === "completed")
      .forEach((quest) => quest.objectives.forEach((objective) => expect(objective.completed).toBe(true)));
  });

  test("its chapters are numbered in play order from one, and exactly one is current", () => {
    expect(chapters.map((chapter) => chapter.order)).toEqual(chapters.map((_chapter, index) => index + 1));
    expect(chapters.filter((chapter) => chapter.isCurrent)).toHaveLength(1);
  });

  // The links panel files a detected name under "in your campaign" when a
  // record already has it, so a detection that matched one would make the
  // example contradict itself.
  test("the note names only what the example holds, and finds only what it lacks", () => {
    const recordIds = new Set([...npcs, ...locations].map((row) => row.id));
    note.references.forEach((id) => expect(recordIds).toContain(id));

    const names = new Set(
      [
        ...npcs.map((npc) => npc.name),
        ...locations.map((location) => location.name),
        ...quests.map((quest) => quest.title),
        ...rumours.map((rumour) => rumour.title),
      ].map((name) => name.toLowerCase())
    );
    note.detections.forEach((detection) => expect(names).not.toContain(detection.text.toLowerCase()));
  });
});
