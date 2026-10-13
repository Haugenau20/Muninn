// src/features/campaign-entities/rumors/components/RumorDirectory.tsx
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Rumor, RumorStatus, SourceType } from '../types';
import { useRumors } from '../context/RumorContext';
import { useNPCs } from '../../npcs/context/NPCContext';
import { useLocations } from '../../locations/context/LocationContext';
import { useCampaigns } from 'features/user-management';
import Button from '../../../../core/components/Button';
import RumorBatchActions from './RumorBatchActions';
import RumorComposer from './RumorComposer';
import RumorRowCells, { RUMOR_ROW_GRID } from './RumorRowCells';
import RumorRowEditor, {
  draftFromRumor,
  isDraftDirty,
  type RumorDraft,
} from './RumorRowEditor';
import { readDrafts, writeDrafts } from '../utils/draft-storage';
import { useNavigation } from 'shared/hooks/useNavigation';
import useHighlightTarget from 'shared/hooks/useHighlightTarget';
import useSelection from 'shared/hooks/useSelection';
import type { AttachKind } from 'shared/components/attach-tray/attachCandidates';
import {
  RUMOR_STATUS_FILL,
  normalizeRumorStatus,
} from '../utils/rumor-presentation';
import { rumorDisplayTitle, rumorTitleText, UNTITLED_RUMOR } from '../utils/rumor-title';
import {
  RosterStatusBar,
  RosterFilterBar,
  RosterFilterPills,
  RosterGroup,
  RosterRow,
  type RosterSegment,
  type RosterFilterOption,
  RosterSkeleton,
  RosterEmpty,
  RosterShowMore,
} from 'core/components/Roster';
import { ROSTER_PAGE_SIZE } from 'shared/utils/roster-paging';
import { useRosterGroupPaging } from 'shared/hooks/useRosterGroupPaging';

interface RumorDirectoryProps {
  rumors: Rumor[];
  isLoading?: boolean;
}

/**
 * Fixed, ordered groups, on `QuestDirectory`'s pattern rather than the
 * location-based grouping this list used to carry.
 *
 * **Location grouping was a lie the data could not support.** A rumour holds
 * `locationId` (where it was heard) *and* `relatedLocations` (what it is
 * about), so a rumour touching three places was filed under exactly one of
 * them, and a reader scanning "what have I heard about this place?" got
 * confident false negatives. `RumorStatus` has exactly three members, so
 * grouping by it gives every rumour list the same stable shape regardless of
 * the data, and nothing is filed anywhere it does not belong.
 *
 * The status bar above filters the same field, which looks like duplication
 * and is not: the bar answers "how many", the groups answer "which ones", and
 * `QuestDirectory` has carried both for the same reason since `15-3`.
 */
const STATUS_GROUPS: { key: RumorStatus; title: string }[] = [
  { key: 'unconfirmed', title: 'Unconfirmed' },
  { key: 'confirmed', title: 'Confirmed' },
  { key: 'false', title: 'False' },
];

/**
 * The one group that starts folded. See `RosterGroup.collapsible`.
 *
 * Confirmed was here too, by analogy with a finished quest, and the analogy
 * does not hold: a confirmed rumour is the thing the party *acts on*, and
 * folding it away hid the best-earned half of the list. False is the only
 * one that is genuinely done with -- it is still knowledge, still counted and
 * one click away, but nobody is going back to it.
 */
const COLLAPSED_BY_DEFAULT: RumorStatus[] = ['false'];

const SOURCE_FILTERS: RosterFilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'npc', label: 'NPC' },
  { value: 'tavern', label: 'Tavern' },
  { value: 'notice', label: 'Notice' },
  { value: 'traveler', label: 'Traveler' },
  { value: 'other', label: 'Other' },
];

/**
 * Status, the status word, the ramp stop and the source label all live in
 * `utils/rumor-presentation.ts`, so the row, the composer and the summary bar
 * cannot disagree about them.
 */

