import { EXAMPLE_CAMPAIGN } from "shared/example-campaign/example-campaign";

/**
 * One cell of the example campaign's stat strip.
 *
 * Deliberately just a label and a number: the example shows the *shape* of the
 * product, and anything richer starts inviting a maintainer to make it richer
 * still until it is a second implementation of the dashboard.
 */
export interface ExampleStat {
  readonly label: string;
  readonly value: number;
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
  readonly date: string;
  readonly title: string;
  readonly kind: "chapter" | "quest" | "npc";
}

/** The whole example panel, in one value. */
export interface SignedOutExample {
  readonly campaignTitle: string;
  readonly subtitle: string;
  readonly stats: readonly ExampleStat[];
  readonly updates: readonly ExampleUpdate[];
}

/** The example campaign's region, its first quest and its first person. */
const [REGION] = EXAMPLE_CAMPAIGN.locations;
const [LEDGER_QUEST] = EXAMPLE_CAMPAIGN.quests;
const [FERRYWOMAN] = EXAMPLE_CAMPAIGN.npcs;

/**
 * The static example shown on signed-out Home: the invented campaign whose
 * rows a stranger also sees under each list page's sign-in panel
 * (`shared/example-campaign`, T150), further along. One setting across the
 * public pages, and no published adventure on them (T123). The quest and the
 * person are taken from that fixture rather than retyped, so they cannot
 * drift from it; the chapter is this snapshot's own, fourteen sessions in.
 *
 * It is never derived from live data and never fetched — if it drifts from
 * what the app actually renders, that is a bug in this file, not a reason to
 * wire it to a context.
 */
export const SIGNED_OUT_EXAMPLE: SignedOutExample = Object.freeze({
  campaignTitle: REGION.name,
  subtitle: "Started 04/10/2024 · Chapter 14",
  // Object.freeze is shallow, so the containing array is frozen here and
  // each element is frozen individually below -- otherwise
  // SIGNED_OUT_EXAMPLE.stats[0].value = 999 would type-check as `readonly`
  // but still succeed silently at runtime, contradicting "this is a fixed
  // picture" above.
  stats: Object.freeze([
    Object.freeze({ label: "Chapters", value: 14 }),
    Object.freeze({ label: "NPCs", value: 23 }),
    Object.freeze({ label: "Locations", value: 9 }),
    Object.freeze({ label: "Open quests", value: 4 }),
  ]),
  updates: Object.freeze([
    Object.freeze({
      date: "12/03/2025",
      title: "The Toll Is Paid",
      kind: "chapter" as const,
    }),
    Object.freeze({
      date: "10/03/2025",
      title: LEDGER_QUEST.title,
      kind: "quest" as const,
    }),
    Object.freeze({
      date: "09/03/2025",
      title: FERRYWOMAN.name,
      kind: "npc" as const,
    }),
  ]),
}) as SignedOutExample;

export default SIGNED_OUT_EXAMPLE;
