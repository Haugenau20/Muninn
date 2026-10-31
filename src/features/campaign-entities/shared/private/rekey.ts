// src/features/campaign-entities/shared/private/rekey.ts
import firebaseServices from 'core/services/firebase';
import { notesPathOf } from '../recordNotes';
import { rewriteIds } from './idFields';
import type { HeldLink, MoveStamps, PrivateDoc, PrivateKind } from './PrivateRecordsContext';

type BatchOp = { type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: unknown };

/** What the author's private space holds, as their client reads it. */
export interface PrivateSpace {
  paths: Record<PrivateKind | 'links', string | null>;
  records: Record<PrivateKind, readonly PrivateDoc[]>;
  links: readonly HeldLink[];
  /** Their session notes, whose extraction marks name records by id. */
  sessionNotes?: { path: string | null; campaignId: string | null };
}

/**
 * A moved note's fields: as stored, with the time it was first written kept
 * in `recordedAt`. The move stamps it created now, as the rules require, and
 * the notes are read back in the order `recordedAt` gives (`recordNotes.ts`),
 * so a moved record's notes keep theirs.
 */
export function movedNote(note: Record<string, unknown>): Record<string, unknown> {
  const recordedAt = note.recordedAt ?? note.createdAt ?? note.dateAdded;
  return { ...storedFields(note), ...(recordedAt ? { recordedAt } : {}) };
}

/**
 * The writes that move the author's session notes' extraction marks from
 * old ids to new ones: a note turned into a record keeps pointing at it,
 * rather than at whatever now carries the old id -- possibly another
 * player's record. Their notes alone; one read of this campaign's.
 *
 * @param space The author's private space, with their session notes' place
 * @param renamed Each record whose id changes
 */
export async function sessionNoteMarkWrites(
  space: PrivateSpace,
  renamed: ReadonlyArray<{ kind: PrivateKind; oldId: string; newId: string }>
): Promise<BatchOp[]> {
  const path = space.sessionNotes?.path;
  const campaignId = space.sessionNotes?.campaignId;
  const changes = renamed.filter(({ oldId, newId }) => oldId !== newId);
  if (!path || !campaignId || changes.length === 0) return [];

  const notes = await firebaseServices.document.queryFromServer<{ extractedEntities?: Array<Record<string, unknown>> }>(
    path, 'campaignId', campaignId
  );
  const ops: BatchOp[] = [];
  for (const note of notes) {
    const extractedEntities = remapMarks(note.extractedEntities, changes);
    if (extractedEntities) ops.push({ type: 'update', collection: path, id: note.id, data: { extractedEntities } });
  }
  return ops;
}

/**
 * A session note's extraction marks with each renamed record's id changed,
 * or null when none names one.
 *
 * @param entities The note's extracted entities
 * @param renamed Each record whose id changes
 */
export function remapMarks(
  entities: ReadonlyArray<Record<string, unknown>> | undefined,
  renamed: ReadonlyArray<{ kind: PrivateKind; oldId: string; newId: string }>
): Array<Record<string, unknown>> | null {
  let changed = false;
  const remapped = (entities ?? []).map((entity) => {
    const rename = renamed.find(
      ({ kind, oldId, newId }) => oldId !== newId && entity.type === kind && entity.convertedToId === oldId
    );
    if (!rename) return entity;
    changed = true;
    return { ...entity, convertedToId: rename.newId };
  });
  return changed ? remapped : null;
}

/** A record's fields as stored: without its id, its in-memory mark and its stamps. */
export function storedFields(record: Record<string, unknown>): Record<string, unknown> {
  const {
    id: _id,
    isPrivate: _isPrivate,
    createdBy: _createdBy,
    createdAt: _createdAt,
    modifiedBy: _modifiedBy,
    modifiedAt: _modifiedAt,
    ...fields
  } = record;
  return fields;
}

/**
 * The writes that rename one of the author's private records everywhere they
 * name it (T163): the record under its new id with its notes, every other
 * private record that names it, and every held link that has it at one end.
 * Everything named is the author's own; no shared record is touched.
 *
 * @param kind The record's kind
 * @param oldId Its id now
 * @param newId Its id after
 * @param space The author's private space
 * @param stamps The attribution the writes carry
 * @returns The writes, for one batch
 */
export async function rekeyWrites(
  kind: PrivateKind,
  oldId: string,
  newId: string,
  space: PrivateSpace,
  stamps: MoveStamps
): Promise<BatchOp[]> {
  const path = space.paths[kind];
  const linksPath = space.paths.links;
  const record = space.records[kind].find((candidate) => candidate.id === oldId);
  if (!path || !linksPath || !record) throw new Error('That private record is not here any more.');

  const notes = await firebaseServices.document.getCollectionFromServer<Record<string, unknown>>(
    notesPathOf(path, oldId)
  );
  const ops: BatchOp[] = [
    { type: 'set', collection: path, id: newId, data: { ...storedFields(record), ...stamps.creation } },
    ...notes.map((note) => ({
      type: 'set' as const,
      collection: notesPathOf(path, newId),
      id: note.id as string,
      data: { ...movedNote(note), ...stamps.creation },
    })),
    ...notes.map((note) => ({ type: 'delete' as const, collection: notesPathOf(path, oldId), id: note.id as string })),
    { type: 'delete', collection: path, id: oldId },
  ];

  for (const other of Object.keys(space.records) as PrivateKind[]) {
    const otherPath = space.paths[other];
    if (!otherPath) continue;
    for (const candidate of space.records[other]) {
      if (other === kind && candidate.id === oldId) continue;
      const change = rewriteIds(other, candidate, kind, oldId, newId);
      if (change) ops.push({ type: 'update', collection: otherPath, id: candidate.id, data: { ...change, ...stamps.modification } });
    }
  }

  const renamed = (end: HeldLink['from']) => (end.kind === kind && end.id === oldId ? { kind, id: newId } : end);
  for (const link of space.links) {
    const from = renamed(link.from);
    const to = renamed(link.to);
    if (from === link.from && to === link.to) continue;
    // Under a new id: a held link is created and deleted, never changed.
    ops.push({ type: 'delete', collection: linksPath, id: link.id });
    ops.push({ type: 'set', collection: linksPath, id: crypto.randomUUID(), data: { from, to, createdAt: stamps.creation.createdAt } });
  }

  // And the session notes that were turned into it.
  ops.push(...(await sessionNoteMarkWrites(space, [{ kind, oldId, newId }])));

  return ops;
}

/**
 * Rename one of the author's private records, in one batch: when someone
 * else has taken its id for a shared record, which they could not see.
 */
export async function rekeyPrivateRecord(
  kind: PrivateKind,
  oldId: string,
  newId: string,
  space: PrivateSpace,
  stamps: MoveStamps
): Promise<void> {
  const ops = await rekeyWrites(kind, oldId, newId, space, stamps);
  await firebaseServices.document.batchOperations(ops as Parameters<typeof firebaseServices.document.batchOperations>[0]);
}
