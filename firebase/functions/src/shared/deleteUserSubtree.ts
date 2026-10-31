// functions/src/shared/deleteUserSubtree.ts
import {getFirestore} from "firebase-admin/firestore";
import {imageBucket} from "./imageBucket";

/**
 * Deletes a user's profile document inside a group, together with everything
 * beneath it.
 *
 * A plain `batch.delete()` on the group-user document leaves its
 * subcollections behind: Firestore has no cascade, and orphaned documents
 * stay readable by anything holding their path. The per-user subcollections
 * today are `notes`, which holds private notes, and `story-progress`, each
 * reader's place in each campaign's story (T073) -- so the plain delete was
 * silently retaining the most personal data in the product after a user asked
 * for it to be gone.
 *
 * `recursiveDelete` walks the whole subtree, so it stays correct if another
 * per-user subcollection is added later. The private records' pictures
 * (T163) are files, not documents, and are deleted by their prefix. It cannot participate in a
 * WriteBatch, so callers must invoke it alongside their batch rather than
 * inside it.
 *
 * @param {string} groupId - Group holding the user profile.
 * @param {string} userId - User whose profile and subtree should be removed.
 * @return {Promise<void>} Resolves once the whole subtree is gone.
 */
export async function deleteGroupUserDocument(
  groupId: string,
  userId: string
): Promise<void> {
  const groupUserRef = getFirestore()
    .collection("groups")
    .doc(groupId)
    .collection("users")
    .doc(userId);

  await getFirestore().recursiveDelete(groupUserRef);
  // The pictures of their private records (T163), stored under the same
  // path in the bucket. After the documents, so a failure leaves files that
  // nothing names, which the monthly sweep finds.
  await imageBucket().deleteFiles({prefix: `groups/${groupId}/users/${userId}/`});
}
