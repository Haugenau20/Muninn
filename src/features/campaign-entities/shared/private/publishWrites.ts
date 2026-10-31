// src/features/campaign-entities/shared/private/publishWrites.ts
import type { Location } from '../../locations/types';
import { linkWrite } from '../linkActions';
import { mergeNote, planMerge } from '../mergeRecords';
import { notesPathOf } from '../recordNotes';
import { nameOf } from '../sameName';
import { ID_FIELDS, rewriteIds } from './idFields';
import { movedNote, remapMarks, storedFields } from './rekey';
import { COMBINED_FROM, COMBINED_INTO, CONVERTED_TO } from './publishGroup';
import type { HeldLink, MoveStamps, PrivateDoc, PrivateKind } from './PrivateRecordsContext';

/**
 * Publishing (T163): private records moved into the campaign, one-way, in
 * one transaction. Each goes under the id chosen for it (its own, or the next
 * free one when another player took it meanwhile), or into a shared record
 * of the same name when the author chose to add it there. Its notes go with
 * it. The links held for it are written onto their owners; the links it owns
 * to records still private are held instead, the other way round. Every id
 * that changes is changed wherever the author's records name it, notes'
 * marks included. Nothing another player wrote needs changing.
 */

/** Where one published record goes. */
export type PublishTarget =
  | { kind: 'own'; id: string; name?: string }
  | { kind: 'merge'; into: string };

/** One record being published, as read before the transaction. */
export interface PublishItem {
  kind: PrivateKind;
  record: PrivateDoc;
  notes: Array<Record<string, unknown> & { id: string }>;
  target: PublishTarget;
}

/** What the writes are worked out from. */
export interface PublishInput {
  items: PublishItem[];
  /** The author's private records and held links. */
  space: {
    paths: Record<PrivateKind | 'links', string | null>;
    records: Record<PrivateKind, readonly PrivateDoc[]>;
    links: readonly HeldLink[];
  };
  /** Each kind's collection in the campaign. */
  shared: Record<PrivateKind, string>;
  stamps: MoveStamps;
  /** Who signs a merge's note. */
  author?: string;
  /**
   * The author's session notes whose extraction marks name a published
   * record: read in the transaction and pointed at where it went.
   */
  marks?: { path: string; noteIds: readonly string[] };
}

export type PublishWrite = {
  type: 'create' | 'set' | 'update' | 'delete';
  collection: string;
  id: string;
  data?: Record<string, unknown>;
};

const keyOf = (kind: PrivateKind, id: string) => `${kind}:${id}`;

/** The id each published record ends up under. */
export function publishedId(item: PublishItem): string {
  return item.target.kind === 'own' ? item.target.id : item.target.into;
}

/** The documents the transaction must read: new ids, merge targets, held links' owners. */
export function publishReads(input: PublishInput): Array<{ collection: string; id: string }> {
  const reads = new Map<string, { collection: string; id: string }>();
  const need = (kind: PrivateKind, id: string) =>
    reads.set(keyOf(kind, id), { collection: input.shared[kind], id });
  for (const item of input.items) {
    need(item.kind, publishedId(item));
    for (const link of input.space.links) {
      if (link.from.kind === item.kind && link.from.id === item.record.id) need(link.to.kind, link.to.id);
    }
  }
  for (const id of input.marks?.noteIds ?? []) {
    reads.set(`note:${id}`, { collection: input.marks!.path, id });
  }
  return [...reads.values()];
}

/** A note's marks of a conversion or a combine, renamed. */
function renameMarks(text: string, renamed: (kind: PrivateKind, id: string) => string): string {
  return text
    .replace(CONVERTED_TO, (_line, id: string) => `Converted to quest: ${renamed('quest', id.trim())}`)
    .replace(COMBINED_INTO, (_line, id: string) => `Combined into rumour: ${renamed('rumor', id.trim())}`)
    .replace(
      COMBINED_FROM,
      (_line, ids: string) => `Combined from rumours: ${ids.split(',').map((id) => renamed('rumor', id.trim())).join(', ')}`
    );
}

/**
 * The fields of a record about to be shared with every id that names a
 * still-private record taken out, and the links to hold for them instead.
 */
