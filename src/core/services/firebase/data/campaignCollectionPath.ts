// src/core/services/firebase/data/campaignCollectionPath.ts

/**
 * The full path of a campaign-scoped collection, or `null` when there is no
 * campaign to scope it to -- signed out, or no group or campaign selected.
 *
 * A listener needs an explicit path (see
 * `DocumentService.subscribeToCollection`), and `null` is what
 * `useFirebaseData`'s `subscribeTo` takes for "nothing to listen to yet".
 *
 * @param signedIn Whether a user is signed in
 * @param groupId The active group's id
 * @param campaignId The active campaign's id
 * @param collectionName The collection inside the campaign, e.g. `npcs`
 */
export const campaignCollectionPath = (
  signedIn: boolean,
  groupId: string | null | undefined,
  campaignId: string | null | undefined,
  collectionName: string
): string | null =>
  signedIn && groupId && campaignId
    ? `groups/${groupId}/campaigns/${campaignId}/${collectionName}`
    : null;

/**
 * The full path of one of a player's private collections in a campaign
 * (T163): `groups/{g}/users/{uid}/private/{c}/{collection}`, beside their
 * notes and readable by them alone. `null` without a signed-in player, a
 * group or a campaign.
 *
 * @param uid The signed-in player's id
 * @param groupId The active group's id
 * @param campaignId The active campaign's id
 * @param collectionName `npcs`, `locations`, `quests`, `rumors` or `links`
 */
export const privateCollectionPath = (
  uid: string | null | undefined,
  groupId: string | null | undefined,
  campaignId: string | null | undefined,
  collectionName: string
): string | null =>
  uid && groupId && campaignId
    ? `groups/${groupId}/users/${uid}/private/${campaignId}/${collectionName}`
    : null;
