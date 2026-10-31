// src/features/campaign-entities/shared/private/useWithPrivate.ts
import { useEffect, useMemo, useRef } from 'react';
import { generateUniqueEntityId } from 'core/utils/entity-id';
import type { Location } from '../../locations/types';
import { nameOf } from '../sameName';
import { withHeldLinks } from './heldLinks';
import { usePrivateRecords, type PrivateKind } from './PrivateRecordsContext';
import { rekeyPrivateRecord } from './rekey';

/**
 * One kind's list as its author sees it (T163): the campaign's shared
 * records, each owner of a held link carrying it, and the author's private
 * records beside them, marked `isPrivate`, arranged as the list always is.
 *
 * A private id is chosen free of the shared ones, but another player, who
 * cannot see it, can still take it for a shared record. Then both would
 * answer to one id: the private record is left out and moved to the next
 * free id, with every other private record and held link that names it.
 *
 * @param kind The list's kind
 * @param shared The shared records, as read and arranged
 * @param arrange How the list is arranged (sorted, repaired)
 */
export function useWithPrivate<T extends { id: string }>(
  kind: PrivateKind,
  shared: T[],
  arrange: (records: T[]) => T[]
): T[] {
  const space = usePrivateRecords({ subscribe: false });
  const { records, links, stamps } = space;
  const moving = useRef<Set<string>>(new Set());

  const sharedIds = useMemo(() => new Set(shared.map((record) => record.id)), [shared]);
  const own = records[kind];
  const taken = useMemo(() => own.filter((record) => sharedIds.has(record.id)), [own, sharedIds]);

  const list = useMemo(() => {
    if (own.length === 0 && links.length === 0) return shared;
    const locationOf = (id: string) =>
      records.location.find((place) => place.id === id) as unknown as Location | undefined;
    const overlaid = withHeldLinks(kind, shared, links, locationOf);
    const mine = own.filter((record) => !sharedIds.has(record.id)) as unknown as T[];
    return mine.length || overlaid !== shared ? arrange([...overlaid, ...mine]) : shared;
  }, [kind, shared, own, links, records.location, sharedIds, arrange]);

  useEffect(() => {
    for (const record of taken) {
      if (moving.current.has(record.id)) continue;
      moving.current.add(record.id);
      const inUse = (id: string) => sharedIds.has(id) || own.some((candidate) => candidate.id === id);
      const newId = generateUniqueEntityId(nameOf(kind, record), inUse);
      rekeyPrivateRecord(kind, record.id, newId, space, stamps())
        .catch((error) => console.error('Could not move a private record whose id was taken:', error))
        .finally(() => moving.current.delete(record.id));
    }
  }, [taken, kind, sharedIds, own, space, stamps]);

  return list;
}
