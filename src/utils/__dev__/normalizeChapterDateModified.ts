// src/utils/__dev__/normalizeChapterDateModified.ts
//
// ============================================================================
// OPERATOR TOOLING — NOT PART OF THE APPLICATION RUNTIME
// ============================================================================
// This is a one-off data-repair script for bug #1202 (chapter reorder wrote
// `dateModified` as a Date, which Firestore stores as a Timestamp).
//
// It is meant to be run DELIBERATELY BY A HUMAN OPERATOR against production
// Firestore, and ONLY after taking a Firestore export/backup
// (`firebase firestore:export` or the console's "Export data" action). It is
// not wired into any npm script, CI job, or scheduled task, and it must never
// be invoked automatically.
//
// Background: the chapter-reorder path in StoryContext used to write
// `dateModified: new Date()` (a JS Date object) instead of
// `new Date().toISOString()` (a string), so the Firebase SDK stored it as a
// Firestore Timestamp. `ContentAttribution.dateModified` is typed `string`,
// and `formatAttributionDate` (src/shared/utils/attribution-utils.ts) calls
// `new Date(dateString)` on it — handed a Timestamp object instead of a
// string, that produces `Invalid Date`, and the function silently returns
// `''`. The code path is fixed; documents written before the fix are not.
// This script finds and repairs those documents.
//
// Design constraints (do not relax these without re-reading the bug ticket
// and the code review that produced them):
//   - Uses the ordinary client SDK (`firebase/firestore`, `firebase/auth`),
//     NOT `firebase-admin`. Do not add `firebase-admin` to package.json and
//     do not introduce a service-account key. The script signs in as a real
//     user and is bound by the production security rules like any client.
//   - Must be run signed in as a GROUP ADMIN (or global admin). The
//     production rule for content updates is:
//       allow update: if isGroupMember(groupId) &&
//         (resource.data.createdBy == request.auth.uid || isGroupAdmin(groupId) || isGlobalAdmin());
//     A plain member can only repair chapters they personally created; a
//     group admin can repair every chapter in groups they administer.
//   - Deliberately does NOT use a `collectionGroup('chapters')` query. The
//     rules are path-scoped (`match /groups/{groupId}/{collection}/{docId}/{nestedCollection}/{nestedDocId}`)
//     with no `match /{path=**}/chapters/{chapterId}` rule, so a collection
//     group query would be denied in production (and would need a separate
//     composite index besides). Instead this script enumerates explicitly:
//     the user's group profiles (T136) -> `groups/{groupId}/campaigns` ->
//     `groups/{groupId}/campaigns/{campaignId}/chapters`, mirroring the path
//     shape `DocumentService.getCollectionRef` builds
//     (src/core/services/firebase/data/DocumentService.ts).
//
// Usage (see the bottom of this file / project docs for the exact commands):
//   npx ts-node ./src/utils/__dev__/normalizeChapterDateModified.ts audit
//   npx ts-node ./src/utils/__dev__/normalizeChapterDateModified.ts migrate --confirm
//   npx ts-node ./src/utils/__dev__/normalizeChapterDateModified.ts revert --journal=<path> --confirm
//
// Required environment variables (never hardcode these, never commit a file
// containing them):
//   REACT_APP_API_KEY, REACT_APP_AUTH_DOMAIN, REACT_APP_PROJECT_ID,
//     REACT_APP_STORAGE_BUCKET, REACT_APP_MESSAGING_SENDER_ID, REACT_APP_APP_ID
//     — the same Firebase project config the app itself reads
//     (core/services/firebase/config/firebaseConfig.ts). Point these at
//     PRODUCTION, e.g. by copying `.env.production` to `.env` the same way
//     `scripts/manage-dev-data.ps1` copies `.env.development` for the
//     emulator equivalent of this script.
// Credentials are PROMPTED FOR INTERACTIVELY when the script runs — you are
// asked for an email and then a password, and the password is not echoed to
// the terminal as you type it. Use a real user account that is a group admin
// (or global admin) in the group(s) whose chapters need repair. `audit` only
// reads, so any group member can run it; only `migrate` needs admin rights,
// because the production rule for content updates is
// `createdBy == request.auth.uid || isGroupAdmin(groupId) || isGlobalAdmin()`.
//
// Credentials are never written to disk by this script, and the journal file
// records only {path, oldValue, newValue} — never credentials.
//
// CHAPTER_NORMALIZE_ADMIN_EMAIL / CHAPTER_NORMALIZE_ADMIN_PASSWORD are still
// honoured if set, so the script stays usable non-interactively (CI, a wrapper
// script, a pipe). Prefer the prompts when running by hand: a password passed
// through the environment is visible to `Get-ChildItem env:`, is inherited by
// child processes, and tends to end up in shell history.
//
// This script deliberately never calls connectFirestoreEmulator /
// connectAuthEmulator — it always targets whatever project the REACT_APP_*
// env vars resolve to, and prints that project id before doing anything
// destructive so the operator can visually confirm it before continuing.
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, collectionGroup, doc, getDocs, query, updateDoc, where, Timestamp, Firestore } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { firebaseConfig } from "../../core/services/firebase/config/firebaseConfig";

