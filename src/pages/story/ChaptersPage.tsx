// pages/story/ChaptersPage.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  useStory,
  BookshelfView,
  ChapterList,
  ChapterExample,
  deriveChapterProgress,
  summariseProgress,
  filterChapters,
} from 'features/storytelling';
import { useNavigation } from 'shared/context/NavigationContext';
import { usePageGate, GatedContent } from 'shared/components/gated';
import PageShell from 'shared/components/page-shell/PageShell';
import { RosterEmpty, RosterBatchBar } from 'core/components/Roster';
import DeleteConfirmationDialog from 'shared/components/DeleteConfirmationDialog';
import useSelection from 'shared/hooks/useSelection';
import Breadcrumb from 'shared/components/Breadcrumb';
import Button from 'core/components/Button';
import ResumeBar from './components/ResumeBar';
import StoryViewTabs from './components/StoryViewTabs';
import { Plus, List, Grid, Trash } from 'lucide-react';
import { clsx } from 'clsx';
import { readLocalStorage, writeLocalStorage } from 'core/utils/local-storage';

/** localStorage key for the list/shelf view toggle. */
const VIEW_PREFERENCE_KEY = 'chapters-view-preference';
/** localStorage key for the all/unread filter pill. */
const FILTER_PREFERENCE_KEY = 'chapters-filter-preference';

type ViewMode = 'list' | 'shelf';
type FilterMode = 'all' | 'unread';

/**
 * Normalises a stored view preference. The pre-redesign page stored
 * `'table' | 'bookshelf'`; those values are read as `'list'` and `'shelf'`
 * respectively so an existing visitor's preference survives the rename.
 */
function normaliseViewMode(stored: string | null): ViewMode {
  if (stored === 'list' || stored === 'table') return 'list';
  return 'shelf';
}

function normaliseFilterMode(stored: string | null): FilterMode {
  return stored === 'unread' ? 'unread' : 'all';
}

/** "1 chapter", "3 chapters". */
const countChapters = (n: number) => `${n} chapter${n === 1 ? '' : 's'}`;

/**
 * Session chapters index: campaign-wide resume bar, a search + unread
 * filter row, and the chapter list itself in either list or shelf form.
 *
 * Also serves as the `/story` landing route (see `app/App.tsx`) now that
 * the dedicated selection page is gone — the segmented control
 * (`StoryViewTabs`) is what lets a visitor get to the saga from here.
 *
 * The five gated states (signed-out, no campaign chosen, still resolving,
 * error, ready) live in `usePageGate`/`GatedContent`; this page describes
 * only itself — its title, its header controls and its own content.
 */
