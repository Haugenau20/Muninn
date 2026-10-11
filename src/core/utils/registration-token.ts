// src/core/utils/registration-token.ts
// When a group registration token can still be redeemed (T013).
//
// Pure, and deliberately outside `InvitationService`: the service enforces the
// rule on redemption, and the admin view states it on each pending invitation.
// Both read it from here, so the view can never call a token live that the
// service would then reject.

/**
 * How long a new registration token stays valid: 14 days.
 *
 * Long enough to reach a player on a fortnightly schedule, short enough that a
 * link pasted somewhere public stops working on its own.
 */
export const REGISTRATION_TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The `scheme` an invitation stored under its token's hash carries (T145).
 * Mirrors `HASHED_SCHEME` in `firebase/functions/src/shared/invitationToken.ts`,
 * the copy that is enforced.
 */
export const HASHED_INVITATION_SCHEME = "sha256";

/**
 * The id an invitation is stored under: its token's SHA-256, in hex (T145).
 * Whoever can read the collection then holds no working link; whoever holds
 * the link can still find its invitation. Mirrors `hashInvitationToken` in the
 * functions.
 *
 * @param token The token from the link
 * @returns The invitation's document id, or `null` where the browser offers
 *   no Web Crypto (a page served over plain http from another machine)
 */
export async function hashInvitationToken(token: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A stored date as a `Date`. Firestore hands back a `Timestamp` for what was
 * written as a `Date`, and the sample-data generator writes strings.
 *
 * @param value A `Date`, a Firestore `Timestamp`, a date string or epoch millis
 * @returns The date, or `undefined` when nothing is stored
 */
export function toTokenDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return value instanceof Date ? value : new Date(value as string | number);
}

/**
 * Whether a token has passed its expiry.
 *
 * A token with no `expiresAt` never expires. Every token minted before T013
 * carries none, and treating them as expired would silently revoke every
 * invitation already sent; backfilling them would need a migration nobody
 * asked for. They lapse the ordinary way, by being used or revoked.
 *
 * @param expiresAt The stored expiry, in any shape {@link toTokenDate} accepts
 * @param now The moment to judge against
 */
export function isRegistrationTokenExpired(expiresAt: unknown, now: Date = new Date()): boolean {
  const expiry = toTokenDate(expiresAt);
  return expiry !== undefined && expiry.getTime() <= now.getTime();
}

/**
 * Whether a stored token can still be redeemed: not used, and not expired.
 *
 * @param data The token document's data
 * @param now The moment to judge against
 */
export function isRegistrationTokenRedeemable(
  data: { used?: boolean; expiresAt?: unknown },
  now: Date = new Date()
): boolean {
  return data.used !== true && !isRegistrationTokenExpired(data.expiresAt, now);
}
