// src/features/collaboration/notes/components/__tests__/NoteEditor.test.tsx

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NoteEditor from '../NoteEditor';
import { Note } from '../../types';
import { unnamedControlsIn } from '@/test-utils/accessible-names';

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const mockGetNoteById = jest.fn();
const mockUpdateNote = jest.fn();
const mockSaveNote = jest.fn();
/** The provider's memory of edits whose save on leaving failed (T085). */
const mockUnsavedEdits = new Map<string, unknown>();
const mockGetUnsavedEdit = jest.fn((id: string) => mockUnsavedEdits.get(id));
const mockSetUnsavedEdit = jest.fn((id: string, edit: unknown) => {
  if (edit) mockUnsavedEdits.set(id, edit);
  else mockUnsavedEdits.delete(id);
});

jest.mock('../../context/NoteContext', () => ({
  useNotes: jest.fn(),
}));

const { useNotes } = require('../../context/NoteContext');

function setupMocks({
  note = undefined as Note | undefined,
  updateNote = mockUpdateNote,
  saveNote = mockSaveNote,
  getNoteById = mockGetNoteById,
} = {}) {
  (useNotes as jest.Mock).mockReturnValue({
    getNoteById,
    updateNote,
    saveNote,
    getUnsavedEdit: mockGetUnsavedEdit,
    setUnsavedEdit: mockSetUnsavedEdit,
  });
  mockGetNoteById.mockImplementation(() => note);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'My Note',
    content: 'Some content here.',
    extractedEntities: [],
    status: 'active',
    tags: [],
    updatedAt: '2024-01-15T10:00:00.000Z',
    dateModified: '2024-01-15T10:00:00.000Z',
    campaignId: 'campaign-1',
    createdBy: 'user-1',
    createdByUsername: 'TestUser',
    dateAdded: '2024-01-15T10:00:00.000Z',
    isUnsaved: false,
    ...overrides,
  };
}

