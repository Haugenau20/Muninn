// src/features/campaign-entities/shared/private/usePublish.ts
import { useCallback } from 'react';
import firebaseServices from 'core/services/firebase';
import { DocumentAlreadyExistsError } from 'core/services/firebase/data/DocumentAlreadyExistsError';
import { generateUniqueEntityId } from 'core/utils/entity-id';
import { useNPCs } from '../../npcs/context/NPCContext';
import { useQuests } from '../../quests/context/QuestContext';
import { useLocations } from '../../locations/context/LocationContext';
import { useRumors } from '../../rumors/context/RumorContext';
import { describeMerge, planMerge } from '../mergeRecords';
import { notesPathOf } from '../recordNotes';
import { findSameNamed, isSameName, nameOf } from '../sameName';
import { blockedByParent, findPublishGroup, type RecordRef } from './publishGroup';
import { publishReads, publishWrites, type PublishItem, type PublishTarget } from './publishWrites';
import { sessionNoteMarkWrites, storedFields } from './rekey';
import { usePrivateRecords, type PrivateKind } from './PrivateRecordsContext';

/** One record a publish names to the author before anything is written. */
export interface PublishListed {
  kind: PrivateKind;
  id: string;
  name: string;
}

/** What a same-named shared record asks: the same choices as "already exists". */
export interface PublishSameName {
  kind: PrivateKind;
  name: string;
  existingId: string;
  existingName: string;
  preview: string[];
}

/** The author's answer to one same-named record. */
export type PublishAnswer =
  | { action: 'merge' }
  | { action: 'create'; name: string }
  | { action: 'open' }
  | { action: 'cancel' };

/** How a publish asks the author. */
export interface PublishQuestions {
  /** Every record that goes, before anything is written; false stops it. */
  confirm: (records: PublishListed[]) => Promise<boolean>;
  /** A record whose name a shared one already carries. */
  sameName: (question: PublishSameName) => Promise<PublishAnswer>;
}

/** How a publish ended. */
export type PublishOutcome =
  | { published: true; ids: Record<string, string> }
  | { published: false; open?: { kind: PrivateKind; id: string } };

/** How many times a publish tries again when an id was taken meanwhile. */
const MAX_ATTEMPTS = 5;

/**
 * Publish one of the author's private records (T163), with everything a
 * conversion or a combine joined to it: one-way, one transaction.
 *
 * Every record that goes is named before anything is written, and each one
 * whose name a shared record already carries gets its own answer: added to
 * that record, published under another name (or the same, as a second one),
 * or the whole publish stopped. A record keeps its id unless another player
 * took it meanwhile; then it takes the next free one, and the transaction
 * renames it wherever the author's records name it.
 *
 * @returns `publish(kind, id, questions)`, resolving with where each record
 *   went (`kind:oldId` → new id), or what the author chose instead
 */
