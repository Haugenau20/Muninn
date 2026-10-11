// functions/src/signUp/founderInvitations.ts
//
// Founder invitations (T125): how a table that has never used the site gets
// in without the maintainer setting its group up. One admits one account,
// which may then create one group (`createGroup` spends it, T126). They are
// issued by the maintainer, on the operator page (T137) or with
// `scripts/issue-founder-invitation.js`, through the Admin SDK: the app grants
// nobody the power to issue them (the onboarding plan, D6).

import {Firestore} from "firebase-admin/firestore";
import {Refusal} from "../shared/refusal";
import {
  HASHED_SCHEME,
  hashInvitationToken,
  newInvitationToken,
} from "../shared/invitationToken";

/** Where founder invitations live. No client can read or write it (catch-all deny). */
export const FOUNDER_INVITATIONS = "founderInvitations";

/** How long a founder link works, the same as an invitation into a group. */
export const FOUNDER_INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The reservation id for a founder invitation. One per invitation, as for an
 * invitation into a group, so reserving again replaces the email; the prefix
 * keeps it apart from a group's `${groupId}_${invitationId}`.
 *
 * @param {string} invitationId The founder invitation's document id
 * @return {string} The reservation's document id
 */
export function founderReservationId(invitationId: string): string {
  return `founder_${invitationId}`;
}

/**
 * The link a founder opens.
 *
 * @param {string} origin The site, e.g. `https://muninn.quest`
 * @param {string} token The founder invitation's token
 * @return {string} The link
 */
export function founderLink(origin: string, token: string): string {
  const url = new URL("/join", origin);
  url.searchParams.set("founder", token);
  return url.toString();
}

/**
 * At most this many founder invitations in any 24 hours, however they are
 * issued (T137). Each one can become an account and a group, so a hijacked
 * operator session, or a slip, is bounded by this.
 */
export const FOUNDER_LINK_DAILY_BUDGET = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the maintainer may say about an invitation when issuing it. */
export interface FounderInvitationOptions {
  /**
   * Who issued it: the operator's email, or `"script"` for
   * `issue-founder-invitation.js`.
   */
  issuedBy: string;
  /** Who it is for, for the maintainer's own records. Nobody else sees it. */
  note?: string;
  /** When it is issued; for the tests. */
  now?: Date;
}

/**
 * Record a new, unused founder invitation, unless the last 24 hours have
 * spent the budget. Counting and issuing are one transaction, so two issues
 * racing for the last slot cannot both have it.
 *
 * The token is the whole secret. It is returned once and stored nowhere: the
 * invitation's id is its SHA-256 (T145, `shared/invitationToken`), so whoever
 * can read the collection holds no working link.
 *
 * @param {Firestore} db Firestore
 * @param {FounderInvitationOptions} options The issuer, a note, the moment
 * @return {Promise<object>} The token, the invitation's id, and its expiry
 * @throws {Refusal} `budget_spent` when the budget is spent
 */
export async function issueFounderInvitation(
  db: Firestore,
  {issuedBy, note, now = new Date()}: FounderInvitationOptions
): Promise<{token: string; invitationId: string; expiresAt: Date}> {
  const token = newInvitationToken();
  const invitationId = hashInvitationToken(token);
  const expiresAt = new Date(now.getTime() + FOUNDER_INVITATION_LIFETIME_MS);
  const invitations = db.collection(FOUNDER_INVITATIONS);

  await db.runTransaction(async (transaction) => {
    const recent = await transaction.get(invitations
      .where("createdAt", ">", new Date(now.getTime() - DAY_MS))
      .limit(FOUNDER_LINK_DAILY_BUDGET));
    if (recent.size >= FOUNDER_LINK_DAILY_BUDGET) {
      throw new Refusal(
        "budget_spent",
        `${FOUNDER_LINK_DAILY_BUDGET} founder links have been issued in ` +
          "the last 24 hours, the most there may be. Try again later."
      );
    }
    transaction.create(invitations.doc(invitationId), {
      scheme: HASHED_SCHEME,
      used: false,
      createdAt: now,
      expiresAt,
      issuedBy,
      ...(note ? {note} : {}),
    });
  });
  return {token, invitationId, expiresAt};
}
