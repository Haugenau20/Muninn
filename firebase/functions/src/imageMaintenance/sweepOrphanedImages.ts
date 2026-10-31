// functions/src/imageMaintenance/sweepOrphanedImages.ts
import {
  DocumentReference,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import type {File, GetFilesOptions} from "@google-cloud/storage";
import {imageBucket} from "../shared/imageBucket";
import {sweepReleasedImages} from "./sweepReleasedImages";
import {deleteWithin, MIN_AGE_MS, PENDING_LEASE_MS} from "./shared";

/**
 * The object paths the app writes images to (see the storage images design,
 * §3), a private record's included (T163: under its author's profile). The
 * collection-group reads below find the private records' pictures too. Anything
 * else in the bucket -- a path added later -- is not the sweep's to judge,
 * however unreferenced it looks.
 */
const IMAGE_PATH = new RegExp(
  "^groups/[^/]+/((users/[^/]+/)?campaigns/[^/]+/((npcs|locations)/[^/]+|banner)|crest)/[^/]+$"
);

/**
 * Where bug-report screenshots are uploaded (T020). No document ever points at
 * one: `sendContactEmail` deletes each once it is mailed, so one still here
 * after a day belongs to a report that was never sent, or whose delete failed.
 */
const SUPPORT_PATH = /^support\/[^/]+\/[^/]+$/;

/**
 * How much one run may do (T084, PERF2-004). The bucket only grows, so a run
 * that listed every file and launched every delete at once would grow with
 * it: memory with the listing, open requests with the backlog.
 */
export interface SweepLimits {
  /** Files listed per Storage request. */
  pageSize: number;
  /**
   * Deletes one run may attempt. A larger backlog is left for the following
   * runs, each of which starts from the front of the bucket again: what was
   * deleted is no longer there to list.
   */
  maxDeletes: number;
  /** Deletes in flight at once. */
  concurrency: number;
}

const DEFAULT_LIMITS: SweepLimits = {
  pageSize: 1000,
  maxDeletes: 2000,
  concurrency: 10,
};

/** What one sweep did, for the log and for tests. */
export interface SweepResult {
  /** How many image and screenshot files were looked at. */
  checked: number;
  /** Paths deleted. */
  deleted: string[];
  /** Paths whose delete failed; the next sweep tries them again. */
  failed: string[];
  /**
   * The run stopped at its delete budget before listing every file, so there
   * may be orphans it did not reach. The next run carries on.
   */
  more: boolean;
  /** `pendingUploads` entries whose lease was over, deleted this run. */
  expiredUploads: number;
}

/**
 * Reads the `pendingUploads` ledger, deletes the entries whose lease is over,
 * and returns the paths the live ones hold.
 *
 * Runs before the references are read. The rules refuse an image path with
 * no entry inside the same lease (`imageLeased` in `firestore.rules.prod`), so
 * a document write that arrives after its entry expired is refused, and one
 * that arrived before is among the references -- no write can land on a file
 * this run then deletes.
 *
 * An entry with no readable `createdAt` counts as expired: the rules stamp it
 * with the server's time, and an entry nobody can date must not hold a file
 * forever.
 *
 * @param {Date} now The time the sweep treats as now
 * @param {number} maxDeletes Expired entries one run may delete
 * @return {Promise<object>} The live paths, and how many entries expired
 */
async function pendingUploads(
  now: Date,
  maxDeletes: number
): Promise<{held: Set<string>; expired: number}> {
  const db = getFirestore();
  const entries = await db.collectionGroup("pendingUploads").get();

  const held = new Set<string>();
  const expired: DocumentReference[] = [];
  entries.docs.forEach((entry) => {
    const createdAt = entry.get("createdAt") as Timestamp | undefined;
    const age = createdAt?.toMillis ? now.getTime() - createdAt.toMillis() : Infinity;
    const path = entry.get("path");
    if (age < PENDING_LEASE_MS && typeof path === "string") held.add(path);
    else if (expired.length < maxDeletes) expired.push(entry.ref);
  });

  // Firestore commits at most 500 writes in one batch.
  for (let i = 0; i < expired.length; i += 500) {
    const batch = db.batch();
    expired.slice(i, i + 500).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return {held, expired: expired.length};
}

/**
 * The path of every image a document points at: each NPC's and location's
 * `image`, each campaign's `banner`, and each group's `crest`.
 *
 * Reads every NPC and location rather than querying `image != null`: a filter
 * on a collection group needs a collection-group index, which Firestore does
 * not keep by default, and a missing one would fail the sweep in production
 * only. `select` keeps each read to the one field.
 *
 * @return {Promise<Set<string>>} The referenced object paths
 */
async function referencedPaths(): Promise<Set<string>> {
  const db = getFirestore();
  const [npcs, locations, campaigns, groups] = await Promise.all([
    db.collectionGroup("npcs").select("image").get(),
    db.collectionGroup("locations").select("image").get(),
    db.collectionGroup("campaigns").select("banner").get(),
    db.collection("groups").select("crest").get(),
  ]);

  const paths = new Set<string>();
  const add = (value: unknown) => {
    const path = (value as {path?: unknown} | null | undefined)?.path;
    if (typeof path === "string") paths.add(path);
  };
  npcs.docs.forEach((doc) => add(doc.get("image")));
  locations.docs.forEach((doc) => add(doc.get("image")));
  campaigns.docs.forEach((doc) => add(doc.get("banner")));
  groups.docs.forEach((doc) => add(doc.get("crest")));
  return paths;
}

/**
 * Whether a file is at least a day old.
 *
 * @param {object} file A bucket file
 * @param {Date} now The time the sweep treats as now
 * @return {boolean} False when the age is unknown
 */
function isOldEnough(
  file: {metadata: {timeCreated?: unknown}},
  now: Date
): boolean {
  const created = Date.parse(String(file.metadata.timeCreated ?? ""));
  // No creation time means the age is unknown: keep it.
  return Number.isFinite(created) && now.getTime() - created >= MIN_AGE_MS;
}

/**
 * Lists the files under `prefix` a page at a time, handing each page to
 * `visit` until it returns false or the listing ends.
 *
 * @param {string} prefix The object path prefix
 * @param {number} pageSize Files per request
 * @param {Function} visit Called with each page; false stops the listing
 * @return {Promise<boolean>} False if `visit` stopped it early
 */
async function forEachPage(
  prefix: string,
  pageSize: number,
  visit: (files: File[]) => boolean
): Promise<boolean> {
  let query: GetFilesOptions | undefined = {
    prefix,
    maxResults: pageSize,
    autoPaginate: false,
  };
  while (query) {
    const [files, next] = await imageBucket().getFiles(query);
    if (!visit(files)) return false;
    query = next as GetFilesOptions | undefined;
  }
  return true;
}

/**
 * The FULL sweep, run monthly (T084): deletes image files that no document
 * references and that are over a day old, and bug-report screenshots over a
 * day old. It reads every image-bearing document and lists the whole bucket;
 * the daily run reads only the ledgers (`sweepReleasedImages`), and this one
 * finds what they never recorded: files from before the ledgers, and the
 * leftovers of a write from a frontend that did not record them.
 *
 * Image writes are ordered so a failure can leave a file without a document,
 * never a document without its file (`shared/hooks/useImageAttachment.ts` in
 * the web app). This removes those leftovers: an upload whose document write
 * failed, the old file of a replace, the file of a removed image or a deleted
 * NPC or location whose follow-up delete failed.
 *
 * The references are read before the files are listed. A file uploaded in
 * between is under a day old, so the age guard keeps it. An older file is
 * kept while a live `pendingUploads` entry names it: its document write may
 * still be queued in an offline tab (T084).
 *
 * The work is bounded by `limits`: the bucket is listed a page at a time, the
 * listing stops once the run has found as many orphans as it may delete, and
 * those are deleted a few at a time.
 *
 * @param {Date} now The time the sweep treats as now
 * @param {Partial<SweepLimits>} limits Overrides for the run's bounds
 * @return {Promise<SweepResult>} What was checked and deleted
 */
export async function sweepOrphanedImages(
  now: Date = new Date(),
  limits: Partial<SweepLimits> = {}
): Promise<SweepResult> {
  const {pageSize, maxDeletes, concurrency} = {...DEFAULT_LIMITS, ...limits};
  // The ledger first: see `pendingUploads`.
  const pending = await pendingUploads(now, maxDeletes);
  const referenced = await referencedPaths();

  let checked = 0;
  const orphans: File[] = [];
  /**
   * Collect a page's orphans, up to the budget.
   *
   * @param {RegExp} layout The paths this listing may judge
   * @param {boolean} needsReference Whether a reference keeps a file
   * @return {Function} The page visitor
   */
  const collect = (layout: RegExp, needsReference: boolean) =>
    (files: File[]): boolean => {
      for (const file of files) {
        if (!layout.test(file.name)) continue;
        checked += 1;
        const kept = needsReference &&
          (referenced.has(file.name) || pending.held.has(file.name));
        if (!kept && isOldEnough(file, now)) {
          orphans.push(file);
          if (orphans.length >= maxDeletes) return false;
        }
      }
      return true;
    };

  const listedAll =
    (await forEachPage("groups/", pageSize, collect(IMAGE_PATH, true))) &&
    (await forEachPage("support/", pageSize, collect(SUPPORT_PATH, false)));

  const outcomes = await deleteWithin(orphans, concurrency);

  const result: SweepResult = {
    checked,
    deleted: [],
    failed: [],
    more: !listedAll,
    expiredUploads: pending.expired,
  };
  outcomes.forEach((outcome, i) => {
    const path = orphans[i].name;
    if (!outcome.failed) {
      result.deleted.push(path);
    } else {
      result.failed.push(path);
      console.error(`Could not delete orphaned image ${path}:`, outcome.reason);
    }
  });
  return result;
}

/** The time zone the sweep is scheduled in, and its month is counted in. */
const SWEEP_TIME_ZONE = "Europe/Copenhagen";

/**
 * Whether `now` falls on the first day of a month where the sweep runs: the
 * day the full sweep runs too.
 *
 * @param {Date} now The time of the run
 * @return {boolean} True on the 1st
 */
export function isFullSweepDay(now: Date): boolean {
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    timeZone: SWEEP_TIME_ZONE,
  }).format(now);
  return day === "1";
}

/**
 * Runs once a day, at night in Europe, when nobody is uploading: the ledger
 * sweep every day, and on the 1st of the month the full sweep after it.
 */
export const sweepOrphanedImagesDaily = onSchedule(
  {
    schedule: "every day 04:00",
    timeZone: SWEEP_TIME_ZONE,
    region: "europe-west1",
  },
  async () => {
    const now = new Date();
    const ledger = await sweepReleasedImages(now);
    console.log(
      `Image ledger sweep: judged ${ledger.checked}, ` +
        `deleted ${ledger.deleted.length}, failed ${ledger.failed.length}, ` +
        `entries cleared ${ledger.cleared}` +
        (ledger.more ? "; stopped at its budget, the rest is tomorrow's." : ".")
    );
    if (!isFullSweepDay(now)) return;

    const full = await sweepOrphanedImages(now);
    console.log(
      `Full orphaned image sweep: checked ${full.checked}, ` +
        `deleted ${full.deleted.length}, failed ${full.failed.length}, ` +
        `expired uploads ${full.expiredUploads}` +
        (full.more ? "; stopped at its budget, the rest is next month's." : ".")
    );
  }
);
