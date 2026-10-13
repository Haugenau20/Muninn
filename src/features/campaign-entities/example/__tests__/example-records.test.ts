// src/features/campaign-entities/example/__tests__/example-records.test.ts
import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";
import { EXAMPLE_RECORDS } from "../example-records";

const all = [
  ...EXAMPLE_RECORDS.npcs,
  ...EXAMPLE_RECORDS.locations,
  ...EXAMPLE_RECORDS.quests,
  ...EXAMPLE_RECORDS.rumors,
];

describe("EXAMPLE_RECORDS", () => {
  it("holds every row of the example, as a full record", () => {
    expect(EXAMPLE_RECORDS.npcs).toHaveLength(EXAMPLE_CAMPAIGN.npcs.length);
    expect(EXAMPLE_RECORDS.locations).toHaveLength(EXAMPLE_CAMPAIGN.locations.length);
    expect(EXAMPLE_RECORDS.quests).toHaveLength(EXAMPLE_CAMPAIGN.quests.length);
    expect(EXAMPLE_RECORDS.rumors).toHaveLength(EXAMPLE_CAMPAIGN.rumours.length);
  });

  // A record must carry `createdBy`; an example must credit no one. Empty is
  // the one value that satisfies both, and "Recorded by" is not drawn for it.
  it("credits no one", () => {
    all.forEach((record) => {
      expect(record.createdBy).toBe("");
      expect(record.createdByUsername).toBe("");
      expect(record.createdByCharacterName ?? null).toBeNull();
      expect(record.modifiedBy ?? "").toBe("");
    });
  });

  // People are filed under a place by the place's own list (T131).
  it("lists each person on the place they were met", () => {
    EXAMPLE_CAMPAIGN.npcs.forEach((npc) => {
      const places = EXAMPLE_RECORDS.locations.filter((place) =>
        (place.connectedNPCs ?? []).includes(npc.id)
      );
      expect(places.map((place) => place.id)).toEqual(npc.locationId ? [npc.locationId] : []);
    });
  });

  it("keeps each quest's objectives, ticked as the example ticks them, under ids of their own", () => {
    EXAMPLE_CAMPAIGN.quests.forEach((example) => {
      const quest = EXAMPLE_RECORDS.quests.find((record) => record.id === example.id)!;
      expect(quest.objectives.map(({ description, completed }) => ({ description, completed }))).toEqual(
        example.objectives
      );
      expect(new Set(quest.objectives.map((objective) => objective.id)).size).toBe(quest.objectives.length);
      expect(quest.relatedNPCIds).toEqual(example.relatedNPCIds);
    });
  });

  it("keeps the quest each rumour became, and the people it is about", () => {
    EXAMPLE_CAMPAIGN.rumours.forEach((example) => {
      const rumor = EXAMPLE_RECORDS.rumors.find((record) => record.id === example.id)!;
      expect(rumor.convertedToQuestId).toBe(example.convertedToQuestId);
      expect(rumor.relatedNPCs).toEqual(example.relatedNPCIds ?? []);
      expect(rumor.content).toBe(example.content);
    });
  });
});
