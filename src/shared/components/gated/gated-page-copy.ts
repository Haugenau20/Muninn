// src/shared/components/gated/gated-page-copy.ts

/**
 * Which selection a page needs before it can show anything.
 *
 * `"campaign"` is the default and covers every route that shows campaign
 * content.
 *
 * `"group"` exists for a page whose content is genuinely visible with only a
 * group chosen. No current page qualifies: `notes` was believed to be that
 * page (see the note on `GATED_COPY.notes` below) until `NoteContext` was
 * read closely and turned out to discard everything without a campaign, so
 * every *content* page here is `"campaign"` today. The value is kept, with its
 * branch in `usePageGate` still covered by tests, for the day a page's data
 * genuinely only needs a group -- e.g. a group-wide notes view.
 *
 * `"none"` is for a page about the *account* rather than about a campaign.
 * `profile` is the first: it shows an email address, a username, a theme
 * preference and a delete-account button, none of which belong to a campaign,
 * and its group-scoped cards already render behind their own `activeGroup`
 * check. Gating it on a campaign would hide a signed-in member's own account
 * and their only route to deleting it, because they happened to be between
 * campaigns.
 */
export type GatedContextRequirement = "group" | "campaign" | "none";

/**
 * Everything the gated panel says about one page.
 *
 * This interface exists so that adding a page is a data change, not a new
 * branch: the panel component reads these fields and never names a page.
 */
export interface GatedPageCopy {
  /** Heading shown to a signed-out visitor on a read route. */
  heading: string;
  /** Heading shown on a create/edit route. Falls back to `heading`. */
  writeHeading?: string;
  /** One paragraph on what this page is for, in the product's voice. */
  blurb: string;
  /**
   * The band's one line, on a page that shows a signed-out visitor its
   * example under a slim band instead of the large panel: what is below.
   * Absent, the band says `blurb`.
   */
  exampleLine?: string;
  /**
   * The small-caps line above the signed-out heading. Defaults to "Private
   * campaign", which is right for every page that shows campaign content and
   * wrong for one that does not -- an account page is private, but it is not a
   * campaign. Data rather than a branch in the panel, per this file's rule.
   */
  eyebrow?: string;
  /** Plural noun for the error line: "Couldn't load quests." */
  noun: string;
  /** Which selection this page needs. */
  requires: GatedContextRequirement;
}

/** Every page that has a gated state. */
export type GatedPageKey =
  | "home"
  | "story"
  | "quests"
  | "npcs"
  | "locations"
  | "rumors"
  | "notes"
  | "profile";

/**
 * The single source of gated wording in `src/`.
 *
 * Context files used to build these sentences themselves, which put five
 * phrasings of two ideas in five different layers — and, because a context
 * cannot tell a signed-out visitor from a member between campaigns, half of
 * them named a group switcher the visitor had no way to see. A context returns
 * a *state*; this module holds the words; the panel renders them.
 *
 * Voice: say what the page is *for*, in the language of someone at the table.
 * Every blurb here used to end with a variant of "each campaign is visible
 * only to the group that plays it", and `notes` opened by explaining who
 * could not read it -- true, but nobody wonders. Players already assume a
 * campaign is theirs and their notes are theirs; spelling out the access
 * model reads like a tour of the back of the application rather than a
 * reason to come in. Nor does anything here name the DM: a group admin is
 * as likely to be a player, and the record works whether or not the DM ever
 * signs in.
 */
