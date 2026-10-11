// functions/src/signUp/reserveSignUp.ts
import * as functions from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {ENFORCE_APP_CHECK} from "../shared/appCheck";
import {rethrowHttpsError} from "../shared/httpsErrors";
import {registrationTokenProblem} from "../shared/registrationToken";
import {findInvitation, isInvitationToken} from "../shared/invitationToken";
import {
  REFUSAL,
  RESERVATIONS,
  RESERVATION_LIFETIME_MS,
  accountLimitReached,
  normalizeEmail,
  reservationId,
} from "./signUpGate";
import {FOUNDER_INVITATIONS, founderReservationId} from "./founderInvitations";
import {GROUP_FULL_MESSAGE, MAX_GROUP_MEMBERS} from "../groupManagement/groupLimits";

/**
 * An invitation into a group (`groupId` and `token`), or a founder invitation
 * (`founderToken`, T125) -- never both.
 */
interface ReserveSignUpData {
  groupId?: string;
  token?: string;
  founderToken?: string;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reserve a sign-up for `email` against a founder invitation, which must exist
 * and be unused and unexpired. Spends nothing: `createGroup` does (T126).
 *
 * @param {string} founderToken The founder invitation's token
 * @param {string} email The address the founder will sign up with
 */
async function reserveForFounder(founderToken: string, email: string): Promise<void> {
  const db = getFirestore();
  const invitation = await findInvitation(db.collection(FOUNDER_INVITATIONS), founderToken);
  if (!invitation) {
    throw new functions.HttpsError(
      "not-found",
      "This link to start a group does not exist. Ask for a new one."
    );
  }
  const problem = registrationTokenProblem(invitation.data() ?? {});
  if (problem !== null) {
    throw new functions.HttpsError(
      "failed-precondition",
      problem === "used" ?
        "This link to start a group has already been used. Ask for a new one." :
        "This link to start a group has expired. Ask for a new one."
    );
  }

  if (await accountLimitReached()) {
    throw new functions.HttpsError(
      "resource-exhausted",
      `${REFUSAL.accountsFull}: This site is not taking new accounts right now.`
    );
  }

  const now = new Date();
  // Named by the invitation's id, never its token: whoever reads the
  // reservations holds no working link (T145).
  await db.collection(RESERVATIONS).doc(founderReservationId(invitation.id)).set({
    email: normalizeEmail(email),
    kind: "founder",
    invitationId: invitation.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + RESERVATION_LIFETIME_MS),
  });
}

/**
 * Lets `email` create an account, on the strength of an invitation: into a
 * group, or to start one (a founder invitation, T125).
 *
 * Called from the join page, anonymously, before the visitor signs in with a
 * magic link or Google. It checks the invitation -- exists, unused, unexpired
 * -- and records a reservation that `gateAccountCreation` looks for when Auth
 * is about to create the account. It spends nothing: the invitation is only
 * spent by `redeemInvitation`, once the account exists.
 *
 * Harmless for somebody who already has an account -- signing in creates
 * nothing, so the reservation is simply never used and expires.
 *
 * The account cap is checked here too, not only in the gate, so that a full
 * project says so on the join page instead of after the visitor has gone to
 * their inbox and back.
 */
export const reserveSignUp = functions.onCall(
  {
    region: "europe-west1",
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request: functions.CallableRequest<ReserveSignUpData>) => {
    const {groupId, token, founderToken, email} = request.data ?? {};

    const founder = founderToken !== undefined;
    const complete = founder ?
      isInvitationToken(founderToken) &&
        groupId === undefined && token === undefined :
      typeof groupId === "string" && groupId !== "" && !groupId.includes("/") &&
        isInvitationToken(token);
    if (!complete) {
      throw new functions.HttpsError(
        "invalid-argument",
        "This invitation link is incomplete."
      );
    }
    if (typeof email !== "string" || !EMAIL.test(email.trim())) {
      throw new functions.HttpsError(
        "invalid-argument",
        "Enter a valid email address."
      );
    }

    const db = getFirestore();

    if (founder) {
      try {
        await reserveForFounder(founderToken as string, email);
        return {success: true};
      } catch (error) {
        rethrowHttpsError(
          error,
          "Failed to prepare your sign-up",
          (wrappedError) =>
            console.error("Error reserving a founder sign-up:", wrappedError)
        );
      }
    }

    try {
      const [tokenDoc, groupDoc] = await Promise.all([
        findInvitation(db.collection(`groups/${groupId}/registrationTokens`), token as string),
        db.doc(`groups/${groupId}`).get(),
      ]);
      if (!tokenDoc) {
        throw new functions.HttpsError(
          "not-found",
          "This invitation does not exist. Ask for a new link."
        );
      }
      // No reservation, which holds an email, for a group being deleted
      // (T037); `redeemInvitation` would refuse the account it was for.
      if (groupDoc.get("deleting") === true) {
        throw new functions.HttpsError(
          "failed-precondition",
          "This group is being deleted."
        );
      }
      const problem = registrationTokenProblem(tokenDoc.data() ?? {});
      if (problem !== null) {
        throw new functions.HttpsError(
          "failed-precondition",
          problem === "used" ?
            "This invitation has already been used. Ask for a new link." :
            "This invitation has expired. Ask for a new link."
        );
      }

      // Said here, before the visitor goes to their inbox and back, as for
      // the account cap; `redeemInvitation` is what holds it (T128).
      const members = await db.collection(`groups/${groupId}/users`).count().get();
      if (members.data().count >= MAX_GROUP_MEMBERS) {
        throw new functions.HttpsError("resource-exhausted", GROUP_FULL_MESSAGE);
      }

      if (await accountLimitReached()) {
        throw new functions.HttpsError(
          "resource-exhausted",
          `${REFUSAL.accountsFull}: This site is not taking new accounts ` +
            "right now."
        );
      }

      const now = new Date();
      await db.collection(RESERVATIONS).doc(reservationId(groupId as string, tokenDoc.id)).set({
        email: normalizeEmail(email),
        kind: "group",
        groupId,
        invitationId: tokenDoc.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + RESERVATION_LIFETIME_MS),
      });

      return {success: true};
    } catch (error) {
      rethrowHttpsError(
        error,
        `Failed to prepare your sign-up: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        (wrappedError) =>
          console.error("Error reserving a sign-up:", wrappedError)
      );
    }
  }
);