function withoutPrivateIds(
  kind: PrivateKind,
  fields: Record<string, unknown>,
  stillPrivate: (kind: PrivateKind, id: string) => boolean
): { fields: Record<string, unknown>; hold: Array<{ kind: PrivateKind; id: string }> } {
  const out: Record<string, unknown> = { ...fields };
  const hold: Array<{ kind: PrivateKind; id: string }> = [];
  for (const { path, names } of ID_FIELDS[kind]) {
    const [head, second, third] = path;
    const value = out[head];
    if (path.length === 1) {
      if (Array.isArray(value)) {
        const kept = value.filter((id) => !(typeof id === 'string' && stillPrivate(names, id)));
        value.filter((id) => !kept.includes(id)).forEach((id) => hold.push({ kind: names, id: id as string }));
        out[head] = kept;
      } else if (typeof value === 'string' && value && stillPrivate(names, value)) {
        // A rumour's source and a person's old place are not links of their
        // own (T131): they are cleared, not held.
        const notALink = (kind === 'rumor' && head === 'sourceNpcId') || (kind === 'npc' && head === 'locationId');
        if (!notALink) hold.push({ kind: names, id: value });
        out[head] = '';
      }
    } else if (second === '[]' && Array.isArray(value)) {
      out[head] = value.map((entry: Record<string, unknown>) => {
        const id = entry?.[third];
        if (typeof id === 'string' && stillPrivate(names, id)) {
          hold.push({ kind: names, id });
          const { [third]: _gone, ...rest } = entry;
          return rest;
        }
        return entry;
      });
    } else if (second !== '[]' && value && typeof value === 'object') {
      const map = value as Record<string, unknown>;
      const list = Array.isArray(map[second]) ? (map[second] as string[]) : [];
      const kept = list.filter((id) => !stillPrivate(names, id));
      list.filter((id) => !kept.includes(id)).forEach((id) => hold.push({ kind: names, id }));
      out[head] = { ...map, [second]: kept };
    }
  }
  return { fields: out, hold };
}

/**
 * The writes of one publish, from the documents the transaction read.
 *
 * @param input What is published, and where
 * @param read A document the transaction read, or undefined when absent
 */
