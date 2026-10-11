// src/features/collaboration/notes/components/NotesList.tsx

import React, { useMemo, useState } from "react";
import Typography from "../../../../core/components/Typography";
import Button from "../../../../core/components/Button";
import NoteCard from "./NoteCard";
import { Note } from "../types";
import { recordTimes } from "core/attribution";
import { displayTitle } from "../utils/note-title";
import { useNotes } from "../context/NoteContext";
import { useCreateNote } from "../hooks/useCreateNote";
import { RosterSkeleton, RosterEmpty } from "core/components/Roster";
import { RuneMark } from "core/components/RuneMark";
import Select from "core/components/Select";
import { useCampaigns } from "features/user-management";
import { AlertCircle, Plus, Search } from "lucide-react";
import { clsx } from "clsx";

/** Which slice of the campaign's notes the index is showing. */
type FilterMode = "all" | "unsaved" | "archived";

/** How the visible rows are ordered. */
type SortMode = "newest" | "oldest" | "edited";

/** Rows shown before the list collapses behind "Show all". */
const COLLAPSED_ROW_COUNT = 4;

/**
 * Notes for the active campaign: a search + filter + sort row, then the notes
 * themselves as rows in a single container.
 *
 * `All` means non-archived, so `All` and `Archived` are disjoint — archived
 * notes were previously in `notes` with no UI able to reach them at all, and
 * this is the first place `status: "archived"` becomes visible.
 */
const NotesList: React.FC = () => {
  const { notes, isLoading, error, retry, saveNote } = useNotes();
  const { activeCampaignId, activeCampaign } = useCampaigns();
  const { createAndOpen } = useCreateNote();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [isExpanded, setIsExpanded] = useState(false);

  // Search narrows the pool the pills count over, so the counts stay live as
  // the reader types -- the same rule the chapters index follows.
  const searchedNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return notes;

    return notes.filter(note => {
      const title = displayTitle(note) ?? "";
      return (
        title.toLowerCase().includes(query) ||
        (note.content ?? "").toLowerCase().includes(query)
      );
    });
  }, [notes, searchQuery]);

  const counts = useMemo(() => {
    const active = searchedNotes.filter(note => note.status !== "archived");
    return {
      all: active.length,
      unsaved: active.filter(note => note.isUnsaved).length,
      archived: searchedNotes.filter(note => note.status === "archived").length,
    };
  }, [searchedNotes]);

  const visibleNotes = useMemo(() => {
    const filtered = searchedNotes.filter(note => {
      if (filterMode === "archived") return note.status === "archived";
      if (note.status === "archived") return false;
      if (filterMode === "unsaved") return !!note.isUnsaved;
      return true;
    });

    // Created is the server's time (T132); edited is the note's own
    // `updatedAt`, which every save stamps.
    const timestamp = (note: Note) =>
      sortMode === "edited"
        ? new Date(note.updatedAt).getTime()
        : recordTimes(note).created?.getTime() ?? 0;

    return [...filtered].sort((a, b) => {
      // Unsaved notes pin to the top under every sort: they are the only rows
      // carrying an action the reader still owes the note.
      if (!!a.isUnsaved !== !!b.isUnsaved) return a.isUnsaved ? -1 : 1;
      return sortMode === "oldest" ? timestamp(a) - timestamp(b) : timestamp(b) - timestamp(a);
    });
  }, [searchedNotes, filterMode, sortMode]);

  const isCollapsed = !isExpanded && visibleNotes.length > COLLAPSED_ROW_COUNT;
  const shownNotes = isCollapsed ? visibleNotes.slice(0, COLLAPSED_ROW_COUNT) : visibleNotes;
  const hiddenCount = visibleNotes.length - shownNotes.length;

  const handleSaveNow = (noteId: string) => {
    (async () => {
      try {
        await saveNote(noteId);
      } catch (saveError) {
        console.error("Failed to save note:", saveError);
      }
    })();
  };

  if (isLoading) {
    return <RosterSkeleton label="Loading notes" />;
  }

  if (error) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 py-8 error-container">
        <AlertCircle className="w-6 h-6 feedback-error" />
        <Typography color="error">{error}</Typography>
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!activeCampaignId) {
    return (
      <div className="notes-list">
        <RosterEmpty
          title="No campaign selected"
          message="Notes belong to a campaign. Pick one and this becomes the place the session gets written down."
        />
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="notes-list">
        <div className="text-center py-10 px-6 border-2 border-dashed card-border rounded-lg">
          <RuneMark size={26} className="block mx-auto mb-2 typography-secondary opacity-50" />
          <Typography variant="h4" className="mb-2">
            Nothing written down yet
          </Typography>
          <Typography color="secondary" className="mb-4">
            {activeCampaign ? (
              <>
                Create your first note for{" "}
                <span className="font-medium">{activeCampaign.name}</span> to start keeping track
                of what happened.
              </>
            ) : (
              "Create your first note to start keeping track of what happened."
            )}
          </Typography>
          <Button variant="primary" onClick={createAndOpen} className="create-note-button">
            <Plus className="w-5 h-5 mr-2" />
            Create Note
          </Button>
        </div>
      </div>
    );
  }

  const pills: Array<{ mode: FilterMode; label: string }> = [
    { mode: "all", label: `All ${counts.all}` },
    { mode: "unsaved", label: `Unsaved ${counts.unsaved}` },
    { mode: "archived", label: `Archived ${counts.archived}` },
  ];

  return (
    <div className="notes-list">
      {/* Control row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 typography-secondary pointer-events-none" />
          <input
            type="text"
            className="input w-full h-[38px] pl-9"
            placeholder="Search note titles and text"
            aria-label="Search note titles and text"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="flex gap-2">
          {pills.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={filterMode === mode}
              onClick={() => {
                setFilterMode(mode);
                setIsExpanded(false);
              }}
              className={clsx(
                "h-[38px] px-3 rounded-full text-sm font-medium transition-colors",
                "roster-filter",
                // Same rule as every other collection: an active filter is the
                // accent as an outline, and "All" is the absence of a filter
                // rather than one, so it stays idle.
                filterMode === mode && mode !== "all"
                  ? "roster-filter-active font-semibold"
                  : "roster-filter-idle selectable-item"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Select
          className="h-[38px] w-auto"
          aria-label="Sort notes"
          value={sortMode}
          onChange={event => setSortMode(event.target.value as SortMode)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="edited">Recently edited</option>
        </Select>
      </div>

      {/* Rows */}
      {visibleNotes.length === 0 ? (
        <RosterEmpty
          title="No notes match these filters"
          message="Try a different search term, or clear the filters to see everything written down so far."
        />
      ) : (
        <>
          <div className="card rounded-xl overflow-hidden">
            {shownNotes.map((note, index) => (
              // The divider is inset 20px from the container edge, so it sits
              // on a wrapper with a horizontal margin and the row pulls itself
              // back out to full width. `card-divider` is colour only -- the
              // `card-border` shorthand used here previously set a width on
              // all four sides and drew a rectangle around every inset row.
              <div
                key={note.id}
                className={clsx(index > 0 && "border-t card-divider mx-5")}
              >
                <div className={clsx(index > 0 && "-mx-5")}>
                  <NoteCard note={note} onSaveNow={handleSaveNow} />
                </div>
              </div>
            ))}
          </div>

          {isCollapsed && (
            <div className="flex items-center justify-between gap-4 mt-3 px-1">
              <Typography variant="body-sm" color="secondary">
                {hiddenCount} older {hiddenCount === 1 ? "note" : "notes"}
              </Typography>
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="text-sm font-medium primary hover:underline"
              >
                Show all
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NotesList;
