// Updated src/features/collaboration/notes/components/NoteEditor.tsx

import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { Note } from "../types";
import { recordTimes } from "core/attribution";
import Typography from "../../../../core/components/Typography";
import Input from 'core/components/Input';
import { useAutoGrow } from 'shared/hooks/useAutoGrow';
import { useNotes } from "../context/NoteContext";
import { deriveTitle, LEGACY_DEFAULT_TITLE } from "../utils/note-title";
import { formatLastSaved } from "../utils/save-status";
import { Loader2, AlertCircle, ArrowLeft, Archive, Trash2, Check } from 'lucide-react';

interface NoteEditorProps {
  /** ID of the note to edit */
  noteId: string;
  /**
   * The note itself, for one the provider cannot look up: a note from another
   * campaign, which `NotePage` fetches directly and shows read-only. The
   * provider holds only the active campaign's notes, so without this the
   * editor opened such a note blank (FUNC-001).
   */
  note?: Note;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Callback when note is saved (auto or manual) */
  onSave?: () => void;
  /** Rendered in the surface's own top bar, left of Archive/Delete. */
  onBack?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}

export interface NoteEditorRef {
  /** Get the current content from the editor */
  getCurrentContent: () => { title: string; content: string };
  /** Save the current content to Firebase */
  saveCurrentContent: () => Promise<void>;
}

/** Idle delay before an autosave fires. Short enough that a pause in real
 *  prose reaches the server; the interval below covers continuous writing. */
const AUTOSAVE_DEBOUNCE_MS = 2000;
/** True interval save while the note is dirty. The debounce alone fires only
 *  after typing STOPS, so a writer who never pauses was never saved -- while
 *  the editor claimed "Autosave every 45s". */
const AUTOSAVE_INTERVAL_MS = 30000;
// MIN_CONTENT_LENGTH is deleted: it returned early with no state change, so a
// two-character note read "Unsaved changes" indefinitely with no explanation.

/**
 * The title to WRITE to Firestore: the explicit title as typed, or "" when
 * there isn't one. Never the derived string (I1) -- `displayTitle` (NoteCard,
 * NotesList's search) derives from content at read time, and a derived value
 * once written here would come back on the next load indistinguishable from
 * a title the user actually typed, permanently hiding the "Taken from the
 * first line" hint and freezing the title against further edits.
 */
function titleToPersist(isExplicit: boolean, explicitTitle: string): string {
  return isExplicit ? explicitTitle : "";
}

/**
 * Component for editing note content
 * Features auto-save functionality (2s idle debounce + a real 30s interval
 * while dirty) and handles unsaved notes.
 * Exposes methods to get and save current content for external components.
 */