export function usePublish() {
  const space = usePrivateRecords();
  const { npcs } = useNPCs({ subscribe: false });
  const { quests } = useQuests({ subscribe: false });
  const { locations } = useLocations({ subscribe: false });
  const { rumors } = useRumors({ subscribe: false });
  return useCallback(
    async (kind: PrivateKind, id: string, ask: PublishQuestions): Promise<PublishOutcome> => {
      const paths = space.campaignPaths;
      if (!paths.npc || !paths.location || !paths.quest || !paths.rumor) throw new Error('No campaign selected');
      const sharedPaths = paths as Record<PrivateKind, string>;
      const lists: Record<PrivateKind, ReadonlyArray<{ id: string; isPrivate?: boolean }>> = {
        npc: npcs,
        location: locations,
        quest: quests,
        rumor: rumors,
      };
      const sharedOf = (k: PrivateKind) => lists[k].filter((record) => !record.isPrivate);
      const recordOf = (ref: RecordRef) => space.records[ref.kind].find((record) => record.id === ref.id);

      const notesOf = async (ref: RecordRef) => {
        const path = space.paths[ref.kind];
        return path
          ? firebaseServices.document.getCollectionFromServer<Record<string, unknown>>(notesPathOf(path, ref.id))
          : [];
      };
      const group = await findPublishGroup({ kind, id }, space.records, async (rumorId) =>
        (await notesOf({ kind: 'rumor', id: rumorId })).map((note) => String(note.content ?? note.text ?? ''))
      );
      const blocked = blockedByParent(group, space.records);
      if (blocked) throw new Error(blocked);

      const listed = group.map((ref) => ({ ...ref, name: nameOf(ref.kind, recordOf(ref) ?? {}) }));
      if (!(await ask.confirm(listed))) return { published: false };

      // Each one's answer: its own place, or a same-named shared record.
      const targets = new Map<string, PublishTarget>();
      for (const ref of listed) {
        let name = ref.name;
        for (;;) {
          const twin = findSameNamed(ref.kind, name, sharedOf(ref.kind));
          if (!twin) break;
          const record = recordOf(ref) ?? {};
          const answer = await ask.sameName({
            kind: ref.kind,
            name,
            existingId: twin.id,
            existingName: nameOf(ref.kind, twin),
            preview: describeMerge(planMerge(ref.kind, twin, storedFields(record))),
          });
          if (answer.action === 'cancel') return { published: false };
          if (answer.action === 'open') return { published: false, open: { kind: ref.kind, id: twin.id } };
          if (answer.action === 'merge') {
            targets.set(`${ref.kind}:${ref.id}`, { kind: 'merge', into: twin.id });
            break;
          }
          const kept = isSameName(answer.name, name);
          name = answer.name;
          if (kept) break;
        }
        if (!targets.has(`${ref.kind}:${ref.id}`)) {
          targets.set(`${ref.kind}:${ref.id}`, { kind: 'own', id: ref.id, ...(name !== ref.name ? { name } : {}) });
        }
      }

      const items: PublishItem[] = [];
      for (const ref of group) {
        const record = recordOf(ref);
        if (!record) throw new Error('That private record is not here any more.');
        items.push({
          kind: ref.kind,
          record,
          notes: (await notesOf(ref)) as PublishItem['notes'],
          target: targets.get(`${ref.kind}:${ref.id}`)!,
        });
      }

      const { author } = space;
      const refused = new Set<string>();
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // An id free in the shared list, among those this publish assigns,
        // and of the author's own records that stay private.
        const assigned = new Set<string>();
        const ready = items.map((item) => {
          if (item.target.kind !== 'own') return item;
          const k = item.kind;
          const taken = (candidate: string) =>
            refused.has(`${k}:${candidate}`) ||
            assigned.has(`${k}:${candidate}`) ||
            sharedOf(k).some((record) => record.id === candidate) ||
            space.records[k].some((record) => record.id === candidate && record.id !== item.record.id);
          const wanted = item.target.name ? generateUniqueEntityId(item.target.name, taken) : item.record.id;
          const finalId = taken(wanted) ? generateUniqueEntityId(nameOf(k, item.record), taken) : wanted;
          assigned.add(`${k}:${finalId}`);
          return { ...item, target: { ...item.target, id: finalId } };
        });
        // Which session notes name a record whose id changes: found here, and
        // read again in the transaction.
        const renames = ready.map((item) => ({
          kind: item.kind,
          oldId: item.record.id,
          newId: item.target.kind === 'own' ? item.target.id : item.target.into,
        }));
        const marked = await sessionNoteMarkWrites(space, renames);
        const marks = space.sessionNotes.path
          ? { path: space.sessionNotes.path, noteIds: marked.map((write) => write.id) }
          : undefined;
        const input = { items: ready, space, shared: sharedPaths, stamps: space.stamps(), author, marks };
        try {
          await firebaseServices.document.commitAfterReading(publishReads(input), async (read) =>
            publishWrites(input, read as (collection: string, id: string) => Record<string, unknown> | undefined)
          );
          return {
            published: true,
            ids: Object.fromEntries(
              ready.map((item) => [`${item.kind}:${item.record.id}`, item.target.kind === 'own' ? item.target.id : item.target.into])
            ),
          };
        } catch (error) {
          if (!(error instanceof DocumentAlreadyExistsError)) throw error;
          const kindOf = (Object.keys(sharedPaths) as PrivateKind[]).find((k) => sharedPaths[k] === error.collectionName);
          refused.add(`${kindOf}:${error.documentId}`);
        }
      }
      throw new Error('Could not find a free name to publish under. Please try again.');
    },
    [space, npcs, quests, locations, rumors]
  );
}
