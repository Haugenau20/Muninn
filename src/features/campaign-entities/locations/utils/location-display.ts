// src/features/campaign-entities/locations/utils/location-display.ts
import { Location } from '../types';

/**
 * The pair of fields every entity that can be located carries. See the
 * `location`/`locationId` contract documented on `NPC.location` in
 * `features/campaign-entities/npcs/types.ts` (shared verbatim by `Quest` and
 * `Rumor`) for the full explanation of what each field means and when it is
 * authoritative.
 */
export interface LocationReference {
  locationId?: string;
  location?: string;
}

/**
 * The campaign's locations, looked up by id rather than searched. A roster
 * resolves one reference per row, and searching the array for each one made a
 * 1,200-row list do 1.4 million comparisons per redraw at that many places
 * (T101). Build it once per `locations` array (`useMemo`) and pass it where
 * the array would go.
 */
export interface LocationNameIndex {
  byId: ReadonlyMap<string, Location>;
}

/**
 * Index `locations` for {@link resolveLocationName}.
 *
 * @param locations The campaign's locations
 */
export const indexLocationNames = (locations: readonly Location[]): LocationNameIndex => {
  const byId = new Map<string, Location>();
  for (const loc of locations) {
    if (!byId.has(loc.id)) byId.set(loc.id, loc);
  }
  return { byId };
};

/**
 * Resolve a stored location reference to the name a user should see.
 *
 * `locationId` is the reference (see the contract on `NPC.location`); the
 * free-text `location` is only ever shown, never looked up:
 * 1. `locationId` set and resolves to a Location -> that Location's current
 *    `name`, so a rename shows everywhere the place is referenced.
 * 2. Otherwise the free text, exactly as written. "Somewhere in the fen" is
 *    what a player wrote, and it stays visible.
 * 3. No free text either, but a `locationId` that names nothing -> that id,
 *    verbatim.
 * 4. Neither field set -> `undefined`, so callers keep their own
 *    "Location unknown" / "--" fallback rather than this function inventing
 *    one.
 *
 * Returning an unresolved reference untouched (steps 2 and 3) is the
 * deliberate part (#1412). A reference to a location that no longer exists
 * has to stay visible as itself rather than be dressed up as something real
 * -- title-casing a slug would invent a place, and would silently diverge
 * from the real name the moment anyone renamed one (#303, #009).
 *
 * The free text used to be matched against the campaign's places too, by id
 * and then by name, for documents written before `locationId` existed. None
 * is left in production: those documents were given their `locationId` on
 * 2026-10-08 (T079, `firebase/functions/scripts/audit-location-ids.js`).
 */
export const resolveLocationName = (
  reference: LocationReference,
  locations: readonly Location[] | LocationNameIndex
): string | undefined => {
  const resolved = resolveLocation(reference, locations);
  if (resolved) {
    return resolved.name;
  }

  // Steps 2 and 3: whatever was stored, verbatim -- the free text if there is
  // any, else the dangling id. Step 4 when neither is set.
  return reference.location || reference.locationId || undefined;
};

/**
 * The Location record a reference points at, or `undefined` when it points
 * at none.
 *
 * The record-returning twin of {@link resolveLocationName}, for callers that
 * link to the place rather than print it: the `locationId`'s record, if it
 * resolves. The free-text `location` names no record, even when it happens to
 * read like one.
 *
 * @param reference The stored pair; either field may be missing
 * @param locations The campaign's locations, or an index of them
 */
export const resolveLocation = (
  reference: LocationReference,
  locations: readonly Location[] | LocationNameIndex
): Location | undefined => {
  const { locationId } = reference;
  if (!locationId) return undefined;
  return isIndex(locations)
    ? locations.byId.get(locationId)
    : locations.find(loc => loc.id === locationId);
};

/** Whether `locations` is an index rather than the array it was built from. */
const isIndex = (
  locations: readonly Location[] | LocationNameIndex
): locations is LocationNameIndex => !Array.isArray(locations);

/**
 * Whether a location reference points at `location`: its `locationId` names
 * that Location. Free text never does (see {@link resolveLocationName}).
 *
 * Used by `QuestContext.getQuestsByLocation`.
 */
export const referencesLocation = (
  reference: LocationReference,
  location: Location
): boolean => !!reference.locationId && reference.locationId === location.id;

/** A place inside a quest: a name, and the Location it is, if it is one. */
export interface KeyPlace {
  name: string;
  locationId?: string;
}

/**
 * The Location a place inside a quest (`Quest.keyLocations`) is, if any: the
 * one its stored `locationId` names, else the one its name names -- by id, then
 * by case-insensitive name.
 *
 * Unlike an entity's `location`, a place's name is still looked up. Places
 * added before #1421 stored no id, the sample data writes none, and T079's
 * audit did not read them. Adding a place under the name of a known location
 * goes through here too, which is how it gets its id.
 *
 * @param place The place, or just a name being added
 * @param locations The campaign's locations
 */
export const resolveKeyPlace = (
  place: KeyPlace,
  locations: readonly Location[]
): Location | undefined => {
  const byId = place.locationId
    ? locations.find(loc => loc.id === place.locationId)
    : undefined;
  if (byId) return byId;
  const lower = place.name.toLowerCase();
  return (
    locations.find(loc => loc.id === place.name) ??
    locations.find(loc => loc.name.toLowerCase() === lower)
  );
};

/**
 * Whether a place inside a quest is `location`: by its stored `locationId`
 * when it has one, else by its name against the Location's id or name,
 * case-insensitively -- the test {@link resolveKeyPlace} applies, for a
 * caller holding one Location rather than the list.
 *
 * @param place The quest's place
 * @param location The Location being asked about
 */
export const keyPlaceIsLocation = (place: KeyPlace, location: Location): boolean => {
  if (place.locationId) return place.locationId === location.id;
  const lower = place.name.toLowerCase();
  return lower === location.id.toLowerCase() || lower === location.name.toLowerCase();
};