const NoteEditor = forwardRef<NoteEditorRef, NoteEditorProps>(({
  noteId,
  note: providedNote,
  readOnly = false,
  onSave,
  onBack,
  onArchive,
  onDelete
}, ref) => {
  const { getNoteById, updateNote, saveNote, getUnsavedEdit, setUnsavedEdit } = useNotes();
  const [note, setNote] = useState<Note | undefined>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  /** True once the loaded note had an explicit title, or the user has typed
   *  one. While false, the title shown and saved is derived from the first
   *  content line instead. No new persisted field -- this is purely local. */
  const [hasExplicitTitle, setHasExplicitTitle] = useState(false);
  /**
   * Error message from the most recent manual save attempt, surfaced to the
   * user via {@link getStatusIndicator}. Only set by {@link triggerManualSave}
   * (the Ctrl+S call site) — the ref-exposed
   * `saveCurrentContent` still rejects directly so CampaignLinksPanel can
   * abort AI extraction on a failed pre-extraction save (bug #1051).
   */
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refs mirroring the latest title/content/hasExplicitTitle so the debounce
  // timeout and interval callbacks always read fresh values without having
  // to be re-created (and thus reset) on every keystroke.
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const hasExplicitTitleRef = useRef(hasExplicitTitle);
  const debounceTimerRef = useRef<number | null>(null);
  /**
   * The fields this editor last wrote successfully, and for which note. An
   * autosave of exactly these writes nothing: the idle save behind a Ctrl+S
   * used to write the same text a second time (PERF2-005). Set only by a
   * write, never by loading, so a save that is asked for always happens.
   */
  const lastWrittenRef = useRef<{ noteId: string; title: string; content: string } | null>(null);
  /** The id whose data is in the fields. See the load effect. */
  const loadedNoteIdRef = useRef<string | null>(null);
  /**
   * The fields as the server last had them, in the form they are written:
   * as loaded, then as each save wrote them. Whatever differs from this would
   * be lost by leaving (T085, REACT-003). Not `hasUnsavedChanges`, which a
   * brand-new note starts with although there is nothing in it to save.
   */
  const baselineRef = useRef<{ title: string; content: string } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { hasExplicitTitleRef.current = hasExplicitTitle; }, [hasExplicitTitle]);

  const effectiveTitle = hasExplicitTitle ? title : deriveTitle(content);
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  /*
    Load note data once per note id. `getNoteById` is a dependency only so a
    note that arrives after mount is still picked up: the provider hands out a
    new one every time its `notes` change -- including when a save of THIS
    note resolves. Reloading then reset the fields to the snapshot that was
    saved, discarding whatever was typed during the round-trip and throwing
    the caret to the end: the editor "jumped" while you wrote.
  */
  useEffect(() => {
    if (loadedNoteIdRef.current === noteId) return;
    const noteData = providedNote ?? getNoteById(noteId);
    setNote(noteData);
    if (noteData) {
      loadedNoteIdRef.current = noteId;
      setTitle(noteData.title || "");
      setContent(noteData.content || "");
      setHasUnsavedChanges(!!noteData.isUnsaved);
      // The exact legacy "New Note" placeholder (persisted on every note
      // created before this redesign) is not a real explicit title -- see
      // LEGACY_DEFAULT_TITLE in note-title.ts. Treating it as one would
      // show "New Note" in the title field, with no derivation hint, on
      // every pre-existing note.
      const loadedTitle = noteData.title?.trim() ?? "";
      const loadedExplicit = !!loadedTitle && loadedTitle !== LEGACY_DEFAULT_TITLE;
      setHasExplicitTitle(loadedExplicit);
      baselineRef.current = {
        title: titleToPersist(loadedExplicit, noteData.title || ""),
        content: noteData.content || "",
      };
      // Set last saved time from note's modification date (if saved)
      setLastSaved(noteData.isUnsaved ? null : recordTimes(noteData).modified);

      // An edit whose save failed after this note was left (T085): put it
      // back, say so, and let "Try again" or the next autosave write it.
      const kept = readOnly ? undefined : getUnsavedEdit(noteId);
      if (kept) {
        setTitle(kept.title);
        setContent(kept.content);
        setHasExplicitTitle(kept.hasExplicitTitle);
        hasExplicitTitleRef.current = kept.hasExplicitTitle;
        titleRef.current = kept.title;
        contentRef.current = kept.content;
        setHasUnsavedChanges(true);
        setSaveError(`Your last changes were not saved: ${kept.error}`);
      }
    }
  }, [noteId, providedNote, getNoteById, getUnsavedEdit, readOnly]);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Clear any pending debounce timer on unmount.
  useEffect(() => clearDebounceTimer, [clearDebounceTimer]);

  /**
   * Mark the note clean after a save -- unless the fields moved on while it
   * was in flight, in which case what is on screen is still unsaved.
   */
  const markCleanIfUnchanged = useCallback((savedTitle: string, savedContent: string) => {
    const titleNow = titleToPersist(hasExplicitTitleRef.current, titleRef.current);
    if (titleNow === savedTitle && contentRef.current === savedContent) {
      setHasUnsavedChanges(false);
    }
  }, []);

  /**
   * The one write behind every save: always both fields together, so a
   * content-only edit still persists a title derived from the new content, and
   * a title-only edit doesn't clobber content. Reads the fields from refs, so a
   * save that waited behind another writes what is on screen when it runs.
   *
   * `viaSave` forces `saveNote` (Ctrl+S, and the pre-extraction save); an
   * autosave of an already-saved note goes through `updateNote`. Rejects on
   * failure -- see {@link performAutosave} and {@link handleManualSave}.
   */
  const writeLatest = useCallback(async (viaSave: boolean) => {
    if (!note || readOnly) return;

    const nextTitle = titleToPersist(hasExplicitTitleRef.current, titleRef.current);
    const nextContent = contentRef.current;

    const written = lastWrittenRef.current;
    if (
      !viaSave &&
      written?.noteId === note.id &&
      written.title === nextTitle &&
      written.content === nextContent
    ) {
      markCleanIfUnchanged(nextTitle, nextContent);
      return;
    }

    try {
      setIsSaving(true);

      const currentNote = getNoteById(note.id);
      const isNewNote = !!currentNote?.isUnsaved;
      // A brand-new note (isUnsaved: true) exists only in React state --
      // updateNote's own unsaved branch just rewrites that state and returns,
      // writing nothing to Firestore. saveNote is the only path that actually
      // creates the document, so autosave must use it for a new note (C1).
      // Once the note is saved once, updateNote correctly routes further
      // edits through saveNote internally.
      const persist = viaSave || isNewNote ? saveNote : updateNote;
      await persist(note.id, { title: nextTitle, content: nextContent });
      lastWrittenRef.current = { noteId: note.id, title: nextTitle, content: nextContent };
      baselineRef.current = { title: nextTitle, content: nextContent };
      setUnsavedEdit(note.id, undefined);
      setSaveError(null);

      // Reflect a now-created document locally so the footer's "Not saved to
      // server" state clears without waiting on a reload.
      setNote(prev => (prev?.isUnsaved ? { ...prev, isUnsaved: false } : prev));
      setLastSaved(new Date());
      // Typing during the round-trip made newer text than was saved; that is
      // still unsaved, and its own debounce (or the interval) will save it.
      markCleanIfUnchanged(nextTitle, nextContent);

      onSave?.();
    } finally {
      setIsSaving(false);
    }
  }, [note, readOnly, getNoteById, updateNote, saveNote, onSave, markCleanIfUnchanged, setUnsavedEdit]);

  /*
    Saves never overlap (T072). Two writes in flight can land in either order
    -- the older text last, after the newer one already marked the note clean
    -- and two creates of a new note race createDocument's existence check.
    A save requested while one is in flight waits for it; every request made
    during that wait joins the same single follow-up, which then writes the
    newest text. The follow-up calls the LATEST writeLatest, not the one from
    the render that queued it.
  */
  const writeLatestRef = useRef(writeLatest);
  useEffect(() => { writeLatestRef.current = writeLatest; }, [writeLatest]);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const queuedSaveRef = useRef<{ promise: Promise<void>; viaSave: boolean } | null>(null);

  const runSave = useCallback((viaSave: boolean): Promise<void> => {
    const start = (useSave: boolean): Promise<void> => {
      const tracked: Promise<void> = writeLatestRef.current(useSave).finally(() => {
        if (inFlightSaveRef.current === tracked) inFlightSaveRef.current = null;
      });
      inFlightSaveRef.current = tracked;
      return tracked;
    };

    const inFlight = inFlightSaveRef.current;
    if (!inFlight) return start(viaSave);

    const queued = queuedSaveRef.current;
    if (queued) {
      // A Ctrl+S joining a queued autosave still saves through saveNote.
      queued.viaSave = queued.viaSave || viaSave;
      return queued.promise;
    }
    const slot = { promise: Promise.resolve(), viaSave };
    slot.promise = inFlight
      .catch(() => undefined)
      .then(() => {
        queuedSaveRef.current = null;
        return start(slot.viaSave);
      });
    queuedSaveRef.current = slot;
    return slot.promise;
  }, []);

  /**
   * An autosave: the idle debounce and the dirty-note interval. A failure
   * shows its reason in the footer, with a retry, instead of only being
   * logged behind the same "Unsaved changes" as a pause (REACT-004).
   */
  const performAutosave = useCallback(async () => {
    try {
      await runSave(false);
    } catch (error) {
      console.error("Failed to save note:", error);
      setSaveError(error instanceof Error ? error.message : "Failed to save note.");
    }
  }, [runSave]);

  const scheduleAutosave = useCallback(() => {
    clearDebounceTimer();
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      performAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [clearDebounceTimer, performAutosave]);

  /** Whether the fields hold anything the server does not have yet. */
  const isDirty = useCallback((): boolean => {
    const baseline = baselineRef.current;
    if (!baseline || readOnly) return false;
    return (
      titleToPersist(hasExplicitTitleRef.current, titleRef.current) !== baseline.title ||
      contentRef.current !== baseline.content
    );
  }, [readOnly]);

  /*
    Leaving the note saves it (T085, REACT-003). The idle debounce is
    cancelled when the editor unmounts, and it used to be the only save
    pending: whatever was typed in the last two seconds -- or longer, for a
    writer who never paused -- went with it. The save is started here and
    runs on after the editor is gone, through the provider above the routes.
    If it fails, nobody is left to say so: the provider keeps the edit, and
    the editor restores it, with the reason, when the note is opened again.
  */
  const leaveRef = useRef<() => void>(() => undefined);
  leaveRef.current = () => {
    if (!note || !isDirty()) return;
    const kept = {
      title: titleRef.current,
      content: contentRef.current,
      hasExplicitTitle: hasExplicitTitleRef.current,
    };
    runSave(false).catch((error: unknown) => {
      console.error("Failed to save note on leaving:", error);
      setUnsavedEdit(note.id, {
        ...kept,
        error: error instanceof Error ? error.message : "Failed to save note.",
      });
    });
  };
  useEffect(() => () => leaveRef.current(), []);

  /*
    Closing or reloading the tab cannot wait for a save, so it asks first
    while there is anything unsaved, or a save still on its way.
  */
  useEffect(() => {
    if (readOnly) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!isDirty() && !inFlightSaveRef.current) return;
      event.preventDefault();
      // Chrome before 119 needs `returnValue` set to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [readOnly, isDirty]);

  // Real interval save while the note is dirty. The debounce above only fires
  // after typing STOPS, so a writer who never pauses was never saved. Cleared
  // on unmount and whenever the note goes clean (hasUnsavedChanges -> false).
  useEffect(() => {
    if (readOnly || !hasUnsavedChanges || !note) return;
    const id = window.setInterval(() => {
      performAutosave();
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [readOnly, hasUnsavedChanges, note, performAutosave]);

  /**
   * Manual save for Ctrl+S and the imperative `saveCurrentContent`. Always
   * through saveNote; re-throws so calling components can handle the error.
   */
  const handleManualSave = useCallback(async () => {
    if (!note || readOnly) return;
    try {
      await runSave(true);
    } catch (error) {
      console.error("Failed to manually save note:", error);
      throw error;
    }
  }, [note, readOnly, runSave]);

  // Expose methods to parent components. Below `handleManualSave` because it
  // is a dependency: the handle must be rebuilt when the save it hands out
  // changes (another note, read-only toggled), not only when the text does.
  useImperativeHandle(ref, () => ({
    getCurrentContent: () => ({ title: effectiveTitle, content }),
    saveCurrentContent: handleManualSave
  }), [effectiveTitle, content, handleManualSave]);

  /**
   * Fire-and-forget wrapper around `handleManualSave` for the Ctrl+S
   * shortcut. The call site doesn't await the promise, so
   * `handleManualSave`'s re-thrown error (needed by the imperative
   * `saveCurrentContent` ref contract — see bug #1051) would otherwise become
   * an unhandled promise rejection with nothing shown to the user. This
   * wrapper catches it and surfaces it via `saveError` instead.
   */
  const triggerManualSave = useCallback(() => {
    handleManualSave()
      .then(() => setSaveError(null))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to save note.";
        setSaveError(message);
      });
  }, [handleManualSave]);

  // Add keyboard shortcut for manual save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Accept Cmd+S (metaKey) alongside Ctrl+S -- otherwise macOS users have
      // no working shortcut at all, since they don't carry a physical Ctrl
      // key in the same role. The footer label below names both.
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        triggerManualSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [triggerManualSave]);

  // Handle title changes
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    setHasExplicitTitle(true);
    hasExplicitTitleRef.current = true;
    setHasUnsavedChanges(true);
    setSaveError(null);

    if (!readOnly && note) {
      scheduleAutosave();
    }
  };

  // Handle content changes
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setHasUnsavedChanges(true);
    setSaveError(null);

    if (!readOnly && note) {
      scheduleAutosave();
    }
  };

  /**
   * "All notes": save first, and leave only once the note is safe. A failure
   * stays here, with the text and the reason (T085).
   */
  const [isLeaving, setIsLeaving] = useState(false);
  const handleBack = useCallback(async () => {
    if (isDirty()) {
      clearDebounceTimer();
      setIsLeaving(true);
      try {
        await runSave(false);
      } catch (error) {
        console.error("Failed to save note before leaving:", error);
        setSaveError(error instanceof Error ? error.message : "Failed to save note.");
        return;
      } finally {
        setIsLeaving(false);
      }
    }
    onBack?.();
  }, [isDirty, clearDebounceTimer, runSave, onBack]);

  // Grow the body to fit its content instead of sitting at a fixed 30 rows.
  useAutoGrow(bodyRef, content);

  // Get status indicator
  const getStatusIndicator = () => {
    if (isSaving) {
      return (
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin primary" />
          <Typography variant="body-sm" color="secondary">Saving...</Typography>
        </div>
      );
    }

    if (saveError) {
      return (
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 typography-error" />
          <Typography variant="body-sm" color="error">
            {saveError}
          </Typography>
          {!readOnly && (
            <button
              type="button"
              onClick={triggerManualSave}
              className="typography-secondary underline hover:no-underline"
            >
              Try again
            </button>
          )}
        </div>
      );
    }

    if (note?.isUnsaved || hasUnsavedChanges) {
      return (
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 feedback-warning" />
          <Typography variant="body-sm" className="feedback-warning">
            {note?.isUnsaved ? "Not saved to server" : "Unsaved changes"}
          </Typography>
        </div>
      );
    }

    const lastSavedText = lastSaved ? formatLastSaved(lastSaved) : "Not saved yet";

    return (
      <div className="flex items-center gap-2">
        <Check className="w-4 h-4 feedback-success" />
        <Typography variant="body-sm" color="secondary" className="text-[13px]">
          {`${lastSavedText} · saves as you write`}
        </Typography>
      </div>
    );
  };

  return (
    <div className="note-editor card rounded-xl flex flex-col min-h-[70vh]">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b card-divider text-[13px]">
        <button
          type="button"
          onClick={() => { void handleBack(); }}
          disabled={isLeaving}
          className="flex items-center gap-1.5 typography-secondary hover:underline disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4" />
          All notes
        </button>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onArchive}
            disabled={readOnly}
            className="flex items-center gap-1.5 typography-secondary hover:underline disabled:opacity-50"
          >
            <Archive className="w-4 h-4" />
            Archive
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={readOnly}
            className="flex items-center gap-1.5 typography-error hover:underline disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* The writing itself */}
      <div className="flex-1 flex flex-col px-8 py-6">
        {/*
          `text-ellipsis` on an input renders the "…" only while the field is
          unfocused, which is exactly the behaviour wanted here: a long title
          reads with a clear truncation mark, and clicking in to edit reveals
          the whole value. Without it the title clips mid-letter
          ("...at the Stonehill Inn in P") with nothing to signal that more
          text exists. This covers explicit titles too, which are uncapped.
        */}
        <input
          value={effectiveTitle}
          onChange={handleTitleChange}
          placeholder="Untitled note"
          disabled={readOnly}
          aria-label="Note title"
          className="note-title w-full bg-transparent border-none outline-none typography-heading text-[30px] font-medium placeholder:opacity-40 overflow-hidden text-ellipsis whitespace-nowrap"
        />

        {!hasExplicitTitle && (
          <Typography variant="caption" color="muted" className="mt-1 text-xs">
            Taken from the first line. Click to write your own title.
          </Typography>
        )}

        {/*
          On the primitive every other field uses (09-2, item 5). This comment
          used to call it "the last hand-rolled textarea element in the
          product"; it was not. `ContactForm` in `src/shared/components` had
          one too, and 09-2's gate grepped only `src/features` and
          `src/pages` -- accurate about what it checked, wrong about what it
          was taken to prove. Converted in 10-3, with the gate rewritten to
          cover `src`. The visible label
          comes with it: the control was already named for a screen reader by
          its `aria-label`, so that attribute goes rather than sitting on top
          of a real label element and shadowing it.
        */}
        <Input
          ref={bodyRef as React.Ref<HTMLTextAreaElement>}
          isTextArea
          label="Note content"
          value={content}
          onChange={handleContentChange}
          placeholder="Write your note here..."
          disabled={readOnly}
          fullWidth
          containerClassName="flex-1 mt-5"
          className="note-textarea flex-1 resize-none text-[17px] leading-[1.65] placeholder:opacity-40"
          style={{ minHeight: "40vh" }}
        />
      </div>

      {/* Footer: save state stated once, and only once */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t card-divider bg-secondary text-[13px]">
        {getStatusIndicator()}
        <Typography variant="body-sm" color="secondary" className="text-[13px]">
          {`${wordCount.toLocaleString()} ${wordCount === 1 ? "word" : "words"} · Ctrl+S (⌘S on Mac) to save now`}
        </Typography>
      </div>
    </div>
  );
});

NoteEditor.displayName = 'NoteEditor';

export default NoteEditor;
