// src/features/campaign-entities/shared/links.ts
import type { NPC } from '../npcs/types';
import type { Quest } from '../quests/types';
import type { Location } from '../locations/types';
import type { Rumor } from '../rumors/types';
import { keyPlaceIsLocation } from '../locations/utils/location-display';

/**
 * Where every link between two records is stored, and how each side reads it
 * (T131; `docs/architecture/data-model-review.md`, F1).
 *
 * **Each link has one owner field**, and the other side derives it, the way a
 * rumour's people always worked. A link added on either page lands in the
 * owner, so both pages show it:
 *
 * | Link | Owner |
 * |---|---|
 * | person ↔ quest | `Quest.relatedNPCIds` |
 * | person ↔ place | `Location.connectedNPCs` (a person may be in several) |
 * | place ↔ quest | `Quest.locationId`, `Quest.keyLocations[].locationId` |
 * | rumour → place | `Rumor.locationId` (where it was heard) and `Rumor.relatedLocations` |
 * | person ↔ person | `NPC.connections.relatedNPCs`, on either one, once |
 * | rumour → person | `Rumor.relatedNPCs` |
 *
 * Three links were once stored on both records: `NPC.connections.relatedQuests`,
 * `NPC.locationId` and `Location.relatedQuests` were second halves.
 * `scripts/migrate-links.js` merged them into the owners in production and
 * cleared them, and nothing reads or writes them any more. A rumour's two
 * place fields are not halves of one link: both live on the rumour, the
 * directory groups by the first, and both are read together. Ids that resolve
 * to no record are left for the reader to drop, as every reader already does.
 */

/** Ids without empties or repeats, in the order first seen. */
function unique(ids: ReadonlyArray<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

// ------------------------------------------------------------ person ↔ quest

/** The quests a person is in: the quests that name them. */
export function questIdsOfNpc(npc: NPC, quests: readonly Quest[]): string[] {
  return quests.filter((quest) => quest.relatedNPCIds?.includes(npc.id)).map((quest) => quest.id);
}

/** The people on a quest: the quest's own list. */
export function npcIdsOfQuest(quest: Quest): string[] {
  return unique(quest.relatedNPCIds ?? []);
}

// ------------------------------------------------------------ person ↔ place

/** The places a person is linked to: the places that list them. */
export function locationIdsOfNpc(npc: NPC, locations: readonly Location[]): string[] {
  return locations.filter((location) => location.connectedNPCs?.includes(npc.id)).map((location) => location.id);
}

/** The people linked to a place: its own list. */
export function npcIdsOfLocation(location: Location): string[] {
  return unique(location.connectedNPCs ?? []);
}

// ------------------------------------------------------------- place ↔ quest

/** Whether a quest itself names a place: as its location, or as one of its places. */
export function questNamesLocation(quest: Quest, location: Location): boolean {
  return (
    (!!quest.locationId && quest.locationId === location.id) ||
    (quest.keyLocations ?? []).some((place) => keyPlaceIsLocation(place, location))
  );
}

/** The quests linked to a place: those that name it. */
export function questIdsOfLocation(location: Location, quests: readonly Quest[]): string[] {
  return quests.filter((quest) => questNamesLocation(quest, location)).map((quest) => quest.id);
}

// ------------------------------------------------------------ rumour → place

/** The places a rumour is linked to: where it was heard, and what it concerns. */
export function locationIdsOfRumor(rumor: Rumor): string[] {
  return unique([...(rumor.relatedLocations ?? []), rumor.locationId]);
}

/** The rumours linked to a place. */
export function rumorIdsOfLocation(location: Location, rumors: readonly Rumor[]): string[] {
  return rumors.filter((rumor) => locationIdsOfRumor(rumor).includes(location.id)).map((rumor) => rumor.id);
}

// ----------------------------------------------------------- person ↔ person

/**
 * The people a person is linked to, both ways (maintainer, 2026-10-08):
 * "Odile knows Marta" is stored once, on either of them, and both pages
 * show it.
 */
export function npcIdsOfNpc(npc: NPC, npcs: readonly NPC[]): string[] {
  return unique([
    ...(npc.connections?.relatedNPCs ?? []),
    ...npcs
      .filter((other) => other.id !== npc.id && other.connections?.relatedNPCs?.includes(npc.id))
      .map((other) => other.id),
  ]).filter((id) => id !== npc.id);
}

// ----------------------------------------------------------- rumour → person

/** The rumours that name a person. */
export function rumorIdsOfNpc(npc: NPC, rumors: readonly Rumor[]): string[] {
  return rumors.filter((rumor) => rumor.relatedNPCs?.includes(npc.id)).map((rumor) => rumor.id);
}
