// src/features/storytelling/stories/components/ChapterBrowser.tsx
import React, { useMemo, useState } from "react";
import { List, Grid } from "lucide-react";
import { clsx } from "clsx";
import Button from "core/components/Button";
import { RosterEmpty } from "core/components/Roster";
import type { Selection } from "shared/hooks/useSelection";
import { filterChapters, type ChapterWithProgress } from "../../chapters/utils/chapter-progress";
import ChapterList from "./ChapterList";
import BookshelfView from "./BookshelfView";

/** How the chapters are drawn: rows, or spines on a shelf. */
export type ChapterViewMode = "list" | "shelf";
/** Which chapters the pills show. */
export type ChapterFilterMode = "all" | "unread";

/** Props for {@link ChapterBrowser}. */
export interface ChapterBrowserProps {
  items: ChapterWithProgress[];
  filterMode: ChapterFilterMode;
  onFilterModeChange: (mode: ChapterFilterMode) => void;
  /** The view in use. Without `onViewModeChange` the list, and no toggle. */
  viewMode?: ChapterViewMode;
  /** Given, the List/Shelf toggle is offered. */
  onViewModeChange?: (mode: ChapterViewMode) => void;
  /** Given, Select Chapters is offered in the list view. */
  selection?: Selection;
  /** Between the toolbar and the chapters: the page's batch bar. */
  batchBar?: React.ReactNode;
  onChapterSelect: (chapterId: string) => void;
  onEditChapter?: (chapterId: string) => void;
  isAdmin?: boolean;
}

/** A pill's look, pressed or not. */
const pillClass = (pressed: boolean) =>
  clsx(
    "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
    pressed ? "bg-accent accent" : "typography-secondary selectable-item"
  );

/**
 * The chapter log's search, All/Unread pills and the chapters themselves, in
 * the list or on the shelf. Out of `ChaptersPage` so the signed-out example
 * draws the same log: the page adds its toggle, selection and batch bar; the
 * example adds none of them.
 *
 * Search narrows the pool the pills count, so their numbers stay live as the
 * reader types.
 */
const ChapterBrowser: React.FC<ChapterBrowserProps> = ({
  items,
  filterMode,
  onFilterModeChange,
  viewMode = "list",
  onViewModeChange,
  selection,
  batchBar,
  onChapterSelect,
  onEditChapter,
  isAdmin = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const searchedItems = useMemo(() => filterChapters(items, searchQuery), [items, searchQuery]);
  const unreadCount = useMemo(
    () => searchedItems.filter((item) => item.state !== "read").length,
    [searchedItems]
  );
  const visibleItems = useMemo(
    () => (filterMode === "unread" ? searchedItems.filter((item) => item.state !== "read") : searchedItems),
    [searchedItems, filterMode]
  );

  return (
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
            aria-pressed={filterMode === "all"}
            onClick={() => onFilterModeChange("all")}
            className={pillClass(filterMode === "all")}
          >
            All {searchedItems.length}
          </button>
          <button
            type="button"
            aria-pressed={filterMode === "unread"}
            onClick={() => onFilterModeChange("unread")}
            className={pillClass(filterMode === "unread")}
          >
            Unread {unreadCount}
          </button>
        </div>

        {selection && viewMode === "list" && (
          <Button
            variant={selection.active ? "primary" : "outline"}
            size="sm"
            onClick={selection.toggleActive}
            className="ml-auto"
          >
            {selection.active ? "Exit Selection" : "Select Chapters"}
          </Button>
        )}

        {onViewModeChange && (
          <div className="flex rounded-lg p-1 bg-secondary ml-auto">
            <button
              type="button"
              aria-current={viewMode === "list" ? "page" : undefined}
              onClick={() => onViewModeChange("list")}
              className={clsx(
                "flex items-center gap-1 px-3 py-1 rounded-md transition-colors",
                viewMode === "list" ? "card" : "typography-secondary"
              )}
            >
              <List className="w-4 h-4" />
              <span className="hidden sm:inline">List</span>
            </button>

            <button
              type="button"
              aria-current={viewMode === "shelf" ? "page" : undefined}
              onClick={() => onViewModeChange("shelf")}
              className={clsx(
                "flex items-center gap-1 px-3 py-1 rounded-md transition-colors",
                viewMode === "shelf" ? "card" : "typography-secondary"
              )}
            >
              <Grid className="w-4 h-4" />
              <span className="hidden sm:inline">Shelf</span>
            </button>
          </div>
        )}
      </div>

      {batchBar}

      {visibleItems.length === 0 ? (
        <RosterEmpty
          title="No chapters match this view"
          message="Try a different search term, or switch back to All to see every chapter recorded so far."
        />
      ) : viewMode === "list" ? (
        <ChapterList
          items={visibleItems}
          onChapterSelect={onChapterSelect}
          onEditChapter={onEditChapter}
          isAdmin={isAdmin}
          selection={
            selection?.active ? { selected: selection.selected, onToggle: selection.setSelected } : undefined
          }
        />
      ) : (
        <BookshelfView
          items={visibleItems}
          onChapterSelect={onChapterSelect}
          onEditChapter={onEditChapter}
          isAdmin={isAdmin}
        />
      )}
    </>
  );
};

export default ChapterBrowser;
