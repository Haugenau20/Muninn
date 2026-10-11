// functions/src/shared/memberGroups.ts
import {DocumentSnapshot, getFirestore} from "firebase-admin/firestore";

/**
 * The groups a user is in: those holding a group profile of theirs,
 * `groups/{g}/users/{uid}`, the one record of membership (T136), found by
 * the `userId` each profile carries. Needs the `users.userId`
 * collection-group index in production.
 *
 * Until the array is retired, also every group `users/{uid}.groups` lists,
 * so that a deletion misses nothing either copy still points at.
 *
 * @param {string} uid The user
 * @param {DocumentSnapshot} profile Their global profile, already read
 * @return {Promise<string[]>} The group ids, profiles' first, each once
 */
export async function memberGroupIds(uid: string, profile: DocumentSnapshot): Promise<string[]> {
  const profiles = await getFirestore().collectionGroup("users").where("userId", "==", uid).get();
  // Only `groups/{g}/users/{uid}`: a top-level profile carries no `userId`,
  // and one of someone else's that named this uid is not theirs.
  const held = profiles.docs
    .filter((doc) => doc.id === uid && doc.ref.parent.parent?.parent.id === "groups")
    .map((doc) => doc.ref.parent.parent?.id as string);
  const listed: unknown = profile.get("groups");
  const array = Array.isArray(listed) ? listed.filter((id): id is string => typeof id === "string") : [];
  return [...new Set([...held, ...array])];
}