const RumorDirectory: React.FC<RumorDirectoryProps> = ({
  rumors: initialRumors,
  isLoading = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<RumorStatus | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceType | 'all'>('all');
  const [expandedRumorId, setExpandedRumorId] = useState<string | null>(null);
  const selection = useSelection();
  /** The rumour the composer just made, so its row opens with the caret in it. */
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  /**
   * The group an open row stays in, whatever its status becomes.
   *
   * **Changing a status from inside an open row used to throw it across the
   * page.** The ladder writes immediately -- `15-7` made that a gate, because
   * confirming a rumour mid-session must be one click -- and that was harmless
   * while the list grouped by location, since a status change moved nothing.
   * Grouping by status made the thing you most often change from this list
   * also the thing that re-sorts it, so the row you were reading and editing
   * vanished to somewhere else the instant you resolved it.
   *
   * Pinning fixes it at the right layer: **sorting** by status would have
   * moved the row just as surely as grouping does, so this is not a patch on
   * the grouping decision. The write still happens on the click; only the
   * row's *position* waits. It settles into its real group when the row
   * closes, and says so while it is open, so the list never quietly lies.
   */
  const [pinnedGroup, setPinnedGroup] = useState<{ id: string; status: RumorStatus } | null>(null);

  /**
   * Typed text for every open (or recently open) row, keyed by rumour id.
   *
   * **Held here rather than in the editor** (item 8). Filtering, sorting, or
   * another player's status change re-renders this list, and a row that stops
   * matching the filter unmounts with whatever was being typed in it. A draft
   * kept in the row's own state dies at that moment; kept here it survives the
   * re-render, the filter, and the trip back.
   */
  const { activeCampaignId } = useCampaigns();

  /**
   * Seeded from storage during render, **not in an effect**.
   *
   * The effect version of this destroyed exactly what it was meant to save,
   * and only outside the test suite. `index.tsx` wraps the app in
   * `React.StrictMode`, which mounts, runs every effect, and runs them all
   * again: the read restored the draft, the paired write-effect then stored
   * the still-empty state over it, and the second pass re-read the key it had
   * just emptied. A `useState` initializer runs during render, so the value is
   * already in state before any effect can overwrite it.
   *
   * Nothing here runs twice destructively, because nothing here writes.
   */
  const [drafts, setDrafts] = useState<Record<string, RumorDraft>>(() =>
    readDrafts(activeCampaignId)
  );

  /**
   * Switching campaign loads that campaign's drafts instead of carrying the
   * previous one's across.
   *
   * Guarded by a ref rather than by the dependency array alone, so the mount
   * -- already handled by the initializer above -- does not read a second
   * time.
   */
  const draftsLoadedFor = useRef(activeCampaignId);
  useEffect(() => {
    if (draftsLoadedFor.current === activeCampaignId) return;
    draftsLoadedFor.current = activeCampaignId;
    setDrafts(readDrafts(activeCampaignId));
  }, [activeCampaignId]);

  /**
   * Stored on the edit that caused it, rather than by an effect watching the
   * state. An effect cannot tell "the user typed" from "we just hydrated",
   * and treating the second as the first is what wiped the key.
   */
  const commitDrafts = (next: Record<string, RumorDraft>) => {
    setDrafts(next);
    writeDrafts(activeCampaignId, next);
  };

  const { addRumor, deleteRumor, updateRumor, updateRumorStatus } = useRumors();
  const { npcs } = useNPCs();
  const { locations } = useLocations();
  const { navigateToPage, getCurrentQueryParams } = useNavigation();
  const { highlight: highlightId } = getCurrentQueryParams();

  /**
   * T014: one hook, four consumers.
   *
   * This directory matched by id already, but never expanded the target -- so
   * a link landed on a row that was still closed.
   */
  const { highlightedId: highlightedRumorId } = useHighlightTarget({
    items: initialRumors,
    highlight: highlightId,
    idOf: (rumor: Rumor) => rumor.id,
    domIdPrefix: 'rumor',
    onReveal: ([rumorId]) => {
      openRow(rumorId);
      // A rumour arriving here with nothing written in it was just created by
      // the global create menu, which has no surface of its own -- so this is
      // where it gets its caret, exactly as the composer's row does.
      //
      // Only an empty one. A pasted link to a rumour somebody wrote last week
      // opens the row and leaves the caret alone; stealing focus into a field
      // the reader did not ask to edit is how a link becomes an accident.
      const target = initialRumors.find((rumor) => rumor.id === rumorId);
      if (target && !(target.title ?? '').trim() && !(target.content ?? '').trim()) {
        setJustAddedId(rumorId);
      }
    },
  });

  /**
   * Rumours carrying text that has not been saved.
   *
   * A draft is only interesting once it differs from the record -- opening a
   * row seeds one identical to it, and marking that as unsaved would cry wolf
   * on every row anybody looked at. `isDraftDirty` is shared with the editor
   * so the marker and the Save button can never disagree.
   */
  const unsavedIds = useMemo(() => {
    const ids = new Set<string>();
    initialRumors.forEach((rumor) => {
      if (isDraftDirty(rumor, drafts[rumor.id])) ids.add(rumor.id);
    });
    return ids;
  }, [initialRumors, drafts]);

  /**
   * The browser's own guard, for the one exit this page cannot otherwise
   * survive: closing the tab or reloading, which takes `sessionStorage`'s
   * usefulness with it for a reload and the whole session for a close.
   *
   * In-app navigation needs no dialog -- the draft is still there when you
   * come back, which is a better answer than asking somebody to confirm a
   * loss. The wording is the browser's; it cannot be set.
   */
  useEffect(() => {
    if (unsavedIds.size === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Assigning returnValue is what still arms the prompt in Chrome and
      // Safari; preventDefault alone is the newer spec and not yet enough.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsavedIds]);

  /**
   * Open one row, or close whatever is open, pinning its group either way.
   *
   * Every path that expands or collapses a row goes through here, so a pin can
   * never outlive the row that owns it. See {@link pinnedGroup}.
   */
  const openRow = (rumorId: string | null) => {
    setExpandedRumorId(rumorId);
    setPinnedGroup(
      rumorId
        ? {
            id: rumorId,
            // A rumour the composer just made is not in `initialRumors` until
            // the refresh lands; `unconfirmed` is both the fallback and what
            // it was created as.
            status: normalizeRumorStatus(
              initialRumors.find((rumor) => rumor.id === rumorId)?.status
            ),
          }
        : null
    );
  };

  /**
   * Which group a rumour renders under: its pinned one while it is open, its
   * real one otherwise.
   */
  const groupOf = useCallback(
    (rumor: Rumor): RumorStatus =>
      pinnedGroup?.id === rumor.id ? pinnedGroup.status : normalizeRumorStatus(rumor.status),
    [pinnedGroup]
  );

  // The group a deep-linked rumour sits in is opened for it (T101).
  const highlightedRumor = highlightedRumorId
    ? initialRumors.find(rumor => rumor.id === highlightedRumorId)
    : undefined;
  const paging = useRosterGroupPaging(
    COLLAPSED_BY_DEFAULT,
    highlightedRumor ? groupOf(highlightedRumor) : null
  );

  // Status counts drive the one bar that replaced the "All Status" dropdown.
  // Confirmed / unconfirmed / false are the entire status enum, so the three
  // segments sum to the total and the bar needs no separate "other" bucket.
  const statusSegments: RosterSegment[] = useMemo(() => {
    // Normalised, so the three bands still sum to the total even when a
    // record stores a status the enum does not have. See
    // `normalizeRumorStatus` for how one gets in.
    const count = (status: RumorStatus) =>
      initialRumors.filter(rumor => normalizeRumorStatus(rumor.status) === status).length;
    return [
      // False wears the red of a failed quest (see RUMOR_STATUS_TONE), so
      // its band stands apart from confirmed's.
      { key: 'confirmed', label: 'confirmed', count: count('confirmed'), colorClass: RUMOR_STATUS_FILL.confirmed },
      { key: 'unconfirmed', label: 'unconfirmed', count: count('unconfirmed'), colorClass: RUMOR_STATUS_FILL.unconfirmed },
      { key: 'false', label: 'false', count: count('false'), colorClass: RUMOR_STATUS_FILL.false },
    ];
  }, [initialRumors]);

  // Filter rumors based on search and filters. Location is deliberately not
  // part of this filter set — see the grouping rationale below.
  const filteredRumors = useMemo(() => {
    return initialRumors.filter(rumor => {
      // The *pinned* group, not the stored status: a filtered list must not
      // do by the back door what pinning exists to prevent.
      if (statusFilter !== 'all' && groupOf(rumor) !== statusFilter) {
        return false;
      }

      if (sourceFilter !== 'all' && rumor.sourceType !== sourceFilter) {
        return false;
      }

      if (searchQuery) {
        const search = searchQuery.toLowerCase();
        return (
          rumorTitleText(rumor).toLowerCase().includes(search) ||
          rumor.content.toLowerCase().includes(search) ||
          rumor.sourceName.toLowerCase().includes(search) ||
          (rumor.createdByUsername && rumor.createdByUsername.toLowerCase().includes(search))
        );
      }

      return true;
    });
  }, [initialRumors, statusFilter, sourceFilter, searchQuery, groupOf]);

  // Grouped by status, in the fixed order above, skipping groups with nothing
  // left after filtering.
  const groupedRumors = useMemo(
    () =>
      STATUS_GROUPS.map(group => ({
        ...group,
        // `groupOf`, so no row can match none of the three and vanish, and so
        // an open row holds its place. The heading's count is this array's
        // length, which means **the count describes the rows under it** rather
        // than the stored data; the summary bar above is what follows the
        // data, and its ticking over is the confirmation that the write
        // landed.
        rumors: filteredRumors.filter(rumor => groupOf(rumor) === group.key),
      })).filter(group => group.rumors.length > 0),
    [filteredRumors, groupOf]
  );

  // The quest this rumour became, at its own address (`15-5` item 11). A
  // rumour could be converted into a quest and then not refer to it; this is
  // the link that closes that.
  const handleQuestClick = (questId: string) => {
    navigateToPage(`/quests/${questId}`);
  };

  /**
   * Create a rumour from the composer and open its row.
   *
   * What the composer captured is the **content**: the sentence somebody said
   * out loud. The title is left empty and the list names the row from that
   * sentence until somebody shortens it on purpose. `sourceType` is left
   * absent rather than defaulted to `'other'` -- nobody has been asked yet,
   * and answering on their behalf is what made the row and the editor
   * disagree.
   */
  const handleAdd = async (content: string): Promise<string> => {
    const id = await addRumor({
      title: '',
      content,
      status: 'unconfirmed',
      sourceName: '',
      relatedNPCs: [],
      relatedLocations: [],
      notes: [],
    });
    openRow(id);
    setJustAddedId(id);
    return id;
  };

  const setDraft = (rumorId: string, patch: Partial<RumorDraft>, rumor: Rumor) =>
    commitDrafts({
      ...drafts,
      [rumorId]: { ...(drafts[rumorId] ?? draftFromRumor(rumor)), ...patch },
    });

  const clearDraft = (rumorId: string) => {
    const next = { ...drafts };
    delete next[rumorId];
    commitDrafts(next);
  };

  /** Every write here re-reads through the context, as the pages do. */
  const handleSave = async (rumor: Rumor, draft: RumorDraft) => {
    await updateRumor(rumor.id, {
      title: draft.title,
      content: draft.content,
      // Normalised on the way out: see `Rumor.sourceType` for why this is
      // never `undefined`.
      sourceType: draft.sourceType ?? null,
      sourceName: draft.sourceName,
      ...(draft.sourceNpcId ? { sourceNpcId: draft.sourceNpcId } : { sourceNpcId: '' }),
    });
    clearDraft(rumor.id);
  };

  const handleDelete = async (rumorId: string) => {
    await deleteRumor(rumorId);
    clearDraft(rumorId);
    if (expandedRumorId === rumorId) openRow(null);
  };

  /**
   * What a rumour points at, attached in place.
   *
   * A location can mean two things to a rumour -- where it was heard
   * (`locationId`) and what it is about (`relatedLocations`) -- and the tray
   * cannot ask which. It writes the one the record is missing: the first place
   * attached becomes where it was heard, because that is what the directory
   * groups by and what a reader sees first; later ones are what it points at.
   */
  const handleAttach = async (rumor: Rumor, id: string, kind: AttachKind) => {
    // Lists are worked out from the rumour the server holds (T083), so a
    // person another player attached a moment ago stays attached.
    if (kind === 'npc') {
      await updateRumor(rumor.id, (current) => ({
        relatedNPCs: Array.from(new Set([...(current.relatedNPCs ?? []), id])),
      }));
      return;
    }

    const place = locations.find((candidate) => candidate.id === id);
    if (!rumor.locationId) {
      await updateRumor(rumor.id, { locationId: id, location: place?.name ?? '' });
      return;
    }

    await updateRumor(rumor.id, (current) => ({
      relatedLocations: Array.from(new Set([...(current.relatedLocations ?? []), id])),
    }));
  };

  /**
   * Remove one relation, found by its kind: a person and a place may share an
   * id, and detaching one must leave the other attached (DATA-008).
   */
  const handleDetach = async (rumor: Rumor, id: string, kind: AttachKind) => {
    if (kind === 'npc') {
      await updateRumor(rumor.id, (current) => ({
        relatedNPCs: (current.relatedNPCs ?? []).filter((existing) => existing !== id),
      }));
      return;
    }

    if (id === rumor.locationId) {
      await updateRumor(rumor.id, { locationId: '', location: '' });
      return;
    }

    await updateRumor(rumor.id, (current) => ({
      relatedLocations: (current.relatedLocations ?? []).filter((existing) => existing !== id),
    }));
  };

  if (isLoading) {
    return <RosterSkeleton label="Loading rumours" />;
  }

  return (
    <div className="space-y-6">
      {/* One status bar that also filters, replacing the "All Status" dropdown */}
      <RosterStatusBar
        total={initialRumors.length}
        totalLabel="rumours gathered"
        segments={statusSegments}
        activeKey={statusFilter}
        onSelect={key => setStatusFilter(key as RumorStatus | 'all')}
      />

      {/* Search and source filter, on one row rather than three stacked dropdowns */}
      <RosterFilterBar
        placeholder="Search rumours..."
        value={searchQuery}
        onChange={setSearchQuery}
      >
        <RosterFilterPills
          options={SOURCE_FILTERS}
          value={sourceFilter}
          onChange={value => setSourceFilter(value as SourceType | 'all')}
          label="Filter by source"
        />

        <Button
          variant={selection.active ? 'primary' : 'outline'}
          size="sm"
          onClick={selection.toggleActive}
        >
          {selection.active ? 'Exit Selection' : 'Select Rumours'}
        </Button>
      </RosterFilterBar>

      {/* Batch actions bar — only visible in selection mode, once something is selected */}
      {selection.active && (
        <RumorBatchActions
          selectedRumors={selection.selected}
          onComplete={selection.clear}
        />
      )}

      {/*
        The composer, permanently at the top of the list (item 1). Not behind a
        button and not on a route: a rumour is written down while somebody is
        still talking.

        Hidden only in selection mode, where every row has become a checkbox
        and the bar above acts on what is ticked -- adding a new rumour in the
        middle of choosing which ones to combine is not a thing anyone is
        doing.
      */}
      {!selection.active && <RumorComposer onAdd={handleAdd} />}

      {/* Rumor roster by status */}
      {groupedRumors.length > 0 ? (
        groupedRumors.map(group => {
          const collapsed = paging.isCollapsed(group.key);
          // Each group pages on its own, folded or not (T101).
          const limit = paging.limitFor(
            group.key,
            group.rumors.findIndex(rumor => rumor.id === highlightedRumorId)
          );
          const rows = group.rumors.slice(0, limit);
          return (
            <React.Fragment key={group.key}>
              <RosterGroup
                title={group.title}
                count={group.rumors.length}
                collapsible={COLLAPSED_BY_DEFAULT.includes(group.key)}
                collapsed={collapsed}
                onCollapsedChange={value => paging.setCollapsed(group.key, value)}
              >
                {rows.map((rumor, index) => {
                  const isExpanded = expandedRumorId === rumor.id;
                  const displayed = rumorDisplayTitle(rumor);
                  const name = displayed ?? UNTITLED_RUMOR;

                  return (
                    <RosterRow
                      key={rumor.id}
                      id={`rumor-${rumor.id}`}
                      entityId={rumor.id}
                      entityName={name}
                      gridClassName={RUMOR_ROW_GRID}
                      isFirst={index === 0}
                      highlighted={highlightedRumorId === rumor.id}
                      expanded={isExpanded}
                      toggleLabel={name}
                      onToggle={() => openRow(isExpanded ? null : rumor.id)}
                      selected={selection.selected.has(rumor.id)}
                      leadingControl={
                        selection.active ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${name}`}
                            checked={selection.selected.has(rumor.id)}
                            onChange={(e) => selection.setSelected(rumor.id, e.target.checked)}
                          />
                        ) : undefined
                      }
                      expandedContent={
                        /*
                          The whole record, in the row (item 2). This is the one
                          entity where §1.3's four-fact bound does not apply,
                          because there is no page holding the remainder.
                        */
                        <RumorRowEditor
                          rumor={rumor}
                          draft={drafts[rumor.id]}
                          onDraftChange={(patch) => setDraft(rumor.id, patch, rumor)}
                          onSave={(draft) => handleSave(rumor, draft)}
                          onCollapse={() => {
                            clearDraft(rumor.id);
                            openRow(null);
                          }}
                          onDelete={() => handleDelete(rumor.id)}
                          onStatusChange={(status) => updateRumorStatus(rumor.id, status)}
                          onAttach={(id, kind) => handleAttach(rumor, id, kind)}
                          onDetach={(id, kind) => handleDetach(rumor, id, kind)}
                          sources={{ npc: npcs, location: locations }}
                          autoFocus={justAddedId === rumor.id}
                          onOpenQuest={handleQuestClick}
                          movesTo={
                            normalizeRumorStatus(rumor.status) === groupOf(rumor)
                              ? null
                              : normalizeRumorStatus(rumor.status)
                          }
                        />
                      }
                    >
                      <RumorRowCells
                        rumor={{
                          name,
                          untitled: !displayed,
                          sourceName: rumor.sourceName,
                          status: rumor.status,
                          sourceType: rumor.sourceType,
                          convertedToQuest: Boolean(rumor.convertedToQuestId),
                          unsaved: unsavedIds.has(rumor.id),
                        }}
                      />
                    </RosterRow>
                  );
                })}
              </RosterGroup>
              {!collapsed && rows.length < group.rumors.length && (
                <RosterShowMore
                  shown={rows.length}
                  total={group.rumors.length}
                  step={ROSTER_PAGE_SIZE}
                  noun={`${group.title.toLowerCase()} rumours`}
                  onShowMore={() => paging.showMore(group.key, limit)}
                />
              )}
            </React.Fragment>
          );
        })
      ) : initialRumors.length > 0 ? (
        <RosterEmpty
          title="No rumours match these filters"
          message="Try a different search term, or clear the filters to see everything the party has heard."
        />
      ) : (
        /*
          No action here any more: the composer above *is* the way to add the
          first rumour, and it is already on screen. A button pointing at
          `/rumors/create` would send someone away from the control they are
          looking at (item 1, and the empty-campaign gate).
        */
        <RosterEmpty
          mark
          title="Muninn hasn't heard any rumours yet"
          message="Overheard in a tavern, posted on a notice board, told by someone who may be lying — title it above and mark it confirmed when you find out."
        />
      )}
    </div>
  );
};

export default RumorDirectory;
