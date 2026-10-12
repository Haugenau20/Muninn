// src/features/storytelling/stories/components/ChapterList.tsx
import React, { useMemo, useState } from 'react';
import Typography from 'core/components/Typography';
import Button from 'core/components/Button';
import { Check } from 'lucide-react';
import clsx from 'clsx';
import {
  ChapterWithProgress,
  ChapterReadState,
  ChapterRow,
  groupChaptersByTens,
  collapseReadRuns,
} from 'features/storytelling/chapters/utils/chapter-progress';

/**
 * Props shared by both chapter views (this component and `BookshelfView`).
 * The page filters, sorts and derives read state before either view ever
 * sees `items` — see `chapters/utils/chapter-progress.ts` — so neither view
 * re-derives that here; both just render it.
 */
export interface ChapterViewProps {
  items: ChapterWithProgress[];
  onChapterSelect: (chapterId: string) => void;
  onEditChapter?: (chapterId: string) => void;
  isAdmin?: boolean;
}

/**
 * Selection mode for the page's batch delete (T017). While it is set every row
 * is a checkbox: a click ticks the row rather than opening the chapter.
 */
export interface ChapterSelection {
  selected: Set<string>;
  onToggle: (chapterId: string, selected: boolean) => void;
}

/** {@link ChapterList}'s props: the shared view props, plus selection, which only the list offers. */
export interface ChapterListProps extends ChapterViewProps {
  selection?: ChapterSelection;
}

/**
 * What one chapter row shows, and nothing it does not: a `ChapterWithProgress`
 * is one, and so is an example chapter, which has no author or text to carry.
 */
export interface ChapterRowItem {
  chapter: Pick<ChapterWithProgress['chapter'], 'id' | 'order' | 'title' | 'summary'>;
  state: ChapterReadState;
  percentRead: number;
  isCurrent: boolean;
}

/** Action button label, one per read state. */
const ACTION_LABEL: Record<ChapterReadState, string> = {
  read: 'Reread',
  reading: 'Resume',
  unread: 'Read',
};

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
];

/**
 * Spell small counts out ("Four") and fall back to digits above ten. A run
 * label reads as a sentence ("Four more read chapters"), not a table cell,
 * so small numbers get words. Runs are collapsed per group of ten (see
 * `collapseReadRuns`), so in practice this rarely sees anything above ten —
 * the digit fallback exists for correctness, not because it fires often.
 */
