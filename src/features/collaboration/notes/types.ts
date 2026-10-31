// Updated src/features/collaboration/notes/types.ts

// src/features/collaboration/notes/types.ts
import { BaseContent, CreateAlongside } from "core/types/common";

/**
 * The answer to "already exists" (T163) for a rumour converted out of a note:
 * add it to the rumour of that title, or create it under the name given.
 * `anyway` when that is the name just asked about, kept on purpose: it makes
 * a second one. Otherwise the new name is checked like the first.
 */
export type SameNameAnswer = { merge: string } | { createAs: string; anyway: boolean };

/**
 * Entity types that can be extracted from notes
 */
export type EntityType = "npc" | "location" | "quest" | "rumor";

/**
 * Status of a note
 */
export type NoteStatus = "active" | "archived";

/**
 * Represents an entity extracted from a note
 */
export interface ExtractedEntity {
  /** Unique identifier for the entity */
  id: string;
  /** The text content of the entity as extracted from the note */
  text: string;
  /** The type of entity (npc, location, etc.) */
  type: EntityType;
  /** Confidence score from 0-1 of the extraction accuracy */
  confidence: number;
  /** Whether this entity has been converted to a campaign element */
  isConverted: boolean;
  /** ID of the created campaign element if converted */
  convertedToId?: string;
  /** Timestamp when the entity was extracted */
  createdAt: string;
  /** Additional data specific to the entity type */
  extraData?: {
    [key: string]: any;
  };
}

/**
 * Represents a user's note
 */
export interface Note extends BaseContent {
  /** Unique identifier for the note */
  id: string;
  /** Title of the note */
  title: string;
  /** Main content of the note */
  content: string;
  /** Entities extracted from the note content */
  extractedEntities: ExtractedEntity[];
  /** Current status of the note */
  status: NoteStatus;
  /** User-defined tags for organization */
  tags: string[];
  /** Last updated timestamp */
  updatedAt: string;
  /** Campaign ID this note belongs to */
  campaignId: string;
  /** Whether this note exists only locally and hasn't been saved to Firebase yet */
  isUnsaved?: boolean;
}

/**
 * A note's text as it stood when a save on leaving failed (T085), and why it
 * failed.
 */
export interface UnsavedNoteEdit {
  /** The title as typed; meaningful only when `hasExplicitTitle`. */
  title: string;
  content: string;
  hasExplicitTitle: boolean;
  /** The failed save's message. */
  error: string;
}

/**
 * Context value provided by NoteContext
 */
export interface NoteContextValue {
  /** All user notes */
  notes: Note[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Reopen the notes listener after it failed; clears `error`. */
  retry: () => void;
  
  /**
   * Get a note by its ID
   * @param id Note ID to find
   * @returns The note if found, otherwise undefined
   */
  getNoteById: (id: string) => Note | undefined;
  
  /**
   * Create a new note locally (not saved to Firebase until saveNote is called)
   * @param title Title of the note
   * @param content Content of the note
   * @returns Promise resolving to the ID of the created note
   */
  createNote: (title: string, content: string) => Promise<string>;
  
  /**
   * Save a note to Firebase (handles both new and existing notes)
   * @param noteId ID of the note to save
   * @param updates Optional updates to apply before saving
   * @returns Promise resolving when save is complete
   */
  saveNote: (noteId: string, updates?: Partial<Note>) => Promise<void>;
  
  /**
   * Convert an extracted entity to a campaign element
   * Now navigates to the create page instead of creating directly
   * @param noteId ID of the note containing the entity
   * @param entityId ID of the entity to convert
   * @param type Type of entity to convert to
   * @returns Promise resolving to empty string (navigation instead of creation)
   */
  convertEntity: (noteId: string, entityId: string, type: EntityType, sameName?: SameNameAnswer) => Promise<string>;
  
  /**
   * Mark an entity as converted in the note
   * Called after successful creation of campaign element
   * @param noteId ID of the note
   * @param entityId ID of the entity to mark as converted
   * @param createdId ID of the created campaign element
   * @returns Promise resolving when update is complete
   */
  markEntityAsConverted: (noteId: string, entityId: string, createdId: string) => Promise<void>;

  /**
   * Create the record an extracted entity becomes and mark the entity
   * converted into it, as one commit (T088). `create` receives the mark as
   * the change to commit with the record -- `undefined` for a draft note,
   * which is marked once the record exists -- and returns the record's id.
   * @param noteId ID of the note
   * @param entityId ID of the entity being converted
   * @param create Creates the record, given the change to commit with it
   * @returns The new record's id
   */
  convertInto: (
    noteId: string,
    entityId: string,
    create: (alongside?: CreateAlongside<Note>) => Promise<string>
  ) => Promise<string>;
  
  /**
   * Update a note (for unsaved notes, updates locally; for saved notes, saves to Firebase)
   * @param noteId ID of the note to update
   * @param updateData Data to update on the note
   * @returns Promise resolving when update is complete
   */
  updateNote: (noteId: string, updateData: Partial<Note>) => Promise<void>;

  /**
   * The edit whose save failed after its editor had already gone (T085), or
   * undefined. The editor restores it, with its error, when the note is
   * opened again. Held in memory only, and dropped on a change of user,
   * group or campaign.
   * @param noteId ID of the note
   */
  getUnsavedEdit: (noteId: string) => UnsavedNoteEdit | undefined;

  /**
   * Keep an edit whose save failed after its editor had gone, or forget it
   * (`undefined`) once the note has been saved.
   * @param noteId ID of the note
   * @param edit The edit, or undefined to forget it
   */
  setUnsavedEdit: (noteId: string, edit: UnsavedNoteEdit | undefined) => void;
  
  /**
   * Archive a note
   * @param noteId ID of the note to archive
   * @returns Promise resolving when archiving is complete
   */
  archiveNote: (noteId: string) => Promise<void>;
  
  /**
   * Delete a note
   * @param noteId ID of the note to delete
   * @returns Promise resolving when deletion is complete
   */
  deleteNote: (noteId: string) => Promise<void>;
}