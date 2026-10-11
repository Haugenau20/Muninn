// functions/src/userManagement/accountDeletion.ts
import * as functions from "firebase-functions/v2/https";
import {getAuth, UserRecord} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {deleteGroupUserDocument} from "../shared/deleteUserSubtree";
import {
  LAST_ADMIN_MESSAGE,
  readAdmins,
  stepDownAsAdmin,
  strandsGroup,
} from "../shared/groupAdmins";
import {memberGroupIds} from "../shared/memberGroups";
import {releaseUsernames} from "../shared/usernameReservations";
import {releaseAccountSlot} from "../signUp/accountCount";

/** One group of an account, as its deletion would leave it. */
export interface GroupInPlan {
  groupId: string;
  /** The names reserved to them there, which are released. */
  names: string[];
  /** Their private notes there, which are deleted. */
  notes: number;
  /** Their place in each of the group's campaigns, which is deleted. */
  readingProgress: number;
  /** They are its only admin, which refuses the deletion until another is. */
  onlyAdmin: boolean;
}

/** What deleting an account removes, read without changing anything. */
export interface AccountDeletionPlan {
  uid: string;
  email: string | undefined;
  /** The Auth account exists. */
  hasSignIn: boolean;
  /** The global profile, `users/{uid}`, exists. */
  hasProfile: boolean;
  groups: GroupInPlan[];
}

/**
 * The Auth account, or undefined when there is none.
 *
 * @param {string} uid The account
 * @return {Promise<UserRecord | undefined>} Its record
 */
async function signInOf(uid: string): Promise<UserRecord | undefined> {
  try {
    return await getAuth().getUser(uid);
  } catch (error) {
    if ((error as {code?: string}).code === "auth/user-not-found") return undefined;
    throw error;
  }
}

/**
 * Deletes the Auth account; one that is already gone counts as deleted.
 * A deleted one gives its slot back to the account count (T128).
 *
 * @param {string} uid The account
 * @return {Promise<boolean>} Whether there was one to delete
 */
async function deleteSignIn(uid: string): Promise<boolean> {
  try {
    await getAuth().deleteUser(uid);
    await releaseAccountSlot();
    return true;
  } catch (error) {
    if ((error as {code?: string}).code === "auth/user-not-found") return false;
    throw error;
  }
}

/**
 * What {@link deleteAccount} would remove for `uid`, read without writing:
 * the sign-in, the profile and, per group, the names, private notes and
 * reading progress, and whether the deletion would be refused because they
 * are a group's only admin (judged as the deletion judges it, in a read-only
 * transaction, so nobody is demoted to find out).
 *
 * @param {string} uid The account
 * @return {Promise<AccountDeletionPlan>} The plan
 */
export async function planAccountDeletion(uid: string): Promise<AccountDeletionPlan> {
  const db = getFirestore();
  const [signIn, profile] = await Promise.all([
    signInOf(uid),
    db.collection("users").doc(uid).get(),
  ]);
  const groupIds = await memberGroupIds(uid, profile);

  const groups = await Promise.all(groupIds.map(async (groupId) => {
    const group = db.collection("groups").doc(groupId);
    const member = group.collection("users").doc(uid);
    const [names, notes, readingProgress, onlyAdmin] = await Promise.all([
      group.collection("usernames").where("userId", "==", uid).get(),
      member.collection("notes").count().get(),
      member.collection("story-progress").count().get(),
      db.runTransaction(
        async (transaction) => strandsGroup(await readAdmins(transaction, groupId, uid), uid, true),
        {readOnly: true}
      ),
    ]);
    return {
      groupId,
      names: names.docs.map((name) => String(name.get("originalUsername") ?? name.id)).sort(),
      notes: notes.data().count,
      readingProgress: readingProgress.data().count,
      onlyAdmin,
    };
  }));

  return {uid, email: signIn?.email, hasSignIn: Boolean(signIn), hasProfile: profile.exists, groups};
}

/**
 * Deletes an account: its name reservations, its profile in every group with
 * everything beneath it (private notes, reading progress), its global profile
 * and its sign-in. What it wrote into campaigns stays, as the privacy page
 * says.
 *
 * Run by the `deleteUser` callable for the account's own holder, and by
 * `scripts/delete-account.js` for the maintainer, on request.
 *
 * @param {string} uid The account
 * @return {Promise<void>} Resolves once it is gone
 * @throws {functions.HttpsError} `failed-precondition` with `details.groupId`
 *   when they are the only admin of a group that has other members;
 *   `not-found` when there is nothing to delete
 */
export async function deleteAccount(uid: string): Promise<void> {
  const userDoc = await getFirestore().collection("users").doc(uid).get();
  const groups = await memberGroupIds(uid, userDoc);

  if (!userDoc.exists && groups.length === 0) {
    // The global profile is the last Firestore record this deletes -- it
    // goes only once the group profiles are gone -- and the Auth account goes
    // after it. A missing profile with an Auth account still standing is
    // therefore an earlier run that failed at its last step: finish it,
    // rather than refuse the only retry there is (AUTH-002). Group profiles
    // outliving it are still deleted below: they are the membership (T136).
    if (!(await deleteSignIn(uid))) {
      throw new functions.HttpsError("not-found", "User profile not found.");
    }
    return;
  }

  // Deleting an account is the third door out of a group, after leaving and
  // demotion, and needs the same guard (T035). Checked before anything is
  // deleted, so a refusal changes nothing. Where it passes, the person is
  // demoted in every group in the same transaction as the check, so two
  // admins deleting their accounts at once cannot both count the other
  // (AUTH-001).
  const stranded = await stepDownAsAdmin(groups, uid);
  if (stranded) {
    throw new functions.HttpsError("failed-precondition", LAST_ADMIN_MESSAGE, {groupId: stranded});
  }

  const batch = getFirestore().batch();

  // Release the name reservations in every group -- found by owner, never by
  // the profile's client-written `username` (SEC-005, T080).
  for (const groupId of groups) {
    await releaseUsernames(batch, groupId, uid);
  }

  if (userDoc.exists) batch.delete(userDoc.ref);

  // The group profile is deleted apart from the batch: it owns the `notes`
  // and `story-progress` subcollections, and a batched delete would orphan
  // them rather than remove them. recursiveDelete cannot join a WriteBatch.
  // It runs before the batch commits, so private notes are confirmed gone
  // before the account's own records (trivially re-deletable on retry) are.
  await Promise.all(groups.map((groupId) => deleteGroupUserDocument(groupId, uid)));

  await batch.commit();

  // Last, so a failure before this leaves the person able to sign in and
  // try again. Already gone counts as done: the maintainer's script may be
  // finishing an account whose sign-in was deleted in the console.
  await deleteSignIn(uid);
}
