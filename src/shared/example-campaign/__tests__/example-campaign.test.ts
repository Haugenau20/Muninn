// src/shared/example-campaign/__tests__/example-campaign.test.ts
import { EXAMPLE_CAMPAIGN } from "../example-campaign";

const collections = [
  ["npcs", EXAMPLE_CAMPAIGN.npcs],
  ["quests", EXAMPLE_CAMPAIGN.quests],
  ["locations", EXAMPLE_CAMPAIGN.locations],
  ["rumours", EXAMPLE_CAMPAIGN.rumours],
  ["chapters", EXAMPLE_CAMPAIGN.chapters],
] as const;

describe("the example campaign", () => {
  test.each(collections)("its %s are a fixed picture, frozen all the way down", (_name, rows) => {
    expect(Object.isFrozen(EXAMPLE_CAMPAIGN)).toBe(true);
    expect(Object.isFrozen(rows)).toBe(true);
    rows.forEach((row) => expect(Object.isFrozen(row)).toBe(true));
  });

  test.each(collections)("its %s have a few rows each, enough to show the page's shape", (_name, rows) => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  test("no row credits anyone: attribution is the one thing an example must not invent", () => {
    const authorLike = /creat|author|user|character|by$|owner|writer/i;
    collections.forEach(([, rows]) =>
      rows.forEach((row) => expect(Object.keys(row).filter((key) => authorLike.test(key))).toEqual([]))
    );
  });

  test("every id is an example id, and no two rows share one", () => {
    const ids = collections.flatMap(([, rows]) => rows.map((row) => row.id));
    ids.forEach((id) => expect(id).toMatch(/^example-/));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("it is one setting: every place and person a row names is in the example", () => {
    const locationIds = new Set(EXAMPLE_CAMPAIGN.locations.map((location) => location.id));
    const npcNames = new Set(EXAMPLE_CAMPAIGN.npcs.map((npc) => npc.name));

    EXAMPLE_CAMPAIGN.npcs.forEach((npc) => expect(locationIds).toContain(npc.locationId));
    EXAMPLE_CAMPAIGN.quests.forEach((quest) => expect(locationIds).toContain(quest.locationId));
    EXAMPLE_CAMPAIGN.locations
      .filter((location) => location.parentId)
      .forEach((location) => expect(locationIds).toContain(location.parentId));
    EXAMPLE_CAMPAIGN.rumours
      .filter((rumour) => rumour.sourceType === "npc")
      .forEach((rumour) => expect(npcNames).toContain(rumour.sourceName));
  });

  test("its chapters are numbered in play order from one", () => {
    expect(EXAMPLE_CAMPAIGN.chapters.map((chapter) => chapter.order)).toEqual(
      EXAMPLE_CAMPAIGN.chapters.map((_chapter, index) => index + 1)
    );
  });
});