dotenv.config();

// ----------------------------------------------------------------------------
// Pure logic — no Firestore, no filesystem, no network. Everything in this
// section is exported so it can be unit-tested directly
// (see __tests__/normalizeChapterDateModified.test.ts).
// ----------------------------------------------------------------------------

/** The four buckets the audit's field-type histogram reports. */
export interface FieldHistogram {
  string: number;
  timestamp: number;
  other: number;
  absent: number;
}

/** A Firestore Timestamp instance, as read back by the client SDK. */
interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
}

/**
 * True if `value` has the shape of a Firestore Timestamp: numeric `seconds`
 * and `nanoseconds`. Covers both a real `Timestamp` instance (which also
 * exposes `.toDate()`) and the plain `{seconds, nanoseconds}` object shape
 * that can arrive depending on how the document was written/serialized.
 */
export function isTimestampLike(value: unknown): value is TimestampLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).seconds === "number" &&
    typeof (value as Record<string, unknown>).nanoseconds === "number"
  );
}

/**
 * Classifies a stored date-ish field into one of four buckets for the audit
 * histogram: `string` (the correct shape), `timestamp` (a Firestore
 * Timestamp or the equivalent `{seconds, nanoseconds}` object — the known
 * corruption this script repairs), `absent` (field never set — not
 * corruption, just no value yet), or `other` (anything else; reported, never
 * guessed at).
 */
export function classifyDateFieldType(value: unknown): keyof FieldHistogram {
  if (value === undefined || value === null) return "absent";
  if (typeof value === "string") return "string";
  if (isTimestampLike(value)) return "timestamp";
  return "other";
}

/** Tallies `classifyDateFieldType` across a batch of raw field values. */
export function computeFieldHistogram(values: unknown[]): FieldHistogram {
  const histogram: FieldHistogram = { string: 0, timestamp: 0, other: 0, absent: 0 };
  for (const value of values) {
    histogram[classifyDateFieldType(value)] += 1;
  }
  return histogram;
}

/**
 * Predicate: does this stored `dateModified` value need repair?
 *
 * The rule is deliberately simple — "the field is present and is not a
 * string" — because that is exactly what distinguishes a document written by
 * the pre-fix reorder path (a Timestamp) from every other write path (an ISO
 * string). It is NOT "is this a valid ISO string": a string is left alone
 * unconditionally, valid or not, because no known write path has ever stored
 * anything but a Timestamp-shaped value for this corruption — guessing a
 * repair for a malformed string would be inventing a new kind of fix for a
 * problem nobody has diagnosed (see the bug tracker's note on retracted
 * entries filed from code-reading alone; the same discipline applies here).
 *
 * IDEMPOTENCE: after a successful repair the stored value is a string (see
 * `convertDateFieldToIsoString`), so this predicate returns `false` for it on
 * every subsequent evaluation. A second `migrate` pass over an
 * already-repaired document therefore always finds `needsDateModifiedRepair`
 * false and performs no write — migrate is safe to re-run.
 */
