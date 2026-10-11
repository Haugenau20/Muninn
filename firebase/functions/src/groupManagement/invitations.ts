// functions/src/groupManagement/invitations.ts
//
// A group admin's invitations, made and shown again server-side (T145). The
// browser used to mint them itself, storing each under its own token, so the
// collection held every unspent link in the clear. Now `createInvitation`
// stores one under its token's hash, with the token sealed beside it, and
// `revealInvitation` opens the seal for the group's admins when they want to
// copy the link again.

import * as functions from "firebase-functions/v2/https";
import {getFirestore, Transaction} from "firebase-admin/firestore";
import {rethrowHttpsError} from "../shared/httpsErrors";
import {
  HASHED_SCHEME,
  hashInvitationToken,
  newInvitationToken,
} from "../shared/invitationToken";
import {
  INVITATION_LINK_KEY,
  sealInvitationToken,
  unsealInvitationToken,
} from "../shared/invitationSeal";
import {registrationTokenProblem} from "../shared/registrationToken";

/**
 * How long an invitation works. Mirrors `REGISTRATION_TOKEN_LIFETIME_MS` in
 * the web app's `core/utils/registration-token.ts`, which states it in the
 * invite dialog.
 */
export const GROUP_INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * At most this many invitations into one group in any 24 hours. A table
 * invites a handful of players; this bounds what a hijacked admin session,
 * or a script, can pile into the collection.
 */
export const GROUP_INVITATION_DAILY_BUDGET = 50;

/** The longest note an invitation may carry, as the admin page lets it. */
export const INVITATION_NOTE_MAX = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Refuse unless `uid` is an admin of the group, and the group exists and is
 * not being deleted (T037).
 *
 * @param {Transaction} transaction The transaction to read in
 * @param {string} groupId The group
 * @param {string} uid The caller
 * @param {string} doing What they are trying to do, for the refusal
 */
async function requireAdmin(
  transaction: Transaction,
  groupId: string,
  uid: string,
  doing: string
): Promise<void> {
  const groupRef = getFirestore().collection("groups").doc(groupId);
  const [group, caller] = await Promise.all([
    transaction.get(groupRef),
    transaction.get(groupRef.collection("users").doc(uid)),
  ]);
  if (!group.exists || !caller.exists || caller.get("role") !== "admin") {
    throw new functions.HttpsError(
      "permission-denied",
      `Only the group's admins can ${doing}.`
    );
  }
  if (group.get("deleting") === true) {
    throw new functions.HttpsError(
      "failed-precondition",
      "This group is being deleted."
    );
  }
}

interface CreateInvitationData {
  groupId: string;
  notes?: string;
}

/**
 * Make an invitation into a group, for one of its admins.
 *
 * Returns the token once; the group's admins can see the link again through
 * {@link revealInvitation}. The budget check and the write are one
 * transaction, so two calls racing for the last slot cannot both have it.
 */
export const createInvitation = functions.onCall(
  {
    region: "europe-west1",
    secrets: [INVITATION_LINK_KEY],
  },
  async (request: functions.CallableRequest<CreateInvitationData>) => {
    if (!request.auth) {
      throw new functions.HttpsError(
        "unauthenticated",
        "You must be signed in to invite someone."
      );
    }
    const {groupId} = request.data ?? {};
    const notes = request.data?.notes ?? "";
    if (typeof groupId !== "string" || !groupId || groupId.includes("/")) {
      throw new functions.HttpsError("invalid-argument", "A group is required.");
    }
    if (typeof notes !== "string" || notes.trim().length > INVITATION_NOTE_MAX) {
      throw new functions.HttpsError(
        "invalid-argument",
        `A note can be at most ${INVITATION_NOTE_MAX} characters.`
      );
    }

    const uid = request.auth.uid;
    const db = getFirestore();
    const invitations = db.collection("groups").doc(groupId).collection("registrationTokens");
    const token = newInvitationToken();
    const invitationRef = invitations.doc(hashInvitationToken(token));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + GROUP_INVITATION_LIFETIME_MS);

    try {
      await db.runTransaction(async (transaction) => {
        await requireAdmin(transaction, groupId, uid, "invite someone");
        const recent = await transaction.get(invitations
          .where("createdAt", ">", new Date(now.getTime() - DAY_MS))
          .limit(GROUP_INVITATION_DAILY_BUDGET));
        if (recent.size >= GROUP_INVITATION_DAILY_BUDGET) {
          throw new functions.HttpsError(
            "resource-exhausted",
            `${GROUP_INVITATION_DAILY_BUDGET} invitations have been made for ` +
              "this group in the last 24 hours, the most there may be. Try " +
              "again tomorrow."
          );
        }
        transaction.create(invitationRef, {
          scheme: HASHED_SCHEME,
          sealed: sealInvitationToken(token, invitationRef.path),
          createdAt: now,
          expiresAt,
          createdBy: uid,
          notes: notes.trim(),
          used: false,
        });
      });
      return {token, invitationId: invitationRef.id, expiresAt: expiresAt.getTime()};
    } catch (error) {
      rethrowHttpsError(
        error,
        "Failed to create the invitation",
        (wrappedError) => console.error("Error creating an invitation:", wrappedError)
      );
    }
  }
);

interface RevealInvitationData {
  groupId: string;
  invitationId: string;
}

/**
 * The token of one of a group's open invitations, for one of its admins to
 * copy the link again.
 *
 * An invitation stored before T145 is its own token, so its id is returned.
 * A used or expired one is not revealed: its link would be refused anyway.
 */
export const revealInvitation = functions.onCall(
  {
    region: "europe-west1",
    secrets: [INVITATION_LINK_KEY],
  },
  async (request: functions.CallableRequest<RevealInvitationData>) => {
    if (!request.auth) {
      throw new functions.HttpsError(
        "unauthenticated",
        "You must be signed in to copy an invitation."
      );
    }
    const {groupId, invitationId} = request.data ?? {};
    if (typeof groupId !== "string" || !groupId || groupId.includes("/") ||
        typeof invitationId !== "string" || !invitationId ||
        invitationId.includes("/")) {
      throw new functions.HttpsError(
        "invalid-argument",
        "A group and an invitation are required."
      );
    }

    const uid = request.auth.uid;
    const db = getFirestore();
    const invitationRef = db.collection("groups").doc(groupId)
      .collection("registrationTokens").doc(invitationId);

    try {
      const invitation = await db.runTransaction(async (transaction) => {
        await requireAdmin(transaction, groupId, uid, "copy an invitation");
        return transaction.get(invitationRef);
      });
      if (!invitation.exists) {
        throw new functions.HttpsError("not-found", "There is no such invitation.");
      }
      const problem = registrationTokenProblem(invitation.data() ?? {});
      if (problem !== null) {
        throw new functions.HttpsError(
          "failed-precondition",
          problem === "used" ?
            "This invitation has been used." :
            "This invitation has expired. Revoke it and invite them again."
        );
      }
      if (invitation.get("scheme") === undefined) {
        return {token: invitation.id};
      }
      const sealed = invitation.get("sealed");
      if (typeof sealed !== "string") {
        throw new functions.HttpsError(
          "failed-precondition",
          "This invitation's link cannot be shown again. Revoke it and invite " +
            "them again."
        );
      }
      return {token: unsealInvitationToken(sealed, invitationRef.path)};
    } catch (error) {
      rethrowHttpsError(
        error,
        "Failed to copy the invitation",
        (wrappedError) => console.error("Error revealing an invitation:", wrappedError)
      );
    }
  }
);
