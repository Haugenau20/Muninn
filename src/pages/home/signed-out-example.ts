import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";

/**
 * One cell of the example campaign's stat strip: a number, and the page whose
 * example it counts.
 *
 * Deliberately just a label, a number and a link: the example shows the
 * *shape* of the product, and anything richer starts inviting a maintainer to
 * make it richer still until it is a second implementation of the dashboard.
 */
export interface ExampleStat {
  readonly label: string;
  readonly value: number;
  /** The list page that shows these, filled from the same example. */
  readonly href: string;
}

/**
 * One "since you last played" row.
 *
 * Note what this type does *not* have: no author, no username, no character.
 * The product's credibility rests on attribution being real ("Gauthak wrote
 * this"), so an example that models fake people writing things undermines
 * exactly the thing it is advertising. Making the field absent from the *type*
 * means a future contributor cannot add one without deleting this comment.
 */
export interface ExampleUpdate {
  /** `YYYY-MM-DD`; shown through {@link formatUpdateDate}. */
  readonly date: string;
  readonly title: string;
  readonly kind: "chapter" | "quest" | "npc";
  /** The example record the row is about: its id in the fixture. */
  readonly ref: string;
}

/** The whole example panel, in one value. */
export interface SignedOutExample {
  readonly campaignTitle: string;
  readonly subtitle: string;
  readonly stats: readonly ExampleStat[];
  readonly updates: readonly ExampleUpdate[];
  /** The card's last line: the rumour page, counted. */
  readonly rumourLine: string;
}

const { locations, quests, npcs, chapters, rumours } = EXAMPLE_CAMPAIGN;

/** The example campaign's region, its first quest and its first person. */
const [REGION] = locations;
const [LEDGER_QUEST] = quests;
const [FERRYWOMAN] = npcs;
/** The last chapter fully read: what the reader last caught up on. */
const LAST_READ = [...chapters].reverse().find((chapter) => chapter.state === "read")!;

/** The quests still being worked on, as the quest page's "active" band counts them. */
const OPEN_QUESTS = quests.filter((quest) => quest.status === "active").length;
const FALSE_RUMOURS = rumours.filter((rumour) => rumour.status === "false").length;

/**
 * The static example shown on signed-out Home: the invented campaign whose
 * pages a stranger also sees under each list page's sign-in band
 * (`shared/example-campaign`, T150). One setting across the public pages,
 * and no published adventure on them (T123). Everything in it is taken from
 * that fixture rather than retyped, so it cannot drift from it, and its
 * numbers are counted from it: the list pages show the same campaign, so
 * Home cannot claim more than they hold.
 *
 * It is never derived from live data and never fetched — if it drifts from
 * what the app actually renders, that is a bug in this file, not a reason to
 * wire it to a context.
 */
export const SIGNED_OUT_EXAMPLE: SignedOutExample = Object.freeze({
  campaignTitle: REGION.name,
  subtitle: `Started October 2024 · ${chapters.length} sessions`,
  // Object.freeze is shallow, so the containing array is frozen here and
  // each element is frozen individually below -- otherwise
  // SIGNED_OUT_EXAMPLE.stats[0].value = 999 would type-check as `readonly`
  // but still succeed silently at runtime, contradicting "this is a fixed
  // picture" above.
  stats: Object.freeze([
    Object.freeze({ label: "Chapters", value: chapters.length, href: "/story/chapters" }),
    Object.freeze({ label: "NPCs", value: npcs.length, href: "/npcs" }),
    Object.freeze({ label: "Locations", value: locations.length, href: "/locations" }),
    Object.freeze({ label: "Open quests", value: OPEN_QUESTS, href: "/quests" }),
  ]),
  updates: Object.freeze([
    Object.freeze({ date: "2025-03-12", title: LAST_READ.title, kind: "chapter" as const, ref: LAST_READ.id }),
    Object.freeze({ date: "2025-03-10", title: LEDGER_QUEST.title, kind: "quest" as const, ref: LEDGER_QUEST.id }),
    Object.freeze({ date: "2025-03-09", title: FERRYWOMAN.name, kind: "npc" as const, ref: FERRYWOMAN.id }),
  ]),
  rumourLine: `${rumours.length} rumours gathered, ${FALSE_RUMOURS} of them false`,
}) as SignedOutExample;

/**
 * A row's date as "12 Mar": a numeric day and month read as December to half
 * the world.
 *
 * @param isoDate `YYYY-MM-DD`
 */
export const formatUpdateDate = (isoDate: string): string =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** What a "since you last played" row draws, worked out from the fixture. */
export interface UpdateRow {
  /** The chapter's number, drawn as its mark; `null` draws the record's sigil. */
  readonly mark: number | null;
  /** The line under the name. */
  readonly detail: string;
  /** The word on the right: what it is, or how it stands. */
  readonly status: string;
  /** The theme class the word is painted in; `null` for plain secondary ink. */
  readonly tone: string | null;
  /** Where the row opens: the example's own row for it, where there is one. */
  readonly href: string;
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A quest's status, painted as its row on the quest page paints it. */
const QUEST_TONE = { active: "valence-1", completed: "valence-0", failed: "valence-3" } as const;
/** A stance, painted as the NPC row paints it. */
const STANCE_TONE = {
  friendly: "disposition-friendly",
  neutral: "disposition-neutral",
  hostile: "disposition-hostile",
  unknown: "disposition-unknown",
} as const;

/**
 * Work out what a row shows from the record it is about.
 *
 * A chapter opens the chapter log, not the chapter: there is no example
 * chapter to read. A quest and a person open their own row on their page,
 * which the example draws and `?highlight=` finds.
 */
export function describeUpdate(update: ExampleUpdate): UpdateRow {
  if (update.kind === "chapter") {
    const chapter = chapters.find((candidate) => candidate.id === update.ref)!;
    return { mark: chapter.order, detail: chapter.summary, status: "Chapter", tone: null, href: "/story/chapters" };
  }
  if (update.kind === "quest") {
    const quest = quests.find((candidate) => candidate.id === update.ref)!;
    const place = locations.find((candidate) => candidate.id === quest.locationId)?.name;
    const done = quest.objectives.filter((objective) => objective.completed).length;
    return {
      mark: null,
      detail: ["Quest", place, `${done} of ${quest.objectives.length} objectives`].filter(Boolean).join(" · "),
      status: capitalise(quest.status),
      tone: QUEST_TONE[quest.status],
      href: `/quests?highlight=${quest.id}`,
    };
  }
  const npc = npcs.find((candidate) => candidate.id === update.ref)!;
  return {
    mark: null,
    detail: ["NPC", npc.title].filter(Boolean).join(" · "),
    status: capitalise(npc.relationship),
    tone: STANCE_TONE[npc.relationship],
    href: `/npcs?highlight=${npc.id}`,
  };
}

export default SIGNED_OUT_EXAMPLE;
