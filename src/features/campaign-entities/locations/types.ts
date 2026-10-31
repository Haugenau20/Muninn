// src/features/campaign-entities/locations/types.ts
import { BaseContent, DomainData, RecordChange, CreateAlongside, CreateOptions } from 'core/types/common';
import { StoredImage } from 'core/types/storedImage';

/**
 * Types of locations that can exist in the game world
 */
export type LocationType = 
  | 'region'
  | 'city'
  | 'town'
  | 'village'
  | 'dungeon'
  | 'landmark'
  | 'building'
  | 'poi';

/**
 * Current status of a location
 */
export type LocationStatus =
  | 'known'
  | 'explored'
  | 'visited';

/**
 * Represents a location in the game world
 */
export interface Location extends BaseContent {
  /** Name of the location */
  name: string;
  /** Type of location */
  type: LocationType;
  /** Discovery status */
  status: LocationStatus;
  /** Detailed description */
  description: string;
  /** Parent location ID (for nested locations) */
  parentId?: string;
  /** Notable features of the location */
  features?: string[];
  /** Connected NPCs */
  connectedNPCs?: string[];
  /**
   * @deprecated The old second half of a place's quests (T131), read and
   * written by nothing: a quest's `locationId` and `keyLocations` own the
   * link, and `scripts/migrate-links.js` emptied this in production.
   */
  relatedQuests?: string[];
  /**
   * @deprecated The old array of notes, read by nothing: each note is a
   * document of its own (T133, `shared/recordNotes.ts`), and
   * `scripts/migrate-records.js` emptied this in production. A new record
   * still writes it empty, for a browser on the app from before.
   */
  notes?: LocationNote[];
  /** Tags for organization */
  tags?: string[];
  /** Last session visited */
  lastVisited?: string;
  /** A picture of the place; null once removed (Firestore cannot store undefined) */
  image?: StoredImage | null;
  /**
   * Set when this place's deletion has started, to the way it is being
   * deleted (T088). A marked place takes no edit and nothing new inside it;
   * the rules hold that. Still set means a deletion failed partway and can
   * be finished.
   */
  deleting?: LocationChildStrategy;
}

/**
 * Note for a location
 */
export interface LocationNote {
  /**
   * `YYYY-MM-DD`, written by `toNoteDate`. Notes stored before that was agreed
   * may hold a full ISO timestamp instead; they are left as they are, and
   * `formatNoteDate` renders both.
   */
  date: string;
  text: string;
  /**
   * Who wrote it -- the acting character's name, or their username when they
   * have no character.
   *
   * Optional, and for the same reason `NPCNote.author` is: every note written
   * before this field existed has none and never will. Those render without an
   * author rather than being attributed to a guess -- the record's creator is
   * not necessarily the person who wrote any given note.
   *
   * This is the one place §8 allows a per-entry credit, because a note really
   * does carry its own author and date. Nothing else on the page may.
   */
  author?: string;
}

/**
 * Context state for locations
 */
export interface LocationContextState {
  locations: Location[];
  isLoading: boolean;
  /**
   * The last failure, a read or a write. A write failure is reported here as
   * well as rejected (#1401), so it is observable, but it says nothing about
   * whether the page can show its records: gate on `loadError` for that.
   */
  error: string | null;
  /**
   * Why the records could not be loaded, or null. Only this may replace a page
   * with its error state: a rejected write leaves the loaded records, and the
   * editor holding the unsaved text, on screen (T085, REACT-002).
   */
  loadError: string | null;
}

/**
 * What happens to the places inside a location when it is deleted.
 *
 * Deleting a parent must ask, and never orphan.
 * There is no default worth having -- both outcomes are reasonable and only the
 * person deleting knows which they mean -- so the caller states one and
 * `deleteLocation` keeps today's subtree delete only for the callers that
 * predate the question.
 */
export type LocationChildStrategy = 'delete-subtree' | 'promote-to-grandparent';

/**
 * Context value including state and methods
 */
export interface LocationContextValue extends LocationContextState {
  getLocationById: (id: string) => Location | undefined;
  getLocationsByType: (type: LocationType) => Location[];
  getLocationsByStatus: (status: LocationStatus) => Location[];
  getChildLocations: (parentId: string) => Location[];
  getParentLocation: (locationId: string) => Location | undefined;
  /** Write `change` to the location: see `RecordChange` (T083). */
  updateLocation: (locationId: string, change: RecordChange<Location>) => Promise<void>;
  updateLocationNote: (locationId: string, note: LocationNote) => Promise<void>;
  updateLocationStatus: (locationId: string, status: LocationStatus) => Promise<void>;
  /** Sets the status of several locations, committed as one batch. */
  updateLocationsStatus: (locationIds: string[], status: LocationStatus) => Promise<void>;
  /**
   * Move a location under a new parent, or to the top level with `undefined`.
   *
   * Rejects rather than writing when the move would close a cycle. The tray
   * that offers parents already excludes self and every descendant, so this is
   * the second line: a cycle written once poisons every walk over that
   * campaign's data, for everyone.
   */
  moveLocation: (locationId: string, nextParentId: string | undefined) => Promise<void>;
  deleteLocation: (locationId: string, childStrategy?: LocationChildStrategy) => Promise<void>;
  /**
   * Delete several places, with one answer for what is inside all of them
   * (T017). Place by place, not atomic: a place already gone is skipped, so a
   * retry finishes what a failure left.
   */
  deleteLocations: (locationIds: string[], childStrategy: LocationChildStrategy) => Promise<void>;
  /** `alongside`: a change to another record that commits with this one (T088). */
  createLocation: (locationData: DomainData<Location>, alongside?: CreateAlongside, options?: CreateOptions) => Promise<string>;
  /** Retry after a failed load: reopens the listener if it failed (T032). Writes never need it. */
  refreshLocations: () => Promise<Location[]>;
  hasRequiredContext: boolean;
}