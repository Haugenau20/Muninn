import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Location, LocationStatus } from '../types';
import { useNPCs } from '../../npcs/context/NPCContext';
import { useQuests } from '../../quests/context/QuestContext';
import { npcIdsOfLocation, questIdsOfLocation } from '../../shared/links';
import { useLocations } from '../context/LocationContext';
import useHighlightTarget, { HIGHLIGHT_DEPTH_CAP } from 'shared/hooks/useHighlightTarget';
import Button from '../../../../core/components/Button';
import Typography from '../../../../core/components/Typography';
import { Plus } from 'lucide-react';
import { useNavigation } from 'shared/context/NavigationContext';
import {
  RosterStatusBar,
  RosterFilterBar,
  RosterFilterPills,
  RosterGroup,
  type RosterSegment,
  type RosterFilterOption,
  RosterSkeleton,
  RosterEmpty,
} from 'core/components/Roster';
import LocationTreeRow from './LocationTreeRow';
import LocationRowSummary from './LocationRowSummary';
import {
  ancestorIdsIn,
  buildLocationIndex,
  childrenOf,
  insideCountOf,
  parentIdOf,
  pathLabelOf,
} from '../utils/location-tree';
import { STATUS_ORDER, formatLocationStatus } from '../utils/location-presentation';
import useSelection from 'shared/hooks/useSelection';
import EntityBatchActions, { type BatchStatusOption } from '../../shared/EntityBatchActions';
import DeleteLocationsDialog from './DeleteLocationsDialog';
import { planBatchDelete } from '../utils/batch-delete';

interface LocationDirectoryProps {
  locations: Location[];
  isLoading?: boolean;
}

/**
 * Location type is a small fixed enum (8 members, unlike NPCDirectory's free-text
 * `location` filter), so it gets pills rather than a dropdown too — the same
 * legibility argument RosterFilterPills already makes for four options still holds
 * for nine. The type sits below the search bar so nothing has to be stacked selects.
 */
const TYPE_FILTERS: RosterFilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'region', label: 'Regions' },
  { value: 'city', label: 'Cities' },
  { value: 'town', label: 'Towns' },
  { value: 'village', label: 'Villages' },
  { value: 'dungeon', label: 'Dungeons' },
  { value: 'landmark', label: 'Landmarks' },
  { value: 'building', label: 'Buildings' },
  { value: 'poi', label: 'POIs' },
];

/**
 * The locations directory: a tree of rows.
 *
 * **What this replaces.** A parent used to expand into a full record card —
 * nine labelled fields, two action buttons — then print a "Locations in X"
 * heading, then nest a *child record card* inside it. Two records at identical
 * weight, nested, unbounded as depth grows. Design language §5 is the principle
 * that breaks: rules inside a card read as one object with parts, and cards
 * inside cards read as two objects arguing about which one is the record.
 *
 * **What it becomes** (§6.1): every place is one line until asked — mark, name,
 * type in words, knowledge step and what is inside. Asking is clicking the
 * row, at every depth and whether or not anything is inside it; the way to the
 * place's own page is *More info*, in the expansion (D41). Expanding adds the
 * bounded summary from §3 and then lists what is inside as more one-line rows,
 * so a child expanded inside an expanded parent still reads as one object with
 * parts. The row is *not* emptied: §1.3 records the first draft that moved
 * every readable fact to the page, and why it was rejected.
 *
 * **Every traversal here is guarded.** `location-tree.ts` carries the visited
 * sets and the depth cap. `15-4` makes cycles reachable — *Move elsewhere* on
 * the page can now write a parent — so a tree render that does not terminate is
 * no longer a hypothetical (`PERF-11`, T033).
 */
/** The batch actions' statuses, in the status bar's order (T017). */
const BATCH_STATUSES: Array<BatchStatusOption<LocationStatus>> = STATUS_ORDER.map(({ key }) => ({
  value: key,
  label: `Mark ${formatLocationStatus(key)}`,
}));

