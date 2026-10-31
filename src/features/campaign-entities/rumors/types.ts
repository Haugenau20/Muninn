// src/features/campaign-entities/rumors/types.ts
import { BaseContent, DomainData, RecordChange, IdentifiableContent, CreateAlongside, CreateOptions } from 'core/types/common';

export type RumorStatus = 'confirmed' | 'unconfirmed' | 'false';
export type SourceType = 'npc' | 'tavern' | 'notice' | 'traveler' | 'other';

/**
 * Represents a note added to a rumor
 * Extends BaseContent for consistency with other content types
 */
export interface RumorNote extends BaseContent {
  content: string;
}

/**
 * Represents a rumor in the game world
 */
export interface Rumor extends BaseContent {
  title: string;
  content: string;
  status: RumorStatus;
  /**
   * Where the rumour came from, or **absent because nobody has said**.
   *
   * Optional on purpose. The retired create form defaulted every rumour to
   * `'other'`, which made the row print "Other" for a record whose source had
   * never been discussed -- and left the editor showing no chip selected, so
   * the two contradicted each other. `'other'` is now a real answer meaning
   * "none of the other four", chosen deliberately; "nobody said" is this field
   * being missing, and the row prints an em dash for it.
   *
   * Records written before this change all carry `'other'` and cannot be told
   * apart from a deliberate choice, so they keep reading "Other" -- exactly
   * what they did before. There is no migration; the app reads the data it has.
   *
   * **`null`, not `undefined`, once a reader has cleared one.** This project
   * builds Firestore with a bare `getFirestore()` and no
   * `ignoreUndefinedProperties`, so an update carrying `undefined` throws
   * rather than clearing the field -- which is why `sourceNpcId` next door is
   * written as `''`. A rumour created without a source simply omits the key;
   * one whose source is un-picked stores `null`. Every reader tests
   * falsiness, so the three absences behave identically.
   */
  sourceType?: SourceType | null;
  sourceName: string;
  sourceNpcId?: string; // Optional reference to NPC if source is an NPC
  /**
   * See the `location`/`locationId` contract documented on `NPC.location` in
   * `features/campaign-entities/npcs/types.ts` -- shared verbatim here.
   */
  location?: string;
  /** See the `location`/`locationId` contract documented on `NPC.location`. */
  locationId?: string; // Optional reference to location in system
  relatedNPCs: string[]; // Array of NPC IDs
  relatedLocations: string[]; // Array of location IDs
  /**
   * @deprecated The old array of notes, read by nothing: each note is a
   * document of its own (T133, `shared/recordNotes.ts`), and
   * `scripts/migrate-records.js` emptied this in production. A new record
   * still writes it empty, for a browser on the app from before.
   */
  notes: RumorNote[];
  convertedToQuestId?: string; // If rumor was converted to quest
}

// Context types
export interface RumorContextState {
  rumors: Rumor[];
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

export interface RumorContextValue extends RumorContextState {
  getRumorById: (id: string) => Rumor | undefined;
  getRumorsByStatus: (status: RumorStatus) => Rumor[];
  getRumorsByLocation: (locationId: string) => Rumor[];
  getRumorsByNPC: (npcId: string) => Rumor[];
  updateRumorStatus: (rumorId: string, status: RumorStatus) => Promise<void>;
  updateRumorNote: (rumorId: string, note: DomainData<RumorNote> & IdentifiableContent) => Promise<void>;
  /** `alongside`: a change to another record that commits with this one (T088). */
  addRumor: (rumor: DomainData<Rumor>, alongside?: CreateAlongside, options?: CreateOptions) => Promise<string>;
  /**
   * Write `change` to the rumour: the fields it names, and nothing else
   * (T083). Never the whole record -- a copy from the listener can be behind
   * the server. A list worked out from the old one goes as a function; see
   * `RecordChange`.
   */
  updateRumor: (rumorId: string, change: RecordChange<Rumor>) => Promise<void>;
  deleteRumor: (rumorId: string) => Promise<void>;
  /** Set the status of several rumours in one atomic write (T032, `PERF-06`). */
  updateRumorsStatus: (rumorIds: string[], status: RumorStatus) => Promise<void>;
  /** Delete several rumours in one atomic write (T032, `PERF-06`). */
  deleteRumors: (rumorIds: string[]) => Promise<void>;
  combineRumors: (rumorIds: string[], newRumor: Partial<Rumor>, options?: JoinOptions) => Promise<string>;
  convertToQuest: (rumorIds: string[], questData: any, options?: JoinOptions) => Promise<string>;
}

/**
 * How a combine or a conversion treats a title one record already carries
 * (T163). `askOnSameName` refuses with a `SameNameError`, as a create does;
 * `into` names the record to add to instead of creating one -- the existing
 * rumour, or the existing quest -- which then carries every mark and note
 * the new one would have.
 */
export interface JoinOptions extends CreateOptions {
  into?: string;
}