export function needsDateModifiedRepair(value: unknown): boolean {
  if (value === undefined || value === null) return false; // absent is not corrupt
  return typeof value !== "string";
}

/** Result of attempting to convert a corrupt `dateModified` value to ISO. */
export type DateFieldConversionResult =
  | { ok: true; isoString: string }
  | { ok: false; reason: string };

/**
 * Converts a value that `needsDateModifiedRepair` flagged into an ISO 8601
 * string. Handles the two shapes that actually occur (a real `Timestamp`
 * with `.toDate()`, and the plain `{seconds, nanoseconds}` object). Anything
 * else is refused rather than guessed at, per the "never guess a date"
 * requirement — the caller is expected to skip and report the item loudly.
 */
export function convertDateFieldToIsoString(value: unknown): DateFieldConversionResult {
  if (!isTimestampLike(value)) {
    return {
      ok: false,
      reason: `Unrecognized dateModified shape (not a string, not Timestamp-like): ${describeUnknownValue(value)}`,
    };
  }

  const date =
    typeof value.toDate === "function"
      ? value.toDate()
      : new Date(value.seconds * 1000 + Math.round(value.nanoseconds / 1_000_000));

  if (Number.isNaN(date.getTime())) {
    return { ok: false, reason: `Timestamp-like value produced an invalid Date: ${describeUnknownValue(value)}` };
  }

  return { ok: true, isoString: date.toISOString() };
}

function describeUnknownValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** A chapter document reduced to just what the repair logic needs. */
export interface ChapterRecord {
  /** Full Firestore document path, e.g. groups/g1/campaigns/c1/chapters/chapter-01 */
  path: string;
  dateModified: unknown;
}

export interface RepairPlanItem {
  path: string;
  /** Raw value exactly as read from Firestore (a Timestamp-like object). */
  oldValue: unknown;
  newValueIso: string;
}

export interface UnrecognizedItem {
  path: string;
  description: string;
}

export interface RepairPlan {
  toRepair: RepairPlanItem[];
  unrecognized: UnrecognizedItem[];
}

/**
 * Pure planning step: given already-fetched chapter records, decides which
 * need repair and what their new value should be. Contains no Firestore
 * calls, so `migrate` and `audit` can share it and it can be exercised in
 * unit tests with fabricated records.
 */
export function planChapterDateModifiedRepairs(chapters: ChapterRecord[]): RepairPlan {
  const toRepair: RepairPlanItem[] = [];
  const unrecognized: UnrecognizedItem[] = [];

  for (const chapter of chapters) {
    if (!needsDateModifiedRepair(chapter.dateModified)) continue;

    const conversion = convertDateFieldToIsoString(chapter.dateModified);
    if (conversion.ok) {
      toRepair.push({ path: chapter.path, oldValue: chapter.dateModified, newValueIso: conversion.isoString });
    } else {
      unrecognized.push({ path: chapter.path, description: conversion.reason });
    }
  }

  return { toRepair, unrecognized };
}

/** The report `audit` mode produces and writes to disk. */
export interface AuditReport {
  totalChaptersScanned: number;
  needingRepairCount: number;
  affectedPaths: string[];
  unrecognized: UnrecognizedItem[];
  histograms: {
    /** dateModified is the field this script repairs. */
    dateModified: FieldHistogram;
    /**
     * dateAdded is measured but never repaired by this script: no known
     * write path has ever produced anything but an ISO string for it, so
     * "fixing" it would be a speculative change based on a code-reading, not
     * a diagnosed bug. This measurement exists to turn that suspicion into a
     * number, per the project's own lesson about filing bugs from
     * code-reading alone.
     */
    dateAdded: FieldHistogram;
    /**
     * `chapters/types.ts` declares `StoryProgress.lastRead` and
     * `ChapterProgress.lastRead` as `Date`, but they round-trip through
     * Firestore as Timestamps the same way `dateModified` used to. Measured
     * here for the same reason as dateAdded — no bug filed, just a number.
     */
    storyProgressLastRead: FieldHistogram;
    chapterProgressLastRead: FieldHistogram;
  };
}

