// functions/src/shared/invitationToken.ts
//
// How an invitation's token is kept at rest (T145): never as itself. An
// invitation -- into a group (`groups/{g}/registrationTokens`) or to start one
// (`founderInvitations`) -- is stored under the SHA-256 of its token, so
// whoever can read the collection (the console, an export, the operator
// page's runtime, a group's admins) holds no working link. The link still
// carries the token; whoever presents it is looked up by its hash.
//
// Invitations stored before T145 sit under the token itself and carry no
// `scheme`. They are still honoured until they expire, and only while they
// carry no `scheme`: otherwise a hash, which anyone who can read the
// collection sees, would redeem its own invitation through the old lookup.

import {createHash, randomBytes} from "crypto";
import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
} from "firebase-admin/firestore";

/** The `scheme` an invitation stored under its token's hash carries. */
export const HASHED_SCHEME = "sha256";

/**
 * What a token may look like before it is used as a document id: new ones
 * are 43 base64url characters, the browser's old ones 32 hex characters, and
 * a test's anything shorter. Anything else -- a slash above all -- is no
 * invitation.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * A new token: 32 random bytes, base64url, so it cannot be guessed and
 * travels in a link unescaped.
 *
 * @return {string} The token
 */
export function newInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The id an invitation is stored under: the token's SHA-256, in hex.
 *
 * @param {string} token The token from the link
 * @return {string} The document id
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Whether a string can be a token at all.
 *
 * @param {unknown} token What the caller sent
 * @return {boolean} True for something that can be looked up
 */
export function isInvitationToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/**
 * The two places a token's invitation can be: under its hash, and, for an
 * invitation stored before T145, under the token itself.
 *
 * @param {CollectionReference} collection The invitations' collection
 * @param {string} token The token from the link
 * @return {object} Both references
 */
export function invitationRefs(
  collection: CollectionReference,
  token: string
): {hashed: DocumentReference; legacy: DocumentReference} {
  return {
    hashed: collection.doc(hashInvitationToken(token)),
    legacy: collection.doc(token),
  };
}

/**
 * The token's invitation, from the two reads of {@link invitationRefs}, or
 * `null` when there is none.
 *
 * @param {DocumentSnapshot} hashed The read under the token's hash
 * @param {DocumentSnapshot} legacy The read under the token itself
 * @return {DocumentSnapshot | null} The invitation
 */
export function pickInvitation(
  hashed: DocumentSnapshot,
  legacy: DocumentSnapshot
): DocumentSnapshot | null {
  if (hashed.exists && hashed.get("scheme") === HASHED_SCHEME) return hashed;
  if (legacy.exists && legacy.get("scheme") === undefined) return legacy;
  return null;
}

/**
 * Find the token's invitation outside a transaction.
 *
 * @param {CollectionReference} collection The invitations' collection
 * @param {string} token The token from the link
 * @return {Promise<DocumentSnapshot | null>} The invitation
 */
export async function findInvitation(
  collection: CollectionReference,
  token: string
): Promise<DocumentSnapshot | null> {
  if (!isInvitationToken(token)) return null;
  const {hashed, legacy} = invitationRefs(collection, token);
  const [hashedDoc, legacyDoc] = await Promise.all([hashed.get(), legacy.get()]);
  return pickInvitation(hashedDoc, legacyDoc);
}
