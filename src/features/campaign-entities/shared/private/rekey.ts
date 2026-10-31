// src/features/campaign-entities/shared/private/rekey.ts
import firebaseServices from 'core/services/firebase';
import { notesPathOf } from '../recordNotes';
import { rewriteIds } from './idFields';
import type { HeldLink, MoveStamps, PrivateDoc, PrivateKind } from './PrivateRecordsContext';

/** What the author's private space holds, as their client reads it. */
export interface PrivateSpace {
  paths: Record<PrivateKind | 'links', string | null>;
  records: Record<PrivateKind, PrivateDoc[]>;
  links: readonly HeldLink[];
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

type BatchOp = { type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: unknown };

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
      data: { ...storedFields(note), ...stamps.creation },
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
