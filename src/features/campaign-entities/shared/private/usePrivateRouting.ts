// src/features/campaign-entities/shared/private/usePrivateRouting.ts
import { useCallback, useMemo } from 'react';
import firebaseServices from 'core/services/firebase';
import type { CreateAlongside, DomainData } from 'core/types/common';
import { useFirebaseData } from 'shared/hooks/useFirebaseData';
import { unlinkDeletedQuietly, type CampaignRecordPaths, type DeletedKind } from '../unlinkDeleted';
import { privateIdsIn } from './idFields';
import { usePrivateRecords, type PrivateKind } from './PrivateRecordsContext';

/** A shared record may not name a private one (T163). */
export class PrivateLinkError extends Error {
  constructor() {
    super('That record is private, and this one is shared: it can name it once it is published.');
    this.name = 'PrivateLinkError';
  }
}

/** The writers a context hands one record's writes to. */
export interface RecordWriters<T> {
  addData: (data: DomainData<T> & { id?: string }, id?: string, alongside?: CreateAlongside) => Promise<string>;
  updateData: (id: string, fields: Partial<T>) => Promise<void>;
  updateDataAfterReading: (
    id: string,
    decide: (read: (otherId: string) => Promise<T | undefined>) => Promise<Partial<T>>
  ) => Promise<void>;
  deleteData: (id: string) => Promise<void>;
}

/** The in-memory mark, which never reaches a document. */
function unmarked<F>(fields: F): F {
  if (!fields || typeof fields !== 'object' || !('isPrivate' in (fields as object))) return fields;
  const { isPrivate: _isPrivate, ...rest } = fields as F & { isPrivate?: unknown };
  return rest as F;
}

/**
 * Where one kind's writes go (T163): a private record's to the author's
 * private space, a shared one's to the campaign. A write to a shared record
 * that would name a private one is refused with a `PrivateLinkError` -- the
 * link actions hold such a link instead -- and no write carries the
 * in-memory `isPrivate` mark.
 *
 * @param kind The context's kind
 * @param sharedPath The kind's collection in the campaign
 * @param shared The context's writers for that collection
 */
export function usePrivateRouting<T extends Record<string, any>>(kind: PrivateKind, sharedPath: string | null, shared: RecordWriters<T>) {
  const { isPrivate, paths, links } = usePrivateRecords({ subscribe: false });
  const privatePath = paths[kind];
  const own = useFirebaseData<T>({ collection: privatePath, autoFetch: false });

  const guard = useCallback(
    (fields: object) => {
      if (privateIdsIn(kind, fields as Record<string, unknown>, isPrivate).length) throw new PrivateLinkError();
    },
    [kind, isPrivate]
  );

  const guarded = useMemo<RecordWriters<T>>(
    () => ({
      addData: (data, id, alongside) => {
        guard(data);
        return alongside ? shared.addData(unmarked(data), id, alongside) : shared.addData(unmarked(data), id);
      },
      updateData: (id, fields) => {
        guard(fields);
        return shared.updateData(id, unmarked(fields));
      },
      updateDataAfterReading: (id, decide) =>
        shared.updateDataAfterReading(id, async (read) => {
          const fields = await decide(read);
          guard(fields);
          return unmarked(fields);
        }),
      deleteData: shared.deleteData,
    }),
    [shared, guard]
  );

  const privately = useMemo<RecordWriters<T>>(
    () => ({
      addData: (data, id, alongside) =>
        alongside ? own.addData(unmarked(data), id, alongside) : own.addData(unmarked(data), id),
      updateData: (id, fields) => own.updateData(id, unmarked(fields)),
      updateDataAfterReading: (id, decide) =>
        own.updateDataAfterReading(id, async (read) => unmarked(await decide(read))),
      deleteData: own.deleteData,
    }),
    [own]
  );

  /** Whether one of this kind's records is the author's private one. */
  const isOwn = useCallback((id: string) => isPrivate(kind, id), [kind, isPrivate]);

  /** The writers for this record. */
  const writersFor = useCallback((id: string) => (isOwn(id) ? privately : guarded), [isOwn, privately, guarded]);

  /** The collection this record lives in. */
  const pathFor = useCallback(
    (id: string) => (isOwn(id) ? privatePath : sharedPath),
    [isOwn, privatePath, sharedPath]
  );

  /**
   * After records of this kind are deleted: their ids out of the author's
   * private records too, and the links held for or to them let go of.
   */
  const afterDelete = useCallback(
    async (ids: readonly string[]) => {
      const privatePaths: CampaignRecordPaths = {
        npcs: paths.npc,
        quests: paths.quest,
        locations: paths.location,
        rumors: paths.rumor,
      };
      if (kind !== 'rumor') await unlinkDeletedQuietly(privatePaths, kind as DeletedKind, ids);
      const gone = new Set(ids);
      const held = links.filter(
        (link) => (link.from.kind === kind && gone.has(link.from.id)) || (link.to.kind === kind && gone.has(link.to.id))
      );
      if (paths.links && held.length) {
        await firebaseServices.document.batchOperations(
          held.map((link) => ({ type: 'delete' as const, collection: paths.links as string, id: link.id }))
        );
      }
    },
    [kind, paths, links]
  );

  /** Ids grouped by the collection each lives in, the campaign's first. */
  const byPath = useCallback(
    (ids: readonly string[]): Array<[string, string[]]> => {
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const path = pathFor(id);
        if (!path) continue;
        groups.set(path, [...(groups.get(path) ?? []), id]);
      }
      return [...groups.entries()];
    },
    [pathFor]
  );

  return { isOwn, writersFor, pathFor, byPath, privatePath, privately, shared: guarded, guard, afterDelete };
}
