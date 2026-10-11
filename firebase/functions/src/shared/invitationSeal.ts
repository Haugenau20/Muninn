// functions/src/shared/invitationSeal.ts
//
// A group invitation's token, sealed so its admins can copy the link again
// (T145). The invitation is stored under the token's hash, which cannot be
// turned back into a link; beside it sits the token encrypted with a key only
// the functions hold. Reading the collection yields neither a token nor a way
// to one: `revealInvitation` unseals it, for that group's admins only.
//
// AES-256-GCM, with the invitation's own path as associated data, so a sealed
// token copied onto another invitation does not open there.

import {createCipheriv, createDecipheriv, createHash, randomBytes} from "crypto";

/** The Secret Manager secret holding the key: 32 random bytes, base64. */
export const INVITATION_LINK_KEY = "INVITATION_LINK_KEY";

/** The sealed format's version, the first part of every sealed value. */
const VERSION = "v1";

/**
 * The key inside the Functions emulator: fixed, and never the real one, so
 * dev and e2e data are never sealed with the production key and the emulator
 * needs no secret. It protects nothing, and nothing it seals leaves the
 * emulator.
 */
const EMULATOR_KEY = createHash("sha256").update("muninn-emulator-invitation-link-key").digest();

/**
 * The key, from the `INVITATION_LINK_KEY` secret.
 *
 * @return {Buffer} 32 bytes
 * @throws {Error} When the secret is missing or not 32 bytes
 */
function sealingKey(): Buffer {
  if (process.env.FUNCTIONS_EMULATOR === "true") return EMULATOR_KEY;
  const key = Buffer.from(process.env[INVITATION_LINK_KEY] ?? "", "base64");
  if (key.length !== 32) {
    throw new Error(`${INVITATION_LINK_KEY} must be 32 bytes, base64-encoded.`);
  }
  return key;
}

/**
 * Seal a token for the invitation at `path`.
 *
 * @param {string} token The token
 * @param {string} path The invitation's document path
 * @return {string} `v1.<iv>.<ciphertext>.<tag>`, base64url
 */
export function sealInvitationToken(token: string, path: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(), iv);
  cipher.setAAD(Buffer.from(path, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => typeof part === "string" ? part : part.toString("base64url"))
    .join(".");
}

/**
 * Open a token sealed for the invitation at `path`.
 *
 * @param {string} sealed What {@link sealInvitationToken} returned
 * @param {string} path The invitation's document path
 * @return {string} The token
 * @throws {Error} When it was sealed for another path, with another key, or
 *   has been altered
 */
export function unsealInvitationToken(sealed: string, path: string): string {
  const [version, iv, ciphertext, tag] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext || !tag) {
    throw new Error("Not a sealed invitation token.");
  }
  const decipher = createDecipheriv("aes-256-gcm", sealingKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(path, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
