// functions/src/extractionUsage.ts
//
// Counting smart detections: each person's calls per day, week and month,
// held to the limits `effectiveLimits` decides (T137). `entityExtraction.ts`
// counts with it; the operator page shows it. It loads neither OpenAI nor the
// callables, so the operator can use it without them.

import {DocumentData} from "firebase-admin/firestore";
import {
  USAGE_PERIODS,
  UsagePeriod,
  effectiveLimits,
} from "./extractionAllowance";

export interface PeriodUsage {
  count: number;
  lastReset: string;
  limit: number;
}

/**
 * A person's usage as the client sees it: the counters, each period's `limit`
 * set to the limit in force, and whether there are limits at all.
 */
export interface EntityExtractionUsage {
  daily: PeriodUsage;
  weekly: PeriodUsage;
  monthly: PeriodUsage;
  isUnlimited: boolean;
  /** When a raised allowance runs out, if it does (ISO 8601). */
  raisedUntil?: string;
  lastExtraction?: string;
}

/** `entityExtractionUsage` as stored: any part of it may be missing. */
export type StoredUsage =
  Partial<Record<UsagePeriod, Partial<PeriodUsage>>> &
  {lastExtraction?: string};

export interface UsageStatus {
  usage: EntityExtractionUsage;
  limitExceeded: boolean;
  exceededPeriod?: UsagePeriod;
  nextReset: {
    daily: string;
    weekly: string;
    monthly: string;
  };
}

/**
 * When a period next resets: midnight UTC tomorrow, next Monday, or the
 * first of next month.
 *
 * @param {UsagePeriod} period The period
 * @return {Date} When it resets
 */
function getNextReset(period: UsagePeriod): Date {
  const resetTime = new Date();
  resetTime.setUTCHours(0, 0, 0, 0);

  switch (period) {
  case "daily":
    resetTime.setUTCDate(resetTime.getUTCDate() + 1);
    break;
  case "weekly": {
    // Reset on Monday at midnight UTC
    const daysUntilMonday = (8 - resetTime.getUTCDay()) % 7 || 7;
    resetTime.setUTCDate(resetTime.getUTCDate() + daysUntilMonday);
    break;
  }
  case "monthly":
    resetTime.setUTCDate(1);
    resetTime.setUTCMonth(resetTime.getUTCMonth() + 1);
    break;
  }

  return resetTime;
}

/**
 * Whether the window a period was last reset in has passed.
 *
 * @param {string} lastReset When it was last reset (ISO 8601)
 * @param {UsagePeriod} period The period
 * @return {boolean} Whether it is due a reset
 */
function shouldResetPeriod(lastReset: string, period: UsagePeriod): boolean {
  const lastResetDate = new Date(lastReset);
  const now = new Date();

  switch (period) {
  case "daily":
    return lastResetDate.getUTCDate() !== now.getUTCDate() ||
      lastResetDate.getUTCMonth() !== now.getUTCMonth() ||
      lastResetDate.getUTCFullYear() !== now.getUTCFullYear();
  case "weekly":
    return getWeekNumber(lastResetDate) !== getWeekNumber(now);
  case "monthly":
    return lastResetDate.getUTCMonth() !== now.getUTCMonth() ||
      lastResetDate.getUTCFullYear() !== now.getUTCFullYear();
  default:
    return false;
  }
}

/**
 * The ISO week number of a date.
 *
 * @param {Date} date The date
 * @return {number} Its week
 */
function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(
    (((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7
  );
}

/**
 * When each period next resets, as the client shows it.
 *
 * @return {object} Each period's next reset (ISO 8601)
 */
export function nextResets(): UsageStatus["nextReset"] {
  return {
    daily: getNextReset("daily").toISOString(),
    weekly: getNextReset("weekly").toISOString(),
    monthly: getNextReset("monthly").toISOString(),
  };
}

/**
 * Zero every period whose window has passed, in place.
 *
 * @param {EntityExtractionUsage} usageData The usage, changed in place
 * @param {string} now The moment of the reset (ISO 8601)
 * @return {boolean} Whether anything was reset
 */
export function resetElapsedPeriods(
  usageData: EntityExtractionUsage,
  now: string
): boolean {
  let changed = false;
  for (const period of USAGE_PERIODS) {
    if (shouldResetPeriod(usageData[period].lastReset, period)) {
      usageData[period].count = 0;
      usageData[period].lastReset = now;
      changed = true;
    }
  }
  return changed;
}

/**
 * Which period, if any, has no calls left.
 *
 * @param {EntityExtractionUsage} usageData The usage, held to its limits
 * @return {UsagePeriod | undefined} The first period spent, if one is
 */
export function exhaustedPeriod(
  usageData: EntityExtractionUsage
): UsagePeriod | undefined {
  return USAGE_PERIODS.find(
    (period) => usageData[period].count >= usageData[period].limit
  );
}

/**
 * The user's counters, or fresh ones for a user who has none, held to the
 * limits in force (`effectiveLimits`). A stored `limit` is only a copy:
 * records written before 10 / 30 / 100 became 3 / 5 / 10 still carry the
 * old numbers.
 *
 * @param {DocumentData | undefined} profile `users/{uid}`, if it exists
 * @param {Date} now The moment to decide the limits for
 * @return {EntityExtractionUsage} The usage, as the client sees it
 */
export function readUsage(
  profile: DocumentData | undefined,
  now: Date
): EntityExtractionUsage {
  const stored = profile?.entityExtractionUsage as
    StoredUsage | undefined;
  const effective = effectiveLimits(profile, now);

  const period = (name: UsagePeriod): PeriodUsage => ({
    count: stored?.[name]?.count ?? 0,
    lastReset: stored?.[name]?.lastReset ?? now.toISOString(),
    limit: effective.limits[name],
  });
  return {
    daily: period("daily"),
    weekly: period("weekly"),
    monthly: period("monthly"),
    isUnlimited: effective.unlimited,
    ...(effective.raisedUntil &&
      {raisedUntil: effective.raisedUntil.toISOString()}),
    ...(stored?.lastExtraction && {lastExtraction: stored.lastExtraction}),
  };
}

/**
 * What the extraction transaction writes back: the counters, and nothing of
 * the policy. `raisedUntil` is never stored.
 *
 * @param {EntityExtractionUsage} usageData The usage after the call
 * @return {object} The update, for `set` with `merge`
 */
export function storedCounters(usageData: EntityExtractionUsage) {
  const {daily, weekly, monthly, lastExtraction} = usageData;
  return {
    entityExtractionUsage: {
      daily, weekly, monthly, ...(lastExtraction && {lastExtraction}),
    },
  };
}

/**
 * A person's usage as it stands: elapsed periods shown reset, held to the
 * limits in force. Writes nothing; the caller decides whether to.
 *
 * @param {DocumentData | undefined} profile `users/{uid}`, if it exists
 * @param {Date} now The moment to judge against
 * @return {UsageStatus} The usage, and whether a limit is reached
 */
export function usageStatusOf(
  profile: DocumentData | undefined,
  now: Date
): UsageStatus {
  const usageData = readUsage(profile, now);
  if (usageData.isUnlimited) {
    return {usage: usageData, limitExceeded: false, nextReset: nextResets()};
  }
  resetElapsedPeriods(usageData, now.toISOString());
  const exceededPeriod = exhaustedPeriod(usageData);
  return {
    usage: usageData,
    limitExceeded: exceededPeriod !== undefined,
    exceededPeriod,
    nextReset: nextResets(),
  };
}
