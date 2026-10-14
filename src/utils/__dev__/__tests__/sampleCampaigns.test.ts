// src/utils/__dev__/__tests__/sampleCampaigns.test.ts
// The sample campaigns are hand-written data that only the emulator ever
// reads, so nothing else notices when a link points nowhere or a record is
// credited to someone outside its group. These hold them to what the app
// assumes of real data, and to the one thing T123 decided: campaign 1-1 is
// the site's own example, not a copy that drifts from it.

import { EXAMPLE_CAMPAIGN } from "../../../shared/example-campaign/example-campaign";
import { SAMPLE_CAMPAIGNS } from "../generators/campaigns";
import type { CampaignSeed } from "../generators/campaigns/types";
import { buildCampaignRecords, SampleAuthor } from "../generators/contentGenerators/records";
import { SAMPLE_MEMBERSHIPS } from "../generators/userGenerator";

/** A group's members as the generator credits them, with made-up uids. */
const membersOf = (groupId: string): SampleAuthor[] =>
  Object.entries(SAMPLE_MEMBERSHIPS)
    .filter(([, membership]) => (membership.groups as string[]).includes(groupId))
    .map(([username]) => ({ uid: `uid-${username}`, username }));

const NOW = new Date("2026-10-14T12:00:00Z");

describe.each(SAMPLE_CAMPAIGNS.map((campaign) => [campaign.name, campaign] as const))(
  "%s",
  (_name, campaign: CampaignSeed) => {
    const npcIds = campaign.npcs.map((npc) => npc.id);
    const locationIds = campaign.locations.map((place) => place.id);
    const questIds = campaign.quests.map((quest) => quest.id);

    test("no two records of a kind share an id", () => {
      for (const ids of [npcIds, locationIds, questIds, campaign.rumors.map((rumor) => rumor.id)]) {
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    test("every person a record names is in the campaign", () => {
      const named = [
        ...campaign.locations.flatMap((place) => place.people ?? []),
        ...campaign.npcs.flatMap((npc) => npc.knows ?? []),
        ...campaign.quests.flatMap((quest) => quest.people ?? []),
        ...campaign.rumors.flatMap((rumor) => [...(rumor.people ?? []), ...(rumor.sourceNpcId ? [rumor.sourceNpcId] : [])]),
      ];
      named.forEach((id) => expect(npcIds).toContain(id));
    });

    test("every place a record names is in the campaign, and parents come first", () => {
      const hungBeforeTheirParent = campaign.locations.filter(
        (place, index) => place.parentId && !locationIds.slice(0, index).includes(place.parentId)
      );
      expect(hungBeforeTheirParent).toEqual([]);
      const named = [
        ...campaign.quests.flatMap((quest) => [
          ...(quest.locationId ? [quest.locationId] : []),
          ...(quest.keyLocations ?? []).flatMap((place) => (place.locationId ? [place.locationId] : [])),
        ]),
        ...campaign.rumors.flatMap((rumor) => [...(rumor.places ?? []), ...(rumor.locationId ? [rumor.locationId] : [])]),
      ];
      named.forEach((id) => expect(locationIds).toContain(id));
    });

    test("a rumour turned into a quest names a quest in the campaign", () => {
      campaign.rumors
        .flatMap((rumor) => (rumor.convertedToQuestId ? [rumor.convertedToQuestId] : []))
        .forEach((id) => expect(questIds).toContain(id));
    });

    test("a rumour from a person names that person as its source", () => {
      campaign.rumors
        .filter((rumor) => rumor.sourceNpcId)
        .forEach((rumor) => {
          expect(rumor.sourceType).toBe("npc");
          expect(campaign.npcs.find((npc) => npc.id === rumor.sourceNpcId)?.name).toBe(rumor.sourceName);
        });
    });

    test("a completed quest has every objective done", () => {
      campaign.quests
        .filter((quest) => quest.status === "completed")
        .forEach((quest) => quest.objectives.forEach((objective) => expect(objective.completed).toBe(true)));
    });

    test("every chapter has text, and every record is credited to a member of its group", () => {
      campaign.chapters.forEach((chapter) => expect(chapter.text.trim()).not.toBe(""));
      // `buildCampaignRecords` refuses an author outside the group.
      const built = buildCampaignRecords(campaign, membersOf(campaign.groupId), NOW);
      const usernames = membersOf(campaign.groupId).map((member) => member.username);
      [...built.locations, ...built.npcs, ...built.quests, ...built.rumors].forEach(({ record, notes }) => {
        expect(usernames).toContain(record.createdByUsername);
        notes.forEach((note) => expect(usernames).toContain(note.author.username));
      });
    });

    test("its chapters are a week apart, numbered in play order, and end when the campaign did", () => {
      const { chapters } = buildCampaignRecords(campaign, membersOf(campaign.groupId), NOW);
      expect(chapters.map(({ record }) => record.order)).toEqual(chapters.map((_chapter, index) => index + 1));
      const times = chapters.map(({ record }) => (record.createdAt as Date).getTime());
      times.slice(1).forEach((time, index) => expect(time - times[index]).toBe(7 * 24 * 60 * 60 * 1000));
      expect(NOW.getTime() - times[times.length - 1]).toBe(campaign.endedDaysAgo * 24 * 60 * 60 * 1000);
    });
  }
);

describe("the sample campaigns together", () => {
  test("two to a group, each group's first being the one its members land in", () => {
    expect(SAMPLE_CAMPAIGNS.map((campaign) => [campaign.groupId, campaign.id])).toEqual([
      ["group1", "campaign1-1"],
      ["group1", "campaign1-2"],
      ["group2", "campaign2-1"],
      ["group2", "campaign2-2"],
    ]);
  });

  test("between them, they hold every status, relationship and kind of place", () => {
    const all = <T,>(pick: (campaign: CampaignSeed) => T[]): Set<T> => new Set(SAMPLE_CAMPAIGNS.flatMap(pick));

    expect(all((c) => c.npcs.map((npc) => npc.status))).toEqual(new Set(["alive", "deceased", "missing", "unknown"]));
    expect(all((c) => c.npcs.map((npc) => npc.relationship))).toEqual(new Set(["friendly", "neutral", "hostile", "unknown"]));
    expect(all((c) => c.locations.map((place) => place.type))).toEqual(
      new Set(["region", "city", "town", "village", "dungeon", "landmark", "building", "poi"])
    );
    expect(all((c) => c.locations.map((place) => place.status))).toEqual(new Set(["known", "explored", "visited"]));
    expect(all((c) => c.quests.map((quest) => quest.status))).toEqual(new Set(["active", "completed", "failed"]));
    expect(all((c) => c.rumors.map((rumor) => rumor.status))).toEqual(new Set(["confirmed", "unconfirmed", "false"]));
  });

  test("one of them is long enough to fill the shelf", () => {
    expect(Math.max(...SAMPLE_CAMPAIGNS.map((campaign) => campaign.chapters.length))).toBeGreaterThanOrEqual(30);
  });
});

describe("the Ashen Vale (campaign 1-1)", () => {
  const ashenVale = SAMPLE_CAMPAIGNS[0];

  test("holds the example campaign's records, in the example's states", () => {
    expect(ashenVale.npcs.map(({ name, status, relationship }) => ({ name, status, relationship }))).toEqual(
      EXAMPLE_CAMPAIGN.npcs.map(({ name, status, relationship }) => ({ name, status, relationship }))
    );
    expect(ashenVale.locations.map(({ name, type, status }) => ({ name, type, status }))).toEqual(
      EXAMPLE_CAMPAIGN.locations.map(({ name, type, status }) => ({ name, type, status }))
    );
    expect(ashenVale.quests.map(({ title, status, objectives }) => ({ title, status, objectives }))).toEqual(
      EXAMPLE_CAMPAIGN.quests.map(({ title, status, objectives }) => ({ title, status, objectives }))
    );
    expect(ashenVale.rumors.map(({ title, status, content }) => ({ title, status, content }))).toEqual(
      EXAMPLE_CAMPAIGN.rumours.map(({ title, status, content }) => ({ title, status, content }))
    );
  });

  test("tells the example's chronicle, chapter by chapter", () => {
    expect(ashenVale.chapters.map(({ title, summary }) => ({ title, summary }))).toEqual(
      EXAMPLE_CAMPAIGN.chapters.map(({ title, summary }) => ({ title, summary }))
    );
  });

  test("ids its records as the app does, not with the example's ids", () => {
    const ids = [...ashenVale.npcs, ...ashenVale.locations, ...ashenVale.quests, ...ashenVale.rumors].map((record) => record.id);
    ids.forEach((id) => expect(id).not.toMatch(/^example-/));
    expect(ashenVale.npcs.find((npc) => npc.name === "Odile Marrow")?.id).toBe("odile-marrow");
  });
});