export interface StoryProgressRecord {
  path: string;
  lastRead: unknown;
  /** Raw chapterProgress map, keyed by chapter id, each entry may have lastRead. */
  chapterProgress?: unknown;
}

function collectChapterProgressLastReadValues(records: StoryProgressRecord[]): unknown[] {
  const values: unknown[] = [];
  for (const record of records) {
    const cp = record.chapterProgress;
    if (cp && typeof cp === "object") {
      for (const entry of Object.values(cp as Record<string, unknown>)) {
        if (entry && typeof entry === "object") {
          values.push((entry as Record<string, unknown>).lastRead);
        } else {
          values.push(undefined);
        }
      }
    }
  }
  return values;
}

/**
 * Builds the full audit report from already-fetched raw records. Pure —
 * no I/O — so it is the function unit tests exercise directly.
 */
export function buildAuditReport(
  chapters: Array<{ path: string; dateModified: unknown; dateAdded: unknown }>,
  storyProgress: StoryProgressRecord[] = []
): AuditReport {
  const plan = planChapterDateModifiedRepairs(
    chapters.map((c) => ({ path: c.path, dateModified: c.dateModified }))
  );

  return {
    totalChaptersScanned: chapters.length,
    needingRepairCount: plan.toRepair.length,
    affectedPaths: plan.toRepair.map((item) => item.path),
    unrecognized: plan.unrecognized,
    histograms: {
      dateModified: computeFieldHistogram(chapters.map((c) => c.dateModified)),
      dateAdded: computeFieldHistogram(chapters.map((c) => c.dateAdded)),
      storyProgressLastRead: computeFieldHistogram(storyProgress.map((s) => s.lastRead)),
      chapterProgressLastRead: computeFieldHistogram(collectChapterProgressLastReadValues(storyProgress)),
    },
  };
}

/** The shape persisted to the journal file, one JSON object per line (ndjson). */
export interface JournalEntry {
  path: string;
  field: "dateModified";
  oldValue: SerializedTimestamp;
  newValue: string;
  /** When this journal line was written, for operator visibility only. */
  recordedAt: string;
}

export interface SerializedTimestamp {
  __type: "timestamp";
  seconds: number;
  nanoseconds: number;
}

/**
 * Converts a raw Timestamp-like value into a JSON-safe shape for the journal
 * file. Returns `null` if `value` isn't actually Timestamp-like (should not
 * happen given `planChapterDateModifiedRepairs` only ever plans repairs for
 * such values, but checked explicitly rather than assumed).
 */
export function serializeTimestampLike(value: unknown): SerializedTimestamp | null {
  if (!isTimestampLike(value)) return null;
  return { __type: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
}

/**
 * The inverse of `serializeTimestampLike`: recovers `{seconds, nanoseconds}`
 * from a journal entry's `oldValue`. Returns `null` (never guesses) if the
 * shape doesn't match — e.g. a hand-edited or corrupted journal file.
 */
export function deserializeTimestampLike(value: unknown): { seconds: number; nanoseconds: number } | null {
  if (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).__type === "timestamp" &&
    typeof (value as Record<string, unknown>).seconds === "number" &&
    typeof (value as Record<string, unknown>).nanoseconds === "number"
  ) {
    const v = value as Record<string, unknown>;
    return { seconds: v.seconds as number, nanoseconds: v.nanoseconds as number };
  }
  return null;
}

/**
 * Builds the journal entry for one planned repair. Returns `null` (and never
 * writes) if the old value can't be serialized as a Timestamp — defensive
 * only, since `planChapterDateModifiedRepairs` should never hand this
 * function anything else.
 */
export function buildJournalEntry(item: RepairPlanItem, now: Date = new Date()): JournalEntry | null {
  const oldValue = serializeTimestampLike(item.oldValue);
  if (!oldValue) return null;
  return {
    path: item.path,
    field: "dateModified",
    oldValue,
    newValue: item.newValueIso,
    recordedAt: now.toISOString(),
  };
}

