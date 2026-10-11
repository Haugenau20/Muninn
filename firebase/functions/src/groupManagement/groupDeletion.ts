// functions/src/groupManagement/groupDeletion.ts
import {
  DocumentReference,
  FieldPath,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {imageBucket} from "../shared/imageBucket";
import {checkedBulkWriter} from "../shared/checkedBulkWriter";
import {RESERVATIONS} from "../signUp/signUpGate";

/**
 * The record of a group deletion that has started and not yet finished.
 *
 * Top-level, because the group cannot record its own unfinished deletion:
 * everything beneath it goes, and `recursiveDelete` removes the root even
 * when a descendant failed. Clients cannot read or write `groupDeletions`;
 * the rules' default deny covers it.
 *
 * @param {string} groupId The group
 * @return {DocumentReference} The record
 */
export function groupDeletionRef(
  groupId: string
): DocumentReference {
  return getFirestore().collection("groupDeletions").doc(groupId);
}

/**
 * Runs every stage of a group deletion whose record exists, and deletes the
 * record once all of them have succeeded (T037).
 *
 * Every stage is safe to repeat, so this is both the first run and every
 * retry: it throws on the first stage that fails, and the record stays for
 * the next attempt.
 *
 * The order closes the group before it empties it. A write that lands
 * before a stage is removed by a later one; none can land after:
 *  1. membership ends: the member profiles themselves go, before anything
 *     beneath them. The profile is the one record of membership (T136), so
 *     no member read or write passes again; `isGroupAdmin` reads `role`
 *     there, so the admin-only writes (invitations, the crest) close too.
 *     Then whoever has the group active has it cleared;
 *  2. what lay beneath the profiles: private notes and reading progress;
 *  3. everything else beneath the group: campaigns and their contents,
 *     invitations, name reservations, upload ledgers;
 *  4. pending sign-ups for the group's invitations, which hold an email;
 *  5. the group's pictures, after the documents that show them (IMG-005).
 *
 * @param {string} groupId The group
 * @return {Promise<void>} Resolves once the group and the record are gone
 */
export async function finishGroupDeletion(groupId: string): Promise<void> {
  const db = getFirestore();
  const groupRef = db.collection("groups").doc(groupId);

  // 1. The profiles alone, not what lies beneath them: membership ends
  // here, whatever stage 2 then takes its time over.
  const profiles = await groupRef.collection("users").select().get();
  const profileWriter = checkedBulkWriter();
  profiles.docs.forEach((doc) => profileWriter.delete(doc.ref));
  await profileWriter.close("member profile(s)");

  // Found by the active group itself, not by the profiles just deleted, so
  // a retry still finds whoever is left.
  const active = await db
    .collection("users")
    .where("activeGroupId", "==", groupId)
    .get();
  const activeWriter = checkedBulkWriter();
  active.docs.forEach((doc) => activeWriter.update(doc.ref, {activeGroupId: null}));
  await activeWriter.close("member account(s)");

  // 2 and 3. `recursiveDelete` finds descendants whether or not their
  // parent still exists, so a retry picks up whatever a failure left.
  await db.recursiveDelete(groupRef.collection("users"));
  await db.recursiveDelete(groupRef);

  // 4.
  const reservations = await db
    .collection(RESERVATIONS)
    .where("groupId", "==", groupId)
    .get();
  const reservationWriter = checkedBulkWriter();
  reservations.docs.forEach((doc) => reservationWriter.delete(doc.ref));
  await reservationWriter.close("pending sign-up(s)");

  // 5. The trailing slash matters: without it, "g1" would also take "g10".
  await imageBucket().deleteFiles({prefix: `groups/${groupId}/`});

  await groupDeletionRef(groupId).delete();
}

/** How long a deletion is left to its caller before the sweep resumes it. */
export const RESUME_AFTER_MS = 60 * 60 * 1000;

/** The most deletions one sweep resumes; the rest wait for the next run. */
export const RESUME_BUDGET = 10;

/** What one sweep did. */
export interface ResumeResult {
  /** The id of each group whose deletion it finished. */
  finished: string[];
  /** The id of each group whose deletion failed again. */
  failed: string[];
  /** Whether it stopped at its budget with records left unread. */
  more: boolean;
}

/**
 * Finishes group deletions nobody retried.
 *
 * A deletion that failed after the caller lost the group cannot be retried
 * from the app -- it is no longer theirs to see -- so without this its
 * leftovers would stay stored for good. Records younger than
 * {@link RESUME_AFTER_MS} are skipped: their deletion may still be running.
 * A record that fails again stays for the next run.
 *
 * @param {Date} now The time the sweep treats as now
 * @param {number} budget The most records to read
 * @return {Promise<ResumeResult>} What it did
 */
export async function resumeGroupDeletions(
  now: Date,
  budget = RESUME_BUDGET
): Promise<ResumeResult> {
  const records = await getFirestore()
    .collection("groupDeletions")
    .orderBy(FieldPath.documentId())
    .limit(budget + 1)
    .get();

  const result: ResumeResult = {
    finished: [],
    failed: [],
    more: records.size > budget,
  };

  for (const record of records.docs.slice(0, budget)) {
    const requestedAt = record.get("requestedAt");
    const age = requestedAt instanceof Timestamp ?
      now.getTime() - requestedAt.toMillis() :
      Infinity;
    if (age < RESUME_AFTER_MS) continue;

    try {
      await finishGroupDeletion(record.id);
      result.finished.push(record.id);
    } catch (error) {
      console.error(`Could not finish deleting group ${record.id}:`, error);
      result.failed.push(record.id);
    }
  }
  return result;
}

/**
 * Runs once a day, before the image sweep, and finishes any group deletion
 * that failed and was never retried.
 */
export const resumeGroupDeletionsDaily = onSchedule(
  {
    schedule: "every day 03:15",
    timeZone: "Europe/Copenhagen",
    region: "europe-west1",
  },
  async () => {
    const result = await resumeGroupDeletions(new Date());
    console.log(
      `Group deletions resumed: finished ${result.finished.length}, ` +
        `failed ${result.failed.length}` +
        (result.more ? "; stopped at its budget, the rest is tomorrow's." : ".")
    );
  }
);
