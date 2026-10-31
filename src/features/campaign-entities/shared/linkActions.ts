// src/features/campaign-entities/shared/linkActions.ts
import type { AttachKind } from 'shared/components/attach-tray/attachCandidates';
import type { RecordChange } from 'core/types/common';
import type { NPC, NPCConnections } from '../npcs/types';
import type { Quest, QuestLocation } from '../quests/types';
import type { Location } from '../locations/types';
import type { Rumor } from '../rumors/types';
import { keyPlaceIsLocation } from '../locations/utils/location-display';
import { questNamesLocation } from './links';

/** One end of a link. */
export interface LinkEnd {
  kind: AttachKind;
  id: string;
}

/**
 * Privacy for the link actions (T163). A private record's id must never be
 * written into a shared one, so a link whose owner is shared and whose other
 * end is private is held beside the private record instead, and written to
 * the owner when that record is published.
 */
export interface LinkPrivacy {
  isPrivate: (end: LinkEnd) => boolean;
  /** Keeps the link between the private `from` and the shared owner `to`. */
  hold: (from: LinkEnd, to: LinkEnd) => Promise<void>;
  /** Lets go of a held link, if there is one. */
  release: (from: LinkEnd, to: LinkEnd) => Promise<void>;
}

/**
 * What the actions read and write through: the lists and writers the
 * contexts hand every page (`useNPCs`, `useQuests`, `useLocations`,
 * `useRumors`).
 */
export interface LinkDeps {
  npcs: readonly NPC[];
  quests: readonly Quest[];
  locations: readonly Location[];
  updateNPC: (id: string, change: RecordChange<NPC>) => Promise<void>;
  updateQuest: (id: string, change: RecordChange<Quest>) => Promise<void>;
  updateLocation: (id: string, change: RecordChange<Location>) => Promise<void>;
  updateRumor: (id: string, change: RecordChange<Rumor>) => Promise<void>;
  /** Private records' links are held rather than written into shared ones (T163). */
  privacy?: LinkPrivacy;
}

/** The two ends in a fixed order, so each pair is handled in one place. */
function ordered(a: LinkEnd, b: LinkEnd): [LinkEnd, LinkEnd] {
  const rank: Record<AttachKind, number> = { npc: 0, quest: 1, location: 2, rumor: 3 };
  return rank[a.kind] <= rank[b.kind] ? [a, b] : [b, a];
}

const NO_CONNECTIONS: NPCConnections = { relatedNPCs: [], affiliations: [] };

const add = (ids: readonly string[] | undefined, id: string) => Array.from(new Set([...(ids ?? []), id]));
const without = (ids: readonly string[] | undefined, id: string) => (ids ?? []).filter((existing) => existing !== id);

/**
 * One `connections` list of an NPC, changed, worked out from the record the
 * server holds; `connections` is one stored map, so the other lists go back
 * as they are.
 */
const changeConnections =
  (list: keyof NPCConnections, next: (ids: string[]) => string[]) => (current: NPC) => {
    const connections = current.connections ?? NO_CONNECTIONS;
    return { connections: { ...connections, [list]: next(connections[list] ?? []) } };
  };

/** What a link writes: the record that owns it, and the change to that record. */
export interface LinkWrite {
  owner: LinkEnd;
  change: (current: any) => Record<string, unknown>;
}

/**
 * Where a link between `a` and `b` is stored, and what storing it changes
 * there, worked out from the owner as it is passed in: the server's copy in
 * a transaction, or a copy in memory (T163's held links). Null when there is
 * nothing to write, or `locationOf` does not know the place a quest is linked to.
 *
 * @param holder For two people, which of them stores it: the first unless said
 */
export function linkWrite(
  a: LinkEnd,
  b: LinkEnd,
  locationOf: (id: string) => Location | undefined,
  holder?: LinkEnd
): LinkWrite | null {
  const [first, second] = ordered(a, b);
  switch (`${first.kind}-${second.kind}`) {
    case 'npc-npc': {
      if (first.id === second.id) return null;
      const owner = holder ?? first;
      const other = owner.id === first.id ? second : first;
      return { owner, change: changeConnections('relatedNPCs', (ids) => add(ids, other.id)) };
    }
    case 'npc-quest':
      return { owner: second, change: (current: Quest) => ({ relatedNPCIds: add(current.relatedNPCIds, first.id) }) };
    case 'npc-location':
      return { owner: second, change: (current: Location) => ({ connectedNPCs: add(current.connectedNPCs, first.id) }) };
    case 'npc-rumor':
      return { owner: second, change: (current: Rumor) => ({ relatedNPCs: add(current.relatedNPCs, first.id) }) };
    case 'quest-location': {
      const location = locationOf(second.id);
      if (!location) return null;
      // The quest's own location when it has none, else one of its places.
      return {
        owner: first,
        change: (current: Quest): Partial<Quest> => {
          if (questNamesLocation(current, location)) return {};
          if (!current.locationId) return { locationId: location.id, location: location.name };
          const place: QuestLocation = { name: location.name, description: '', locationId: location.id };
          return { keyLocations: [...(current.keyLocations ?? []), place] };
        },
      };
    }
    case 'location-rumor':
      return {
        owner: second,
        change: (current: Rumor) => ({ relatedLocations: add(current.relatedLocations, first.id) }),
      };
    default:
      throw new Error(`A ${first.kind} cannot be linked to a ${second.kind}.`);
  }
}

