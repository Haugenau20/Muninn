// src/features/campaign-entities/npcs/types.ts
import { BaseContent, DomainData, RecordChange, CreateAlongside } from 'core/types/common';
import { StoredImage } from 'core/types/storedImage';

export type NPCStatus = 'alive' | 'deceased' | 'missing' | 'unknown';
export type NPCRelationship = 'friendly' | 'neutral' | 'hostile' | 'unknown';

export interface NPCConnections {
  relatedNPCs: string[];
  affiliations: string[];
  /**
   * @deprecated The old second half of a person's quests (T131), read and
   * written by nothing: a quest's `relatedNPCIds` owns the link, and
   * `scripts/migrate-links.js` emptied this in production. Older records
   * still store it, empty.
   */
  relatedQuests?: string[];
}

export interface NPCNote {
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
   * Optional because every note written before this field existed has no
   * author and never will. Those render without one rather than being
   * attributed to a guess: the record's creator is not necessarily the person
   * who wrote any given note, and inventing that would be showing data that
   * does not exist.
   */
  author?: string;
}

/**
 * Represents an NPC in the game world
 */
export interface NPC extends BaseContent {
  name: string;
  title?: string;
  status: NPCStatus;
  race?: string;
  occupation?: string;
  /**
   * How an entity's location is stored, and how it should be read. This
   * comment is the single source of truth for the contract; `Quest.locationId`/
   * `Quest.location` and `Rumor.locationId`/`Rumor.location` share it verbatim
   * rather than repeating it.
   *
   * `locationId` is the canonical reference to a Location record and wins
   * whenever it is set and resolves. `location` is free text, used when no
   * Location record was selected (a player may legitimately write "somewhere
   * in the fen"). It is also written alongside `locationId` as a
   * human-readable convenience, but is never authoritative.
   *
   * Free text is shown as written and never looked up as a place, even when
   * it reads like one (`resolveLocationName` in
   * `features/campaign-entities/locations/utils/location-display.ts`).
   * Documents predating this contract stored only `location`, an id or a
   * name; production's were given their `locationId` on 2026-10-08 (T079).
   */
  location?: string;
  /**
   * @deprecated For a person, written by nothing and never read as a link:
   * the place's `connectedNPCs` owns that (T131). `scripts/migrate-links.js`
   * emptied it in production except where the place no longer exists, and
   * that dangling reference is still shown where a person has no linked
   * place, as `resolveLocationName` reads any reference (#1412). The
   * contract on `location` above holds for quests and rumours.
   */
  locationId?: string;
  relationship: NPCRelationship;
  description: string;
  appearance?: string;
  personality?: string;
  background?: string;
  connections: NPCConnections;
  /**
   * @deprecated The old array of notes, read by nothing: each note is a
   * document of its own (T133, `shared/recordNotes.ts`), and
   * `scripts/migrate-records.js` emptied this in production. A new record
   * still writes it empty, for a browser on the app from before.
   */
  notes: NPCNote[];
  /** Free-text labels for grouping, the same shape `Location.tags` uses. */
  tags?: string[];
  /** The NPC's portrait; null once removed (Firestore cannot store undefined). */
  image?: StoredImage | null;
}

// Context types
export interface NPCContextState {
  npcs: NPC[];
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

export interface NPCContextValue extends NPCContextState {
  getNPCById: (id: string) => NPC | undefined;
  getNPCsByRelationship: (relationship: NPCRelationship) => NPC[];
  updateNPCNote: (npcId: string, note: NPCNote) => void;
  updateNPCRelationship: (npcId: string, relationship: NPCRelationship) => Promise<void>;
  /** `alongside`: a change to another record that commits with this one (T088). */
  addNPC: (npc: DomainData<NPC>, alongside?: CreateAlongside) => Promise<string>;
  /**
   * Write `change` to the NPC: the fields it names, and nothing else
   * (T083). Never the whole record -- a copy from the listener can be behind
   * the server. A list worked out from the old one goes as a function; see
   * `RecordChange`.
   */
  updateNPC: (npcId: string, change: RecordChange<NPC>) => Promise<void>;
  deleteNPC: (npcId: string) => Promise<void>;
  /** Sets the status of several NPCs, committed as one batch. */
  updateNPCsStatus: (npcIds: string[], status: NPCStatus) => Promise<void>;
  /** Deletes several NPCs, committed as one batch. */
  deleteNPCs: (npcIds: string[]) => Promise<void>;
  /**
   * Retry after a failed load: reopens the NPC listener if Firestore closed it
   * after an error (T032). Writes never need it -- the listener already
   * carries them -- and a healthy listener answers without a read.
   * Resolves to the list, or `[]` when there is no group or campaign selected.
   */
  refreshNPCs: () => Promise<NPC[]>;
  /** Whether a group and a campaign are both selected. */
  hasRequiredContext: boolean;
}