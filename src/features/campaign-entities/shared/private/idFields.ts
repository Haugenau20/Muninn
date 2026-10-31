// src/features/campaign-entities/shared/private/idFields.ts
import type { PrivateKind } from './PrivateRecordsContext';

/**
 * Every field of a record that holds another record's id (T163), by the kind
 * of record it names. A private record's id must never reach one of these on
 * a shared record (`privateIdsIn`), and when a private record's id changes,
 * these are where its author's other records name it (`rewriteIds`).
 *
 * `path` is a field, a field inside a map (`connections`), or a field of each
 * entry in a list of objects (`keyLocations[].locationId`). An NPC's
 * `locationId` is listed though nothing writes it any more (T131): an old
 * value still names a place.
 */
interface IdField {
  /** The field: `[field]`, `[map, field]`, or `[list, '[]', field]`. */
  path: readonly string[];
  /** What kind of record the id names. */
  names: PrivateKind;
}

export const ID_FIELDS: Record<PrivateKind, readonly IdField[]> = {
  npc: [
    { path: ['connections', 'relatedNPCs'], names: 'npc' },
    { path: ['locationId'], names: 'location' },
  ],
  location: [
    { path: ['parentId'], names: 'location' },
    { path: ['connectedNPCs'], names: 'npc' },
  ],
  quest: [
    { path: ['relatedNPCIds'], names: 'npc' },
    { path: ['locationId'], names: 'location' },
    { path: ['keyLocations', '[]', 'locationId'], names: 'location' },
  ],
  rumor: [
    { path: ['relatedNPCs'], names: 'npc' },
    { path: ['relatedLocations'], names: 'location' },
    { path: ['locationId'], names: 'location' },
    { path: ['sourceNpcId'], names: 'npc' },
    { path: ['convertedToQuestId'], names: 'quest' },
  ],
};

type Fields = Record<string, unknown>;

/** The ids a field holds, as a list. */
function idsAt(record: Fields, path: readonly string[]): string[] {
  const [head, second, third] = path;
  const value = record[head];
  if (path.length === 1) {
    if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');
    return typeof value === 'string' && value ? [value] : [];
  }
  if (second === '[]') {
    return Array.isArray(value)
      ? value.map((entry) => (entry as Fields)?.[third]).filter((id): id is string => typeof id === 'string' && !!id)
      : [];
  }
  return idsAt((value as Fields) ?? {}, [second]);
}

/**
 * The private ids a write would put into a shared record, as
 * `{ kind, id }`: none, for a write that may go ahead.
 *
 * @param kind The kind of the record written to
 * @param fields The fields written (only these are looked at)
 * @param isPrivate Whether a record is one of the author's private ones
 */
export function privateIdsIn(
  kind: PrivateKind,
  fields: Fields,
  isPrivate: (kind: PrivateKind, id: string) => boolean
): Array<{ kind: PrivateKind; id: string }> {
  return ID_FIELDS[kind].flatMap(({ path, names }) =>
    path[0] in fields ? idsAt(fields, path).filter((id) => isPrivate(names, id)).map((id) => ({ kind: names, id })) : []
  );
}

/**
 * The fields of `record` that name `oldId` (a record of `named`), with that
 * id changed to `newId`; null when none does. Whole fields, ready to write.
 *
 * @param kind The kind of `record`
 * @param record The record, as read
 * @param named The kind of record whose id changes
 */
export function rewriteIds(
  kind: PrivateKind,
  record: Fields,
  named: PrivateKind,
  oldId: string,
  newId: string
): Fields | null {
  const change: Fields = {};
  const swap = (id: unknown) => (id === oldId ? newId : id);
  for (const { path, names } of ID_FIELDS[kind]) {
    if (names !== named || !idsAt(record, path).includes(oldId)) continue;
    const [head, second, third] = path;
    if (path.length === 1) {
      const value = record[head];
      change[head] = Array.isArray(value) ? value.map(swap) : newId;
    } else if (second === '[]') {
      change[head] = (record[head] as Fields[]).map((entry) =>
        entry?.[third] === oldId ? { ...entry, [third]: newId } : entry
      );
    } else {
      const map = ((change[head] ?? record[head]) as Fields) ?? {};
      const list = map[second];
      change[head] = { ...map, [second]: Array.isArray(list) ? list.map(swap) : newId };
    }
  }
  return Object.keys(change).length ? change : null;
}
