// src/core/types/common.ts

/**
 * Standard attribution metadata for all content items
 * This ensures consistent attribution across all content types
 */
export interface ContentAttribution {
  /** User ID who created the item */
  createdBy: string;
  /** Username who created the item */
  createdByUsername: string;
  /** Character ID active when item was created */
  createdByCharacterId?: string | null;
  /** Character name active when item was created */
  createdByCharacterName?: string | null;
  /**
   * When the item was created, by the writer's clock. Written until T132 and
   * no longer; read only as `recordTimes`' fallback for an older record.
   */
  dateAdded?: string;
  
  /** User ID who last modified the item (optional) */
  modifiedBy?: string;
  /** Username who last modified the item (optional) */
  modifiedByUsername?: string;
  /** Character ID active when item was modified (optional) */
  modifiedByCharacterId?: string | null;
  /** Character name active when item was modified (optional) */
  modifiedByCharacterName?: string | null;
  /** When the item was last modified, by the writer's clock. Not written since T132. */
  dateModified?: string;

  /**
   * When the item was created, by the server's clock (T132). Read through
   * `recordTimes`, which falls back to `dateAdded` for an older record. Null
   * while a write is pending.
   */
  createdAt?: StoredTime | ServerTimeSentinel | null;
  /** When the item was last modified, by the server's clock (T132). */
  modifiedAt?: StoredTime | ServerTimeSentinel | null;
}

/**
 * A server timestamp as the SDK hands it back (`Timestamp`), recognised by
 * shape so `core` needs no SDK type: anything with `toDate()`.
 */
export interface StoredTime {
  toDate: () => Date;
}

/**
 * What a write carries in place of a server time: `serverTimestamp()`, which
 * the server replaces as it commits. Matched by shape, as `StoredTime` is.
 */
export interface ServerTimeSentinel {
  isEqual(other: unknown): boolean;
}

/**
 * Content item with an ID
 */
export interface IdentifiableContent {
  /** Unique identifier for the item */
  id: string;
}

/**
 * Base content item with ID and attribution
 */
export interface BaseContent extends IdentifiableContent, ContentAttribution {
  /**
   * In memory only, never stored: the record is one of the reader's private
   * ones (T163), read from their private space rather than the campaign.
   */
  isPrivate?: boolean;
}

/**
 * The caller-supplied half of an entity: domain fields only.
 *
 * System metadata — `id` and every `ContentAttribution` field — is excluded,
 * because attribution is stamped centrally by `DocumentService`
 * (`createDocument` / `updateDocumentWithAttribution` in
 * `core/services/firebase/data/DocumentService.ts`, reached via
 * `shared/hooks/useFirebaseData.ts`), which spreads its own attribution AFTER
 * the caller's data. Whatever attribution a caller supplies is discarded at
 * the write layer, so requiring it in a create/update payload's type is a
 * false requirement on the presentation layer — this type removes it.
 */
export type DomainData<T> = Omit<T, keyof ContentAttribution | 'id'>;

/**
 * A change to another record that commits with a create, or not at all
 * (T088, DATA-005).
 *
 * For an action that turns one thing into a record: a note's detected entity
 * into an NPC, a location's feature into a place. Created first and changed
 * after, a failed change left the new record behind and every retry made
 * another. `change` is given the other record as the server holds it, inside
 * the transaction, and the id the new record got; it may run more than once,
 * and throwing refuses the whole action.
 *
 * @typeParam S - the other record's type
 */
export interface CreateAlongside<S = any> {
  /** The other record's collection: a name or a full path. */
  collection: string;
  /** The other record's id. */
  id: string;
  /** The fields to write on the other record. */
  change: (current: (S & { id: string }) | undefined, createdId: string) => Partial<S>;
}

/**
 * How a create treats a record that already carries its name (T163).
 *
 * `askOnSameName` refuses with a `SameNameError` naming that record, so the
 * player can open it, add to it or choose another name. Without it a second
 * "Grog" is created as `grog-2`, which is also what the player gets on
 * purpose by keeping the name.
 */
export interface CreateOptions {
  askOnSameName?: boolean;
  /**
   * Create it in the author's private space (T163): only they see it until
   * they publish it.
   */
  private?: boolean;
}

/**
 * What an update writes to one record (T083): the fields to set, or a
 * function that works them out from the record as the server holds it.
 *
 * Use the function whenever the new value depends on the old one -- adding to
 * or removing from a list, toggling an entry in it. The page's copy can be
 * behind the server, and a list worked out from it drops whatever another
 * player added since. The function runs in a transaction and may run more
 * than once, so it must only compute.
 */
export type RecordChange<T> = Partial<T> | ((current: T) => Partial<T>);

/**
 * Generic context state structure for content types
 */
export interface ContentContextState<T> {
  /** Array of content items */
  items: T[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
}