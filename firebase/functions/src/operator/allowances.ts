// functions/src/operator/allowances.ts
//
// Setting one person's extraction allowance from the operator page (T137).
// What the allowance means is `extractionAllowance.ts`; this is the bounded,
// validated way to write it. Every call to OpenAI is paid from a prepaid
// balance, so the bounds are what a slip of the finger can cost.

import {FieldValue, Firestore, Timestamp} from "firebase-admin/firestore";
import {
  ExtractionAllowance,
  PeriodLimits,
  USAGE_PERIODS,
} from "../extractionAllowance";
import {Refusal} from "../shared/refusal";

/**
 * The most an allowance may grant per period: 500 calls a month is about
 * $1.50 at about $0.003 a call. Unlimited is a separate, deliberate choice.
 */
export const ALLOWANCE_BOUNDS: Readonly<PeriodLimits> = {
  daily: 50,
  weekly: 150,
  monthly: 500,
};

/** What the operator asks for. */
export interface AllowanceRequest {
  unlimited: boolean;
  /** Required unless unlimited. */
  limits?: PeriodLimits | null;
  /** When it stops applying; none for until it is changed. */
  expiresAt?: Date | null;
}

/** A uid as Firebase Auth makes them; it names a document, so no `/`. */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The uid, if it can name a profile.
 *
 * @param {string} uid The account's uid
 * @return {string} The uid
 * @throws {Refusal} `invalid_input`
 */
function checkedUid(uid: string): string {
  if (typeof uid !== "string" || !UID_PATTERN.test(uid)) {
    throw new Refusal("invalid_input", "That is not an account.");
  }
  return uid;
}

/**
 * The same moment one calendar year later, in UTC.
 *
 * @param {Date} date A moment
 * @return {Date} A year on
 */
function oneYearAfter(date: Date): Date {
  const later = new Date(date);
  later.setUTCFullYear(later.getUTCFullYear() + 1);
  return later;
}

/**
 * The allowance a request asks for, held to the bounds.
 *
 * @param {AllowanceRequest} request What the operator asked for
 * @param {Date} now The moment to judge the expiry against
 * @return {object} The validated allowance, without `setAt`
 * @throws {Refusal} `invalid_input`, with what is wrong
 */
export function validateAllowance(
  request: AllowanceRequest,
  now: Date
): Omit<ExtractionAllowance, "setAt"> {
  const expiresAt = request.expiresAt ?? null;
  if (expiresAt !== null) {
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
      throw new Refusal("invalid_input", "The end date is not a date.");
    }
    if (expiresAt.getTime() <= now.getTime()) {
      throw new Refusal(
        "invalid_input", "The end date has to be in the future."
      );
    }
    if (expiresAt.getTime() > oneYearAfter(now).getTime()) {
      throw new Refusal(
        "invalid_input", "The end date can be a year away at most."
      );
    }
  }
  const stamp = expiresAt && Timestamp.fromDate(expiresAt);

  if (request.unlimited === true) {
    return {unlimited: true, limits: null, expiresAt: stamp};
  }
  if (request.unlimited !== false || !request.limits) {
    throw new Refusal(
      "invalid_input",
      "Give a limit for each period, or choose unlimited."
    );
  }
  const limits = {} as PeriodLimits;
  for (const period of USAGE_PERIODS) {
    const value = request.limits[period];
    const most = ALLOWANCE_BOUNDS[period];
    if (!Number.isInteger(value) || value < 0 || value > most) {
      throw new Refusal(
        "invalid_input",
        `The ${period} limit has to be a whole number from 0 to ${most}.`
      );
    }
    limits[period] = value;
  }
  return {unlimited: false, limits, expiresAt: stamp};
}

/**
 * Whether `error` is Firestore's "no such document", which `update` throws
 * for a profile that does not exist.
 *
 * @param {unknown} error What was thrown
 * @return {boolean} Whether the document was missing
 */
function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as {code?: unknown}).code === 5;
}

/**
 * Update an existing profile, never create one: a profile made here would be
 * one `createGroup` and `redeemInvitation` later find half made.
 *
 * @param {Firestore} db Firestore
 * @param {string} uid The account
 * @param {object} fields The update
 * @return {Promise<void>} When written
 * @throws {Refusal} `no_profile`
 */
async function updateProfile(
  db: Firestore,
  uid: string,
  fields: Record<string, unknown>
): Promise<void> {
  try {
    await db.collection("users").doc(checkedUid(uid)).update(fields);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    throw new Refusal(
      "no_profile",
      "This account has no profile yet: it is in no group, so it cannot use " +
        "smart detection."
    );
  }
}

/**
 * Set one person's allowance, replacing any they had.
 *
 * @param {Firestore} db Firestore
 * @param {string} uid The account
 * @param {AllowanceRequest} request What the operator asked for
 * @param {Date} now When
 * @return {Promise<ExtractionAllowance>} What was stored
 * @throws {Refusal} `invalid_input`, `no_profile`
 */
export async function setAllowance(
  db: Firestore,
  uid: string,
  request: AllowanceRequest,
  now: Date = new Date()
): Promise<ExtractionAllowance> {
  const allowance: ExtractionAllowance = {
    ...validateAllowance(request, now),
    setAt: Timestamp.fromDate(now),
  };
  await updateProfile(db, uid, {extractionAllowance: allowance});
  return allowance;
}

/**
 * Put one person back on the defaults.
 *
 * @param {Firestore} db Firestore
 * @param {string} uid The account
 * @return {Promise<void>} When written
 * @throws {Refusal} `invalid_input`, `no_profile`
 */
export async function clearAllowance(
  db: Firestore,
  uid: string
): Promise<void> {
  await updateProfile(db, uid, {extractionAllowance: FieldValue.delete()});
}