/**
 * Links and unlinks two records, from whichever page the player is on (T131).
 *
 * Every link is written to its owner (`links.ts` has the table), so adding a
 * quest on a person's page and adding the person on the quest's page store
 * the same thing, and removing it clears the same field.
 *
 * Each write is worked out from the record the server holds (T083), so a
 * link another player added a moment ago survives this one. With `privacy`,
 * a link that would put a private record's id into a shared one is held
 * instead (T163), and two people of whom one is private store it on that one.
 */
export function createLinkActions({
  npcs,
  quests,
  locations,
  updateNPC,
  updateQuest,
  updateLocation,
  updateRumor,
  privacy,
}: LinkDeps) {
  const npcOf = (id: string) => npcs.find((npc) => npc.id === id);
  const questOf = (id: string) => quests.find((quest) => quest.id === id);
  const locationOf = (id: string) => locations.find((location) => location.id === id);
  const isPrivate = (end: LinkEnd) => privacy?.isPrivate(end) ?? false;
  const same = (x: LinkEnd, y: LinkEnd) => x.kind === y.kind && x.id === y.id;

  const updateOf: Record<AttachKind, (id: string, change: any) => Promise<void>> = {
    npc: updateNPC,
    quest: updateQuest,
    location: updateLocation,
    rumor: updateRumor,
  };

  const link = async (a: LinkEnd, b: LinkEnd): Promise<void> => {
    const [first, second] = ordered(a, b);
    let holder: LinkEnd | undefined;
    if (first.kind === 'npc' && second.kind === 'npc') {
      // Stored once: nothing to do when the other side already holds it.
      if (npcOf(second.id)?.connections?.relatedNPCs?.includes(first.id)) return;
      // On the private one, when one is: then nothing needs holding.
      holder = isPrivate(second) && !isPrivate(first) ? second : first;
    }

    const write = linkWrite(first, second, locationOf, holder);
    if (!write) return;
    const other = same(write.owner, first) ? second : first;
    if (privacy && isPrivate(other) && !isPrivate(write.owner)) {
      await privacy.hold(other, write.owner);
      return;
    }
    await updateOf[write.owner.kind](write.owner.id, write.change);
  };

  const unlink = async (a: LinkEnd, b: LinkEnd): Promise<void> => {
    const [first, second] = ordered(a, b);
    const pair = `${first.kind}-${second.kind}`;

    // A held link is let go of: the shared owner never had it.
    if (privacy && pair !== 'npc-npc') {
      const owner = pair === 'quest-location' ? first : second;
      const other = owner === first ? second : first;
      if (isPrivate(other) && !isPrivate(owner)) {
        await privacy.release(other, owner);
        return;
      }
    }

    switch (pair) {
      case 'npc-npc': {
        // Stored once, but on either side: clear whichever holds it.
        for (const [holder, other] of [[first.id, second.id], [second.id, first.id]]) {
          if (npcOf(holder)?.connections?.relatedNPCs?.includes(other)) {
            await updateNPC(holder, changeConnections('relatedNPCs', (ids) => without(ids, other)));
          }
        }
        return;
      }
      case 'npc-quest':
        await updateQuest(second.id, (current) => ({ relatedNPCIds: without(current.relatedNPCIds, first.id) }));
        return;
      case 'npc-location':
        await updateLocation(second.id, (current) => ({ connectedNPCs: without(current.connectedNPCs, first.id) }));
        return;
      case 'npc-rumor':
        await updateRumor(second.id, (current) => ({ relatedNPCs: without(current.relatedNPCs, first.id) }));
        return;
      case 'quest-location': {
        const location = locationOf(second.id);
        const quest = questOf(first.id);
        if (!location) return;
        if (quest && !questNamesLocation(quest, location)) return;
        await updateQuest(first.id, (current): Partial<Quest> => ({
          ...(current.locationId === location.id ? { locationId: '', location: '' } : {}),
          keyLocations: (current.keyLocations ?? []).filter((place) => !keyPlaceIsLocation(place, location)),
        }));
        return;
      }
      case 'location-rumor':
        await updateRumor(second.id, (current) => ({
          relatedLocations: without(current.relatedLocations, first.id),
          ...(current.locationId === first.id ? { locationId: '', location: '' } : {}),
        }));
        return;
      default:
        throw new Error(`A ${first.kind} cannot be linked to a ${second.kind}.`);
    }
  };

  return { link, unlink };
}
