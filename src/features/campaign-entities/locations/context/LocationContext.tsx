// src/features/campaign-entities/locations/context/LocationContext.tsx
import React, { createContext, useContext, useCallback, useRef } from 'react';
import { Location, LocationStatus, LocationContextValue, LocationNote, LocationChildStrategy } from '../types';
import { descendantIdsDeepestFirst, parentChainReaches, wouldCreateCycle } from '../utils/location-tree';
import { planBatchDelete } from '../utils/batch-delete';
import { HIGHLIGHT_DEPTH_CAP } from 'shared/hooks/useHighlightTarget';
import { DomainData, RecordChange, CreateAlongside, CreateOptions } from 'core/types/common';
import { useLocationData } from '../hooks/useLocationData';
import { useFirebaseData } from 'shared/hooks/useFirebaseData';
import { writeRecordChange } from '../../shared/writeRecordChange';
import { useCampaignCollectionPath } from 'shared/hooks/useCampaignCollectionPath';
import { toNoteDate } from 'shared/utils/dateFormatter';
import { useAuth, useUser, useGroups, useCampaigns } from 'features/user-management';
import { createWithUniqueEntityId } from 'core/utils/entity-id';
import { buildModificationAttribution, modificationTimes } from 'core/attribution';
import { commitEntityWrites } from '../../shared/commitEntityWrites';
import { unlinkDeletedQuietly, useCampaignRecordPaths } from '../../shared/unlinkDeleted';
import { addRecordNote, deleteRecordNotes } from '../../shared/recordNotes';
import { assertNoSameNamed, stopOnSameNamed } from '../../shared/sameName';
import { releaseImage } from 'shared/hooks/useImageAttachment';
import { createListenerDemandContext, useListenerDemand, ListReaderOptions } from 'shared/hooks/useListenerDemand';

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

/**
 * Hands a ready value to everything under it, in place of
 * `LocationProvider`'s own: the example campaign's records, for a page drawn from
 * it (`../../example/ExampleCampaignProvider`).
 */
export const LocationContextValueProvider = LocationContext.Provider;

/** Children marked or moved per transaction, under its 500-write limit. */
const CLAIMS_PER_TRANSACTION = 400;

/**
 * Who is reading this provider's list right now (T032, `PERF-03`): the
 * listener is open only while some component that called `useLocations()` is
 * mounted, and for a while after. See `useListenerDemand`.
 */
const { DemandProvider: LocationDemandProvider, useDemand: useLocationDemand } = createListenerDemandContext();

