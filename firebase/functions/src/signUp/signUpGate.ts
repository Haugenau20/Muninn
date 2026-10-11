// functions/src/signUp/signUpGate.ts
//
// What the two halves of the sign-up gate share: `reserveSignUp`, which a
// visitor holding an invitation calls before any account exists, and
// `gateAccountCreation`, which Firebase Auth calls before it creates one.
//
// Why the gate needs two halves: a blocking function sees only the account
// about to be created -- its email, its provider -- and nothing the client
// sent alongside. There is no way to hand it an invitation token. So the token
// is checked first, by a callable, and what the callable leaves behind is a
// reservation keyed to the email the visitor said they would use. The blocking
// function then admits exactly the emails that hold one.

import {DocumentReference, Firestore} from "firebase-admin/firestore";
import {registrationTokenProblem} from "../shared/registrationToken";
import {FOUNDER_INVITATIONS} from "./founderInvitations";

// The account cap and its count live in `accountCount.ts` (T128).
export {MAX_ACCOUNTS, accountLimitReached} from "./accountCount";

/**
 * How long a reservation stays usable. Long enough to cover a magic link that
 * sits unread in an inbox for an evening; the invitation's own expiry and
 * single use still apply on top of it.
 */
export const RESERVATION_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Where reservations live. No client can read or write it (catch-all deny). */
export const RESERVATIONS = "signUpReservations";

/**
 * Stable markers the web app reads out of a refused sign-up.
 *
 * A refusal from a blocking function reaches the client as a generic
 * `auth/internal-error` whose message embeds ours, so the message has to carry
 * something the client can match on. These strings are that contract -- the
 * web app's `src/core/services/firebase/auth/signInErrors.ts` mirrors them.
 */
export const REFUSAL = {
  inviteRequired: "INVITE_REQUIRED",
  accountsFull: "ACCOUNTS_FULL",
} as const;

/**
 * An email as the gate compares it. Auth stores addresses as typed, and a
 * visitor may type their address with different case in two places.
 *
 * @param {string} email The address
 * @return {string} Trimmed and lower-cased
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The reservation's document id. One per invitation, so a single leaked token
 * can hold at most one pending email at a time -- reserving again replaces it.
 * Named by the invitation's document id, which since T145 is its token's
 * hash, never by the token.
 *
 * @param {string} groupId The invitation's group
 * @param {string} invitationId The invitation's document id
 * @return {string} The document id
 */
export function reservationId(groupId: string, invitationId: string): string {
  return `${groupId}_${invitationId}`;
}

/**
 * The live reservation for `email`, if there is one.
 *
 * Live means unexpired, *and* its invitation -- into a group, or a founder
 * invitation -- is still redeemable: a reservation outlives nothing it was
 * made from. Expired or dead ones found on
 * the way are deleted.
 *
 * @param {Firestore} db Firestore
 * @param {string} email The address about to get an account
 * @param {Date} now The moment to judge against
 * @return {Promise<DocumentReference | null>} The reservation
 */
export async function findLiveReservation(
  db: Firestore,
  email: string,
  now: Date = new Date()
): Promise<DocumentReference | null> {
  const snapshot = await db
    .collection(RESERVATIONS)
    .where("email", "==", normalizeEmail(email))
    .get();

  for (const reservation of snapshot.docs) {
    const {kind, groupId, invitationId, token, expiresAt} = reservation.data();
    const expired =
      !expiresAt || expiresAt.toDate().getTime() <= now.getTime();
    // One written before T145 names its invitation by `token`, which was
    // then the invitation's id; one before T125 has no `kind`: it is a group's.
    const id = invitationId ?? token;
    const invitationPath = kind === "founder" ?
      (typeof id === "string" ? `${FOUNDER_INVITATIONS}/${id}` : null) :
      (typeof groupId === "string" && typeof id === "string" ?
        `groups/${groupId}/registrationTokens/${id}` : null);
    const tokenDoc = expired || invitationPath === null ?
      null :
      await db.doc(invitationPath).get();

    if (tokenDoc?.exists &&
        registrationTokenProblem(tokenDoc.data() ?? {}, now) === null) {
      return reservation.ref;
    }
    await reservation.ref.delete();
  }
  return null;
}