export const GATED_COPY: Record<GatedPageKey, GatedPageCopy> = {
  home: {
    heading: "Sign in to open your campaign",
    blurb:
      "Chapters, quests, NPCs, locations, rumours and your own notes — " +
      "everything your party has pieced together, in one place.",
    noun: "your campaign",
    requires: "campaign",
  },
  story: {
    heading: "Sign in to read your campaign's story",
    writeHeading: "Sign in to write a chapter",
    blurb:
      "The chapter log is the campaign told in order — one entry a session, " +
      "written by whoever was at the table.",
    exampleLine:
      "Below is an example campaign's chapter log.",
    noun: "chapters",
    requires: "campaign",
  },
  quests: {
    heading: "Sign in to see your party's quests",
    writeHeading: "Sign in to add a quest",
    blurb:
      "Quests are the open threads of a campaign — who asked for what, which " +
      "objectives are done, and what the party still owes.",
    exampleLine:
      "Below is an example campaign, so try it.",
    noun: "quests",
    requires: "campaign",
  },
  npcs: {
    heading: "Sign in to see who your party has met",
    writeHeading: "Sign in to add an NPC",
    blurb:
      "NPCs are everyone the party has dealt with: allies, patrons, rivals, " +
      "and the ones nobody trusts yet.",
    exampleLine:
      "Below is an example campaign, so try it.",
    noun: "NPCs",
    requires: "campaign",
  },
  locations: {
    heading: "Sign in to see where your party has been",
    writeHeading: "Sign in to add a location",
    blurb:
      "Locations are the places the party has visited, heard of, or is still " +
      "trying to find, and what happened at each.",
    exampleLine:
      "Below is an example campaign, so try it.",
    noun: "locations",
    requires: "campaign",
  },
  rumors: {
    heading: "Sign in to hear what the realm is saying",
    writeHeading: "Sign in to record a rumour",
    blurb:
      "Rumours are the leads a party picks up in taverns and on notice boards " +
      "— some true, some not, all worth writing down.",
    exampleLine:
      "Below is an example campaign, so try it.",
    noun: "rumours",
    requires: "campaign",
  },
  notes: {
    heading: "Sign in to read your notes",
    writeHeading: "Sign in to write a note",
    // The one blurb that sells rather than describes: extraction is the
    // product's most persuasive feature and a stranger has no other way to
    // learn it exists. The four nouns are the exact union `ExtractedEntity`
    // returns (`notes/types.ts`, `core/services/openai/types.ts`) -- do not
    // add a fifth here without adding it there first.
    blurb:
      "Write down what happened while it's fresh — then let AI read it back " +
      "and pull out the NPCs, locations, quests and rumours, ready for the " +
      "party's records.",
    noun: "notes",
    // Was "group": the spec assumed a member with a group but no campaign
    // chosen has notes to read, because `NoteContext` "fetches on
    // `activeGroupId` alone and applies `activeCampaignId` as a filter
    // afterwards". That premise is false -- `NoteContext.tsx` sets
    // `filteredNotes = []` whenever there is no `activeCampaignId` ("If no
    // active campaign, show no notes"), so that member has nothing to read.
    // Gating on `pick-campaign` earlier is honest about that; without it, the
    // member instead hit NotesList's "No Campaign Selected" dead end or, on
    // NotePage, a "doesn't exist or you don't have access to it" message that
    // was simply untrue. `"group"` stays a valid value (see
    // `GatedContextRequirement`) for the day a group-wide notes view exists.
    requires: "campaign",
  },
  profile: {
    heading: "Sign in to see your profile",
    // No `writeHeading`: the profile has no separate create or edit route --
    // every card on it edits in place.
    blurb:
      "Your account, the characters you post as, and how Muninn looks " +
      "to you.",
    noun: "your profile",
    eyebrow: "Your account",
    // The first `"none"`. See GatedContextRequirement.
    requires: "none",
  },
};

/**
 * Pick the heading for a page in the mode the route is in.
 *
 * A create route asking someone to "sign in to see your party's quests" names
 * the wrong thing; `writeHeading` names the action they were actually trying to
 * take. Pages with no write route omit it and fall back.
 *
 * @param copy The page's copy entry
 * @param mode Whether the route reads or writes
 * @returns The heading to render
 */
export function gatedHeading(
  copy: GatedPageCopy,
  mode: "read" | "write"
): string {
  return mode === "write" && copy.writeHeading
    ? copy.writeHeading
    : copy.heading;
}
