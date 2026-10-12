import React, { useState, useMemo, useEffect } from 'react';
import { NPC, NPCRelationship, NPCStatus } from '../types';
import { useLocations } from '../../locations/context/LocationContext';
import { useNPCs } from '../context/NPCContext';
import { indexLocationNames, resolveLocationName } from '../../locations/utils/location-display';
import Button from '../../../../core/components/Button';
import Typography from '../../../../core/components/Typography';
import { Plus } from 'lucide-react';
import { useNavigation } from 'shared/context/NavigationContext';
import useHighlightTarget from 'shared/hooks/useHighlightTarget';
import useSelection from 'shared/hooks/useSelection';
import StateLadder from 'shared/components/row-controls/StateLadder';
import useCreatorName from 'shared/hooks/useCreatorName';
import DeleteConfirmationDialog from 'shared/components/DeleteConfirmationDialog';
import EntityBatchActions, { type BatchStatusOption } from '../../shared/EntityBatchActions';
import NPCRowNotes from './NPCRowNotes';
import NPCRowCells, { NPC_ROW_GRID } from './NPCRowCells';
import NPCExample from './NPCExample';
import {
  RosterStatusBar,
  RosterFilterBar,
  RosterFilterPills,
  RosterGroup,
  RosterRow,
  RosterField,
  type RosterSegment,
  RosterSkeleton,
  RosterEmpty,
  RosterShowMore,
} from 'core/components/Roster';
import { ROSTER_PAGE_SIZE, pageGroups, limitReaching } from 'shared/utils/roster-paging';

interface NPCDirectoryProps {
  npcs: NPC[];
  isLoading?: boolean;
  onNPCUpdate?: (updatedNPC: NPC) => void;
  /** Called after an NPC has been deleted from the directory. */
  onNPCDelete?: (npcId: string) => void;
}

const RELATIONSHIP_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'hostile', label: 'Hostile' },
  { value: 'unknown', label: 'Unknown' },
];

/**
 * Stance: the only valenced thing in the NPC list, and always also a word
 * (design language §2).
 *
 * These four carried `selectedClassName: 'disposition-*'` until `15-6`.
 * `StateLadder` stopped reading that prop in `15-4`, and nothing failed: an
 * options array declared as a `const` is a wider type than the prop it is
 * passed to, so TypeScript's excess-property check never runs on it. The
 * classes are real and are still what paints the *word* in the row -- they
 * were simply being handed to something that had stopped listening.
 * `ladder-classes.test.ts` is the gate that now says so.
 */
const STANCE_OPTIONS: Array<{
  value: NPCRelationship;
  label: string;
}> = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'hostile', label: 'Hostile' },
  { value: 'unknown', label: 'Unknown' },
];

/**
 * The batch actions' statuses, best to worst as the status bar orders them.
 * Plain words with no icon or hue: presence carries none here (`STATUS_TONE`),
 * and a death is not an error.
 */
const BATCH_STATUSES: Array<BatchStatusOption<NPCStatus>> = [
  { value: 'alive', label: 'Mark Alive' },
  { value: 'unknown', label: 'Mark Unknown' },
  { value: 'missing', label: 'Mark Missing' },
  { value: 'deceased', label: 'Mark Deceased' },
];

/**
 * Who recorded the NPC, named as the NPC's own page names them. A component
 * of its own because the rows are drawn in a loop, and a hook cannot be.
 */
const RecordedBy: React.FC<{ npc: NPC }> = ({ npc }) => {
  const creator = useCreatorName(npc);
  return (
    <RosterField label="Recorded by" emptyText="Unknown">
      {creator ? <Typography variant="body-sm">{creator}</Typography> : undefined}
    </RosterField>
  );
};