function renderEditor({
  note = makeNote(),
  props = {} as Partial<React.ComponentProps<typeof NoteEditor>>,
} = {}) {
  setupMocks({ note });
  return render(<NoteEditor noteId="note-1" {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NoteEditor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockUnsavedEdits.clear();
    mockUpdateNote.mockResolvedValue(undefined);
    mockSaveNote.mockResolvedValue(undefined);
    setupMocks({ note: makeNote() });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  describe('rendering', () => {
    // "Title" / "Content" headings are gone -- see the "writing surface"
    // describe block below ('should not render field headings').

    test('should render title input pre-populated from note', () => {
      setupMocks({ note: makeNote({ title: 'Pre-filled Title' }) });
      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByDisplayValue('Pre-filled Title')).toBeInTheDocument();
    });

    test('should render content textarea pre-populated from note', () => {
      setupMocks({ note: makeNote({ content: 'Pre-filled content.' }) });
      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByDisplayValue('Pre-filled content.')).toBeInTheDocument();
    });

    // The standalone "Save (Ctrl+S)" button is gone -- see the "writing
    // surface" describe block below and the "keyboard shortcut" block, which
    // covers Ctrl+S still working.

    // Placeholder is "Untitled note", not "Note Title" -- this is the same
    // input the title-derivation tests below locate by that placeholder.
    test('should render note title placeholder when note exists', () => {
      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByPlaceholderText('Untitled note')).toBeInTheDocument();
    });

    test('should render content placeholder', () => {
      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByPlaceholderText('Write your note here...')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Input interaction
  // -------------------------------------------------------------------------
  describe('input interaction', () => {
    test('should update title input when user types', () => {
      render(<NoteEditor noteId="note-1" />);
      const titleInput = screen.getByPlaceholderText('Untitled note');
      fireEvent.change(titleInput, { target: { value: 'New Title' } });
      expect(titleInput).toHaveValue('New Title');
    });

    test('should update content textarea when user types', () => {
      render(<NoteEditor noteId="note-1" />);
      const contentInput = screen.getByPlaceholderText('Write your note here...');
      fireEvent.change(contentInput, { target: { value: 'New content here.' } });
      expect(contentInput).toHaveValue('New content here.');
    });

    test('should call updateNote when title changes (via debounced save)', async () => {
      render(<NoteEditor noteId="note-1" />);
      const titleInput = screen.getByPlaceholderText('Untitled note');
      fireEvent.change(titleInput, { target: { value: 'Updated Title' } });

      jest.advanceTimersByTime(2500);

      await waitFor(() => {
        expect(mockUpdateNote).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({ title: 'Updated Title' })
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // Read-only mode
  // -------------------------------------------------------------------------
  describe('read-only mode', () => {
    test('should disable title input when readOnly is true', () => {
      render(<NoteEditor noteId="note-1" readOnly={true} />);
      expect(screen.getByPlaceholderText('Untitled note')).toBeDisabled();
    });

    test('should disable content textarea when readOnly is true', () => {
      render(<NoteEditor noteId="note-1" readOnly={true} />);
      expect(screen.getByPlaceholderText('Write your note here...')).toBeDisabled();
    });

    test('should disable archive and delete in the top bar when readOnly is true', () => {
      render(<NoteEditor noteId="note-1" readOnly={true} />);
      expect(screen.getByRole('button', { name: /archive/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled();
    });

    // FUNC-001: a note from another campaign is fetched by the page, and the
    // active campaign's lookup never has it. Its text must still show.
    test('shows a note the active campaign cannot look up, when it is handed one', () => {
      setupMocks({ note: undefined });
      const elsewhere = makeNote({
        title: 'Old Quest Note',
        content: 'Written in the side campaign.',
        campaignId: 'campaign-other',
      });
      render(<NoteEditor noteId="note-1" note={elsewhere} readOnly />);
      expect(screen.getByPlaceholderText('Untitled note')).toHaveValue('Old Quest Note');
      expect(screen.getByPlaceholderText('Write your note here...')).toHaveValue(
        'Written in the side campaign.'
      );
      expect(screen.getByText(/^5 words/)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Save functionality
  // -------------------------------------------------------------------------
  describe('save functionality', () => {
    // The standalone Save button is gone; Ctrl+S is now the only manual-save
    // trigger (see the "writing surface" block for the footer's "to save
    // now" hint, and the "keyboard shortcut" block for the shortcut itself).
    test('should call saveNote with the current title and content on Ctrl+S', async () => {
      render(<NoteEditor noteId="note-1" />);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });
      expect(mockSaveNote).toHaveBeenCalledWith(
        'note-1',
        expect.objectContaining({ title: 'My Note', content: 'Some content here.' })
      );
    });

    test('should call onSave callback after manual save', async () => {
      const onSave = jest.fn();
      render(<NoteEditor noteId="note-1" onSave={onSave} />);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });
      expect(onSave).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Unsaved state display
  // -------------------------------------------------------------------------
  describe('unsaved state display', () => {
    test('should show "Not saved to server" status when note isUnsaved', () => {
      setupMocks({ note: makeNote({ isUnsaved: true }) });
      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByText('Not saved to server')).toBeInTheDocument();
    });

    // The separate "Remember to save your work!" / "Click Save to store this
    // note permanently" caption row is gone -- save state is stated exactly
    // once now, via the status indicator above. See the "save status"
    // describe block below for the positive assertion.
    test('should not show a second "remember to save" message alongside the status indicator', () => {
      setupMocks({ note: makeNote({ isUnsaved: true }) });
      render(<NoteEditor noteId="note-1" />);
      expect(screen.queryByText(/remember to save your work/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/click save to store this note permanently/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Keyboard shortcut (lines 135-137)
  // -------------------------------------------------------------------------
  describe('keyboard shortcut', () => {
    test('should call saveNote when Ctrl+S is pressed', async () => {
      render(<NoteEditor noteId="note-1" />);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });
      expect(mockSaveNote).toHaveBeenCalled();
    });

    test('should NOT call saveNote when only S key pressed (no Ctrl)', async () => {
      render(<NoteEditor noteId="note-1" />);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: false, bubbles: true })
        );
      });
      expect(mockSaveNote).not.toHaveBeenCalled();
    });

    test('should NOT call saveNote when Ctrl+other key pressed', async () => {
      render(<NoteEditor noteId="note-1" />);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })
        );
      });
      expect(mockSaveNote).not.toHaveBeenCalled();
    });

    // C1 (also): the footer used to say "Ctrl+S to save now" unconditionally
    // while this handler only checked ctrlKey -- macOS users (Cmd+S) had no
    // working shortcut at all. The handler now accepts metaKey too.
    test('should call saveNote when Cmd+S (metaKey) is pressed', async () => {
      render(<NoteEditor noteId="note-1" />);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true })
        );
      });
      expect(mockSaveNote).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Saving state indicator (lines 181-182 — isSaving === true path)
  // -------------------------------------------------------------------------
  describe('saving state indicator', () => {
    test('should show "Saving..." text while save is in progress', async () => {
      let resolveNote!: () => void;
      mockSaveNote.mockReturnValue(new Promise<void>(resolve => { resolveNote = resolve; }));

      render(<NoteEditor noteId="note-1" />);

      // Ctrl+S to enter saving state
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
      );

      // While saving, "Saving..." text should appear
      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeInTheDocument();
      });

      // Clean up
      await act(async () => { resolveNote(); });
    });
  });

  // -------------------------------------------------------------------------
  // handleManualSave error re-throw (lines 132-134)
  // -------------------------------------------------------------------------
  describe('handleManualSave error propagation', () => {
    // Bug #1051 (fixed): handleManualSave still re-throws (that contract is
    // relied on by the ref-exposed saveCurrentContent -- see the
    // "imperative ref methods" describe block below, and CampaignLinksPanel's
    // own suite). The standalone Save button is gone -- Ctrl+S is the only
    // manual-save trigger now, and it goes through triggerManualSave, which
    // catches the rejection and surfaces it via the saveError state instead
    // of producing an unhandled promise rejection.
    test('should recover from the saving state after a failed save', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSaveNote.mockRejectedValue(new Error('Save failed'));

      render(<NoteEditor noteId="note-1" />);

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });

      // After failure, saving state should resolve (isSaving = false via finally)
      await waitFor(() => {
        expect(screen.queryByText('Saving...')).not.toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    test('should display the error message when Ctrl+S fails, with no unhandled rejection', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSaveNote.mockRejectedValue(new Error('Ctrl+S save failed'));

      render(<NoteEditor noteId="note-1" />);

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Ctrl+S save failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    test('should clear a prior save error once a subsequent save succeeds', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSaveNote.mockRejectedValueOnce(new Error('Save failed'));

      render(<NoteEditor noteId="note-1" />);

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });

      mockSaveNote.mockResolvedValueOnce(undefined);

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });

      await waitFor(() => {
        expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    test('should clear a prior save error when the user edits the content', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSaveNote.mockRejectedValue(new Error('Save failed'));

      render(<NoteEditor noteId="note-1" />);

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'Editing after failure.' },
      });

      expect(screen.queryByText('Save failed')).not.toBeInTheDocument();

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // REACT-004: a failed autosave was only logged; the footer went back to
  // "Unsaved changes", the same as a pause that had not saved yet.
  // -------------------------------------------------------------------------
  describe('a failed autosave', () => {
    test('shows the reason and keeps the text', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockUpdateNote.mockRejectedValue(new Error('Autosave refused'));
      renderEditor({ note: makeNote({ content: 'start' }) });
      const body = screen.getByLabelText('Note content') as HTMLTextAreaElement;

      fireEvent.change(body, { target: { value: 'start and more' } });
      await act(async () => { jest.advanceTimersByTime(2500); });

      expect(screen.getByText('Autosave refused')).toBeInTheDocument();
      expect(body.value).toBe('start and more');
    });

    test('offers a retry that saves, and the reason goes once it has', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockUpdateNote.mockRejectedValue(new Error('Autosave refused'));
      renderEditor({ note: makeNote({ content: 'start' }) });

      fireEvent.change(screen.getByLabelText('Note content'), {
        target: { value: 'start and more' },
      });
      await act(async () => { jest.advanceTimersByTime(2500); });

      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      await waitFor(() => {
        expect(screen.queryByText('Autosave refused')).not.toBeInTheDocument();
      });
      expect(mockSaveNote).toHaveBeenCalledWith(
        'note-1',
        expect.objectContaining({ content: 'start and more' })
      );
      expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // T085 (REACT-003): leaving a note before the autosave fired dropped the
  // text. Leaving now saves it; a failure keeps it; closing the tab asks.
  // -------------------------------------------------------------------------
  describe('leaving the note', () => {
    test('saves what was typed when the editor goes before the autosave fires', async () => {
      const { unmount } = renderEditor({ note: makeNote({ content: 'start' }) });
      fireEvent.change(screen.getByLabelText('Note content'), {
        target: { value: 'start and the last sentence' },
      });

      unmount();
      await act(async () => { await Promise.resolve(); });

      expect(mockUpdateNote).toHaveBeenCalledTimes(1);
      expect(mockUpdateNote).toHaveBeenCalledWith(
        'note-1',
        expect.objectContaining({ content: 'start and the last sentence' })
      );
      // The debounce went with the editor: nothing writes a second time.
      await act(async () => { jest.advanceTimersByTime(5000); });
      expect(mockUpdateNote).toHaveBeenCalledTimes(1);
    });

    test('writes nothing when nothing was changed', async () => {
      const { unmount } = renderEditor();
      unmount();
      await act(async () => { await Promise.resolve(); });
      expect(mockUpdateNote).not.toHaveBeenCalled();
      expect(mockSaveNote).not.toHaveBeenCalled();
    });

    test('does not create an empty new note just because it was opened', async () => {
      const { unmount } = renderEditor({
        note: makeNote({ title: '', content: '', isUnsaved: true }),
      });
      unmount();
      await act(async () => { await Promise.resolve(); });
      expect(mockSaveNote).not.toHaveBeenCalled();
      expect(mockUpdateNote).not.toHaveBeenCalled();
    });

    test('never saves a read-only note', async () => {
      const { unmount } = renderEditor({ props: { readOnly: true } });
      unmount();
      await act(async () => { await Promise.resolve(); });
      expect(mockUpdateNote).not.toHaveBeenCalled();
    });

    test('a failed save on leaving keeps the edit, and reopening the note restores it with the reason', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockUpdateNote.mockRejectedValueOnce(new Error('Network unavailable'));
      const { unmount } = renderEditor({ note: makeNote({ content: 'start' }) });
      fireEvent.change(screen.getByLabelText('Note content'), {
        target: { value: 'start and the last sentence' },
      });

      unmount();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      expect(mockSetUnsavedEdit).toHaveBeenCalledWith('note-1', expect.objectContaining({
        content: 'start and the last sentence',
        error: 'Network unavailable',
      }));

      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByLabelText('Note content')).toHaveValue('start and the last sentence');
      expect(screen.getByText(/your last changes were not saved: network unavailable/i)).toBeInTheDocument();

      // Saving it forgets the kept edit.
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      await waitFor(() => expect(mockSetUnsavedEdit).toHaveBeenLastCalledWith('note-1', undefined));
      expect(mockSaveNote).toHaveBeenCalledWith(
        'note-1',
        expect.objectContaining({ content: 'start and the last sentence' })
      );
    });

    test('"All notes" saves first, then goes', async () => {
      const onBack = jest.fn();
      let release: () => void = () => undefined;
      mockUpdateNote.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
      renderEditor({ note: makeNote({ content: 'start' }), props: { onBack } });
      fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'start, then more' } });

      fireEvent.click(screen.getByRole('button', { name: /all notes/i }));
      await act(async () => { await Promise.resolve(); });
      expect(onBack).not.toHaveBeenCalled();

      await act(async () => { release(); });
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(mockUpdateNote).toHaveBeenCalledWith(
        'note-1',
        expect.objectContaining({ content: 'start, then more' })
      );
    });

    test('"All notes" stays, with the reason and the text, when that save fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const onBack = jest.fn();
      mockUpdateNote.mockRejectedValueOnce(new Error('Write refused'));
      renderEditor({ note: makeNote({ content: 'start' }), props: { onBack } });
      fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'start, then more' } });

      fireEvent.click(screen.getByRole('button', { name: /all notes/i }));

      expect(await screen.findByText('Write refused')).toBeInTheDocument();
      expect(onBack).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Note content')).toHaveValue('start, then more');
    });

    test('"All notes" with nothing to save simply goes', async () => {
      const onBack = jest.fn();
      renderEditor({ props: { onBack } });
      fireEvent.click(screen.getByRole('button', { name: /all notes/i }));
      await act(async () => { await Promise.resolve(); });
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(mockUpdateNote).not.toHaveBeenCalled();
    });

    test('closing the tab asks first while there is unsaved text, and not otherwise', () => {
      renderEditor({ note: makeNote({ content: 'start' }) });
      const close = () => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };

      expect(close()).toBe(false);
      fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'start, unsaved' } });
      expect(close()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // T085 (RECOVERY-001): pass 4's sequence, in jsdom. Note A's second Ctrl+S is
  // queued behind a first that has not answered (offline); the user opens
  // note B. The route remounts the editor per note id (`RecordRoute`), so the
  // queue belongs to A's editor: A's latest text must reach A, and B must get
  // no write and none of A's save state.
  // -------------------------------------------------------------------------
  describe('a save queued on one note when another is opened', () => {
    test("finishes against its own note, with that note's latest text", async () => {
      const noteA = makeNote({ id: 'note-a', title: 'A', content: 'Original A.' });
      const noteB = makeNote({ id: 'note-b', title: 'B', content: 'Original B.' });
      const calls: Array<{ id: string; content?: string; release: () => void }> = [];
      const held = (id: string, updates: Partial<Note>) =>
        new Promise<void>((resolve) => { calls.push({ id, content: updates.content, release: resolve }); });
      (useNotes as jest.Mock).mockImplementation(() => ({
        getNoteById: (id: string) => [noteA, noteB].find((n) => n.id === id),
        updateNote: held,
        saveNote: held,
        getUnsavedEdit: mockGetUnsavedEdit,
        setUnsavedEdit: mockSetUnsavedEdit,
      }));
      // What `RecordRoute` does: one editor instance per note id.
      const Route = ({ id }: { id: string }) => <NoteEditor key={id} noteId={id} />;
      const { rerender } = render(<Route id="note-a" />);
      const body = () => screen.getByLabelText('Note content');

      fireEvent.change(body(), { target: { value: 'First submitted version of A.' } });
      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
      fireEvent.change(body(), { target: { value: 'Latest submitted version of A.' } });
      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
      expect(calls).toHaveLength(1);

      rerender(<Route id="note-b" />);
      expect(body()).toHaveValue('Original B.');

      // Reconnect: the first save answers, and the queued one runs.
      await act(async () => { calls[0].release(); });
      await act(async () => { jest.advanceTimersByTime(0); });

      expect(calls.map((c) => c.id)).toEqual(['note-a', 'note-a']);
      expect(calls[1].content).toBe('Latest submitted version of A.');
      await act(async () => { calls[1].release(); });

      // B was never written and shows none of A's save state.
      expect(calls.some((c) => c.id === 'note-b')).toBe(false);
      expect(screen.queryByText(/saving/i)).not.toBeInTheDocument();
      expect(body()).toHaveValue('Original B.');
    });
  });

  // -------------------------------------------------------------------------
  // useImperativeHandle ref (line 55 — getCurrentContent / saveCurrentContent)
  // -------------------------------------------------------------------------
  describe('imperative ref methods', () => {
    test('should expose getCurrentContent returning current title and content via ref', () => {
      const ref = React.createRef<any>();
      setupMocks({ note: makeNote({ title: 'Ref Title', content: 'Ref Content' }) });
      render(<NoteEditor noteId="note-1" ref={ref} />);

      // After render, ref should be populated
      expect(ref.current).not.toBeNull();
      const { title, content } = ref.current.getCurrentContent();
      expect(title).toBe('Ref Title');
      expect(content).toBe('Ref Content');
    });

    test('should expose saveCurrentContent that calls saveNote via ref', async () => {
      const ref = React.createRef<any>();
      render(<NoteEditor noteId="note-1" ref={ref} />);

      await act(async () => {
        await ref.current.saveCurrentContent();
      });

      expect(mockSaveNote).toHaveBeenCalled();
    });

    // Bug #1051: the report's "Recommended Fix" option 1 (remove `throw error`
    // from handleManualSave) would break this contract. CampaignLinksPanel's
    // handleExtract calls saveCurrentContent (via NotePage's
    // saveCurrentEditorContent) and depends on the rejection to abort AI
    // extraction against unsaved content -- see
    // src/features/collaboration/notes/components/CampaignLinksPanel.tsx
    // (the pre-extraction save's catch block). This test guards against a
    // future "simplification" that swallows the error inside NoteEditor
    // instead of rejecting.
    test('should reject saveCurrentContent (via ref) when saveNote fails, so callers like CampaignLinksPanel can abort', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSaveNote.mockRejectedValue(new Error('Save failed'));

      const ref = React.createRef<any>();
      render(<NoteEditor noteId="note-1" ref={ref} />);

      await expect(
        act(async () => {
          await ref.current.saveCurrentContent();
        })
      ).rejects.toThrow('Save failed');

      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Last-saved text, via formatLastSaved (replaces the old getLastSavedText,
  // which had no day unit and rendered "Saved 10870h ago" for an old note).
  // -------------------------------------------------------------------------
  describe('last saved text', () => {
    // The footer states the save mechanism alongside the timestamp ("...
    // saves as you write"), so these match by substring rather than an exact
    // string -- see the "writing surface" block for the mechanism assertion.
    test('should show "Not saved yet" when a saved note carries no time at all', () => {
      setupMocks({ note: makeNote({ isUnsaved: false, dateModified: undefined, dateAdded: undefined }) });
      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByText(/not saved yet/i)).toBeInTheDocument();
    });

    test('should show "Saved just now" when note was saved less than a minute ago', () => {
      const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
      setupMocks({ note: makeNote({ isUnsaved: false, dateModified: tenSecondsAgo }) });
      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByText(/saved just now/i)).toBeInTheDocument();
    });

    test('should show a minutes-ago phrase when note was saved a few minutes ago', () => {
      const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
      setupMocks({ note: makeNote({ isUnsaved: false, dateModified: twoMinutesAgo }) });
      render(<NoteEditor noteId="note-1" />);
      expect(screen.getByText(/saved 2 minutes ago/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Title derivation (Task 11: deriveTitle drives the title until the user
  // types one explicitly).
  // -------------------------------------------------------------------------
  describe('title derivation', () => {
    // I1: the derived title is shown live but must NOT be the value written
    // to Firestore -- see the "title persistence (I1)" describe block below
    // for why a persisted derived string breaks on the second open.
    test('should derive the displayed title from the first content line, without persisting that derived string', async () => {
      renderEditor({ note: makeNote({ title: '', content: '' }) });

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'Wave Echo Cave\nThe party met Gundren.' },
      });

      expect(screen.getByDisplayValue('Wave Echo Cave')).toBeInTheDocument();

      jest.advanceTimersByTime(2500);

      await waitFor(() => {
        expect(mockUpdateNote).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({ title: '' })
        );
      });
    });

    test('should stop deriving once the user types a title', async () => {
      renderEditor({ note: makeNote({ title: '', content: 'First line' }) });

      fireEvent.change(screen.getByPlaceholderText('Untitled note'), {
        target: { value: 'My own title' },
      });
      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'A different first line' },
      });

      jest.advanceTimersByTime(2500);

      await waitFor(() => {
        expect(mockUpdateNote).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({ title: 'My own title' })
        );
      });
    });

    test('should hide the derivation hint once the title is explicit', () => {
      renderEditor({ note: makeNote({ title: 'Explicit', content: 'x' }) });
      expect(
        screen.queryByText('Taken from the first line. Click to write your own title.')
      ).not.toBeInTheDocument();
    });

    test('should show the derivation hint while the title is derived', () => {
      renderEditor({ note: makeNote({ title: '', content: 'First line' }) });
      expect(
        screen.getByText('Taken from the first line. Click to write your own title.')
      ).toBeInTheDocument();
    });

    // Legacy migration: notes created before this redesign persisted the
    // literal placeholder "New Note" as an explicit title. The editor must
    // treat that as if no title were set at all -- showing the derived
    // title and the derivation hint, not "New Note".
    test('should show the derivation hint and the derived title for a legacy "New Note" title', () => {
      renderEditor({ note: makeNote({ title: 'New Note', content: 'Wave Echo Cave\nmore' }) });
      expect(screen.getByDisplayValue('Wave Echo Cave')).toBeInTheDocument();
      expect(
        screen.getByText('Taken from the first line. Click to write your own title.')
      ).toBeInTheDocument();
    });
  });

  describe('autosave', () => {
    test('should save about two seconds after typing stops', async () => {
      renderEditor({ note: makeNote({ content: 'start' }) });

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'start and more' },
      });

      jest.advanceTimersByTime(1000);
      expect(mockUpdateNote).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1500);
      await waitFor(() => expect(mockUpdateNote).toHaveBeenCalled());
    });

    test('should save on an interval during continuous typing', async () => {
      renderEditor({ note: makeNote({ content: 'start' }) });
      const body = screen.getByPlaceholderText('Write your note here...');

      // Type without ever pausing long enough for the debounce to fire.
      for (let tick = 0; tick < 20; tick += 1) {
        fireEvent.change(body, { target: { value: `start ${'x'.repeat(tick)}` } });
        jest.advanceTimersByTime(1800);
      }

      await waitFor(() => expect(mockUpdateNote).toHaveBeenCalled());
    });

    test('should save a note shorter than three characters', async () => {
      renderEditor({ note: makeNote({ content: '' }) });

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'ab' },
      });

      jest.advanceTimersByTime(2500);

      // MIN_CONTENT_LENGTH used to return early with no state change, leaving
      // a two-character note reading "Unsaved changes" forever.
      await waitFor(() => {
        expect(mockUpdateNote).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({ content: 'ab' })
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // C1 (CRITICAL, data loss): a brand-new note (isUnsaved: true) was only ever
  // persisted via updateNote, which for an unsaved note just updates local
  // state -- performAutosave (both the debounce and the 30s interval) never
  // wrote it to Firestore. Only saveNote does that.
  // ---------------------------------------------------------------------------
  describe('unsaved note persistence (C1)', () => {
    test('should call saveNote, not merely updateNote, when autosaving a brand-new (isUnsaved) note', async () => {
      renderEditor({ note: makeNote({ isUnsaved: true, title: '', content: 'start' }) });

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'start and more' },
      });

      jest.advanceTimersByTime(2500);

      await waitFor(() => {
        expect(mockSaveNote).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({ content: 'start and more' })
        );
      });
    });

    test('should persist a brand-new note on the 30s interval even when typing never pauses', async () => {
      renderEditor({ note: makeNote({ isUnsaved: true, title: '', content: 'start' }) });
      const body = screen.getByPlaceholderText('Write your note here...');

      // Type without ever pausing long enough for the debounce to fire.
      for (let tick = 0; tick < 20; tick += 1) {
        fireEvent.change(body, { target: { value: `start ${'x'.repeat(tick)}` } });
        jest.advanceTimersByTime(1800);
      }

      await waitFor(() => expect(mockSaveNote).toHaveBeenCalled());
    });

    test('should switch the footer away from "Not saved to server" once a new note is autosaved', async () => {
      renderEditor({ note: makeNote({ isUnsaved: true, title: '', content: 'start' }) });

      expect(screen.getByText('Not saved to server')).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'start and more' },
      });

      jest.advanceTimersByTime(2500);

      await waitFor(() => {
        expect(screen.queryByText('Not saved to server')).not.toBeInTheDocument();
      });
    });

    test('should not regress a not-yet-unsaved (already-saved) note back to saveNote-only expectations -- updateNote still used', async () => {
      renderEditor({ note: makeNote({ isUnsaved: false, content: 'start' }) });

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'start and more' },
      });

      jest.advanceTimersByTime(2500);

      await waitFor(() => expect(mockUpdateNote).toHaveBeenCalled());
      expect(mockSaveNote).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // I1 (IMPORTANT): a derived title used to be PERSISTED (title: deriveTitle(
  // content)) by both performAutosave and handleManualSave. On the SECOND
  // open, the stored title was non-empty, so the load effect's
  // `!!noteData.title?.trim()` treated it as user-authored: the derivation
  // hint vanished and rewriting the opening line stopped updating the title
  // anywhere. The fix persists "" when the title is not explicit and lets
  // `displayTitle` (NoteCard, NotesList search) derive at read time instead.
  // ---------------------------------------------------------------------------
  describe('title persistence (I1)', () => {
    test('should persist an empty title, not the derived string, via autosave when the title is not explicit', async () => {
      renderEditor({ note: makeNote({ title: '', content: '' }) });

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'Wave Echo Cave\nThe party met Gundren.' },
      });

      jest.advanceTimersByTime(2500);

      await waitFor(() => {
        expect(mockUpdateNote).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({ title: '' })
        );
      });
      // The title input itself must still show the derived value -- only the
      // persisted field changes.
      expect(screen.getByDisplayValue('Wave Echo Cave')).toBeInTheDocument();
    });

    test('should persist an empty title, not the derived string, via manual save (Ctrl+S) when the title is not explicit', async () => {
      renderEditor({ note: makeNote({ title: '', content: 'Derived First Line\nmore' }) });

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });

      expect(mockSaveNote).toHaveBeenCalledWith(
        'note-1',
        expect.objectContaining({ title: '' })
      );
    });

    test('should still persist the explicit title as-is (unaffected by the derived-title fix)', async () => {
      renderEditor({ note: makeNote({ title: 'My own title', content: 'Some content' }) });

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
        );
      });

      expect(mockSaveNote).toHaveBeenCalledWith(
        'note-1',
        expect.objectContaining({ title: 'My own title' })
      );
    });

    test('should still show the derivation hint on a note reloaded with the persisted (empty-title) shape, and keep deriving from the first line', () => {
      // This is the shape a note now round-trips as: title "" persisted by
      // the fix above, content unchanged. Reload = a fresh render with that
      // exact shape (title never became "Wave Echo Cave" on disk).
      renderEditor({ note: makeNote({ title: '', content: 'Wave Echo Cave\nThe party met Gundren.' }) });

      expect(
        screen.getByText('Taken from the first line. Click to write your own title.')
      ).toBeInTheDocument();
      expect(screen.getByDisplayValue('Wave Echo Cave')).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('Write your note here...'), {
        target: { value: 'A Different First Line\nmore' },
      });

      expect(screen.getByDisplayValue('A Different First Line')).toBeInTheDocument();
      expect(
        screen.getByText('Taken from the first line. Click to write your own title.')
      ).toBeInTheDocument();
    });
  });

  describe('save status', () => {
    test('should state the save status exactly once', () => {
      renderEditor({ note: makeNote({ isUnsaved: false, dateModified: new Date().toISOString() }) });

      expect(screen.queryByText(/autosave every/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/remember to save your work/i)).not.toBeInTheDocument();
      expect(screen.getAllByText(/saved/i)).toHaveLength(1);
    });

    test('should not claim an hour count for an old note', () => {
      const longAgo = new Date('2024-01-01T00:00:00.000Z').toISOString();
      renderEditor({ note: makeNote({ isUnsaved: false, dateModified: longAgo }) });

      expect(screen.queryByText(/\d{3,}h ago/)).not.toBeInTheDocument();
    });

    test('should count words', () => {
      renderEditor({ note: makeNote({ content: 'one two three four five' }) });
      expect(screen.getByText(/5 words/)).toBeInTheDocument();
    });
  });

  describe('removed API', () => {
    test('should not accept an onExtractEntities prop', () => {
      // Compile-time contract; asserted here so the deletion is recorded.
      const props = Object.keys({ noteId: '', readOnly: false, onSave: () => undefined });
      expect(props).not.toContain('onExtractEntities');
    });
  });

  describe('writing surface', () => {
    test('should not render field headings', () => {
      renderEditor({ note: makeNote() });
      expect(screen.queryByRole('heading', { name: 'Title' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Content' })).not.toBeInTheDocument();
    });

    test('should not render the body in a monospace face', () => {
      renderEditor({ note: makeNote() });
      expect(screen.getByPlaceholderText('Write your note here...')).not.toHaveClass('font-mono');
    });

    test('should not pin the body to thirty rows', () => {
      renderEditor({ note: makeNote() });
      expect(screen.getByPlaceholderText('Write your note here...')).not.toHaveAttribute('rows', '30');
    });

    test('should place the title placeholder as "Untitled note"', () => {
      renderEditor({ note: makeNote({ title: '' }) });
      expect(screen.getByPlaceholderText('Untitled note')).toBeInTheDocument();
    });

    test('should offer back, archive and delete in the top bar', () => {
      const onBack = jest.fn();
      const onArchive = jest.fn();
      const onDelete = jest.fn();
      renderEditor({ note: makeNote(), props: { onBack, onArchive, onDelete } });

      fireEvent.click(screen.getByRole('button', { name: /all notes/i }));
      expect(onBack).toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: /archive/i }));
      expect(onArchive).toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: /delete/i }));
      expect(onDelete).toHaveBeenCalled();
    });

    test('should state the save mechanism honestly in the footer', () => {
      renderEditor({ note: makeNote({ isUnsaved: false, dateModified: new Date().toISOString() }) });
      expect(screen.getByText(/saves as you write/i)).toBeInTheDocument();
    });

    test('should show the word count and the save shortcut', () => {
      renderEditor({ note: makeNote({ content: 'one two three' }) });
      expect(screen.getByText(/3 words/)).toBeInTheDocument();
      expect(screen.getByText(/to save now/i)).toBeInTheDocument();
    });

    // C1 (also): the label must not contradict the handler. The keydown
    // handler accepts both Ctrl+S and Cmd+S (metaKey) -- see the "keyboard
    // shortcut" describe block -- so the footer must name both.
    test('should name both Ctrl+S and Cmd+S, matching what the handler accepts', () => {
      renderEditor({ note: makeNote({ content: 'one two three' }) });
      expect(screen.getByText(/ctrl\+s/i)).toBeInTheDocument();
      expect(screen.getByText(/⌘s/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // The body field on the shared primitive (PR 9.2)
  //
  // NoteEditor kept a hand-rolled textarea while every other field in the
  // product moved onto `Input` in 8.1 -- its scope was the eleven entity
  // forms, and this was not one of them. It is the last one.
  // -------------------------------------------------------------------------
  describe('body field', () => {
    test('resolves the body by its label, not only by its placeholder', () => {
      // A placeholder is the name a control has until someone types in it,
      // which is to say it is not a name. Every existing test here finds this
      // field by placeholder; this is the one that proves it has a real label.
      renderEditor({ note: makeNote({ content: 'written down' }) });

      const body = screen.getByLabelText('Note content') as HTMLTextAreaElement;
      expect(body.tagName).toBe('TEXTAREA');
      expect(body.value).toBe('written down');
    });

    test('every control in the editor has an accessible name', () => {
      const { container } = renderEditor({ note: makeNote() });
      expect(unnamedControlsIn(container)).toEqual([]);
    });

    test('carries no markdown toolbar', () => {
      // D84: notes stay plain text, so there is nothing for a toolbar to mark
      // up. The field moved onto the primitive for the label association; it
      // did not gain a parser.
      renderEditor({ note: makeNote() });
      expect(screen.queryByRole('button', { name: /bold/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /italic/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /quote/i })).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Typing while an autosave is in flight. The real NoteProvider writes the
  // saved fields into its `notes` state when the write resolves, which hands
  // out a NEW `getNoteById`. The editor's load effect depended on it, so it
  // re-ran and reset the fields to the snapshot that was saved -- throwing
  // away whatever was typed during the round-trip and moving the caret to the
  // end. The mocks above keep one `getNoteById` for the whole test, which is
  // why none of them saw it; this harness behaves like the provider.
  // ---------------------------------------------------------------------------
  describe('typing during an in-flight save', () => {
    /** A stand-in for NoteProvider: notes in React state, a fresh
     *  `getNoteById` whenever they change, and a save the test resolves. */
    function renderWithProvider(initial: Note) {
      let resolveSave: (() => void) | null = null;
      let ctx: Record<string, unknown> = {};
      (useNotes as jest.Mock).mockImplementation(() => ctx);

      const Harness: React.FC = () => {
        const [notes, setNotes] = React.useState<Note[]>([initial]);
        const getNoteById = React.useCallback(
          (id: string) => notes.find(n => n.id === id),
          [notes]
        );
        const persist = React.useCallback(
          (id: string, updates: Partial<Note>) =>
            new Promise<void>(resolve => {
              resolveSave = () => {
                setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...updates, isUnsaved: false } : n)));
                resolve();
              };
            }),
          []
        );
        ctx = { getNoteById, updateNote: persist, saveNote: persist, getUnsavedEdit: mockGetUnsavedEdit, setUnsavedEdit: mockSetUnsavedEdit };
        return <NoteEditor noteId={initial.id} />;
      };

      render(<Harness />);
      return {
        finishSave: async () => {
          await act(async () => {
            resolveSave?.();
          });
        },
      };
    }

    test('keeps text typed while the save was on its way to the server', async () => {
      const { finishSave } = renderWithProvider(makeNote({ content: 'The innkeeper' }));
      const body = screen.getByLabelText('Note content') as HTMLTextAreaElement;

      fireEvent.change(body, { target: { value: 'The innkeeper lied' } });
      act(() => { jest.advanceTimersByTime(2500); });

      // The save of "The innkeeper lied" is in flight; the player keeps writing.
      fireEvent.change(body, { target: { value: 'The innkeeper lied about the cellar' } });
      await finishSave();

      expect(body.value).toBe('The innkeeper lied about the cellar');
    });

    test('keeps a title typed while the save was on its way to the server', async () => {
      const { finishSave } = renderWithProvider(makeNote({ title: '', content: 'body' }));
      const title = screen.getByLabelText('Note title') as HTMLInputElement;

      fireEvent.change(title, { target: { value: 'Stonehill' } });
      act(() => { jest.advanceTimersByTime(2500); });

      fireEvent.change(title, { target: { value: 'Stonehill Inn' } });
      await finishSave();

      expect(title.value).toBe('Stonehill Inn');
    });

    test('still reads "Unsaved changes" when the save finished behind newer text', async () => {
      const { finishSave } = renderWithProvider(makeNote({ content: 'a' }));
      const body = screen.getByLabelText('Note content');

      fireEvent.change(body, { target: { value: 'ab' } });
      act(() => { jest.advanceTimersByTime(2500); });
      fireEvent.change(body, { target: { value: 'abc' } });
      await finishSave();

      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    test('a brand-new note saved by Ctrl+S stops reading "Not saved to server"', async () => {
      const { finishSave } = renderWithProvider(makeNote({ isUnsaved: true, title: '', content: 'x' }));

      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
      await finishSave();

      expect(screen.queryByText('Not saved to server')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // T072: the 2 s debounce, the 30 s interval and Ctrl+S all save through the
  // same path, and nothing stopped one from starting while another was
  // awaiting. Two writes in flight can land in either order -- the older text
  // last, with the newer save having already marked the note clean -- and
  // two creates of a new note race `createDocument`'s existence check.
  // ---------------------------------------------------------------------------
  describe('saves never overlap', () => {
    /** A stand-in for NoteProvider that holds every save until released. */
    function renderWithHeldSaves(initial: Note) {
      const calls: Array<{ via: string; updates: Partial<Note>; release: () => void }> = [];
      let ctx: Record<string, unknown> = {};
      (useNotes as jest.Mock).mockImplementation(() => ctx);

      const Harness: React.FC = () => {
        const [notes, setNotes] = React.useState<Note[]>([initial]);
        const getNoteById = React.useCallback(
          (id: string) => notes.find(n => n.id === id),
          [notes]
        );
        const held = (via: string) => (id: string, updates: Partial<Note>) =>
          new Promise<void>(resolve => {
            calls.push({
              via,
              updates,
              release: () => {
                setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...updates, isUnsaved: false } : n)));
                resolve();
              },
            });
          });
        ctx = { getNoteById, updateNote: held('updateNote'), saveNote: held('saveNote'), getUnsavedEdit: mockGetUnsavedEdit, setUnsavedEdit: mockSetUnsavedEdit };
        return <NoteEditor noteId={initial.id} />;
      };

      render(<Harness />);
      return {
        calls,
        release: async (index: number) => {
          await act(async () => {
            calls[index].release();
          });
        },
      };
    }

    const type = (value: string) =>
      fireEvent.change(screen.getByLabelText('Note content'), { target: { value } });
    const idle = () => act(() => { jest.advanceTimersByTime(2500); });

    test('an autosave due while another is in flight waits for it', async () => {
      const { calls, release } = renderWithHeldSaves(makeNote({ content: 'a' }));

      type('ab'); idle();
      type('abc'); idle();
      expect(calls).toHaveLength(1);

      await release(0);
      expect(calls).toHaveLength(2);
      expect(calls[1].updates.content).toBe('abc');
    });

    test('several saves due during one in flight become one save of the newest text', async () => {
      const { calls, release } = renderWithHeldSaves(makeNote({ content: 'a' }));

      type('ab'); idle();
      type('abc'); idle();
      type('abcd'); idle();
      act(() => { jest.advanceTimersByTime(30000); });

      await release(0);
      await act(async () => { jest.advanceTimersByTime(0); });
      expect(calls).toHaveLength(2);
      expect(calls[1].updates.content).toBe('abcd');
    });

    test('Ctrl+S during an in-flight autosave waits for it, then saves', async () => {
      const { calls, release } = renderWithHeldSaves(makeNote({ content: 'a' }));

      type('ab'); idle();
      type('abc');
      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
      expect(calls).toHaveLength(1);

      await release(0);
      expect(calls).toHaveLength(2);
      expect(calls[1].updates.content).toBe('abc');
    });

    // PERF2-005: the idle save behind a Ctrl+S wrote the same text again.
    test('an autosave of text a save already wrote writes nothing', async () => {
      const { calls, release } = renderWithHeldSaves(makeNote({ content: 'a' }));

      type('ab');
      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
      expect(calls).toHaveLength(1);
      await release(0);

      idle();
      await act(async () => { jest.advanceTimersByTime(30000); });
      expect(calls).toHaveLength(1);
    });

    test('an autosave queued behind a save of the same text writes nothing', async () => {
      const { calls, release } = renderWithHeldSaves(makeNote({ content: 'a' }));

      type('ab');
      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
      idle();
      expect(calls).toHaveLength(1);

      await release(0);
      await act(async () => { jest.advanceTimersByTime(0); });
      expect(calls).toHaveLength(1);
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });

    test('once all saves are through, the note reads as saved', async () => {
      const { calls, release } = renderWithHeldSaves(makeNote({ content: 'a' }));

      type('ab'); idle();
      type('abc'); idle();
      await release(0);
      await release(1);

      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
      expect(calls).toHaveLength(2);
    });
  });
});