function spellCount(count: number): string {
  if (count >= 0 && count <= 10) {
    const word = NUMBER_WORDS[count];
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return String(count);
}

/**
 * One chapter row: number, title/summary, read state, and the primary
 * action. The current chapter is promoted (accent left border, tinted
 * background, larger title, inline progress bar) so the reader can find
 * where they left off at a glance; already-read chapters are muted so the
 * unread and in-progress rows are what actually draw the eye.
 *
 * On a phone the row has no room for all four columns: the title would be
 * squeezed to a word per line. Below `sm` the read-state column goes (the
 * action's label already says it -- Reread, Resume, Read) and the actions wrap
 * onto a line of their own under the title.
 */
export const ChapterRowView: React.FC<{
  item: ChapterRowItem;
  onChapterSelect?: (chapterId: string) => void;
  onEditChapter?: (chapterId: string) => void;
  isAdmin?: boolean;
  selection?: ChapterSelection;
  /**
   * A picture of a row: no click, no hover, no actions. For the example under
   * an empty chronicle (`ChapterExample`, T150).
   */
  inert?: boolean;
}> = ({ item, onChapterSelect, onEditChapter, isAdmin, selection, inert = false }) => {
  const { chapter, state, percentRead, isCurrent } = item;
  const isMuted = state === 'read' && !isCurrent;
  const isTicked = selection?.selected.has(chapter.id) ?? false;

  return (
    <div
      className={clsx(
        'flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 py-3 px-2 border-b card-border last:border-b-0',
        !inert && 'selectable-item cursor-pointer transition-colors',
        isCurrent && 'border-l-4 border-l-accent bg-accent',
        isTicked && 'roster-row-selected'
      )}
      onClick={
        inert
          ? undefined
          : () =>
              selection ? selection.onToggle(chapter.id, !isTicked) : onChapterSelect?.(chapter.id)
      }
    >
      {selection && (
        <input
          type="checkbox"
          aria-label={`Select ${chapter.title}`}
          checked={isTicked}
          onChange={(event) => selection.onToggle(chapter.id, event.target.checked)}
          // The row's own click would toggle it a second time.
          onClick={(event) => event.stopPropagation()}
          className="shrink-0"
        />
      )}

      {/* Chapter number */}
      <div className="w-8 sm:w-11 shrink-0">
        <Typography variant="body-sm" color="secondary" centered>
          {chapter.order}
        </Typography>
      </div>

      {/* Title (+ summary, + inline progress when this is the current chapter) */}
      <div className="flex-1 min-w-0 basis-[calc(100%-2.75rem)] sm:basis-0">
        <Typography
          variant={isCurrent ? 'h4' : 'body'}
          className={clsx(isMuted && 'typography-muted')}
        >
          {chapter.title}
        </Typography>
        {chapter.summary && (
          <Typography variant="body-sm" color="secondary" className="line-clamp-1">
            {chapter.summary}
          </Typography>
        )}
        {isCurrent && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full progress-container">
              <div
                className="h-full rounded-full progress-bar-active"
                style={{ width: `${percentRead}%` }}
              />
            </div>
            <Typography variant="caption" color="secondary" className="shrink-0">
              {percentRead}% through
            </Typography>
          </div>
        )}
      </div>

      {/* Read state */}
      <div className="w-24 shrink-0 hidden sm:flex items-center gap-1">
        {state === 'read' && (
          <>
            <Check className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
            <Typography variant="body-sm" color="success">Read</Typography>
          </>
        )}
        {state === 'reading' && (
          <Typography variant="body-sm" className="accent">Reading</Typography>
        )}
      </div>

      {/* Action(s) — the row itself is clickable, but the action always has a
          real <button> so it stays keyboard-reachable. stopPropagation keeps
          a click here from also firing the row's own onClick. Selection mode
          has no actions: the checkbox is the row's one control. */}
      {!selection && !inert && (
        <div
          className="shrink-0 flex items-center gap-1 ml-auto sm:ml-0"
          onClick={(event) => event.stopPropagation()}
        >
          <Button variant="ghost" size="sm" onClick={() => onChapterSelect?.(chapter.id)}>
            {ACTION_LABEL[state]}
          </Button>
          {isAdmin && onEditChapter && (
            <Button variant="ghost" size="sm" onClick={() => onEditChapter(chapter.id)}>
              Edit
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * A collapsed run of consecutive read chapters, rendered as one thin row.
 * "Show" expands it in place into the individual chapter rows it stands in
 * for; "Hide" collapses it back. The row itself never disappears, so the
 * reader's scroll position doesn't jump when they expand it.
 */
const RunRowView: React.FC<{
  row: Extract<ChapterRow, { kind: 'run' }>;
  expanded: boolean;
  onToggle: () => void;
}> = ({ row, expanded, onToggle }) => {
  const countLabel = spellCount(row.items.length);

  return (
    <div className="flex items-center justify-between gap-3 py-2 px-2 border-b card-border last:border-b-0">
      <Typography variant="body-sm" color="secondary">
        {row.rangeLabel} · {countLabel} more read chapters
      </Typography>
      <Button variant="ghost" size="sm" onClick={onToggle}>
        {expanded ? 'Hide' : 'Show'}
      </Button>
    </div>
  );
};

/**
 * Chapters ten at a time, replacing the old sortable table. Reads top to
 * bottom like a table of contents — number, title, read state, action —
 * with long runs of already-read chapters collapsed so a 39-chapter
 * campaign doesn't turn into 39 identical-looking rows, and trailing groups
 * nobody has opened yet collapsed into a single line rather than three
 * empty-looking section headers.
 */
const ChapterList: React.FC<ChapterListProps> = ({
  items,
  onChapterSelect,
  onEditChapter,
  isAdmin = false,
  selection,
}) => {
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [showAllTrailing, setShowAllTrailing] = useState(false);

  const groups = useMemo(() => groupChaptersByTens(items), [items]);

  // The first group of an unbroken run of inactive trailing groups —
  // everything from here to the end collapses into one "none opened yet"
  // line until the reader asks to see it. A freshly started 39-chapter
  // campaign shouldn't cost 3 section headers' worth of scrolling to reach
  // the bottom. The scan starts at the *second* group deliberately: group 0
  // always renders normally, even when nothing has been read yet, because
  // it's where a brand-new reader finds Chapter 1 — collapsing the only
  // visible group would hide the entire list instead of shortening it.
  const trailingCollapseStart = useMemo(() => {
    for (let i = 1; i < groups.length; i += 1) {
      if (groups.slice(i).every((group) => !group.hasActivity)) {
        return i;
      }
    }
    return groups.length;
  }, [groups]);

  const toggleRun = (id: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="rounded-lg overflow-hidden card">
      {groups.map((group, groupIndex) => {
        const isCollapsedTrailing = groupIndex >= trailingCollapseStart && !showAllTrailing;

        if (isCollapsedTrailing) {
          // Only the first group of the trailing run renders anything — the
          // rest are represented by that single row.
          if (groupIndex !== trailingCollapseStart) return null;

          const firstGroup = groups[trailingCollapseStart];
          const lastGroup = groups[groups.length - 1];
          const firstOrder = firstGroup.items[0]?.chapter.order;
          const lastOrder = lastGroup.items[lastGroup.items.length - 1]?.chapter.order;

          return (
            <div key={group.label} className="px-3">
              <div className="flex items-center justify-between gap-3 py-3">
                <Typography variant="body-sm" color="secondary">
                  Chapters {firstOrder}–{lastOrder} · none opened yet
                </Typography>
                <Button variant="ghost" size="sm" onClick={() => setShowAllTrailing(true)}>
                  Show all
                </Button>
              </div>
            </div>
          );
        }

        const rows = collapseReadRuns(group.items);

        return (
          <div key={group.label}>
            <div className="px-3 pt-6 pb-2">
              <Typography variant="h4">{group.label}</Typography>
              <div className="mt-2 border-t divider" />
            </div>
            <div className="px-3">
              {rows.map((row) =>
                row.kind === 'chapter' ? (
                  <ChapterRowView
                    key={row.item.chapter.id}
                    item={row.item}
                    onChapterSelect={onChapterSelect}
                    onEditChapter={onEditChapter}
                    isAdmin={isAdmin}
                    selection={selection}
                  />
                ) : (
                  <React.Fragment key={row.id}>
                    <RunRowView
                      row={row}
                      expanded={expandedRuns.has(row.id)}
                      onToggle={() => toggleRun(row.id)}
                    />
                    {expandedRuns.has(row.id) &&
                      row.items.map((item) => (
                        <ChapterRowView
                          key={item.chapter.id}
                          item={item}
                          onChapterSelect={onChapterSelect}
                          onEditChapter={onEditChapter}
                          isAdmin={isAdmin}
                          selection={selection}
                        />
                      ))}
                  </React.Fragment>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ChapterList;
