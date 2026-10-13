import { SIGNED_OUT_EXAMPLE, describeUpdate, formatUpdateDate } from "../signed-out-example";
import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";

describe("SIGNED_OUT_EXAMPLE", () => {
  it("names the campaign and its progress", () => {
    expect(SIGNED_OUT_EXAMPLE.campaignTitle.length).toBeGreaterThan(0);
    expect(SIGNED_OUT_EXAMPLE.subtitle.length).toBeGreaterThan(0);
  });

  // T123: no published adventure on the public pages. Home's example is the
  // same invented campaign the signed-out list pages show (T150), so the
  // public pages show one setting.
  it("is the example campaign the signed-out list pages show, not a published adventure", () => {
    expect(SIGNED_OUT_EXAMPLE.campaignTitle).not.toMatch(/sunless citadel/i);
    const places = EXAMPLE_CAMPAIGN.locations.map((place) => place.name);
    expect(places).toContain(SIGNED_OUT_EXAMPLE.campaignTitle);

    const named = {
      quest: EXAMPLE_CAMPAIGN.quests.map((quest) => quest.title),
      npc: EXAMPLE_CAMPAIGN.npcs.map((npc) => npc.name),
    };
    SIGNED_OUT_EXAMPLE.updates
      .filter((update) => update.kind !== "chapter")
      .forEach((update) => expect(named[update.kind as "quest" | "npc"]).toContain(update.title));
  });

  it("has a four-cell stat strip", () => {
    expect(SIGNED_OUT_EXAMPLE.stats).toHaveLength(4);
    SIGNED_OUT_EXAMPLE.stats.forEach((stat) => {
      expect(stat.label.length).toBeGreaterThan(0);
      expect(Number.isInteger(stat.value)).toBe(true);
    });
  });

  // Home used to claim 23 NPCs and 9 locations while the list pages showed 3
  // and 2. Counted from the fixture, the two cannot disagree.
  it("counts what the example pages show", () => {
    const value = (label: string) => SIGNED_OUT_EXAMPLE.stats.find((stat) => stat.label === label)?.value;
    expect(value("Chapters")).toBe(EXAMPLE_CAMPAIGN.chapters.length);
    expect(value("NPCs")).toBe(EXAMPLE_CAMPAIGN.npcs.length);
    expect(value("Locations")).toBe(EXAMPLE_CAMPAIGN.locations.length);
    expect(value("Open quests")).toBe(
      EXAMPLE_CAMPAIGN.quests.filter((quest) => quest.status === "active").length
    );
    expect(SIGNED_OUT_EXAMPLE.subtitle).toContain(`${EXAMPLE_CAMPAIGN.chapters.length} sessions`);
  });

  // Each tile opens the page whose example it counts.
  it("links each number to the page that shows it", () => {
    expect(SIGNED_OUT_EXAMPLE.stats.map((stat) => [stat.label, stat.href])).toEqual([
      ["Chapters", "/story/chapters"],
      ["NPCs", "/npcs"],
      ["Locations", "/locations"],
      ["Open quests", "/quests"],
    ]);
  });

  it("counts the rumours, and the false ones, from the example", () => {
    const falseOnes = EXAMPLE_CAMPAIGN.rumours.filter((rumour) => rumour.status === "false").length;
    expect(SIGNED_OUT_EXAMPLE.rumourLine).toBe(
      `${EXAMPLE_CAMPAIGN.rumours.length} rumours gathered, ${falseOnes} of them false`
    );
  });

  // "12/03/2025" reads as December to half the world.
  it("writes dates so they cannot be misread", () => {
    expect(formatUpdateDate("2025-03-12")).toBe("12 Mar");
  });

  describe("each recent row says what it is and opens where it lives", () => {
    const [chapter, quest, npc] = SIGNED_OUT_EXAMPLE.updates.map(describeUpdate);

    it("a chapter: its number, its summary, and the chapter log", () => {
      expect(chapter.mark).toBe(12);
      expect(chapter.detail).toBe("We paid, and it cost more than coin. Pell was found in the fen.");
      expect(chapter.status).toBe("Chapter");
      expect(chapter.href).toBe("/story/chapters");
    });

    it("a quest: where, how far along, its status, and its row on the quest page", () => {
      expect(quest.mark).toBeNull();
      expect(quest.detail).toBe("Quest · Cinderford · 1 of 3 objectives");
      expect(quest.status).toBe("Active");
      expect(quest.tone).toBe("valence-1");
      expect(quest.href).toBe("/quests?highlight=example-quest-ledger");
    });

    it("an NPC: who they are, where the party stands, and their row on the NPC page", () => {
      expect(npc.detail).toBe("NPC · Keeper of the Cinderford crossing");
      expect(npc.status).toBe("Friendly");
      expect(npc.tone).toBe("disposition-friendly");
      expect(npc.href).toBe("/npcs?highlight=example-npc-odile");
    });
  });

  it("has three recent rows, each typed as real content", () => {
    expect(SIGNED_OUT_EXAMPLE.updates).toHaveLength(3);
    SIGNED_OUT_EXAMPLE.updates.forEach((update) => {
      expect(["chapter", "quest", "npc"]).toContain(update.kind);
      expect(update.title.length).toBeGreaterThan(0);
      expect(update.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(update.ref).toMatch(/^example-/);
    });
  });

  // The constraint that matters. Attribution is what the product's
  // credibility rests on, so the example must not model fake people writing
  // things -- and the check is structural rather than a string match, so it
  // still fails if someone adds a differently-worded author field later.
  it("carries no authorship anywhere in the fixture", () => {
    const forbidden =
      /author|createdby|modifiedby|username|character|player|writtenby|by$/i;

    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (value && typeof value === "object") {
        Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
          expect(key).not.toMatch(forbidden);
          walk(child, `${path}.${key}`);
        });
      }
    };

    walk(SIGNED_OUT_EXAMPLE, "SIGNED_OUT_EXAMPLE");
  });

  it("is frozen, so nothing can mutate it into live data", () => {
    expect(Object.isFrozen(SIGNED_OUT_EXAMPLE)).toBe(true);
    expect(Object.isFrozen(SIGNED_OUT_EXAMPLE.stats)).toBe(true);
    expect(Object.isFrozen(SIGNED_OUT_EXAMPLE.updates)).toBe(true);
    // Object.freeze is shallow: freezing the arrays does not freeze the
    // objects inside them. Assert at least one of each is frozen too, so a
    // regression to "only the containers are frozen" fails here rather than
    // surfacing as a silent runtime mutation later.
    expect(Object.isFrozen(SIGNED_OUT_EXAMPLE.stats[0])).toBe(true);
    expect(Object.isFrozen(SIGNED_OUT_EXAMPLE.updates[0])).toBe(true);
  });
});
