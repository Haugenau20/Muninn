// src/utils/__dev__/generators/contentGenerators/recordNotes.ts

import { doc, setDoc } from 'firebase/firestore';
import type { SampleRecord } from './records';

/**
 * Write a record, and its notes as documents of their own (T133):
 * `{collection}/{id}/notes/{noteId}`, as the app writes them. The record is
 * stored with an empty `notes` array, as production's are since
 * `scripts/migrate-records.js`.
 *
 * Each note gains the attribution the app's writes stamp. Its time is a
 * millisecond past the note before it, starting from the record's own, so the
 * notes read back in the order they are listed.
 *
 * @param db Firestore
 * @param collectionPath The record's collection, as path segments
 * @param sample The record, and the notes to write under it
 */
export async function writeRecordWithNotes(
  db: any,
  collectionPath: readonly string[],
  sample: SampleRecord
): Promise<void> {
  const { record, notes } = sample;
  const [first, ...rest] = collectionPath;
  await setDoc(doc(db, first, ...rest, record.id), { ...record, notes: [] });

  const base = (record.createdAt as Date).getTime();
  for (const [index, { fields, author }] of notes.entries()) {
    const noteId = typeof fields.id === 'string' ? fields.id : `${record.id}-note-${index + 1}`;
    const written = new Date(base + index + 1);
    await setDoc(doc(db, first, ...rest, record.id, 'notes', noteId), {
      ...fields,
      createdBy: author.uid,
      createdByUsername: author.username,
      modifiedBy: author.uid,
      modifiedByUsername: author.username,
      dateAdded: written.toISOString(),
      dateModified: written.toISOString(),
      createdAt: written,
      modifiedAt: written,
    });
  }
}
