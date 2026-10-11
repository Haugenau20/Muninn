// functions/src/campaignManagement/createCampaign.ts
import * as functions from "firebase-functions/v2/https";
import {randomBytes} from "crypto";
import {getFirestore} from "firebase-admin/firestore";
import {rethrowHttpsError} from "../shared/httpsErrors";
import {
  CAMPAIGNS_FULL_MESSAGE,
  MAX_GROUP_CAMPAIGNS,
} from "../groupManagement/groupLimits";

interface CreateCampaignData {
  groupId: string;
  name: string;
  description?: string;
}

/**
 * The longest name and description a campaign may have (T119). The same as
 * the app's `TEXT_LIMITS.line` and `.text` and the production rules, which
 * check them on every edit.
 */
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 10_000;

/**
 * A campaign's id from its name, as the app has always made them: lower case,
 * every run of other characters one hyphen. A name with no letter or digit in
 * it gets `campaign`.
 *
 * @param {string} name The campaign's name
 * @return {string} The id to try first
 */
export function campaignSlug(name: string): string {
  const slug = name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "campaign";
}

/**
 * Creates a campaign in a group, for any member of it (T128).
 *
 * Campaigns used to be created by the browser under the rules, which cannot
 * count, so nothing bounded how many a group had. This counts them in the
 * same transaction that creates one: a group holds at most
 * `MAX_GROUP_CAMPAIGNS`, two members racing for the last place cannot both
 * have it, and deleting a campaign (`deleteCampaign`) gives its place back,
 * since a deleted campaign is no longer there to count.
 *
 * Every member may create one (decided 2026-10-08), as the rules allowed; a
 * member is someone with a group profile there, the one record of membership
 * (T136). Not while the group is being deleted (T037).
 *
 * The id is the name's slug, or the slug and a random suffix when that is
 * taken, and the creator's active campaign becomes the new one.
 */
export const createCampaign = functions.onCall(
  {
    region: "europe-west1",
  },
  async (request: functions.CallableRequest<CreateCampaignData>) => {
    if (!request.auth) {
      throw new functions.HttpsError(
        "unauthenticated",
        "You must be signed in to create a campaign."
      );
    }

    const {groupId, description} = request.data ?? {};
    const name = typeof request.data?.name === "string" ? request.data.name.trim() : "";

    if (typeof groupId !== "string" || !groupId) {
      throw new functions.HttpsError("invalid-argument", "A campaign needs a group.");
    }
    if (!name) {
      throw new functions.HttpsError("invalid-argument", "Campaign name is required.");
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new functions.HttpsError(
        "invalid-argument",
        `A campaign's name can hold ${MAX_NAME_LENGTH} characters.`
      );
    }
    if (description !== undefined && typeof description !== "string") {
      throw new functions.HttpsError("invalid-argument", "A campaign's description must be text.");
    }
    if ((description ?? "").length > MAX_DESCRIPTION_LENGTH) {
      throw new functions.HttpsError(
        "invalid-argument",
        `A campaign's description can hold ${MAX_DESCRIPTION_LENGTH.toLocaleString("en-US")} characters.`
      );
    }

    const uid = request.auth.uid;
    const db = getFirestore();
    const groupRef = db.collection("groups").doc(groupId);
    const campaigns = groupRef.collection("campaigns");
    const slug = campaignSlug(name);
    const candidates = [
      campaigns.doc(slug),
      campaigns.doc(`${slug}-${randomBytes(3).toString("hex")}`),
    ];

    try {
      const campaignId = await db.runTransaction(async (transaction) => {
        const [group, member, existing, ...taken] = await Promise.all([
          transaction.get(groupRef),
          transaction.get(groupRef.collection("users").doc(uid)),
          transaction.get(campaigns.limit(MAX_GROUP_CAMPAIGNS)),
          ...candidates.map((candidate) => transaction.get(candidate)),
        ]);

        if (!group.exists || !member.exists) {
          throw new functions.HttpsError(
            "permission-denied",
            "You are not a member of this group."
          );
        }
        if (group.get("deleting") === true) {
          throw new functions.HttpsError(
            "failed-precondition",
            "This group is being deleted."
          );
        }
        if (existing.size >= MAX_GROUP_CAMPAIGNS) {
          throw new functions.HttpsError("resource-exhausted", CAMPAIGNS_FULL_MESSAGE);
        }

        const free = candidates.find((_candidate, index) => !taken[index].exists);
        if (!free) {
          throw new functions.HttpsError(
            "aborted",
            "Could not find a free name for this campaign. Please try again."
          );
        }

        transaction.create(free, {
          name,
          description: description ?? "",
          createdAt: new Date(),
          createdBy: uid,
          isActive: true,
        });
        transaction.update(member.ref, {activeCampaignId: free.id});
        return free.id;
      });

      return {success: true, campaignId};
    } catch (error) {
      rethrowHttpsError(
        error,
        `Failed to create the campaign: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        (wrappedError) => console.error("Error creating a campaign:", wrappedError)
      );
    }
  }
);
