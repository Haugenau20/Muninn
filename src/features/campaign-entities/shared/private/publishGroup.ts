// src/features/campaign-entities/shared/private/publishGroup.ts
import type { PrivateDoc, PrivateKind } from './PrivateRecordsContext';

/** One record, by kind and id. */
export interface RecordRef {
  kind: PrivateKind;
  id: string;
}

/**
 * Records joined by a conversion or a combine publish together (T163,
 * maintainer 2026-10-31): each names the others -- a rumour its quest in
 * `convertedToQuestId`, and in notes that say "Converted to quest: {id}",
 * "Combined into rumour: {id}" and "Combined from rumours: {ids}" -- so one
 * published alone would leave a shared record naming private ones. The chain
 * is followed both ways: a combined rumour later converted brings its
 * sources and the quest.
 */
export const COMBINED_INTO = /^Combined into rumour: (.+)$/m;
export const COMBINED_FROM = /^Combined from rumours: (.+)$/m;
export const CONVERTED_TO = /^Converted to quest: (.+)$/m;

/**
 * The private records that publish with `start`, `start` first.
 *
 * @param start The record the author asked to publish
 * @param records The author's private records
 * @param notesOf A private rumour's notes' text, read when needed
 */
export async function findPublishGroup(
  start: RecordRef,
  records: Record<PrivateKind, readonly PrivateDoc[]>,
  notesOf: (rumorId: string) => Promise<string[]>
): Promise<RecordRef[]> {
  const isOwn = (kind: PrivateKind, id: string) => records[kind].some((record) => record.id === id);
  const group: RecordRef[] = [];
  const seen = new Set<string>();
  const queue: RecordRef[] = [start];

  const add = (kind: PrivateKind, id: string) => {
    if (id && isOwn(kind, id) && !seen.has(`${kind}:${id}`)) queue.push({ kind, id });
  };

  while (queue.length) {
    const next = queue.shift()!;
    const key = `${next.kind}:${next.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    group.push(next);

    if (next.kind === 'rumor') {
      const rumor = records.rumor.find((record) => record.id === next.id);
      add('quest', String(rumor?.convertedToQuestId ?? ''));
      for (const text of await notesOf(next.id)) {
        add('quest', CONVERTED_TO.exec(text)?.[1]?.trim() ?? '');
        add('rumor', COMBINED_INTO.exec(text)?.[1]?.trim() ?? '');
        for (const id of (COMBINED_FROM.exec(text)?.[1] ?? '').split(',')) add('rumor', id.trim());
      }
    }
    if (next.kind === 'quest') {
      for (const rumor of records.rumor) {
        if (rumor.convertedToQuestId === next.id) add('rumor', rumor.id);
      }
    }
  }
  return group;
}

/**
 * Why a place cannot be published yet, or null: a shared place never sits
 * inside a private one, so a place whose parent is still private (and not
 * published with it) waits for that parent.
 *
 * @param group What is being published
 * @param records The author's private records
 */
export function blockedByParent(
  group: readonly RecordRef[],
  records: Record<PrivateKind, readonly PrivateDoc[]>
): string | null {
  const publishing = new Set(group.filter((ref) => ref.kind === 'location').map((ref) => ref.id));
  for (const ref of group) {
    if (ref.kind !== 'location') continue;
    const place = records.location.find((record) => record.id === ref.id);
    const parent = records.location.find((record) => record.id === place?.parentId);
    if (place && parent && !publishing.has(parent.id)) {
      return `${place.name} is inside ${parent.name}, which is private: publish ${parent.name} first.`;
    }
  }
  return null;
}