export function publishWrites(
  input: PublishInput,
  read: (collection: string, id: string) => Record<string, unknown> | undefined
): PublishWrite[] {
  const { items, space, shared, stamps } = input;
  const linksPath = space.paths.links;
  if (!linksPath) throw new Error('No campaign selected');

  const published = new Map(items.map((item) => [keyOf(item.kind, item.record.id), publishedId(item)]));
  const renamed = (kind: PrivateKind, id: string) => published.get(keyOf(kind, id)) ?? id;
  const inGroup = (kind: PrivateKind, id: string) => published.has(keyOf(kind, id));
  const stillPrivate = (kind: PrivateKind, id: string) =>
    !inGroup(kind, id) && space.records[kind].some((record) => record.id === id);

  const writes: PublishWrite[] = [];
  // Each shared record written to, as this commit leaves it.
  const touched = new Map<string, Record<string, unknown>>();
  const sharedNow = (kind: PrivateKind, id: string) =>
    touched.get(keyOf(kind, id)) ?? read(shared[kind], id);

  for (const item of items) {
    const { kind, record } = item;
    const privatePath = space.paths[kind];
    if (!privatePath) throw new Error('No campaign selected');
    const targetId = publishedId(item);

    // Its fields as they will be shared: the group's ids renamed, the ids of
    // records still private taken out and held the other way round.
    let fields = storedFields(record);
    for (const other of items) {
      const from = other.record.id;
      const to = publishedId(other);
      if (from !== to) fields = { ...fields, ...(rewriteIds(kind, fields, other.kind, from, to) ?? {}) };
    }
    if (item.target.kind === 'own' && item.target.name) {
      fields = { ...fields, [kind === 'npc' || kind === 'location' ? 'name' : 'title']: item.target.name };
    }
    const { fields: shareable, hold } = withoutPrivateIds(kind, fields, stillPrivate);
    for (const end of hold) {
      writes.push({
        type: 'set',
        collection: linksPath,
        id: crypto.randomUUID(),
        data: { from: end, to: { kind, id: targetId }, createdAt: stamps.creation.createdAt },
      });
    }

    const notesPath = notesPathOf(shared[kind], targetId);
    if (item.target.kind === 'own') {
      writes.push({ type: 'create', collection: shared[kind], id: targetId, data: { ...shareable, ...stamps.creation } });
      touched.set(keyOf(kind, targetId), shareable);
    } else {
      const existing = sharedNow(kind, targetId);
      if (!existing) throw new Error(`${nameOf(kind, record)} was to be added to a record that has since been deleted.`);
      const plan = planMerge(kind, existing, shareable);
      // A picture fills one it lacks, as any field does (T163); its copy was
      // made for this.
      if (shareable.image && !existing.image) {
        plan.fields.image = shareable.image;
        plan.added.push('Picture');
      }
      if (Object.keys(plan.fields).length) {
        writes.push({ type: 'update', collection: shared[kind], id: targetId, data: { ...plan.fields, ...stamps.modification } });
        touched.set(keyOf(kind, targetId), { ...existing, ...plan.fields });
      }
      const note = mergeNote(kind, nameOf(kind, record), plan.differing, input.author);
      if (note) writes.push({ type: 'set', collection: notesPath, id: crypto.randomUUID(), data: { ...note, ...stamps.creation } });
    }

    // Its notes go with it, their marks renamed.
    for (const note of item.notes) {
      const data = movedNote(note);
      for (const field of ['text', 'content']) {
        if (typeof data[field] === 'string') data[field] = renameMarks(data[field] as string, renamed);
      }
      writes.push({ type: 'set', collection: notesPath, id: note.id, data: { ...data, ...stamps.creation } });
      writes.push({ type: 'delete', collection: notesPathOf(privatePath, record.id), id: note.id });
    }
    writes.push({ type: 'delete', collection: privatePath, id: record.id });

    // The links held for it, written onto their owners now it is shared. A
    // quest held to a place reads the place's name from the place itself.
    const self = { ...shareable, id: targetId } as unknown as Location;
    const locationOf = (id: string) => (kind === 'location' && id === targetId ? self : undefined);
    for (const link of space.links) {
      if (link.from.kind !== kind || link.from.id !== record.id) continue;
      writes.push({ type: 'delete', collection: linksPath, id: link.id });
      const owner = sharedNow(link.to.kind, link.to.id);
      // An owner deleted meanwhile takes the link with it.
      if (!owner) continue;
      const write = linkWrite({ kind, id: targetId }, link.to, locationOf);
      if (!write || write.owner.kind !== link.to.kind || write.owner.id !== link.to.id) continue;
      const change = write.change(owner);
      if (!Object.keys(change).length) continue;
      writes.push({ type: 'update', collection: shared[link.to.kind], id: link.to.id, data: { ...change, ...stamps.modification } });
      touched.set(keyOf(link.to.kind, link.to.id), { ...owner, ...change });
    }
  }

  // Every record of the author's still private that names one whose id
  // changed, renamed; and every held link that does.
  for (const kind of Object.keys(space.records) as PrivateKind[]) {
    const path = space.paths[kind];
    if (!path) continue;
    for (const candidate of space.records[kind]) {
      if (inGroup(kind, candidate.id)) continue;
      let change: Record<string, unknown> = {};
      for (const item of items) {
        const from = item.record.id;
        const to = publishedId(item);
        if (from === to) continue;
        change = { ...change, ...(rewriteIds(kind, { ...candidate, ...change }, item.kind, from, to) ?? {}) };
      }
      if (Object.keys(change).length) {
        writes.push({ type: 'update', collection: path, id: candidate.id, data: { ...change, ...stamps.modification } });
      }
    }
  }

  // The session notes turned into a record that went elsewhere follow it.
  if (input.marks) {
    const renames = items.map((item) => ({ kind: item.kind, oldId: item.record.id, newId: publishedId(item) }));
    for (const id of input.marks.noteIds) {
      const note = read(input.marks.path, id);
      const extractedEntities = remapMarks(note?.extractedEntities as Array<Record<string, unknown>> | undefined, renames);
      if (extractedEntities) writes.push({ type: 'update', collection: input.marks.path, id, data: { extractedEntities } });
    }
  }

  return writes;
}