const ChaptersPage: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    normaliseViewMode(readLocalStorage(VIEW_PREFERENCE_KEY))
  );
  const [filterMode, setFilterMode] = useState<FilterMode>(() =>
    normaliseFilterMode(readLocalStorage(FILTER_PREFERENCE_KEY))
  );
  const [searchQuery, setSearchQuery] = useState('');

  const { chapters, storyProgress, isLoading, deleteChapters } = useStory();
  const { navigateToPage } = useNavigation();
  /** Selection mode for deleting several chapters at once (T017); the list view only. */
  const selection = useSelection();
  const { clear: clearSelection } = selection;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const gate = usePageGate('story', { loading: isLoading });

  useEffect(() => {
    writeLocalStorage(VIEW_PREFERENCE_KEY, viewMode);
    // The shelf has no checkboxes, so a selection made in the list cannot follow it there.
    if (viewMode !== 'list') clearSelection();
  }, [viewMode, clearSelection]);

  useEffect(() => {
    writeLocalStorage(FILTER_PREFERENCE_KEY, filterMode);
  }, [filterMode]);

  // Campaign-wide progress, independent of the search/filter row below —
  // the resume bar always reflects the whole campaign, not the current view.
  const items = useMemo(
    () => deriveChapterProgress(chapters, storyProgress),
    [chapters, storyProgress]
  );
  const summary = useMemo(() => summariseProgress(items), [items]);

  // Search narrows the pool the filter pills count and operate over, so the
  // pill counts stay live as the reader types.
  const searchedItems = useMemo(
    () => filterChapters(items, searchQuery),
    [items, searchQuery]
  );
  const allCount = searchedItems.length;
  const unreadCount = useMemo(
    () => searchedItems.filter((item) => item.state !== 'read').length,
    [searchedItems]
  );
  const visibleItems = useMemo(
    () =>
      filterMode === 'unread'
        ? searchedItems.filter((item) => item.state !== 'read')
        : searchedItems,
    [searchedItems, filterMode]
  );

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Story', href: '/story' },
    { label: 'Chapters' },
  ];

  const handleChapterSelect = (chapterId: string) => {
    navigateToPage(`/story/chapters/${chapterId}`);
  };

  const handleCreateChapter = () => {
    navigateToPage('/story/chapters/create');
  };

  const handleEditChapter = (chapterId: string) => {
    navigateToPage(`/story/chapters/edit/${chapterId}`);
  };

  // `position` is deliberately not passed along. Resuming mid-chapter does
  // work now, but the reader restores the position itself from stored
  // progress — the same source this summary was derived from — so putting it
  // in the URL would duplicate the fact and let the two disagree. The
  // parameter stays on the callback because it is part of ResumeBar's
  // contract and reads as intent at the call site.
  const handleResume = (chapterId: string, _position: number) => {
    navigateToPage(`/story/chapters/${chapterId}`);
  };

  return (
    <PageShell
      title="Session Chronicles"
      breadcrumb={<Breadcrumb items={breadcrumbItems} className="mb-4" />}
      actions={
        <>
          {/* Navigation, not a control that acts on data -- it is how a
              visitor moves between story views, so unlike the create button
              below it stays visible in every gate state. */}
          <StoryViewTabs />
          {gate.canAct && (
            <Button
              variant="primary"
              startIcon={<Plus />}
              onClick={handleCreateChapter}
            >
              New Chapter
            </Button>
          )}
        </>
      }
    >
      <GatedContent gate={gate}>
        <ResumeBar summary={summary} onResume={handleResume} />

        {chapters.length === 0 ? (
          <>
            <RosterEmpty
              title="Muninn hasn't heard the story yet"
              message="Each session becomes a chapter here — what happened, who you met, and what it cost. The party reads them back between games."
              mark
              action={
                gate.canAct ? (
                  <Button startIcon={<Plus className="w-4 h-4" />} onClick={handleCreateChapter}>
                    Write the first chapter
                  </Button>
                ) : undefined
              }
            />
            {/* What the story will hold, while it holds nothing (T150). */}
            <ChapterExample />
          </>
        ) : (
          <>
            {/* Search + filter + view toggle row */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <input
                type="text"
                className="input flex-1 min-w-[200px] px-3 py-2"
                placeholder="Search chapter titles and summaries"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search chapter titles and summaries"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  aria-pressed={filterMode === 'all'}
                  onClick={() => setFilterMode('all')}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                    filterMode === 'all'
                      ? 'bg-accent accent'
                      : 'typography-secondary selectable-item'
                  )}
                >
                  All {allCount}
                </button>
                <button
                  type="button"
                  aria-pressed={filterMode === 'unread'}
                  onClick={() => setFilterMode('unread')}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                    filterMode === 'unread'
                      ? 'bg-accent accent'
                      : 'typography-secondary selectable-item'
                  )}
                >
                  Unread {unreadCount}
                </button>
              </div>

              {gate.canAct && viewMode === 'list' && (
                <Button
                  variant={selection.active ? 'primary' : 'outline'}
                  size="sm"
                  onClick={selection.toggleActive}
                  className="ml-auto"
                >
                  {selection.active ? 'Exit Selection' : 'Select Chapters'}
                </Button>
              )}

              <div className="flex rounded-lg p-1 bg-secondary ml-auto">
                <button
                  type="button"
                  aria-current={viewMode === 'list' ? 'page' : undefined}
                  onClick={() => setViewMode('list')}
                  className={clsx(
                    'flex items-center gap-1 px-3 py-1 rounded-md transition-colors',
                    viewMode === 'list' ? 'card' : 'typography-secondary'
                  )}
                >
                  <List className="w-4 h-4" />
                  <span className="hidden sm:inline">List</span>
                </button>

                <button
                  type="button"
                  aria-current={viewMode === 'shelf' ? 'page' : undefined}
                  onClick={() => setViewMode('shelf')}
                  className={clsx(
                    'flex items-center gap-1 px-3 py-1 rounded-md transition-colors',
                    viewMode === 'shelf' ? 'card' : 'typography-secondary'
                  )}
                >
                  <Grid className="w-4 h-4" />
                  <span className="hidden sm:inline">Shelf</span>
                </button>
              </div>
            </div>

            {selection.active && selection.selected.size > 0 && (
              <div className="mb-4">
                <RosterBatchBar label={`${countChapters(selection.selected.size)} selected`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(true)}
                    startIcon={<Trash size={16} className="feedback-error" />}
                  >
                    Delete
                  </Button>
                </RosterBatchBar>
                <DeleteConfirmationDialog
                  isOpen={confirmingDelete}
                  onClose={() => setConfirmingDelete(false)}
                  onConfirm={async () => {
                    await deleteChapters(Array.from(selection.selected));
                    clearSelection();
                  }}
                  itemName={countChapters(selection.selected.size)}
                  itemType={selection.selected.size === 1 ? 'chapter' : 'chapters'}
                  message={`Delete ${countChapters(selection.selected.size)}? The chapters after them are renumbered to close the gap.`}
                />
              </div>
            )}

            {visibleItems.length === 0 ? (
              <RosterEmpty
                title="No chapters match this view"
                message="Try a different search term, or switch back to All to see every chapter recorded so far."
              />
            ) : viewMode === 'list' ? (
              <ChapterList
                items={visibleItems}
                onChapterSelect={handleChapterSelect}
                onEditChapter={handleEditChapter}
                isAdmin={gate.canAct}
                selection={
                  selection.active
                    ? { selected: selection.selected, onToggle: selection.setSelected }
                    : undefined
                }
              />
            ) : (
              <BookshelfView
                items={visibleItems}
                onChapterSelect={handleChapterSelect}
                onEditChapter={handleEditChapter}
                isAdmin={gate.canAct}
              />
            )}
          </>
        )}
      </GatedContent>
    </PageShell>
  );
};

export default ChaptersPage;
