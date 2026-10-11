// src/core/attribution/attribution.ts

import { serverTimestamp, type FieldValue } from "firebase/firestore";
import type { ContentAttribution, ServerTimeSentinel, StoredTime } from "../types/common";
import { getUserName, getActiveCharacterName } from "../utils/user-utils";

/**
 * Minimal shape the attribution helpers need.
 *
 * `activeGroupUserProfile` is typed `any` to match the parameter type already
 * accepted by `getUserName` / `getActiveCharacterName` in `user-utils.ts`. Those
 * utilities are not being refactored as part of this change, so the helper
 * accepts the same loose shape rather than introducing a stricter type that
 * would not actually be enforced end-to-end.
 */
export interface AttributionSource {
  /** UID of the acting user (the author of the create/update). */
  uid: string;
  /** The active group user profile for the acting user, if any. */
  activeGroupUserProfile: any;
}

/**
 * Builds the full attribution metadata for a newly created content item.
 *
 * Sets both the `created*` and `modified*` fields to the same actor, since
 * creation and initial modification are the same event. The times are the
 * server's, from {@link creationTimes}: the client-clock strings `dateAdded`
 * and `dateModified` are no longer written (T132).
 *
 * @param src The acting user's uid and active group user profile.
 * @returns A complete {@link ContentAttribution} object.
 */
export function buildCreationAttribution(src: AttributionSource): ContentAttribution {
  const username = getUserName(src.activeGroupUserProfile);
  const characterId = src.activeGroupUserProfile?.activeCharacterId ?? null;
  const characterName = getActiveCharacterName(src.activeGroupUserProfile);

  return {
    createdBy: src.uid,
    createdByUsername: username,
    createdByCharacterId: characterId,
    createdByCharacterName: characterName,
    modifiedBy: src.uid,
    modifiedByUsername: username,
    modifiedByCharacterId: characterId,
    modifiedByCharacterName: characterName,
  };
}

/**
 * Builds the attribution delta for a modification to an existing content item.
 *
 * Only returns the `modified*` fields so the caller can spread it over the
 * existing entity without disturbing the `created*` fields. The time is the
 * server's, from {@link modificationTimes} (T132).
 *
 * @param src The acting user's uid and active group user profile.
 * @returns The subset of {@link ContentAttribution} fields touched by a modification.
 */
export function buildModificationAttribution(
  src: AttributionSource,
): Pick<
  ContentAttribution,
  | "modifiedBy"
  | "modifiedByUsername"
  | "modifiedByCharacterId"
  | "modifiedByCharacterName"
> {
  return {
    modifiedBy: src.uid,
    modifiedByUsername: getUserName(src.activeGroupUserProfile),
    modifiedByCharacterId: src.activeGroupUserProfile?.activeCharacterId ?? null,
    modifiedByCharacterName: getActiveCharacterName(src.activeGroupUserProfile),
  };
}

/**
 * The server-clock times a new top-level record carries (T132): `createdAt`
 * and `modifiedAt`, as `serverTimestamp()`, which the server sets to the
 * moment the write commits -- the same value its rules see as
 * `request.time`, and no browser's clock.
 *
 * Only for a record's own fields: Firestore refuses a sentinel inside an
 * array, so a note inside a record keeps the times its builder gives it.
 */
export function creationTimes(): { createdAt: FieldValue; modifiedAt: FieldValue } {
  return { createdAt: serverTimestamp(), modifiedAt: serverTimestamp() };
}

/** The server-clock time an edit to a top-level record carries (T132). */
export function modificationTimes(): { modifiedAt: FieldValue } {
  return { modifiedAt: serverTimestamp() };
}

/** A stored time: a server timestamp, an ISO or `YYYY-MM-DD` string, or a Date. */
type AnyTime = StoredTime | ServerTimeSentinel | string | Date | null | undefined;

/**
 * A stored time as a Date, or null when there is none or it cannot be read.
 *
 * @param value The stored time
 */
export function toTime(value: AnyTime): Date | null {
  if (!value) return null;
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "string") date = new Date(value);
  // A write's own sentinel, read back before the server replaced it, has no date.
  else if ("toDate" in value && typeof value.toDate === "function") date = value.toDate();
  else return null;
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether a server time is a write still on its way: the sentinel, or the
 * null the SDK reads in its place until the server has stamped it.
 *
 * @param value The stored time
 */
function isPendingTime(value: AnyTime): boolean {
  if (value === null) return true;
  return typeof value === "object" && !(value instanceof Date) && !("toDate" in value);
}

/**
 * When a record was created and last modified (T132): the server's times.
 * A write still pending, whose server time is not yet known, reads as now,
 * which is when the server is about to stamp it. A record written before
 * T132 that never got server times falls back to the client-clock strings
 * `dateAdded` / `dateModified`, which nothing writes any more.
 *
 * @param item The record's attribution
 */
export function recordTimes(
  item: Partial<Pick<ContentAttribution, "createdAt" | "modifiedAt" | "dateAdded" | "dateModified">> | null | undefined,
): { created: Date | null; modified: Date | null } {
  const timeOf = (server: AnyTime, legacy: string | undefined): Date | null =>
    toTime(server) ?? (isPendingTime(server) ? new Date() : toTime(legacy));
  const created = timeOf(item?.createdAt, item?.dateAdded);
  const modified = timeOf(item?.modifiedAt, item?.dateModified) ?? created;
  return { created, modified };
}