const NPCDirectory: React.FC<NPCDirectoryProps> = ({
  npcs: initialNpcs,
  isLoading = false,
  onNPCUpdate,
  onNPCDelete
}) => {
  // Track npcs locally
  const [npcs, setNpcs] = useState<NPC[]>(initialNpcs);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [relationshipFilter, setRelationshipFilter] = useState<string>('all');
  const [expandedNpcId, setExpandedNpcId] = useState<string | null>(null);
  /** How many rows the roster mounts; "Show more" raises it (T101). */
  const [rowLimit, setRowLimit] = useState(ROSTER_PAGE_SIZE);
  const { locations } = useLocations();
  /** One lookup per row, not a search of every place (T101). */
  const locationIndex = useMemo(() => indexLocationNames(locations), [locations]);
  const { updateNPCRelationship, deleteNPC, updateNPCsStatus, deleteNPCs } = useNPCs();
  /** The NPC whose Delete was pressed, awaiting confirmation. */
  const [confirmingDelete, setConfirmingDelete] = useState<NPC | null>(null);
  /** Selection mode for the batch actions (T017). */
  const selection = useSelection();
  const { navigateToPage, createPath } = useNavigation();

  const { getCurrentQueryParams } = useNavigation();

  // Update when props change
  useEffect(() => {
    setNpcs(initialNpcs);
  }, [initialNpcs]);

  /**
   * Delete the NPC once confirmed. The row leaves through the provider's
   * listener, not a local filter: this button once only hid the row and wrote
   * nothing, so the NPC came back on the next change (T078). A failure stays
   * in the dialog, which reports it.
   */
  const handleConfirmDelete = async () => {
    if (!confirmingDelete) return;
    const npcId = confirmingDelete.id;
    await deleteNPC(npcId);
    setConfirmingDelete(null);
    onNPCDelete?.(npcId);
  };

  // Handle location click
  const handleLocationClick = (location: string) => {
    // The stored value may already be an id, or the free text a player wrote.
    // A location that resolves to a record opens its own page (T014); free
    // text that names no record has no page, so it falls back to the directory.
    const match = locations.find(
      (loc) => loc.id === location || loc.name.toLowerCase() === location.toLowerCase()
    );
    if (match) {
      navigateToPage(`/locations/${match.id}`);
      return;
    }
    navigateToPage(createPath('/locations', {}, { highlight: location }));
  };

  /**
   * T014: one hook, four consumers.
   *
   * Deliberately no location filtering here. Arriving from a link used to set
   * `locationFilter` to the target's location, which silently hid every other
   * group and explained itself only through a small "Clear location:" ghost
   * button. The roster already groups by location, so the target's group is
   * visually separated anyway -- highlighting, expanding and scrolling is the
   * whole job.
   */
  const { highlightedId: highlightedNpcId } = useHighlightTarget({
    items: npcs,
    highlight: getCurrentQueryParams().highlight,
    idOf: (npc) => npc.id,
    domIdPrefix: 'npc',
    onReveal: ([npcId]) => setExpandedNpcId(npcId),
  });

  // Status counts drive the one bar that replaced four stat cards
  const statusSegments: RosterSegment[] = useMemo(() => {
    const count = (status: string) => npcs.filter(npc => npc.status === status).length;
    return [
      // Best to worst, left to right, like every other directory's bar.
      { key: 'alive', label: 'alive', count: count('alive'), colorClass: 'bg-valence-0' },
      { key: 'unknown', label: 'unknown', count: count('unknown'), colorClass: 'bg-valence-1' },
      { key: 'missing', label: 'missing', count: count('missing'), colorClass: 'bg-valence-2' },
      { key: 'deceased', label: 'deceased', count: count('deceased'), colorClass: 'bg-valence-3' },
    ];
  }, [npcs]);

  // Filter NPCs based on search and filters
  const filteredNPCs = useMemo(() => {
    return npcs.filter(npc => {
      // Search filter
      const searchMatch = searchQuery === '' ||
        npc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        npc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (npc.title && npc.title.toLowerCase().includes(searchQuery.toLowerCase()));

      // Status filter
      const statusMatch = statusFilter === 'all' || npc.status === statusFilter;

      // Relationship filter
      const relationshipMatch = relationshipFilter === 'all' ||
        npc.relationship === relationshipFilter;

      // Location is the grouping, not a filter — see the highlight effect above.
      return searchMatch && statusMatch && relationshipMatch;
    });
  }, [npcs, searchQuery, statusFilter, relationshipFilter]);

  // Each person's first place: the first place, in the places' order, whose
  // list names them (T131), as their own page shows it. One pass over the
  // places rather than one per person.
  const firstPlaceOf = useMemo(() => {
    const first = new Map<string, string>();
    for (const location of locations) {
      for (const npcId of location.connectedNPCs ?? []) {
        if (!first.has(npcId)) first.set(npcId, location.name);
      }
    }
    return first;
  }, [locations]);

  // Group NPCs by location for display: their first place, else what their
  // own record says, as `resolveLocationName` reads it -- the free text, or a
  // reference to a place since deleted, visible as one (#1412; see the
  // contract on `NPC.location`). Grouping on a stored id verbatim printed
  // slugs as headings -- "mines-of-moria" where the Locations page says
  // "Mines of Moria".
  const groupedNPCs = useMemo(() => {
    return filteredNPCs.reduce((acc, npc) => {
      const location =
        firstPlaceOf.get(npc.id) ??
        resolveLocationName({ locationId: npc.locationId, location: npc.location }, locationIndex) ??
        'Location unknown';
      if (!acc[location]) {
        acc[location] = [];
      }
      acc[location].push(npc);
      return acc;
    }, {} as Record<string, NPC[]>);
  }, [filteredNPCs, firstPlaceOf, locationIndex]);

  if (isLoading) {
    return <RosterSkeleton label="Loading NPCs" />;
  }

  const allGroups = Object.entries(groupedNPCs);
  // A deep link reaches its NPC however far down the roster it sits.
  const highlightedIndex = highlightedNpcId
    ? allGroups.flatMap(([, list]) => list).findIndex((npc) => npc.id === highlightedNpcId)
    : -1;
  const limit = limitReaching(rowLimit, highlightedIndex);
  const roster = pageGroups(allGroups, limit);

  return (
    <div className="space-y-6">
      {/* One status bar that also filters, replacing four non-clickable stat cards */}
      <RosterStatusBar
        total={npcs.length}
        totalLabel="met so far"
        segments={statusSegments}
        activeKey={statusFilter}
        onSelect={setStatusFilter}
      />

      {/* Search and filters, on one row rather than four stacked dropdowns */}
      <RosterFilterBar
        placeholder="Search name, title or description"
        value={searchQuery}
        onChange={setSearchQuery}
      >
        <RosterFilterPills
          options={RELATIONSHIP_FILTERS}
          value={relationshipFilter}
          onChange={setRelationshipFilter}
          label="Filter by relationship"
        />

        <Button
          variant={selection.active ? 'primary' : 'outline'}
          size="sm"
          onClick={selection.toggleActive}
        >
          {selection.active ? 'Exit Selection' : 'Select NPCs'}
        </Button>
      </RosterFilterBar>

      {/* Batch actions -- only in selection mode, once something is ticked */}
      {selection.active && (
        <EntityBatchActions
          selected={selection.selected}
          noun={{ one: 'NPC', many: 'NPCs' }}
          statuses={BATCH_STATUSES}
          onStatus={updateNPCsStatus}
          onDelete={deleteNPCs}
          deleteConsequence="Their pages, notes and portraits go with them."
          onComplete={selection.clear}
        />
      )}

      {/* NPC roster by location */}
      {roster.groups.length > 0 ? (
        roster.groups.map(({ key: location, rows: locationNPCs, total: groupTotal }) => {
          const isUnknown = location === 'Location unknown';

          return (
            <RosterGroup
              key={location}
              title={location}
              count={groupTotal}
              muted={isUnknown}
              onOpen={isUnknown ? undefined : () => handleLocationClick(location)}
            >
              {locationNPCs.map((npc, index) => {
                const isExpanded = expandedNpcId === npc.id;

                return (
                  <RosterRow
                    key={npc.id}
                    id={`npc-${npc.id}`}
                    entityId={npc.id}
                    entityName={npc.name}
                    gridClassName={NPC_ROW_GRID}
                    isFirst={index === 0}
                    highlighted={highlightedNpcId === npc.id}
                    expanded={isExpanded}
                    toggleLabel={npc.name}
                    onToggle={() => setExpandedNpcId(isExpanded ? null : npc.id)}
                    selected={selection.selected.has(npc.id)}
                    leadingControl={
                      selection.active ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${npc.name}`}
                          checked={selection.selected.has(npc.id)}
                          onChange={(e) => selection.setSelected(npc.id, e.target.checked)}
                        />
                      ) : undefined
                    }
                    expandedContent={
                      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-7 pt-4">
                        <div className="flex flex-col gap-4">
                          <RosterField
                            label="Description"
                            emptyText="Nothing written yet"
                          >
                            {npc.description ? (
                              <Typography variant="body-sm">{npc.description}</Typography>
                            ) : undefined}
                          </RosterField>

                          {/*
                            Stance, changed from the row in one click. It is the
                            field that changes most and the one people currently
                            open a whole form for (S6). Presence -- deceased --
                            is a different thing and stays where it is: muted ink
                            and a strike, never a valenced step on this ladder.
                          */}
                          <StateLadder
                            label="Stance"
                            options={STANCE_OPTIONS}
                            value={npc.relationship}
                            ariaLabel={`Stance of ${npc.name}`}
                            onChange={async (relationship) => {
                              await updateNPCRelationship(npc.id, relationship);
                              /*
                                And then tell the page. `updateNPCRelationship`
                                refreshes the provider's copy of the collection,
                                and `NPCsPage` now renders that copy, so this
                                call is belt-and-braces rather than the thing
                                carrying the fix -- which is what it used to be.
                                It was once a declared, destructured, never-called
                                prop, and the stance someone picked stayed on the
                                old word because of it (T046).
                              */
                              onNPCUpdate?.({ ...npc, relationship });
                            }}
                          />

                          <NPCRowNotes npc={npc} />
                        </div>

                        <div className="flex flex-col gap-4">
                          <RosterField label="Race" emptyText="Unrecorded">
                            {npc.race ? (
                              <Typography variant="body-sm">{npc.race}</Typography>
                            ) : undefined}
                          </RosterField>

                          <RecordedBy npc={npc} />

                          <div className="flex flex-wrap gap-2 mt-1">
                            {/* The way into the NPC's own page. It lives in the
                                expanded content, never in the collapsed row:
                                the collapsed row is the highest-frequency
                                surface in the product and does not get a second
                                control (D41). A row that is already open has
                                said it wants more. */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => navigateToPage(`/npcs/${npc.id}`)}
                            >
                              More info
                            </Button>
                            {/* Edit used to sit here and leave for
                                `/npcs/edit/:id`. That route is a redirect back
                                to this NPC's page since `15-8`, because the
                                page edits every field in place -- so the
                                control would have been a longer way to press
                                *More info*. */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmingDelete(npc)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    }
                  >
                    <NPCRowCells npc={npc} />
                  </RosterRow>
                );
              })}
            </RosterGroup>
          );
        })
      ) : npcs.length > 0 ? (
        // Emptied by a filter, not by the campaign. The fix is to change the
        // filter, so no action is offered -- "Add an NPC" would answer a
        // question nobody asked.
        <RosterEmpty
          title="No NPCs match these filters"
          message="Try a different search term, or clear the filters to see everyone you have met."
        />
      ) : (
        <>
          <RosterEmpty
            mark
            title="Muninn hasn't met anyone yet"
            message="Every person the party meets can live here — name, standing, where you found them, and what they told you."
            action={
              <Button
                onClick={() => navigateToPage('/npcs/create')}
                startIcon={<Plus className="w-4 h-4" />}
              >
                Add the first NPC
              </Button>
            }
          />
          {/* What the page will hold, while it holds nothing (T150). */}
          <NPCExample />
        </>
      )}

      {roster.shown < roster.total && (
        <RosterShowMore
          shown={roster.shown}
          total={roster.total}
          step={ROSTER_PAGE_SIZE}
          noun="NPCs"
          onShowMore={() => setRowLimit(limit + ROSTER_PAGE_SIZE)}
        />
      )}

      {confirmingDelete && (
        <DeleteConfirmationDialog
          isOpen
          onClose={() => setConfirmingDelete(null)}
          onConfirm={handleConfirmDelete}
          itemName={confirmingDelete.name}
          itemType="NPC"
        />
      )}
    </div>
  );
};

export default NPCDirectory;