/** Parses one line of an ndjson journal file. Returns `null` on bad JSON. */
export function parseJournalLine(line: string): JournalEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as JournalEntry;
  } catch {
    return null;
  }
}

/** CLI mode names this script accepts. */
export type ScriptMode = "audit" | "migrate" | "revert";

export interface ParsedArgs {
  mode: ScriptMode | null;
  confirm: boolean;
  journalPath: string | null;
  outPath: string | null;
}

/**
 * Parses `process.argv.slice(2)`-style args. Pure — exported for unit
 * testing of the CLI contract without spawning a process.
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
  const validModes: ScriptMode[] = ["audit", "migrate", "revert"];
  const rawMode = argv[0];
  const mode = (validModes as string[]).includes(rawMode) ? (rawMode as ScriptMode) : null;

  const parsed: ParsedArgs = {
    mode,
    confirm: argv.includes("--confirm"),
    journalPath: null,
    outPath: null,
  };

  for (const arg of argv.slice(1)) {
    if (arg.startsWith("--journal=")) parsed.journalPath = arg.slice("--journal=".length);
    if (arg.startsWith("--out=")) parsed.outPath = arg.slice("--out=".length);
  }

  return parsed;
}

function timestampForFilename(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

// ----------------------------------------------------------------------------
// Firestore-touching orchestration below this line. Everything above is pure
// and covered by unit tests; everything below is thin glue that cannot be
// exercised without a real (or emulated) Firestore, and is therefore NOT
// covered by this project's automated test suite. Read it carefully before
// running it against production.
// ----------------------------------------------------------------------------

interface FetchedChapter {
  path: string;
  dateModified: unknown;
  dateAdded: unknown;
}

interface FetchedStoryProgress {
  path: string;
  lastRead: unknown;
  chapterProgress: unknown;
}

interface WalkResult {
  chapters: FetchedChapter[];
  storyProgress: FetchedStoryProgress[];
  warnings: string[];
}

/**
 * Enumerates every chapter (and, incidentally, every story-progress document)
 * reachable from the signed-in user's own group memberships:
 *   the user's group profiles -> groups/{groupId}/campaigns -> .../chapters
 * Deliberately NOT a collectionGroup('chapters') query — see the file header
 * comment for why that would be denied in production.
 */
async function walkReachableChapters(db: Firestore, uid: string): Promise<WalkResult> {
  const chapters: FetchedChapter[] = [];
  const storyProgress: FetchedStoryProgress[] = [];
  const warnings: string[] = [];

  // The groups are those holding a group profile of the user, the one record
  // of membership (T136); the rules let a user list their own.
  const profiles = await getDocs(query(collectionGroup(db, "users"), where("userId", "==", uid)));
  const groupIds = profiles.docs
    .map((profile) => profile.ref.parent.parent?.id)
    .filter((groupId): groupId is string => Boolean(groupId));

  if (groupIds.length === 0) {
    warnings.push(`${uid} has no group profile — nothing to scan`);
  }

  for (const groupId of groupIds) {
    let campaignsSnap;
    try {
      campaignsSnap = await getDocs(collection(db, "groups", groupId, "campaigns"));
    } catch (error) {
      warnings.push(`Could not list groups/${groupId}/campaigns: ${(error as Error).message}`);
      continue;
    }

    for (const campaignDoc of campaignsSnap.docs) {
      const campaignId = campaignDoc.id;

      try {
        const chaptersSnap = await getDocs(
          collection(db, "groups", groupId, "campaigns", campaignId, "chapters")
        );
        for (const chapterDoc of chaptersSnap.docs) {
          const data = chapterDoc.data();
          chapters.push({
            path: chapterDoc.ref.path,
            dateModified: data.dateModified,
            dateAdded: data.dateAdded,
          });
        }
      } catch (error) {
        warnings.push(
          `Could not list groups/${groupId}/campaigns/${campaignId}/chapters: ${(error as Error).message}`
        );
      }

      // Free measurement (see AuditReport.histograms docs): read on the same
      // walk, same collection level as chapters. Never fixed, only measured.
      try {
        const progressSnap = await getDocs(
          collection(db, "groups", groupId, "campaigns", campaignId, "story-progress")
        );
        for (const progressDoc of progressSnap.docs) {
          const data = progressDoc.data();
          storyProgress.push({
            path: progressDoc.ref.path,
            lastRead: data.lastRead,
            chapterProgress: data.chapterProgress,
          });
        }
      } catch (error) {
        warnings.push(
          `Could not list groups/${groupId}/campaigns/${campaignId}/story-progress: ${(error as Error).message}`
        );
      }
    }
  }

  return { chapters, storyProgress, warnings };
}

