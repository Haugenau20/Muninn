// functions/src/shared/memberGroups.ts
import {getFirestore} from "firebase-admin/firestore";

/**
 * The groups a user is in: those holding a group profile of theirs,
 * `groups/{g}/users/{uid}`, the one record of membership (T136), found by
 * the `userId` each profile carries. Needs the `users.userId`
 * collection-group index in production.
 *
 * @param {string} uid The user
 * @return {Promise<string[]>} The group ids
 */
export async function memberGroupIds(uid: string): Promise<string[]> {
  const profiles = await getFirestore().collectionGroup("users").where("userId", "==", uid).get();
  // Only `groups/{g}/users/{uid}`: a top-level profile carries no `userId`,
  // and one of someone else's that named this uid is not theirs.
  return profiles.docs
    .filter((doc) => doc.id === uid && doc.ref.parent.parent?.parent.id === "groups")
    .map((doc) => doc.ref.parent.parent?.id as string);
}