const LocationDirectory: React.FC<LocationDirectoryProps> = ({
  locations,
  isLoading = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  const { getNPCById } = useNPCs();
  const { quests, getQuestById } = useQuests();

  /**
   * Each place's people and quests, linked from either side (T131): the
   * place lists its people, and a quest stores its places. Counted as
   * stored, as the row always counted them; the summary below resolves each
   * to its record.
   */
  const linked = useMemo(() => {
    const byPlace = new Map<string, { npcIds: string[]; questIds: string[] }>();
    for (const location of locations) {
      byPlace.set(location.id, {
        npcIds: npcIdsOfLocation(location),
        questIds: questIdsOfLocation(location, quests),
      });
    }
    return byPlace;
  }, [locations, quests]);
  const { updateLocationStatus, updateLocationsStatus, deleteLocations } = useLocations();
  /** Selection mode for the batch actions (T017). */
  const selection = useSelection();
  // Unpacked for `renderRow`'s dependency list: calling a method on the object
  // would make the whole (per-render) object a dependency.
  const { active: selecting, selected: selectedIds, setSelected } = selection;

  // T023: this component used to mount a *fifth* `locations` loader of its own,
  // under a comment claiming real-time updates -- `getDocs` is not a
  // subscription, and the extra target fired late enough to miss Firestore's
  // startup coalescing, so it was two real reads rather than a free one. The
  // provider owns the collection; `LocationsPage` already passes it in.
  const { navigateToPage, getCurrentQueryParams } = useNavigation();
  const { highlight: highlightId } = getCurrentQueryParams();

  const index = useMemo(() => buildLocationIndex(locations), [locations]);

  /**
   * T014: one hook, four consumers -- and the PERF-11 guard with it.
   *
   * This directory's own parent walk was a `while (current?.parentId)` around
   * repeated `locations.find`, with **no visited set**, so a location inside a
   * parent cycle never terminated. It also matched `?highlight=` against the
   * name as well as the id, so a renamed place stopped answering its own links.
   */
  const { highlightedId: highlightedLocationId } = useHighlightTarget({
    items: locations,
    highlight: highlightId,
    idOf: (location) => location.id,
    parentIdOf,
    domIdPrefix: 'location',
    onReveal: (idsToReveal) =>
      setExpandedLocations((previous) => new Set([...previous, ...idsToReveal])),
  });

  const toggleExpansion = useCallback((locationId: string) => {
    setExpandedLocations((previous) => {
      const next = new Set(previous);
      if (next.has(locationId)) next.delete(locationId);
      else next.add(locationId);
      return next;
    });
  }, []);

  const search = searchQuery.trim().toLowerCase();
  const searching = search.length > 0;

  /** Does this place itself answer the active filters? */
  const matchesSelf = useCallback(
    (location: Location): boolean => {
      const byStatus = statusFilter === 'all' || location.status === statusFilter;
      const byType = typeFilter === 'all' || location.type === typeFilter;
      const byText =
        !search ||
        location.name.toLowerCase().includes(search) ||
        location.description.toLowerCase().includes(search) ||
        location.type.toLowerCase().includes(search);
      return byStatus && byType && byText;
    },
    [statusFilter, typeFilter, search]
  );

  /**
   * Does this place, or anything inside it, answer the filters?
   *
   * Carries its own visited set: this recursion descends the children map, and
   * a cycle there hangs quite independently of the parent walk.
   */
  const matchesWithDescendants = useCallback(
    (location: Location, visited = new Set<string>(), depth = 0): boolean => {
      if (visited.has(location.id) || depth > HIGHLIGHT_DEPTH_CAP) return false;
      visited.add(location.id);
      if (matchesSelf(location)) return true;
      return childrenOf(index, location.id).some((child) =>
        matchesWithDescendants(child, visited, depth + 1)
      );
    },
    [index, matchesSelf]
  );

  /**
   * **Search flattens the tree** (§6.1).
   *
   * A filtered tree with orphaned parents is unreadable: a hit four levels down
   * either drags three ancestors on screen that match nothing, or appears under
   * a parent that has been filtered away. So a search is a flat list of hits,
   * each carrying its path.
   *
   * The type and status pills do *not* flatten. They narrow a tree that is
   * still a tree, and revealing an ancestor purely to show a matching
   * descendant is what the auto-expand below is for.
   */
  const flatMatches = useMemo(
    () => (searching ? locations.filter(matchesSelf) : []),
    [searching, locations, matchesSelf]
  );

  /**
   * Narrowing the list must never hide a match behind a collapsed row, so the
   * ancestors of every match are expanded.
   *
   * Only for the pills: a search is flat and has no ancestors to reveal.
   */
  useEffect(() => {
    if (searching || (typeFilter === 'all' && statusFilter === 'all')) return;

    const toExpand = new Set<string>();
    locations.forEach((location) => {
      if (!matchesSelf(location)) return;
      // Through the index built once above, not one rebuilt per match
      // (PERF2-001).
      ancestorIdsIn(index, location.id).forEach((id) => toExpand.add(id));
    });

    if (toExpand.size) {
      setExpandedLocations((previous) => new Set([...previous, ...toExpand]));
    }
  }, [searching, typeFilter, statusFilter, locations, index, matchesSelf]);

  // Status counts drive the one bar that replaced the "All Status" dropdown
  const statusSegments: RosterSegment[] = useMemo(() => {
    const count = (status: string) => locations.filter((loc) => loc.status === status).length;
    return STATUS_ORDER.map(({ key, colorClass }) => ({
      key,
      label: key,
      count: count(key),
      colorClass,
    }));
  }, [locations]);

  const summaryFor = useCallback(
    (location: Location) => (
      <LocationRowSummary
        location={location}
        people={(linked.get(location.id)?.npcIds ?? [])
          .map((id) => getNPCById(id))
          .filter((npc): npc is NonNullable<typeof npc> => Boolean(npc))
          .map((npc) => ({ id: npc.id, name: npc.name, detail: npc.title || undefined }))}
        quests={(linked.get(location.id)?.questIds ?? [])
          .map((id) => getQuestById(id))
          .filter((quest): quest is NonNullable<typeof quest> => Boolean(quest))
          .map((quest) => ({
            id: quest.id,
            name: quest.title,
            // The word, not a hue: the icon used to carry the status by colour
            // alone with no legend anywhere on the page.
            detail: quest.status.charAt(0).toUpperCase() + quest.status.slice(1),
          }))}
        onChangeStatus={(status) => updateLocationStatus(location.id, status)}
        onOpenNPC={(npcId) => navigateToPage(`/npcs/${npcId}`)}
        onOpenQuest={(questId) =>
          navigateToPage(`/quests/${questId}`)
        }
        onOpenLocation={() => navigateToPage(`/locations/${location.id}`)}
      />
    ),
    [linked, getNPCById, getQuestById, updateLocationStatus, navigateToPage]
  );

  /**
   * One row, and the rows for whatever is inside it.
   *
   * Recursive, with a visited set and a depth cap: this is the traversal
   * `PERF-11` is about, and it now renders a control that can create the cycle.
   */
  const renderRow = useCallback(
    (
      location: Location,
      depth: number,
      visited: Set<string>,
      path?: string,
      isFirst = false
    ): React.ReactNode => {
      if (visited.has(location.id) || depth > HIGHLIGHT_DEPTH_CAP) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(location.id);

      // A flattened hit renders no children: they are already in the flat list
      // in their own right, and rendering them twice would put two elements
      // with the same `id` in the document -- which would also break
      // `?highlight=`, since it scrolls to the first `#location-<id>` it finds.
      const flat = Boolean(path);
      const children = flat
        ? []
        : childrenOf(index, location.id).filter((child) => matchesWithDescendants(child));
      const expanded = expandedLocations.has(location.id);

      return (
        <LocationTreeRow
          key={location.id}
          location={location}
          depth={depth}
          expanded={expanded}
          onToggle={() => toggleExpansion(location.id)}
          highlighted={highlightedLocationId === location.id}
          path={path}
          insideCount={insideCountOf(index, location.id)}
          npcCount={linked.get(location.id)?.npcIds.length ?? 0}
          questCount={linked.get(location.id)?.questIds.length ?? 0}
          summary={expanded ? summaryFor(location) : undefined}
          selected={selectedIds.has(location.id)}
          isFirst={isFirst}
          leadingControl={
            selecting ? (
              <input
                type="checkbox"
                aria-label={`Select ${location.name}`}
                checked={selectedIds.has(location.id)}
                onChange={(e) => setSelected(location.id, e.target.checked)}
              />
            ) : undefined
          }
        >
          {children.map((child) => renderRow(child, depth + 1, nextVisited))}
        </LocationTreeRow>
      );
    },
    [
      index,
      expandedLocations,
      matchesWithDescendants,
      toggleExpansion,
      highlightedLocationId,
      summaryFor,
      linked,
      selecting,
      selectedIds,
      setSelected,
    ]
  );

  if (isLoading) {
    return <RosterSkeleton label="Loading locations" />;
  }

  const rootRows = searching
    ? flatMatches.map((location) =>
        // A root's own path is empty, so a hit at the top level needs a
        // placeholder that still marks it as flattened.
        renderRow(location, 0, new Set(), pathLabelOf(locations, location.id, index) || 'the top level')
      )
    : index.roots
        .filter((location) => matchesWithDescendants(location))
        // The first draws no rule above it, as in every other directory.
        .map((location, i) => renderRow(location, 0, new Set(), undefined, i === 0));

  // Locations whose parentId names an id that isn't in the loaded set —
  // dangling references from a deleted or renamed parent (see #303). Kept
  // visible and reconciled against the status bar's total instead of silently
  // vanishing. A search has already flattened them into the list above.
  const orphanRows = searching
    ? []
    : index.orphans
        .filter((location) => matchesWithDescendants(location))
        .map((location) => renderRow(location, 0, new Set()));

  const nothingToShow = rootRows.filter(Boolean).length === 0 && orphanRows.filter(Boolean).length === 0;

  return (
    <div className="space-y-6">
      {/* One status bar that also filters, replacing the "All Status" dropdown */}
      <RosterStatusBar
        total={locations.length}
        totalLabel="charted so far"
        segments={statusSegments}
        activeKey={statusFilter}
        onSelect={setStatusFilter}
      />

      {/* Search and type filter, on one row rather than two stacked dropdowns */}
      <RosterFilterBar
        placeholder="Search locations..."
        value={searchQuery}
        onChange={setSearchQuery}
      >
        <RosterFilterPills
          options={TYPE_FILTERS}
          value={typeFilter}
          onChange={setTypeFilter}
          label="Filter by location type"
        />

        <Button
          variant={selection.active ? 'primary' : 'outline'}
          size="sm"
          onClick={selection.toggleActive}
        >
          {selection.active ? 'Exit Selection' : 'Select Locations'}
        </Button>
      </RosterFilterBar>

      {/* Batch actions -- only in selection mode, once something is ticked */}
      {selection.active && (
        <EntityBatchActions
          selected={selection.selected}
          noun={{ one: 'location', many: 'locations' }}
          statuses={BATCH_STATUSES}
          onStatus={updateLocationsStatus}
          // Mounted only while open: the plan walks every ticked subtree, and
          // each opening starts from the default answer.
          renderDeleteDialog={({ ids, isOpen, onClose, onDeleted }) => isOpen && (
            <DeleteLocationsDialog
              isOpen
              onClose={onClose}
              count={ids.length}
              plan={planBatchDelete(locations, ids)}
              onConfirm={async (strategy) => {
                await deleteLocations(ids, strategy);
                onDeleted();
              }}
            />
          )}
          onComplete={selection.clear}
        />
      )}

      {nothingToShow ? (
        locations.length > 0 ? (
          <RosterEmpty
            title="No locations match these filters"
            message="Try a different search term, or clear the filters to see everywhere you have charted."
          />
        ) : (
          <RosterEmpty
            mark
            title="Muninn hasn't been anywhere yet"
            message="Regions, cities, dungeons and the rooms inside them — each one can hold the notes, NPCs and quests you found there."
            action={
              <Button
                onClick={() => navigateToPage('/locations/create')}
                startIcon={<Plus className="w-4 h-4" />}
              >
                Add the first location
              </Button>
            }
          />
        )
      ) : (
        <>
          {rootRows.length > 0 && (
            <RosterGroup
              title={searching ? 'Matches' : 'Locations'}
              count={rootRows.filter(Boolean).length}
            >
              {searching && (
                <Typography
                  variant="body-sm"
                  color="secondary"
                  className="px-5 py-2 text-xs"
                >
                  Searching flattens the tree — each place is shown with the path
                  it sits on.
                </Typography>
              )}
              {rootRows}
            </RosterGroup>
          )}

          {orphanRows.length > 0 && (
            <RosterGroup title="Unplaced" count={orphanRows.filter(Boolean).length} muted>
              <Typography
                variant="body-sm"
                color="secondary"
                className="px-5 py-2 text-xs"
              >
                Each of these was filed inside a place that is no longer in this
                campaign — it was deleted, or the link to it broke. Open one and
                use Move elsewhere to put it back on the map.
              </Typography>
              {orphanRows}
            </RosterGroup>
          )}
        </>
      )}
    </div>
  );
};

export default LocationDirectory;