function requireProjectId(): string {
  const projectId = firebaseConfig.projectId;
  if (!projectId) {
    throw new Error(
      "REACT_APP_PROJECT_ID (or the fallback in core/services/firebase/config/firebaseConfig.ts) is empty."
    );
  }
  return projectId;
}

function refuseWithoutConfirmation(mode: ScriptMode): never {
  console.error(
    `Refusing to run '${mode}' without --confirm.\n` +
      `This mode writes to Firestore. Re-run with --confirm once you have:\n` +
      `  1. Taken a Firestore export/backup of the project.\n` +
      `  2. Verified REACT_APP_PROJECT_ID resolves to the project you intend to change.\n` +
      `  3. Verified the account you will sign in as is a group admin\n` +
      `     or global admin for the group(s) whose chapters need repair.\n`
  );
  process.exit(1);
}

async function runAudit(db: Firestore, uid: string, outPath: string | null): Promise<void> {
  console.log(`Auditing chapters reachable from users/${uid} on project '${requireProjectId()}'...`);

  const { chapters, storyProgress, warnings } = await walkReachableChapters(db, uid);
  const report = buildAuditReport(chapters, storyProgress);

  warnings.forEach((w) => console.warn(`WARNING: ${w}`));

  console.log(`Chapters scanned: ${report.totalChaptersScanned}`);
  console.log(`Chapters needing dateModified repair: ${report.needingRepairCount}`);
  if (report.affectedPaths.length > 0) {
    console.log("Affected document paths:");
    report.affectedPaths.forEach((p) => console.log(`  - ${p}`));
  }
  if (report.unrecognized.length > 0) {
    console.log("Unrecognized values (skipped, NOT repaired, needs manual look):");
    report.unrecognized.forEach((u) => console.log(`  - ${u.path}: ${u.description}`));
  }
  console.log("Field-type histograms:", JSON.stringify(report.histograms, null, 2));

  const resolvedOutPath = outPath ?? path.join(process.cwd(), `chapter-dateModified-audit-${timestampForFilename()}.json`);
  fs.writeFileSync(resolvedOutPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Full audit report written to: ${resolvedOutPath}`);
}

async function runMigrate(db: Firestore, uid: string, journalPath: string | null): Promise<void> {
  console.log(`Migrating chapters reachable from users/${uid} on project '${requireProjectId()}'...`);

  const { chapters, warnings } = await walkReachableChapters(db, uid);
  warnings.forEach((w) => console.warn(`WARNING: ${w}`));

  const plan = planChapterDateModifiedRepairs(chapters.map((c) => ({ path: c.path, dateModified: c.dateModified })));

  if (plan.unrecognized.length > 0) {
    console.log("Unrecognized values (skipped, NOT repaired, needs manual look):");
    plan.unrecognized.forEach((u) => console.log(`  - ${u.path}: ${u.description}`));
  }

  if (plan.toRepair.length === 0) {
    console.log("Nothing to repair. (If this is unexpected, run 'audit' first and inspect its report.)");
    return;
  }

  const resolvedJournalPath =
    journalPath ?? path.join(process.cwd(), `chapter-dateModified-journal-${timestampForFilename()}.ndjson`);
  console.log(`Journal file: ${resolvedJournalPath}`);

  let repaired = 0;
  let failed = 0;

  for (const item of plan.toRepair) {
    const entry = buildJournalEntry(item);
    if (!entry) {
      // Defensive only: planChapterDateModifiedRepairs should never produce
      // a non-Timestamp-like oldValue here.
      console.error(`Could not serialize old value for ${item.path}; skipping without writing.`);
      failed += 1;
      continue;
    }

    // Journal is appended BEFORE the write. If the process dies between this
    // append and the updateDoc below, the journal records an "intended"
    // change that never actually happened — replaying it with 'revert' is
    // still safe, because writing oldValue back onto a document that was
    // never touched is a no-op (the document already holds oldValue).
    fs.appendFileSync(resolvedJournalPath, JSON.stringify(entry) + "\n", "utf8");

    try {
      await updateDoc(doc(db, item.path), { dateModified: item.newValueIso });
      console.log(`Repaired ${item.path}`);
      repaired += 1;
    } catch (error) {
      console.error(`Failed to update ${item.path}: ${(error as Error).message}`);
      failed += 1;
    }
  }

  console.log(`Done. Repaired: ${repaired}. Failed: ${failed}. Unrecognized/skipped: ${plan.unrecognized.length}.`);
  console.log(`To undo this run: npx ts-node ./src/utils/__dev__/normalizeChapterDateModified.ts revert --journal=${resolvedJournalPath} --confirm`);
}

async function runRevert(db: Firestore, journalPath: string | null): Promise<void> {
  if (!journalPath) {
    console.error("revert requires --journal=<path to a journal file written by a previous 'migrate' run>.");
    process.exit(1);
    return;
  }

  console.log(`Reverting from journal '${journalPath}' on project '${requireProjectId()}'...`);

  const lines = fs.readFileSync(journalPath, "utf8").split("\n");
  let restored = 0;
  let skipped = 0;

  for (const line of lines) {
    const entry = parseJournalLine(line);
    if (!entry) continue; // blank lines are expected at EOF; malformed lines are silently not a crash

    const old = deserializeTimestampLike(entry.oldValue);
    if (!old) {
      console.error(`Skipping ${entry.path}: journal oldValue is not Timestamp-shaped, refusing to guess.`);
      skipped += 1;
      continue;
    }

    try {
      const restoredTimestamp = new Timestamp(old.seconds, old.nanoseconds);
      await updateDoc(doc(db, entry.path), { [entry.field]: restoredTimestamp });
      console.log(`Restored ${entry.path}.${entry.field}`);
      restored += 1;
    } catch (error) {
      console.error(`Failed to restore ${entry.path}: ${(error as Error).message}`);
      skipped += 1;
    }
  }

  console.log(`Done. Restored: ${restored}. Skipped: ${skipped}.`);
}

/**
 * Ask a question on the terminal and resolve with the typed answer.
 *
 * @param question - Text shown to the operator, including any trailing space.
 * @returns The trimmed answer.
 */
function promptVisible(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ask for a secret without echoing it to the terminal.
 *
 * `readline` echoes every keystroke through its private `_writeToOutput` hook.
 * Replacing that hook lets the prompt itself print normally while the typed
 * characters are swallowed — nothing is shown, not even asterisks, which is
 * the same behaviour `ssh` and `sudo` use. Muting is switched on only AFTER
 * `rl.question` has synchronously written the prompt, otherwise the prompt
 * would be swallowed too.
 *
 * The answer is deliberately NOT trimmed: leading and trailing whitespace can
 * be part of a password, and silently stripping it would turn a correct
 * password into an authentication failure the operator cannot see.
 *
 * @param question - Text shown to the operator, including any trailing space.
 * @returns The password exactly as typed.
 */
function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let muted = false;
  const rlInternals = rl as unknown as {
    _writeToOutput: (text: string) => void;
    output: NodeJS.WritableStream;
  };
  const writeToOutput = rlInternals._writeToOutput.bind(rl);
  rlInternals._writeToOutput = (text: string) => {
    if (!muted) {
      writeToOutput(text);
    }
  };

  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      muted = false;
      // The newline the operator typed was swallowed with everything else, so
      // emit one to stop the next line of output landing on the prompt.
      rlInternals.output.write("\n");
      rl.close();
      resolve(answer);
    });
    // Only now: rl.question has already written the prompt text.
    muted = true;
  });
}

/**
 * Resolve the credentials to sign in with.
 *
 * Environment variables win when both are present, so the script stays usable
 * non-interactively. Otherwise the operator is prompted, with the password
 * hidden. Prompting is only possible on a TTY — piping input in without
 * setting the env vars is an error rather than a silent hang.
 */
async function resolveCredentials(): Promise<{ email: string; password: string }> {
  const envEmail = process.env.CHAPTER_NORMALIZE_ADMIN_EMAIL;
  const envPassword = process.env.CHAPTER_NORMALIZE_ADMIN_PASSWORD;

  if (envEmail && envPassword) {
    console.log(`Using credentials from the environment (${envEmail}).`);
    return { email: envEmail, password: envPassword };
  }

  if (!process.stdin.isTTY) {
    console.error(
      "No terminal available to prompt for credentials.\n" +
        "Set CHAPTER_NORMALIZE_ADMIN_EMAIL and CHAPTER_NORMALIZE_ADMIN_PASSWORD, " +
        "or run this script from an interactive terminal."
    );
    process.exit(1);
  }

  console.log(
    "Sign in with a real user account. `audit` only reads, so any group member\n" +
      "can run it; `migrate` needs a group admin. Nothing is written to disk.\n"
  );

  const email = envEmail ?? (await promptVisible("Email: "));
  const password = envPassword ?? (await promptHidden("Password: "));

  if (!email || !password) {
    console.error("Both an email and a password are required.");
    process.exit(1);
  }

  return { email, password };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.mode) {
    console.error(
      "Usage:\n" +
        "  npx ts-node ./src/utils/__dev__/normalizeChapterDateModified.ts audit\n" +
        "  npx ts-node ./src/utils/__dev__/normalizeChapterDateModified.ts migrate --confirm\n" +
        "  npx ts-node ./src/utils/__dev__/normalizeChapterDateModified.ts revert --journal=<path> --confirm\n"
    );
    process.exit(1);
    return;
  }

  if ((args.mode === "migrate" || args.mode === "revert") && !args.confirm) {
    refuseWithoutConfirmation(args.mode);
    return;
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const { email, password } = await resolveCredentials();

  const auth = getAuth(app);
  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    // Report the failure without ever echoing the password back.
    const code = (error as { code?: string }).code ?? "unknown";
    console.error(`Sign-in failed for ${email} (${code}).`);

    if (code.includes("invalid-credential") || code.includes("user-not-found") || code.includes("wrong-password")) {
      console.error(
        "\nNote: Firebase returns a deliberately vague error here (email-enumeration\n" +
          "protection), so this means one of: no such user, wrong password, or the user\n" +
          "exists but has no email/password credential.\n" +
          "\n" +
          "The most common cause is signing in with the WRONG DIRECTORY. This must be an\n" +
          "account from this project's Firebase Authentication user pool -- the same one\n" +
          "the app's own login form uses -- listed under Firebase Console > Authentication\n" +
          "> Users. The Google account you log into the Firebase CONSOLE with is a\n" +
          "different thing entirely and will not work here."
      );
    } else if (code.includes("app-check")) {
      console.error(
        "\nApp Check is enforced for Authentication on this project, and a Node script\n" +
          "cannot produce an attestation token (the app uses ReCaptchaV3, which is\n" +
          "browser-only). Temporarily disable App Check enforcement for Authentication\n" +
          "while running this, or run the pass through the Admin SDK instead."
      );
    }

    process.exit(1);
    return;
  }
  const uid = credential.user.uid;
  console.log(`Signed in as ${credential.user.email ?? uid} (uid: ${uid})`);

  switch (args.mode) {
    case "audit":
      await runAudit(db, uid, args.outPath);
      break;
    case "migrate":
      await runMigrate(db, uid, args.journalPath);
      break;
    case "revert":
      await runRevert(db, args.journalPath);
      break;
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}
