// functions/src/shared/invitationToken.ts
//
// How an invitation's token is kept at rest (T145): never as itself. An
// invitation -- into a group (`groups/{g}/registrationTokens`) or to start one
// (`founderInvitations`) -- is stored under the SHA-256 of its token, so
// whoever can read the collection (the console, an export, the operator
// page's runtime, a group's admins) holds no working link. The link still
// carries the token; whoever presents it is looked up by its hash.
//
// Only a document carrying the `scheme` is an invitation. Those stored before
// T145 sit under the token itself, with no `scheme`, and are refused: their
// links no longer work.

import {createHash, randomBytes} from "crypto";
import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
} from "firebase-admin/firestore";

/** The `scheme` an invitation stored under its token's hash carries. */
export const HASHED_SCHEME = "sha256";

/**
 * What a token may look like: ours are 43 base64url characters, a test's
 * anything shorter. Anything else is no invitation, and is not even hashed.
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
 * Where the token's invitation is stored: under the token's hash.
 *
 * @param {CollectionReference} collection The invitations' collection
 * @param {string} token The token from the link
 * @return {DocumentReference} The invitation's reference
 */
export function invitationRef(
  collection: CollectionReference,
  token: string
): DocumentReference {
  return collection.doc(hashInvitationToken(token));
}

/**
 * The read of {@link invitationRef} as an invitation, or `null` when there is
 * none. A document without the `scheme` was stored before T145, under its
 * token, and is no invitation any more.
 *
 * @param {DocumentSnapshot} snapshot The read under the token's hash
 * @return {DocumentSnapshot | null} The invitation
 */
export function asInvitation(snapshot: DocumentSnapshot): DocumentSnapshot | null {
  return snapshot.exists && snapshot.get("scheme") === HASHED_SCHEME ?
    snapshot :
    null;
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
  return asInvitation(await invitationRef(collection, token).get());
}
