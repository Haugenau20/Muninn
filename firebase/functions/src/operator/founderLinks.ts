// functions/src/operator/founderLinks.ts
//
// The operator page's founder links (T137): issue one, list them, revoke one.
// A link's token is the whole secret, so outside the response that issues it
// a link is named by the first characters of its document id (its `ref`): in
// lists, in forms, in URLs and in the audit log. Since T145 that id is the
// token's SHA-256, so a ref says nothing about the token.

import {
  DocumentData,
  FieldPath,
  Firestore,
  Timestamp,
} from "firebase-admin/firestore";
import {Refusal} from "../shared/refusal";
import {registrationTokenProblem, toDate} from "../shared/registrationToken";
import {
  FOUNDER_INVITATIONS,
  issueFounderInvitation,
} from "../signUp/founderInvitations";
import {LOGGED_LINK_LENGTH} from "./audit";

/** How many links a page lists. */
export const FOUNDER_LINK_PAGE_SIZE = 50;

/** The longest note a link may carry. */
export const FOUNDER_LINK_NOTE_MAX = 200;

/** A link's first characters, which name it everywhere but at issue. */
const REF_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${LOGGED_LINK_LENGTH}}$`);

/** Where a founder link stands. */
export type FounderLinkStatus = "open" | "used" | "expired" | "revoked";

/** One link, as the list shows it: never its token. */
export interface FounderLinkRow {
  ref: string;
  status: FounderLinkStatus;
  note: string | null;
  issuedBy: string | null;
  createdAt: Date | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
}

/** A page of links, newest first, and the cursor for the next, if any. */
export interface FounderLinkPage {
  rows: FounderLinkRow[];
  /** Pass as `before` for the page after this one; null on the last. */
  next: string | null;
}

/**
 * The ref of a link: the first characters of its document id.
 *
 * @param {string} invitationId A founder link's document id
 * @return {string} Its ref
 */
export function refOf(invitationId: string): string {
  return invitationId.slice(0, LOGGED_LINK_LENGTH);
}

/**
 * Issue a founder link for the operator, within the daily budget.
 *
 * @param {Firestore} db Firestore
 * @param {object} request Who issues it, an optional note, and when
 * @return {Promise<object>} The token, shown once, its ref and its expiry
 * @throws {Refusal} `invalid_input` for a bad note, `budget_spent`
 */
export async function issueFounderLink(
  db: Firestore,
  {issuedBy, note, now = new Date()}:
    {issuedBy: string; note?: string; now?: Date}
): Promise<{token: string; ref: string; expiresAt: Date}> {
  const trimmed = (note ?? "").trim();
  if (trimmed.length > FOUNDER_LINK_NOTE_MAX) {
    throw new Refusal(
      "invalid_input",
      `A note can be at most ${FOUNDER_LINK_NOTE_MAX} characters.`
    );
  }
  const {token, invitationId, expiresAt} = await issueFounderInvitation(db, {
    issuedBy,
    ...(trimmed ? {note: trimmed} : {}),
    now,
  });
  return {token, ref: refOf(invitationId), expiresAt};
}

/**
 * Where a stored link stands. Revoked wins over expired, because revoking
 * moves the expiry to the moment of revoking.
 *
 * @param {object} data The invitation's data
 * @param {Date} now The moment to judge against
 * @return {FounderLinkStatus} Its status
 */
function statusOf(
  data: DocumentData,
  now: Date
): FounderLinkStatus {
  if (data.used === true) return "used";
  if (data.revokedAt) return "revoked";
  return registrationTokenProblem(data, now) === "expired" ? "expired" : "open";
}

/**
 * A cursor: when the last row shown was issued, and its ref.
 *
 * @param {FounderLinkRow} row The last row of a page
 * @return {string} The cursor
 */
function cursorOf(row: FounderLinkRow): string {
  return `${row.createdAt?.getTime() ?? 0}.${row.ref}`;
}

/**
 * List founder links, newest first, a page at a time.
 *
 * The cursor names the last row shown by when it was issued and by its ref,
 * never by its token, since it travels in a URL. A link issued in the same
 * millisecond as the cursor's, whose id also starts with the same six
 * characters (one chance in 2^24), would fall between two pages.
 *
 * @param {Firestore} db Firestore
 * @param {object} request The cursor from the page before, and the moment
 * @return {Promise<FounderLinkPage>} The page
 * @throws {Refusal} `invalid_input` for a malformed cursor
 */
export async function listFounderLinks(
  db: Firestore,
  {before, now = new Date()}: {before?: string; now?: Date} = {}
): Promise<FounderLinkPage> {
  let query = db.collection(FOUNDER_INVITATIONS)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");

  if (before !== undefined) {
    const match = /^(\d{1,15})\.([A-Za-z0-9_-]+)$/.exec(before);
    if (!match || !REF_PATTERN.test(match[2])) {
      throw new Refusal("invalid_input", "That page does not exist.");
    }
    query = query.startAfter(Timestamp.fromMillis(Number(match[1])), match[2]);
  }

  const snapshot = await query.limit(FOUNDER_LINK_PAGE_SIZE + 1).get();
  const rows = snapshot.docs.slice(0, FOUNDER_LINK_PAGE_SIZE).map((doc) => {
    const data = doc.data();
    return {
      ref: refOf(doc.id),
      status: statusOf(data, now),
      note: typeof data.note === "string" ? data.note : null,
      issuedBy: typeof data.issuedBy === "string" ? data.issuedBy : null,
      createdAt: toDate(data.createdAt) ?? null,
      expiresAt: toDate(data.expiresAt) ?? null,
      usedAt: toDate(data.usedAt) ?? null,
      revokedAt: toDate(data.revokedAt) ?? null,
      revokedBy: typeof data.revokedBy === "string" ? data.revokedBy : null,
    };
  });
  const more = snapshot.size > FOUNDER_LINK_PAGE_SIZE;
  return {rows, next: more ? cursorOf(rows[rows.length - 1]) : null};
}

/**
 * Revoke the unused founder link named by `ref`. It stops working at once:
 * its expiry moves to now, and everything that accepts a link refuses an
 * expired one (`registrationTokenProblem`). Revoking a revoked link again
 * changes nothing.
 *
 * @param {Firestore} db Firestore
 * @param {object} request The link's ref, who revokes it, and when
 * @return {Promise<{alreadyRevoked: boolean}>} Whether it was revoked before
 * @throws {Refusal} `invalid_input`, `link_not_found`, `link_ambiguous`,
 *   `link_used`
 */
export async function revokeFounderLink(
  db: Firestore,
  {ref, revokedBy, now = new Date()}:
    {ref: string; revokedBy: string; now?: Date}
): Promise<{alreadyRevoked: boolean}> {
  if (!REF_PATTERN.test(ref)) {
    throw new Refusal("invalid_input", "That is not a founder link.");
  }
  // Every id character sorts below "~", so this range is the links whose
  // id starts with `ref`.
  const named = db.collection(FOUNDER_INVITATIONS)
    .where(FieldPath.documentId(), ">=", ref)
    .where(FieldPath.documentId(), "<", `${ref}~`)
    .limit(2);

  return db.runTransaction(async (transaction) => {
    const found = await transaction.get(named);
    if (found.empty) {
      throw new Refusal("link_not_found", "There is no such founder link.");
    }
    if (found.size > 1) {
      throw new Refusal(
        "link_ambiguous",
        "Two founder links start with these characters. Revoke it in the " +
          "Firebase console instead."
      );
    }
    const link = found.docs[0];
    const data = link.data();
    if (data.used === true) {
      throw new Refusal(
        "link_used",
        "This founder link has been used to start a group, so it cannot be " +
          "revoked."
      );
    }
    if (data.revokedAt) return {alreadyRevoked: true};

    const expiry = toDate(data.expiresAt);
    transaction.update(link.ref, {
      // Never later than it was: an expired link stays expired from when it
      // expired.
      expiresAt: expiry && expiry.getTime() < now.getTime() ? expiry : now,
      revokedAt: now,
      revokedBy,
    });
    return {alreadyRevoked: false};
  });
}
