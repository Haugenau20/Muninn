// functions/src/groupManagement/redeemInvitation.ts
import * as functions from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {ENFORCE_APP_CHECK} from "../shared/appCheck";
import {rethrowHttpsError} from "../shared/httpsErrors";
import {registrationTokenProblem} from "../shared/registrationToken";
import {
  invitationRefs,
  isInvitationToken,
  pickInvitation,
} from "../shared/invitationToken";
import {GROUP_FULL_MESSAGE, MAX_GROUP_MEMBERS} from "./groupLimits";

interface RedeemInvitationData {
  groupId: string;
  token: string;
  username: string;
}

/** The bounds both join forms already enforce (`useUsernameCheck`). */
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;

/**
 * Makes the caller a member of a group, in exchange for a registration token.
 *
 * This is the only way into a group other than creating it, and it has to run
 * server-side (T052). Group membership is the group profile written here,
 * which the Firestore rules read to answer `isGroupMember` (T136). It used to
 * be `users/{uid}.groups`, and while a client could write that array, anyone
 * who knew a group's id could make themselves a member of it without ever
 * holding a token. No client creates a group profile, and this function is
 * where the token is actually checked: it exists, it has not been used, and
 * it has not expired.
 *
 * Serves both join paths. A brand-new account (the client has just created
 * the Auth user) has no global profile yet, so one is created here; an
 * existing account has the group appended to the one it has. The two paths
 * used to write different group themes, and still do, so that moving the
 * write server-side changes nothing a member can see.
 *
 * Everything -- the token check, the username check, the member count and
 * all five writes -- happens in one transaction, so two people racing for the
 * same token, the same name or a group's last place cannot both win. A group
 * holds at most `MAX_GROUP_MEMBERS` (T128).
 */
export const redeemInvitation = functions.onCall(
  {
    region: "europe-west1",
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request: functions.CallableRequest<RedeemInvitationData>) => {
    if (!request.auth) {
      throw new functions.HttpsError(
        "unauthenticated",
        "You must be signed in to join a group."
      );
    }

    const {groupId, token} = request.data ?? {};
    const username =
      typeof request.data?.username === "string" ?
        request.data.username.trim() :
        "";

    if (typeof groupId !== "string" || !groupId ||
        !isInvitationToken(token)) {
      throw new functions.HttpsError(
        "invalid-argument",
        "This invitation link is incomplete."
      );
    }
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      throw new functions.HttpsError(
        "invalid-argument",
        `Your name in this group must be ${USERNAME_MIN}-${USERNAME_MAX} ` +
          "characters."
      );
    }

    const uid = request.auth.uid;
    const db = getFirestore();
    const groupRef = db.collection("groups").doc(groupId);
    // Under the token's hash, or, for an invitation made before T145, under
    // the token itself (`shared/invitationToken`).
    const tokenRefs = invitationRefs(groupRef.collection("registrationTokens"), token);
    const usernameRef = groupRef
      .collection("usernames")
      .doc(username.toLowerCase());
    const groupUserRef = groupRef.collection("users").doc(uid);
    const userRef = db.collection("users").doc(uid);

    try {
      await db.runTransaction(async (transaction) => {
        const [hashedDoc, legacyDoc, groupDoc, userDoc, groupUserDoc, usernameDoc, members] =
          await Promise.all([
            transaction.get(tokenRefs.hashed),
            transaction.get(tokenRefs.legacy),
            transaction.get(groupRef),
            transaction.get(userRef),
            transaction.get(groupUserRef),
            transaction.get(usernameRef),
            transaction.get(groupRef.collection("users").limit(MAX_GROUP_MEMBERS)),
          ]);

        const tokenDoc = pickInvitation(hashedDoc, legacyDoc);
        if (!tokenDoc || !groupDoc.exists) {
          throw new functions.HttpsError(
            "not-found",
            "This invitation does not exist. Ask for a new link."
          );
        }

        // A group being deleted admits nobody (T037): its deletion has
        // taken, or is about to take, the group off every member's account.
        if (groupDoc.get("deleting") === true) {
          throw new functions.HttpsError(
            "failed-precondition",
            "This group is being deleted."
          );
        }

        const problem = registrationTokenProblem(tokenDoc.data() ?? {});
        if (problem === "used") {
          throw new functions.HttpsError(
            "failed-precondition",
            "This invitation has already been used. Ask for a new link."
          );
        }
        if (problem === "expired") {
          throw new functions.HttpsError(
            "failed-precondition",
            "This invitation has expired. Ask for a new link."
          );
        }

        // The group profile is the one record of membership (T136). Someone
        // the array lists without one is not a member, and joining gives
        // them the profile they lacked.
        if (groupUserDoc.exists) {
          throw new functions.HttpsError(
            "already-exists",
            "You are already a member of this group."
          );
        }

        if (members.size >= MAX_GROUP_MEMBERS) {
          throw new functions.HttpsError("resource-exhausted", GROUP_FULL_MESSAGE);
        }

        if (usernameDoc.exists && usernameDoc.data()?.userId !== uid) {
          throw new functions.HttpsError(
            "already-exists",
            "Username is already taken in this group."
          );
        }

        const now = new Date();

        if (userDoc.exists) {
          transaction.update(userRef, {activeGroupId: groupId});
        } else {
          transaction.set(userRef, {
            id: uid,
            ...(request.auth?.token.email ?
              {email: request.auth.token.email} :
              {}),
            activeGroupId: groupId,
            lastLogin: now,
            createdAt: now,
          });
        }

        transaction.set(groupUserRef, {
          userId: uid,
          username,
          role: "member",
          joinedAt: now,
          preferences: {
            theme: userDoc.exists ? "default" : "light",
          },
        });

        transaction.set(usernameRef, {
          userId: uid,
          originalUsername: username,
          createdAt: now,
        });

        transaction.update(tokenDoc.ref, {
          used: true,
          usedAt: now,
          usedBy: uid,
        });
      });

      return {success: true, groupId};
    } catch (error) {
      rethrowHttpsError(
        error,
        `Failed to join the group: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        (wrappedError) =>
          console.error("Error redeeming invitation:", wrappedError)
      );
    }
  }
);