export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // The list follows a Firestore listener (T032), which delivers this
  // client's own writes before their promises resolve -- so nothing below
  // patches it after a write, or asks for a re-read.
  const demand = useListenerDemand();
  const { locations, loading, error, refreshLocations, hasRequiredContext } = useLocationData({ enabled: demand.wanted });
  const { user } = useAuth();
  const { userProfile, activeGroupUserProfile } = useUser();
  const { activeGroupId } = useGroups();
  const { activeCampaignId } = useCampaigns();
  // `autoFetch: false` because nothing renders off this instance's `data`:
  // the list comes from `useLocationData()` above. Its `error` is bound as
  // `writeError` so write failures are not conflated with read failures
  // (bug #1401).
  // Writes name this render's campaign by full path, so one started here
  // lands here even if the player switches campaign before it runs (T082).
  const locationsPath = useCampaignCollectionPath('locations');
  const recordPaths = useCampaignRecordPaths();
  const {
    updateData, updateDataAfterReading, updateManyAfterReading, queryData, deleteData, addData, error: writeError
  } = useFirebaseData<Location>({
    collection: locationsPath,
    autoFetch: false
  });

  // Get location by ID
  const getLocationById = useCallback((id: string) => {
    return locations.find(location => location.id === id);
  }, [locations]);

  // Get locations by type
  const getLocationsByType = useCallback((type: string) => {
    return locations.filter(location => location.type === type);
  }, [locations]);

  // Get locations by status
  const getLocationsByStatus = useCallback((status: LocationStatus) => {
    return locations.filter(location => location.status === status);
  }, [locations]);

  // Get all child locations for a parent
  const getChildLocations = useCallback((parentId: string) => {
    return locations.filter(location => location.parentId === parentId);
  }, [locations]);

  // Get parent location for a location
  const getParentLocation = useCallback((locationId: string) => {
    const location = getLocationById(locationId);
    return location?.parentId ? getLocationById(location.parentId) : undefined;
  }, [getLocationById]);

  // Update a location: only what `change` names; see `RecordChange` (T083)
  const updateLocation = useCallback(async (locationId: string, change: RecordChange<Location>): Promise<void> => {
    if (!user || !activeGroupId || !activeCampaignId) {
      throw new Error('User must be authenticated and group/campaign context must be set to update a location');
    }

    if (!getLocationById(locationId)) {
      throw new Error('Location not found');
    }

    await writeRecordChange({ updateData, updateDataAfterReading }, locationId, change, 'Location not found');
  }, [user, activeGroupId, activeCampaignId, getLocationById, updateData, updateDataAfterReading]);

  // Update location note
  const updateLocationNote = useCallback(async (locationId: string, note: LocationNote): Promise<void> => {
    if (!user || !userProfile || !activeGroupId || !activeCampaignId) {
      throw new Error('User must be authenticated and group/campaign context must be set to add location notes');
    }

    const location = getLocationById(locationId);
    if (!location) {
      throw new Error('Location not found');
    }

    // A note of its own (T133), not one more entry in the record.
    if (!locationsPath) throw new Error('No campaign selected');
    await addRecordNote(locationsPath, locationId, { ...note, date: toNoteDate() });
  }, [user, userProfile, activeGroupId, activeCampaignId, getLocationById, locationsPath]);

  // Update location status
  const updateLocationStatus = useCallback(async (locationId: string, status: LocationStatus): Promise<void> => {
    if (!user || !activeGroupId || !activeCampaignId) {
      throw new Error('User must be authenticated and group/campaign context must be set to update location status');
    }

    if (!getLocationById(locationId)) {
      throw new Error('Location not found');
    }

    await updateData(locationId, { status });
  }, [user, activeGroupId, activeCampaignId, getLocationById, updateData]);

  /**
   * Sets the status of several locations in one batch (T017): one round trip,
   * and all or nothing.
   */
  const updateLocationsStatus = useCallback(async (locationIds: string[], status: LocationStatus): Promise<void> => {
    if (!user || !activeGroupId || !activeCampaignId) {
      throw new Error('User must be authenticated and group/campaign context must be set to update location status');
    }

    if (locationIds.some(id => !getLocationById(id))) {
      throw new Error('One or more locations not found');
    }

    const modificationAttribution = buildModificationAttribution({ uid: user.uid, activeGroupUserProfile });
    await commitEntityWrites<Location>(locationsPath, 'locations', locationIds.map(id => ({
      type: 'update' as const,
      id,
      data: { status, ...modificationAttribution, ...modificationTimes() }
    })));
  }, [user, activeGroupUserProfile, activeGroupId, activeCampaignId, getLocationById, locationsPath]);

  /**
   * Move a location under a new parent.
   *
   * The write the whole cycle guard exists for. Nothing in the product could
   * choose a parent before `15-4`, so `PERF-11`'s unterminating walks needed
   * hand-edited data to reach; *Move elsewhere* makes them one click away. The
   * tray refuses to offer self or a descendant and this refuses to write one,
   * because the two failures have very different blast radii: an unofferable
   * choice is a UI gap, a written cycle is a campaign nobody can open.
   */
  const moveLocation = useCallback(async (
    locationId: string,
    nextParentId: string | undefined
  ): Promise<void> => {
    if (!user || !activeGroupId || !activeCampaignId) {
      throw new Error('User must be authenticated and group/campaign context must be set to move a location');
    }

    const location = getLocationById(locationId);
    if (!location) {
      throw new Error('Location not found');
    }

    /** Why `nextParentId` cannot hold this place. */
    const cycleError = (parentName: string | undefined) =>
      new Error(
        nextParentId === locationId
          ? `${location.name} cannot be inside itself.`
          : `${parentName ?? 'That place'} is already inside ${location.name}.`
      );

    // Refused here at once when the list on screen already shows the cycle.
    if (wouldCreateCycle(locations, locationId, nextParentId)) {
      throw cycleError(nextParentId ? getLocationById(nextParentId)?.name : undefined);
    }

    // '' rather than `undefined`: Firestore rejects `undefined`, and it is what
    // both the form and quick add already write for "no parent".
    if (!nextParentId) {
      await updateLocation(locationId, { parentId: '' });
      return;
    }

    // The list on screen is a snapshot: another member may have moved the new
    // parent inside this place since, and two opposite moves each pass the
    // check above (DATA-006). The parent's chain is read again inside the
    // transaction that writes the move, so whichever commits second sees the
    // first and is refused.
    await updateDataAfterReading(locationId, async (read) => {
      const parent = await read(nextParentId);
      if (!parent) {
        throw new Error(`${getLocationById(nextParentId)?.name ?? 'That place'} no longer exists.`);
      }
      if (await parentChainReaches(read, nextParentId, locationId)) {
        throw cycleError(parent.name);
      }
      return { parentId: nextParentId };
    });
  }, [user, activeGroupId, activeCampaignId, getLocationById, locations, updateLocation, updateDataAfterReading]);

  /**
   * Delete a location, and say what happens to the places inside it.
   *
   * §6.2: **never orphan, never decide silently.** `promote-to-grandparent`
   * moves the direct children up one level -- to this location's own parent, or
   * to the top level when it had none -- before the record goes; each child's
   * own subtree travels with it untouched, because only the edge that pointed
   * at the deleted location is broken.
   *
   * `delete-subtree` stays the default only because it is what every caller
   * written before this question existed already does. Every caller that asks
   * passes a strategy explicitly.
   */
  /**
   * Delete a place, and either everything inside it or nothing (its children
   * move up a level).
   *
   * Decided from the server, not from this client's list (T088, DATA-006).
   * The place is marked first, in a transaction that also confirms it still
   * exists; from then on the rules refuse a new place inside it, a place moved
   * into it, and any edit to it. Only then is the server asked what is inside
   * it, and each child is marked (or moved) in a transaction that reads it
   * again, so one moved out meanwhile stays where it went. A whole subtree is
   * marked level by level, each level asked for once its parent is marked.
   *
   * A deletion that fails partway leaves its marks, and calling this again
   * finishes it, the way it started: nothing is marked twice.
   */
  const deletePlace = useCallback(async (
    locationId: string,
    childStrategy: LocationChildStrategy,
    ifMissing: 'throw' | 'skip'
  ): Promise<void> => {
    if (!user || !activeGroupId || !activeCampaignId) {
      throw new Error('User must be authenticated and group/campaign context must be set to delete a location');
    }

    // 1. The mark. A place already marked keeps the way its deletion began.
    let root: Location | undefined;
    await updateManyAfterReading(async (read) => {
      root = await read(locationId);
      if (!root) {
        if (ifMissing === 'skip') return [];
        throw new Error('Location not found');
      }
      return root.deleting ? [] : [{ id: locationId, data: { deleting: childStrategy } }];
    });
    // Assigned inside the callback, which narrowing cannot see.
    const place = root as Location | undefined;
    if (!place) return;
    const strategy = place.deleting ?? childStrategy;

    /**
     * Marks or moves the children the server lists under `parentId`, each
     * only if the transaction still finds it there, and returns those it
     * found there. `change` returns null for a child it should not write: the
     * rules refuse an edit to a place already marked.
     */
    const claimChildren = async (
      parentId: string,
      change: (child: Location) => Partial<Location> | null,
      skip: ReadonlySet<string> = new Set()
    ): Promise<Location[]> => {
      const listed = (await queryData('parentId', parentId)).filter(child => !skip.has(child.id));
      const claimed: Location[] = [];
      // One transaction commits at most 500 writes.
      for (let start = 0; start < listed.length; start += CLAIMS_PER_TRANSACTION) {
        const chunk = listed.slice(start, start + CLAIMS_PER_TRANSACTION);
        let inside: Location[] = [];
        await updateManyAfterReading(async (read) => {
          const current = await Promise.all(chunk.map(child => read(child.id)));
          inside = current.filter((child): child is Location => child?.parentId === parentId);
          return inside.flatMap(child => {
            const data = change(child);
            return data ? [{ id: child.id, data }] : [];
          });
        });
        claimed.push(...inside);
      }
      return claimed;
    };

    if (strategy === 'promote-to-grandparent') {
      // The children are re-homed *before* the parent goes. The other order
      // leaves a window in which a reader loading the campaign sees children
      // pointing at an id that no longer resolves -- the dangling-parent state
      // #303 catalogued, created deliberately by the fix for orphaning.
      const grandparentId = place.parentId || '';
      await claimChildren(locationId, () => ({ parentId: grandparentId }));

      const discard = place.image ? releaseImage(place.image.path) : undefined;
      // Its notes first (T133): a record's subcollection outlives the record.
      if (locationsPath) await deleteRecordNotes(locationsPath, [locationId]);
      await deleteData(locationId);
      // After the document: a failure can then only orphan the file, which the
      // released record lets the daily sweep find.
      discard?.();
      // And out of every list that named it (T131).
      await unlinkDeletedQuietly(recordPaths, 'location', [locationId]);
      return;
    }

    // 2. Every descendant, marked level by level. The visited set and the
    // depth cap keep a parent cycle from looping (PERF-11).
    const subtree: Location[] = [place];
    const seen = new Set<string>([locationId]);
    let level = [locationId];
    for (let depth = 0; level.length > 0 && depth <= HIGHLIGHT_DEPTH_CAP; depth++) {
      const next: Location[] = [];
      for (const parentId of level) {
        const children = await claimChildren(
          parentId,
          child => (child.deleting ? null : { deleting: 'delete-subtree' }),
          seen
        );
        children.forEach(child => seen.add(child.id));
        next.push(...children);
      }
      subtree.push(...next);
      level = next.map(child => child.id);
    }

    // Deepest first: the ordering bug #010 was filed about, unchanged.
    const childrenIds = descendantIdsDeepestFirst(subtree, locationId);

    // Every picture in the subtree is recorded as released up front: a delete
    // that fails partway leaves some places gone, and their files are then
    // the daily sweep's to find.
    const discards = subtree.flatMap(location =>
      location.image ? [releaseImage(location.image.path)] : []
    );

    // Sequential (rather than Promise.all) execution is required here: it is
    // the only way to guarantee descendants are actually removed from the
    // database before their ancestors.
    for (const id of childrenIds) {
      if (locationsPath) await deleteRecordNotes(locationsPath, [id]);
      await deleteData(id);
    }
    if (locationsPath) await deleteRecordNotes(locationsPath, [locationId]);
    await deleteData(locationId);

    // Every deleted place's picture, once all the documents are gone.
    discards.forEach(discard => discard());
    await unlinkDeletedQuietly(recordPaths, 'location', [...childrenIds, locationId]);
  }, [user, activeGroupId, activeCampaignId, deleteData, queryData, updateManyAfterReading, recordPaths, locationsPath]);

  const deleteLocation = useCallback(
    (locationId: string, childStrategy: LocationChildStrategy = 'delete-subtree') =>
      deletePlace(locationId, childStrategy, 'throw'),
    [deletePlace]
  );

  /**
   * Delete several places, with one answer for what is inside them (T017).
   *
   * Each ticked place goes through the same protocol as {@link deleteLocation}
   * -- marked, then the server asked what is inside it -- so a place added
   * inside one meanwhile is never orphaned. That makes this a sequence, not
   * one atomic batch: a failure partway leaves the places before it deleted,
   * and running it again finishes the rest, since a place already gone is
   * skipped rather than refused. `planBatchDelete` orders the sequence so that
   * deleting everything inside starts from the outermost place, and moving it
   * up starts from the innermost, letting each child climb to the nearest
   * place that is not being deleted.
   */
  const deleteLocations = useCallback(async (
    locationIds: string[],
    childStrategy: LocationChildStrategy
  ): Promise<void> => {
    const { order } = planBatchDelete(locations, locationIds);
    for (const id of order[childStrategy]) {
      await deletePlace(id, childStrategy, 'skip');
    }
  }, [locations, deletePlace]);

  // Ids issued during this session but not yet reflected in `locations`. Two
  // locations can be created back-to-back within a single `act()` / event
  // handler before the first create has re-rendered this provider -- a
  // collision check against `getLocationById` alone would miss that first id
  // and silently let the second create overwrite it. This ref is the second
  // source of truth `isTaken` below consults, alongside the loaded list.
  const issuedIds = useRef<Set<string>>(new Set());

  // Create a new location
  const createLocation = useCallback(async (
    locationData: DomainData<Location>,
    alongside?: CreateAlongside,
    options: CreateOptions = {}
  ): Promise<string> => {
    if (!user || !activeGroupId || !activeCampaignId) {
      throw new Error('User must be authenticated and group/campaign context must be set to create a location');
    }

    // Generate a location ID from the name, disambiguating on collision --
    // including with a location another session wrote that the listener has
    // not delivered yet (#1402).
    // A record already carrying the name stops here when the caller asks
    // (T163): one the client holds, or one that took the id a moment ago.
    if (options.askOnSameName) assertNoSameNamed('location', locationData.name, locations);
    const locationId = await createWithUniqueEntityId({
      name: locationData.name,
      issuedIds: issuedIds.current,
      isLoaded: (candidateId) => Boolean(getLocationById(candidateId)),
      write: (candidateId) => addData({ ...locationData, id: candidateId }, candidateId, ...(alongside ? [alongside] : [])),
      onRefused: options.askOnSameName && locationsPath
        ? stopOnSameNamed('location', locationsPath, locationData.name)
        : undefined
    });

    return locationId;
  }, [user, activeGroupId, activeCampaignId, getLocationById, addData, locations, locationsPath]);

  const value: LocationContextValue = {
    locations,
    isLoading: loading,
    // Trailing `|| null` normalizes the type. The real `useFirebaseData` declares
    // `useState<string | null>(null)`, so `writeError` is never `undefined` in
    // production -- but suites that mock the hook return an object with no `error`
    // key at all, which makes this expression `undefined` and violates the
    // `string | null` contract consumers rely on. Cheap to keep, and it means the
    // contract holds regardless of how the hook is supplied.
    error: error || writeError || null,
    // The read alone: a rejected write must not take the page down (T085).
    loadError: error || null,
    getLocationById,
    getLocationsByType,
    getLocationsByStatus,
    getChildLocations,
    getParentLocation,
    updateLocation,
    moveLocation,
    updateLocationNote,
    updateLocationStatus,
    updateLocationsStatus,
    deleteLocation,
    deleteLocations,
    createLocation,
    refreshLocations,
    hasRequiredContext
  };

  return (
    <LocationDemandProvider value={demand.retain}>
      <LocationContext.Provider value={value}>
        {children}
      </LocationContext.Provider>
    </LocationDemandProvider>
  );
};

export const useLocations = (options: ListReaderOptions = {}) => {
  useLocationDemand(options.subscribe ?? true);
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error('useLocations must be used within a LocationProvider');
  }
  return context;
};