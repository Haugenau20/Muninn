// functions/src/extractionAllowance.ts
//
// How many smart detections one person may run (T137). The policy lives in
// `users/{uid}.extractionAllowance`, apart from the counters the extraction
// transaction rewrites (`entityExtractionUsage`). Only the server writes
// either: the profile's update rule is an allowlist that names neither
// (`firestore.rules.prod`). The operator page sets the allowance; in an
// emergency, the maintainer edits it in the console.

import {DocumentData, Timestamp} from "firebase-admin/firestore";

/** The three windows a person's calls are counted in. */
export type UsagePeriod = "daily" | "weekly" | "monthly";

/** A number of calls for each period. */
export type PeriodLimits = Record<UsagePeriod, number>;

/** The periods, in the order they are checked. */
export const USAGE_PERIODS: readonly UsagePeriod[] =
  ["daily", "weekly", "monthly"];

/**
 * Each person's allowance unless raised (T129, maintainer 2026-10-08), across
 * all their groups. The project-wide ceiling is the OpenAI account itself:
 * prepaid, with no automatic top-up.
 */
export const DEFAULT_USAGE_LIMITS: Readonly<PeriodLimits> = {
  daily: 3,
  weekly: 5,
  monthly: 10,
};

/** One person's allowance, as stored on their profile. */
export interface ExtractionAllowance {
  /** No limits at all. */
  unlimited: boolean;
  /** The limits that replace the defaults; null when unlimited. */
  limits: PeriodLimits | null;
  /** When the allowance stops applying; null for until it is changed. */
  expiresAt: Timestamp | null;
  /** When it was last set. */
  setAt: Timestamp;
}

/** The limits a person's calls are held to right now. */
export interface EffectiveLimits {
  /** No limits at all. */
  unlimited: boolean;
  /** The limits; the defaults when unlimited, for display only. */
  limits: PeriodLimits;
  /** When the allowance that set these runs out, if it does. */
  raisedUntil: Date | null;
}

/**
 * A Firestore timestamp, recognised by shape: a copy of the SDK loaded twice
 * would fail `instanceof`.
 *
 * @param {unknown} value Anything
 * @return {boolean} Whether it is a timestamp
 */
function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === "object" && value !== null &&
    typeof (value as Timestamp).toMillis === "function";
}

/**
 * Whether `value` is a usable limit: a whole number of calls, 0 or more.
 *
 * @param {unknown} value Anything
 * @return {boolean} Whether it is a limit
 */
function isLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The stored allowance, if it is well formed. One that is not, from a slip in
 * the console, is ignored rather than guessed at: it grants nothing.
 *
 * @param {unknown} value `extractionAllowance` as stored
 * @return {ExtractionAllowance | undefined} The allowance, or nothing
 */
export function readAllowance(value: unknown): ExtractionAllowance | undefined {
  if (value === undefined || value === null) return undefined;
  const allowance = value as Partial<ExtractionAllowance>;
  const expiresAt = allowance.expiresAt ?? null;
  const wellFormed =
    typeof allowance === "object" &&
    typeof allowance.unlimited === "boolean" &&
    (expiresAt === null || isTimestamp(expiresAt)) &&
    (allowance.unlimited ||
      (typeof allowance.limits === "object" && allowance.limits !== null &&
        USAGE_PERIODS.every((period) => isLimit(allowance.limits?.[period]))));
  if (!wellFormed) {
    console.warn(
      "Ignoring a malformed extractionAllowance; the defaults apply."
    );
    return undefined;
  }
  return allowance as ExtractionAllowance;
}

/**
 * The limits that apply to a person now: their allowance while it has not
 * expired, otherwise the defaults. The fields that came before the allowance,
 * `entityExtractionUsage.isUnlimited` and `customLimit`, are no longer read
 * (T137 step 7, once no profile in production carried them).
 *
 * @param {DocumentData | undefined} profile `users/{uid}`, if it exists
 * @param {Date} now The moment to decide for
 * @return {EffectiveLimits} The limits in force
 */
export function effectiveLimits(
  profile: DocumentData | undefined,
  now: Date
): EffectiveLimits {
  const allowance = readAllowance(profile?.extractionAllowance);
  if (allowance && (allowance.expiresAt === null ||
      allowance.expiresAt.toMillis() > now.getTime())) {
    return {
      unlimited: allowance.unlimited,
      limits: allowance.unlimited || !allowance.limits ?
        {...DEFAULT_USAGE_LIMITS} :
        {...allowance.limits},
      raisedUntil: allowance.expiresAt?.toDate() ?? null,
    };
  }
  return {unlimited: false, limits: {...DEFAULT_USAGE_LIMITS}, raisedUntil: null};
}
