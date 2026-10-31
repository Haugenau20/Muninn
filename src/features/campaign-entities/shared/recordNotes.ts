// src/features/campaign-entities/shared/recordNotes.ts
import { useEffect, useState } from 'react';
import firebaseServices from 'core/services/firebase';
import { recordTimes } from 'core/attribution';
import { assertUnchanged } from 'shared/utils/edit-conflict';
import { useRecordNotesPath } from './private/useRecordNotesPath';
import type { PrivateKind } from './private/PrivateRecordsContext';

const KIND_OF: Record<string, PrivateKind> = { npcs: 'npc', locations: 'location', quests: 'quest', rumors: 'rumor' };

/**
 * A record's notes as documents of their own (T133): `npcs/{id}/notes/{noteId}`,
 * and the same under locations and rumours.
 *
 * They lived in an array inside the record, so every note rewrote the whole
 * record, went again to every listener, and grew it towards Firestore's 1 MiB,
 * after which every write to the record failed (F3); and no rule could cap a
 * note's text inside the array (F4). As documents, each is written alone and
 * capped alone, and a record's notes are read only where they are shown.
 *
 * `scripts/migrate-records.js` moved every note from the old array into its
 * own document in production and emptied the array, which nothing reads now.
 */

/** Where a record's notes live. */
export const notesPathOf = (recordsPath: string, recordId: string): string =>
  `${recordsPath}/${recordId}/notes`;

/** A note read from its own document: `noteId` says where it lives. */
export type StoredNote<T> = T & { noteId: string };

/**
 * Oldest first, as the array kept them: by the server's time of creation, or
 * the string written beside it while that is pending. A document's id is
 * random, so the order the listener delivers says nothing.
 */
const byCreation = (a: Record<string, unknown>, b: Record<string, unknown>): number =>
  (recordTimes(a).created?.getTime() ?? Infinity) - (recordTimes(b).created?.getTime() ?? Infinity);

/**
 * A record's notes from their documents, live and oldest first; undefined
 * while loading or when there is nothing to read.
 *
 * @param recordsPath The record's collection, e.g. a campaign's `npcs`
 * @param recordId The record
 */
export function useRecordNotes<T>(
  recordsPath: string | null,
  recordId: string | undefined
): StoredNote<T>[] | undefined {
  const [notes, setNotes] = useState<StoredNote<T>[] | undefined>(undefined);

  useEffect(() => {
    setNotes(undefined);
    if (!recordsPath || !recordId) return undefined;
    return firebaseServices.document.subscribeToCollection<T & { id: string }>(
      notesPathOf(recordsPath, recordId),
      (documents) =>
        setNotes(
          [...documents]
            .sort((a, b) => byCreation(a as Record<string, unknown>, b as Record<string, unknown>))
            .map(({ id, ...note }) => ({ ...(note as unknown as T), noteId: id }))
        ),
      (error) => console.error('Could not read the notes:', error)
    );
  }, [recordsPath, recordId]);

  return notes;
}

/**
 * A record of the active campaign's notes: what a list's open row shows.
 * Empty while they load.
 *
 * @param collection The record's collection in the campaign, e.g. `npcs`
 * @param recordId The record
 */
export function useCampaignRecordNotes<T>(collection: string, recordId: string): StoredNote<T>[] {
  // A private record's notes are in its author's space (T163).
  return useRecordNotes<T>(useRecordNotesPath(KIND_OF[collection], recordId), recordId) ?? [];
}

/**
 * Add a note as a document of its own, attributed and stamped with the
 * server's time like any record.
 *
 * @param recordsPath The record's collection
 * @param recordId The record
 * @param note The note's fields
 * @returns The new note's id
 */
export async function addRecordNote(
  recordsPath: string,
  recordId: string,
  note: Record<string, unknown>
): Promise<string> {
  const noteId = crypto.randomUUID();
  await firebaseServices.document.createDocument(notesPathOf(recordsPath, recordId), note, noteId);
  return noteId;
}

/**
 * Change a note's text, refusing when someone else changed it since it was
 * opened (T083).
 *
 * @param recordsPath The record's collection
 * @param recordId The record
 * @param noteId The note
 * @param field The note's text field: `text`, or a rumour note's `content`
 * @param openedWith The text when the editor opened
 * @param text The new text
 * @throws {EditConflictError} with their text, when it changed meanwhile
 */
export async function editRecordNote(
  recordsPath: string,
  recordId: string,
  noteId: string,
  field: 'text' | 'content',
  openedWith: string,
  text: string
): Promise<void> {
  await firebaseServices.document.updateDocumentAfterReading<Record<string, unknown>>(
    notesPathOf(recordsPath, recordId),
    noteId,
    async (read) => {
      const current = await read(noteId);
      if (!current) throw new Error('This note was deleted by someone else.');
      assertUnchanged(current[field] as string | undefined, openedWith, text);
      return { [field]: text };
    }
  );
}

/** Delete one note's document. */
export async function deleteRecordNote(recordsPath: string, recordId: string, noteId: string): Promise<void> {
  await firebaseServices.document.deleteDocument(notesPathOf(recordsPath, recordId), noteId);
}

/**
 * Delete every note of a record, before the record itself: a deleted record's
 * subcollection is not deleted with it, and its notes would be left behind.
 *
 * @param recordsPath The record's collection
 * @param recordIds The records about to be deleted
 */
export async function deleteRecordNotes(recordsPath: string, recordIds: readonly string[]): Promise<void> {
  for (const recordId of recordIds) {
    const path = notesPathOf(recordsPath, recordId);
    const notes = await firebaseServices.document.getCollectionFromServer<Record<string, unknown>>(path);
    for (let start = 0; start < notes.length; start += 400) {
      await firebaseServices.document.batchOperations(
        notes.slice(start, start + 400).map((note) => ({ type: 'delete' as const, collection: path, id: note.id }))
      );
    }
  }
}
