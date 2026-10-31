// functions/src/imageMaintenance/publishImage.ts
import * as functions from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {randomUUID} from "crypto";
import {imageBucket} from "../shared/imageBucket";
import {rethrowHttpsError} from "../shared/httpsErrors";

interface PublishImageData {
  groupId: string;
  /** The private picture: `groups/{g}/users/{uid}/campaigns/{c}/{kind}/{id}/{file}`. */
  path: string;
  /** The id the record is published under, which names the new picture's folder. */
  recordId: string;
}

/** A private picture's path, read into its parts. */
const PRIVATE_IMAGE =
  /^groups\/([^/]+)\/users\/([^/]+)\/campaigns\/([^/]+)\/(npcs|locations)\/([^/]+)\/([0-9a-f-]{36})\.(webp|jpg)$/;

/** An id the app derives from a name: a slug, or a random id. */
const RECORD_ID = /^[a-z0-9-]{1,200}$/;

/** The cache header every image the app stores carries (`IMMUTABLE_CACHE_CONTROL`). */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Copies a private record's picture to where the campaign's records keep
 * theirs, for its publish (T163). Only the author reads a private picture,
 * and the client cannot copy a file without downloading and uploading it
 * again, so the copy is made here.
 *
 * The copy gets a new name and a new download token -- the private file's
 * token stays the author's -- and a `pendingUploads` entry in the caller's
 * name, so the publish transaction's write of the record may point at it
 * (`imageLeased` in firestore.rules.prod) and the daily sweep spares it
 * until then. The private file is left for the caller to release.
 *
 * Only the picture's owner may copy it, while a member of the group, into a
 * campaign that takes writes.
 *
 * @return {Promise<{path: string}>} The new picture's path
 */
export const publishImage = functions.onCall(
  {region: "europe-west1"},
  async (request: functions.CallableRequest<PublishImageData>) => {
    if (!request.auth) {
      throw new functions.HttpsError("unauthenticated", "You must be signed in to publish a picture.");
    }
    const {groupId, path, recordId} = request.data ?? {};
    const parts = typeof path === "string" ? PRIVATE_IMAGE.exec(path) : null;
    if (typeof groupId !== "string" || !parts || parts[1] !== groupId ||
        typeof recordId !== "string" || !RECORD_ID.test(recordId)) {
      throw new functions.HttpsError("invalid-argument", "A group, a private picture and a record id are required.");
    }
    const [, , owner, campaignId, kind, , , extension] = parts;
    if (owner !== request.auth.uid) {
      throw new functions.HttpsError("permission-denied", "Only its author can publish a private picture.");
    }

    try {
      const db = getFirestore();
      const group = db.collection("groups").doc(groupId);
      const [member, campaign] = await Promise.all([
        group.collection("users").doc(request.auth.uid).get(),
        group.collection("campaigns").doc(campaignId).get(),
      ]);
      if (!member.exists) {
        throw new functions.HttpsError("permission-denied", "You are not a member of this group.");
      }
      if (!campaign.exists || campaign.get("deleting") === true) {
        throw new functions.HttpsError("failed-precondition", "That campaign takes no changes.");
      }

      const source = imageBucket().file(path);
      const [exists] = await source.exists();
      if (!exists) {
        throw new functions.HttpsError("not-found", "That picture is not there any more.");
      }

      const fileName = `${randomUUID()}.${extension}`;
      const target = `groups/${groupId}/campaigns/${campaignId}/${kind}/${recordId}/${fileName}`;
      // The lease first: a copy that outlives a failed publish is then the
      // sweep's to find once the lease is over, never a file nothing names.
      await group.collection("pendingUploads").doc(fileName).set({
        path: target,
        uid: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      await source.copy(imageBucket().file(target), {
        cacheControl: IMMUTABLE_CACHE_CONTROL,
        metadata: {firebaseStorageDownloadTokens: randomUUID()},
      });
      return {path: target};
    } catch (error) {
      rethrowHttpsError(error, "Could not publish the picture.");
    }
  }
);
