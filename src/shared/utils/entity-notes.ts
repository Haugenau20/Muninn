// src/shared/utils/entity-notes.ts

/**
 * The shape a person's, a place's and a quest's notes share: each a document
 * of its own under its record (T133, T163,
 * `features/campaign-entities/shared/recordNotes.ts`).
 */
export interface EntityNote {
  date: string;
  text: string;
  author?: string;
}
