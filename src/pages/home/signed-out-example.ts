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

/**
 * The static example shown on signed-out Home. The rows under the signed-out
 * list pages' panels are a different example, with a setting of their own
 * (`shared/example-campaign`, T150).
 *
 * Built from published module content (*The Sunless Citadel*) rather than
 * invented campaign fiction, so nothing here pretends to be a real group's
 * play. It is never derived from live data and never fetched — if it drifts
 * from what the app actually renders, that is a bug in this file, not a reason
 * to wire it to a context.
 */
export const SIGNED_OUT_EXAMPLE: SignedOutExample = Object.freeze({
  campaignTitle: "The Sunless Citadel",
  // Start date corrected from 12/03/2025: that was the same day as the
  // newest "since you last played" row below, which would mean the campaign
  // started and reached chapter 14 on the same day. Every other value here
  // (including the row dates) is unchanged.
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
      title: "The Twig Blights of Oakhurst",
      kind: "chapter" as const,
    }),
    Object.freeze({
      date: "10/03/2025",
      title: "Find the missing Hucrele heirs",
      kind: "quest" as const,
    }),
    Object.freeze({
      date: "09/03/2025",
      title: "Kerowyn Hucrele",
      kind: "npc" as const,
    }),
  ]),
}) as SignedOutExample;

export default SIGNED_OUT_EXAMPLE;
