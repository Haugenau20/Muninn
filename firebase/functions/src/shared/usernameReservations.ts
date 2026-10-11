// functions/src/shared/usernameReservations.ts
import {getFirestore, WriteBatch} from "firebase-admin/firestore";

/**
 * Adds to `batch` the deletion of every username reservation in a group that
 * belongs to `userId` -- the reservations a departing member releases.
 *
 * Found by owner, not by the profile's `username`: that field is
 * client-written, and trusting it let a member who took another member's name
 * release that member's reservation by leaving (SEC-005, T080). By owner also
 * catches names the profile no longer shows: the profile editor used to rename
 * without moving the reservation, so a member can hold an old name too.
 *
 * Each delete is conditional on the reservation being unchanged since it was
 * read, so one released and re-reserved by somebody else in between fails the
 * commit instead of being deleted.
 *
 * @param {WriteBatch} batch - Batch the deletions join.
 * @param {string} groupId - Group whose reservations to release.
 * @param {string} userId - Uid of the departing member.
 * @return {Promise<void>} Resolves once the deletions are in the batch.
 */
export async function releaseUsernames(
  batch: WriteBatch,
  groupId: string,
  userId: string
): Promise<void> {
  const owned = await getFirestore()
    .collection("groups")
    .doc(groupId)
    .collection("usernames")
    .where("userId", "==", userId)
    .get();

  for (const reservation of owned.docs) {
    batch.delete(reservation.ref, {lastUpdateTime: reservation.updateTime});
  }
}

/**
 * Adds to `batch` the deletion of every username reservation `userId` holds,
 * in every group -- for a deleted account.
 *
 * Found by owner across groups, not group by group: the groups are found by
 * the account's group profiles (T136), and a run whose profiles were deleted
 * before its batch failed has none left to find them by. Needs the
 * `usernames.userId` collection-group index in production. Each delete is
 * conditional, as in {@link releaseUsernames}.
 *
 * @param {WriteBatch} batch - Batch the deletions join.
 * @param {string} userId - Uid of the deleted account.
 * @return {Promise<void>} Resolves once the deletions are in the batch.
 */
export async function releaseAllUsernames(
  batch: WriteBatch,
  userId: string
): Promise<void> {
  const owned = await getFirestore()
    .collectionGroup("usernames")
    .where("userId", "==", userId)
    .get();

  for (const reservation of owned.docs) {
    // Only `groups/{g}/usernames/{name}`.
    if (reservation.ref.parent.parent?.parent.id !== "groups") continue;
    batch.delete(reservation.ref, {lastUpdateTime: reservation.updateTime});
  }
}
