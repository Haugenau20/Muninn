// functions/src/groupManagement/createGroup.ts
import * as functions from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {ENFORCE_APP_CHECK} from "../shared/appCheck";
import {rethrowHttpsError} from "../shared/httpsErrors";
import {registrationTokenProblem} from "../shared/registrationToken";
import {FOUNDER_INVITATIONS} from "../signUp/founderInvitations";
import {
  asInvitation,
  invitationRef,
  isInvitationToken,
} from "../shared/invitationToken";

interface CreateGroupData {
  name: string;
  description?: string;
  /** The founder's name in the new group, as a member gives one on joining. */
  username: string;
  /** A founder invitation to spend (T125); without one, the allowance applies. */
  founderToken?: string;
}

/** The bounds of a name in a group, the same as `redeemInvitation`'s. */
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;

/**
 * How many groups one person may start without a founder link (T126; the
 * onboarding plan, D4, decided 2026-10-08): the first comes from a founder
 * link, and whoever started one may start more, up to this many in all, for
 * another table. A founder link always works: the maintainer issued it on
 * purpose.
 */
export const MAX_GROUPS_STARTED = 3;

/**
 * The longest name and description a group may have (T119). The same as the
 * app's `TEXT_LIMITS.line` and `.text` (`src/core/constants/textLimits.ts`)
 * and the production rules, which check them on every edit; a group is
 * created here, past the rules, so they are checked here.
 */
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 10_000;

/**
 * Creates a new group and the group creator's admin profile.
 *
 * Who may (T126): someone spending a founder invitation, which this spends in
 * the same transaction as the group it creates; or someone who has already
 * started a group, and has started fewer than `MAX_GROUPS_STARTED`. Started
 * means the group's `createdBy`, so a deleted group no longer counts. Before
 * this, any signed-in caller could create any number of groups.
 *
 * This has to run server-side with the Admin SDK because it writes the
 * caller's own group profile with `role: "admin"`. Production Firestore
 * rules deny clients that write entirely (see bug #1409): a member could
 * otherwise delete their own group profile -- permitted, as "leave group" --
 * and recreate it with an escalated role, because rules cannot distinguish
 * "the group creator, right after creating the group" from "any member,
 * rewriting their own profile" once both writes originate from the client.
 */
export const createGroup = functions.onCall(
  {
    region: "europe-west1",
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request: functions.CallableRequest<CreateGroupData>) => {
    if (!request.auth) {
      throw new functions.HttpsError(
        "unauthenticated",
        "You must be logged in to create a group."
      );
    }

    const {name, description, founderToken} = request.data ?? {};
    const trimmedName = typeof name === "string" ? name.trim() : "";
    const username = typeof request.data?.username === "string" ?
      request.data.username.trim() :
      "";

    if (!trimmedName) {
      throw new functions.HttpsError(
        "invalid-argument",
        "Group name is required."
      );
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      throw new functions.HttpsError(
        "invalid-argument",
        `A group's name can hold ${MAX_NAME_LENGTH} characters.`
      );
    }
    if (description !== undefined && typeof description !== "string") {
      throw new functions.HttpsError(
        "invalid-argument",
        "A group's description must be text."
      );
    }
    if ((description ?? "").length > MAX_DESCRIPTION_LENGTH) {
      throw new functions.HttpsError(
        "invalid-argument",
        `A group's description can hold ${MAX_DESCRIPTION_LENGTH.toLocaleString("en-US")} characters.`
      );
    }

    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      throw new functions.HttpsError(
        "invalid-argument",
        `Your name in the group must be ${USERNAME_MIN}-${USERNAME_MAX} ` +
          "characters."
      );
    }
    if (founderToken !== undefined && !isInvitationToken(founderToken)) {
      throw new functions.HttpsError(
        "invalid-argument",
        "This link to start a group is incomplete."
      );
    }

    try {
      const callerUid = request.auth.uid;
      const callerEmail = request.auth.token.email;
      const groupId = getFirestore().collection("groups").doc().id;

      await getFirestore().runTransaction(async (transaction) => {
        const now = new Date();

        // The reads come first: the SDK refuses a read after a write in the
        // same transaction, and reading the profile after writing the group
        // failed every call.
        const userDocRef = getFirestore().collection("users").doc(callerUid);
        // Under the token's hash (`shared/invitationToken`).
        const founderInvitationRef = founderToken ?
          invitationRef(getFirestore().collection(FOUNDER_INVITATIONS), founderToken) :
          null;
        const [userDoc, founderInvitation, started] = await Promise.all([
          transaction.get(userDocRef),
          founderInvitationRef ? transaction.get(founderInvitationRef) : null,
          founderInvitationRef ?
            null :
            transaction.get(getFirestore().collection("groups")
              .where("createdBy", "==", callerUid)
              .limit(MAX_GROUPS_STARTED)),
        ]);

        if (founderInvitation) {
          const invitation = asInvitation(founderInvitation);
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
          transaction.update(invitation.ref, {
            used: true,
            usedAt: now,
            usedBy: callerUid,
            groupId,
          });
        } else if (!started || started.empty) {
          throw new functions.HttpsError(
            "permission-denied",
            "Starting a group needs a link to start a group. Ask for one."
          );
        } else if (started.size >= MAX_GROUPS_STARTED) {
          throw new functions.HttpsError(
            "resource-exhausted",
            `You have started ${MAX_GROUPS_STARTED} groups, the most one ` +
              "person may start without a new link."
          );
        }

        // Create the group document.
        const groupDocRef = getFirestore().collection("groups").doc(groupId);
        transaction.set(groupDocRef, {
          name: trimmedName,
          description: description || "",
          createdAt: now,
          createdBy: callerUid,
        });

        // Make it the caller's active group. Membership is the group profile
        // below (T136); the global profile no longer lists groups.
        if (userDoc.exists) {
          transaction.update(userDocRef, {activeGroupId: groupId});
        } else {
          // If the user document doesn't exist (shouldn't happen), create it.
          transaction.set(userDocRef, {
            id: callerUid,
            email: callerEmail,
            activeGroupId: groupId,
            lastLogin: now,
            createdAt: now,
          });
        }

        // Create the caller's group profile as an admin.
        const groupUserDocRef = getFirestore()
          .collection("groups")
          .doc(groupId)
          .collection("users")
          .doc(callerUid);
        transaction.set(groupUserDocRef, {
          userId: callerUid,
          username,
          role: "admin",
          joinedAt: now,
          preferences: {
            theme: "default",
          },
        });

        // Reserve the username.
        const usernameLower = username.toLowerCase();
        const usernameDocRef = getFirestore()
          .collection("groups")
          .doc(groupId)
          .collection("usernames")
          .doc(usernameLower);
        transaction.set(usernameDocRef, {
          userId: callerUid,
          originalUsername: username,
          createdAt: now,
        });
      });

      return {success: true, groupId};
    } catch (error) {
      // Preserve specific error codes instead of collapsing every failure
      // into "internal" -- callers need to be able to tell "bad input" from
      // "something broke".
      rethrowHttpsError(
        error,
        `Failed to create group: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        (wrappedError) =>
          console.error("Error creating group:", wrappedError)
      );
    }
  }
);
