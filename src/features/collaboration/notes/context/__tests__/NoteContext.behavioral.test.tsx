// src/features/collaboration/notes/context/__tests__/NoteContext.behavioral.test.tsx
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { NoteProvider, useNotes } from '../NoteContext';
import { Note, ExtractedEntity, EntityType, NoteStatus } from '../../types';
import { createFakeCollectionListener } from '@/test-utils/fake-collection-listener';

// Mock Firebase dependencies (NOT the context being tested)
const mockUseAuth = jest.fn();
const mockUseGroups = jest.fn();
const mockUseCampaigns = jest.fn();
const mockUseUser = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@/features/user-management', () => ({
  useAuth: () => mockUseAuth(),
  useGroups: () => mockUseGroups(),
  useCampaigns: () => mockUseCampaigns(),
  useUser: () => mockUseUser()
}));

/**
 * `15-9`: converting a rumour out of a note writes the rumour here, because a
 * rumour has no create page to hand that job to. That makes `RumorProvider` a
 * requirement of `NoteProvider` -- satisfied in `app/App.tsx`, and mocked here.
 */
const mockAddRumor = jest.fn().mockResolvedValue('rumor-1');
const mockMergeIntoRecord = jest.fn().mockResolvedValue('strange-lights');
jest.mock('features/campaign-entities', () => ({
  useRumors: () => ({ addRumor: mockAddRumor }),
  // "Add what you know to it" (T163), which a plain conversion never reaches.
  useMergeIntoRecord: () => mockMergeIntoRecord,
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate
}));

// `where` is observable, so a test can see what the read was constrained to.
jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  where: (field: string, op: string, value: unknown) => ({ field, op, value })
}));

/*
  The notes listener (T032). Its first snapshot comes from
  `notesListener.firstSnapshot`, which a test resolves, rejects or holds the
  way it once configured `getCollection`; the write fakes installed below
  deliver every write to the open listener, as the SDK does.
*/
const notesListener = createFakeCollectionListener<Note>();

// Mock DocumentService
const mockDocumentService = {
  subscribeToCollection: notesListener.subscribe,
  createDocument: jest.fn(),
  updateDocument: jest.fn(),
  updateDocumentWithAttribution: jest.fn(),
  updateDocumentAfterReading: jest.fn(),
  deleteDocument: jest.fn()
};

jest.mock('core/services/firebase/data/DocumentService', () => ({
  __esModule: true,
  default: {
    getInstance: () => mockDocumentService
  }
}));

// Mock user utilities
jest.mock('core/utils/user-utils', () => ({
  getUserName: jest.fn(),
  getActiveCharacterName: jest.fn()
}));

const { getUserName, getActiveCharacterName } = require('core/utils/user-utils');

/**
 * The id `createNote` returned in the current test. Ids are random since T029,
 * so a test that creates a note refers to it by what came back, not by a
 * literal.
 */
let createdId: string;

describe('NoteContext Behavioral Tests', () => {
  // Test component to access context
  const TestComponent = ({ onRender }: { onRender?: (context: any) => void }) => {
    const context = useNotes();
    React.useEffect(() => {
      if (onRender) onRender(context);
    }, [context, onRender]);
    return <div data-testid="test-component">Test</div>;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock returns
    mockUseAuth.mockReturnValue({
      user: { uid: 'test-user', email: 'test@example.com' }
    });
    mockUseGroups.mockReturnValue({
      activeGroupId: 'test-group'
    });
    mockUseCampaigns.mockReturnValue({
      activeCampaignId: 'test-campaign'
    });
    mockUseUser.mockReturnValue({
      userProfile: { id: 'test-user', name: 'Test User' },
      activeGroupUserProfile: {
        userId: 'test-user',
        username: 'Test User',
        role: 'member',
        joinedAt: '2025-06-15T00:00:00.000Z',
        activeCharacterId: 'char-1',
        characters: [
          { id: 'char-1', name: 'Test Character' }
        ]
      }
    });

    getUserName.mockReturnValue('Test User');
    getActiveCharacterName.mockReturnValue('Test Character');

    // Default empty collection, and writes that reach the listener.
    notesListener.reset();
    mockDocumentService.createDocument.mockImplementation(notesListener.create);
    mockDocumentService.updateDocumentWithAttribution.mockImplementation(notesListener.update);
    mockDocumentService.updateDocumentAfterReading.mockImplementation(notesListener.updateAfterReading);
    mockDocumentService.deleteDocument.mockImplementation(notesListener.remove);
  });

  // T029: the provider is mounted on every route, so what it reads is paid
  // on every page load. Since T032 that is one listener, not a fetch.
  describe('What is read', () => {
    const renderProvider = () => {
      let capturedContext: any;
      const utils = render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      return { ...utils, context: () => capturedContext };
    };

    test("reads only the active campaign's notes", async () => {
      renderProvider();

      await waitFor(() => expect(notesListener.subscribe).toHaveBeenCalled());
      expect(notesListener.subscribe).toHaveBeenCalledWith(
        'groups/test-group/users/test-user/notes',
        expect.any(Function),
        expect.any(Function),
        [{ field: 'campaignId', op: '==', value: 'test-campaign' }]
      );
    });

    test('reads nothing while no campaign is selected', async () => {
      mockUseCampaigns.mockReturnValue({ activeCampaignId: null });
      const { context } = renderProvider();

      await waitFor(() => expect(context().isLoading).toBe(false));
      expect(notesListener.subscribe).not.toHaveBeenCalled();
      expect(context().notes).toEqual([]);
    });

    test('reads once when the campaign resolves after the group', async () => {
      mockUseCampaigns.mockReturnValue({ activeCampaignId: null });
      const { rerender } = renderProvider();

      mockUseCampaigns.mockReturnValue({ activeCampaignId: 'test-campaign' });
      rerender(
        <NoteProvider>
          <TestComponent />
        </NoteProvider>
      );

      await waitFor(() => expect(notesListener.subscribe).toHaveBeenCalled());
      expect(notesListener.subscribe).toHaveBeenCalledTimes(1);
    });
  });

  // T085: an edit whose save failed after its editor had gone is held here,
  // in memory, until the note is saved -- and never across users or campaigns.
  describe('Unsaved edits kept after leaving a note', () => {
    const edit = { title: '', content: 'the last sentence', hasExplicitTitle: false, error: 'offline' };
    const renderProvider = () => {
      let capturedContext: any;
      const utils = render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      return { ...utils, context: () => capturedContext };
    };

    test('keeps an edit until it is forgotten', async () => {
      const { context } = renderProvider();
      await waitFor(() => expect(context()).toBeDefined());

      context().setUnsavedEdit('note-1', edit);
      expect(context().getUnsavedEdit('note-1')).toEqual(edit);

      context().setUnsavedEdit('note-1', undefined);
      expect(context().getUnsavedEdit('note-1')).toBeUndefined();
    });

    test('drops every kept edit when the user or campaign changes', async () => {
      const { context, rerender } = renderProvider();
      await waitFor(() => expect(context()).toBeDefined());
      context().setUnsavedEdit('note-1', edit);

      mockUseCampaigns.mockReturnValue({ activeCampaignId: 'other-campaign' });
      rerender(
        <NoteProvider>
          <TestComponent onRender={() => undefined} />
        </NoteProvider>
      );
      await waitFor(() => expect(context().getUnsavedEdit('note-1')).toBeUndefined());

      context().setUnsavedEdit('note-2', edit);
      mockUseAuth.mockReturnValue({ user: { uid: 'someone-else', email: 'x@example.com' } });
      rerender(
        <NoteProvider>
          <TestComponent onRender={() => undefined} />
        </NoteProvider>
      );
      await waitFor(() => expect(context().getUnsavedEdit('note-2')).toBeUndefined());
    });
  });

  describe('Authentication Requirements', () => {
    test('should throw error when creating note without authentication', async () => {
      mockUseAuth.mockReturnValue({ user: null });

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      await act(async () => {
        await expect(capturedContext.createNote('Test Title', 'Test Content'))
          .rejects.toThrow('User not authenticated or no active group');
      });
    });

    test('should throw error when creating note without active group', async () => {
      mockUseGroups.mockReturnValue({ activeGroupId: null });

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      await act(async () => {
        await expect(capturedContext.createNote('Test Title', 'Test Content'))
          .rejects.toThrow('User not authenticated or no active group');
      });
    });

    test('should throw error when creating note without active campaign', async () => {
      mockUseCampaigns.mockReturnValue({ activeCampaignId: null });

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      await act(async () => {
        await expect(capturedContext.createNote('Test Title', 'Test Content'))
          .rejects.toThrow('No active campaign selected. Please select a campaign before creating notes.');
      });
    });
  });

  describe('Note Creation (createNote)', () => {
    test('should create note with a note- id and metadata', async () => {
      // Wait for the listener's first snapshot before acting, so every test
      // starts from a loaded list.
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      let noteId = '';
      await act(async () => {
        noteId = await capturedContext.createNote('Test Note', 'Test content here');
      });
      expect(noteId).toMatch(/^note-[a-z0-9]+$/);

      // Verify note was added to local state
      expect(capturedContext.notes).toHaveLength(1);
      expect(capturedContext.notes[0]).toMatchObject({
        id: noteId,
        title: 'Test Note',
        content: 'Test content here',
        status: 'active',
        campaignId: 'test-campaign',
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        createdByCharacterName: 'Test Character',
        isUnsaved: true
      });
    });

    test('should not allocate an id an existing note holds', async () => {
      // Mock existing notes to test sequence
      const existingNotes: Note[] = [
        {
          id: 'note-3',
          title: 'Existing Note',
          content: 'Existing content',
          extractedEntities: [],
          status: 'active' as NoteStatus,
          tags: [],
          updatedAt: '2025-06-15T00:00:00.000Z',
          campaignId: 'test-campaign',
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          createdByCharacterName: 'Test Character',
          dateAdded: '2025-06-15T00:00:00.000Z',
          dateModified: '2025-06-15T00:00:00.000Z',
          modifiedBy: 'test-user',
          modifiedByUsername: 'Test User',
          modifiedByCharacterName: 'Test Character'
        }
      ];
      notesListener.firstSnapshot.mockResolvedValue(existingNotes);

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      // Wait for the mocked existing notes to actually land in state first.
      await waitFor(() => {
        expect(capturedContext.notes).toHaveLength(1);
      });

      await act(async () => {
        const noteId = await capturedContext.createNote('New Note', 'New content');
        expect(noteId).toMatch(/^note-[a-z0-9]+$/);
        expect(noteId).not.toBe('note-3');
      });
    });

    test('should include required BaseContent fields', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });

      const note = capturedContext.notes[0];
      // Its times are the server's, stamped when it is first saved (T132).
      expect(note).not.toHaveProperty('dateAdded');
      expect(note).not.toHaveProperty('dateModified');
      expect(note).toHaveProperty('createdBy', 'test-user');
      expect(note).toHaveProperty('createdByUsername', 'Test User');
      expect(note).toHaveProperty('createdByCharacterName', 'Test Character');
      expect(note).toHaveProperty('modifiedBy', 'test-user');
      expect(note).toHaveProperty('modifiedByUsername', 'Test User');
      expect(note).toHaveProperty('modifiedByCharacterName', 'Test Character');
    });
  });

  describe('Note Saving (saveNote)', () => {
    test('should save unsaved note to Firebase', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      // createNote and saveNote are split into separate act() calls: saveNote
      // reads the just-created note via getNoteById, which is a useCallback
      // closed over `notes` from the last committed render. If both calls
      // happen inside the same act() with no render in between, saveNote
      // still sees the pre-createNote (empty) `notes` and throws "Note not
      // found" -- a stale-closure timing issue, not a behavior under test.
      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.saveNote(createdId);
      });

      // Verify Firebase createDocument was called
      expect(mockDocumentService.createDocument).toHaveBeenCalledWith(
        'groups/test-group/users/test-user/notes',
        expect.objectContaining({
          id: createdId,
          title: 'Test Note',
          content: 'Test content'
        }),
        createdId
      );

      // Verify isUnsaved flag was removed locally
      expect(capturedContext.notes[0].isUnsaved).toBe(false);
    });

    // T072: the editor queues a save behind one in flight, and the queued save
    // runs with the context it was handed -- possibly from before the first
    // save's state update committed, where the note still reads isUnsaved.
    // Creating it again either throws "already exists" (the save is lost) or,
    // had both checks passed, lands a second create over the first.
    test('a save made from a context captured before the create committed updates, not re-creates', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });
      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });

      const stale = capturedContext;
      await act(async () => {
        await stale.saveNote(createdId, { content: 'first' });
        await stale.saveNote(createdId, { content: 'second' });
      });

      expect(mockDocumentService.createDocument).toHaveBeenCalledTimes(1);
      expect(mockDocumentService.updateDocumentWithAttribution).toHaveBeenCalledWith(
        'groups/test-group/users/test-user/notes',
        createdId,
        expect.objectContaining({ content: 'second' })
      );
    });

    test('an update made from a context captured before the create committed still writes', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });
      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });

      const stale = capturedContext;
      await act(async () => {
        await stale.saveNote(createdId, { content: 'first' });
        await stale.updateNote(createdId, { content: 'second' });
      });

      expect(mockDocumentService.updateDocumentWithAttribution).toHaveBeenCalledWith(
        'groups/test-group/users/test-user/notes',
        createdId,
        expect.objectContaining({ content: 'second' })
      );
    });

    test('should update existing saved note in Firebase', async () => {
      // Start with a saved note
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.saveNote(createdId); // Save it first
      });
      jest.clearAllMocks();

      // Now update it
      await act(async () => {
        await capturedContext.saveNote(createdId, { title: 'Updated Title' });
      });

      // Verify the update reached Firebase through the attribution-aware write.
      // This assertion previously named updateDocument; saveNote's update branch
      // was deliberately moved onto updateDocumentWithAttribution so that note
      // edits get attribution from the same single write path as every other
      // content type. The old assertion encoded the superseded contract.
      expect(mockDocumentService.updateDocumentWithAttribution).toHaveBeenCalledWith(
        'groups/test-group/users/test-user/notes',
        createdId,
        expect.objectContaining({
          title: 'Updated Title'
        })
      );
    });

    test('should route updates to an already-saved note through updateDocumentWithAttribution, preserving updatedAt and the caller\'s updates', async () => {
      // Seed an already-saved note via the initial fetch, rather than via
      // createNote()+saveNote() in the same act(), to avoid the pre-existing,
      // unrelated stale-closure bug where getNoteById can't see a note
      // created moments earlier in the same act() callback.
      const existingNote: Note = {
        id: 'note-42',
        title: 'Existing Note',
        content: 'Original content',
        extractedEntities: [],
        status: 'active' as NoteStatus,
        tags: [],
        updatedAt: '2025-06-01T00:00:00.000Z',
        campaignId: 'test-campaign',
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        createdByCharacterName: 'Test Character',
        dateAdded: '2025-06-01T00:00:00.000Z',
        dateModified: '2025-06-01T00:00:00.000Z',
        modifiedBy: 'test-user',
        modifiedByUsername: 'Test User',
        modifiedByCharacterName: 'Test Character'
      };
      notesListener.firstSnapshot.mockResolvedValue([existingNote]);

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      // The initial fetch that populates `notes` (and therefore what
      // getNoteById can see) resolves asynchronously; wait for it to land
      // before acting, rather than assuming it beat the next statement.
      await waitFor(() => {
        expect(capturedContext.notes).toHaveLength(1);
      });

      await act(async () => {
        await capturedContext.saveNote('note-42', { title: 'Updated Title', tags: ['lore'] });
      });

      // BEHAVIOR: Updating an already-saved note must go through the
      // attribution-aware updateDocumentWithAttribution (the same single
      // write path createDocument already uses for new notes), while still
      // sending updatedAt -- a Note-specific field, not attribution -- and
      // the caller's own ...updates.
      expect(mockDocumentService.updateDocumentWithAttribution).toHaveBeenCalledWith(
        'groups/test-group/users/test-user/notes',
        'note-42',
        expect.objectContaining({
          title: 'Updated Title',
          tags: ['lore'],
          updatedAt: expect.any(String)
        })
      );
      expect(mockDocumentService.updateDocument).not.toHaveBeenCalled();
    });

    test('should throw error when saving note without authentication', async () => {
      mockUseAuth.mockReturnValue({ user: null });

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        await expect(capturedContext.saveNote('note-1'))
          .rejects.toThrow('User not authenticated or no active group');
      });
    });

    test('should throw error when saving nonexistent note', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        await expect(capturedContext.saveNote('nonexistent-note'))
          .rejects.toThrow('Note not found');
      });
    });
  });

  describe('Note Updates (updateNote)', () => {
    test('should update unsaved note locally only', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.updateNote(createdId, { title: 'Updated Title' });
      });

      // Should update locally but not call Firebase
      expect(capturedContext.notes[0].title).toBe('Updated Title');
      expect(capturedContext.notes[0].isUnsaved).toBe(true);
      expect(mockDocumentService.updateDocument).not.toHaveBeenCalled();
    });

    test('should save updates to Firebase for saved notes', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.saveNote(createdId); // Save it first
      });
      jest.clearAllMocks();

      await act(async () => {
        await capturedContext.updateNote(createdId, { title: 'Updated Title' });
      });

      // Should call saveNote internally, which routes an already-saved note
      // through the attribution-aware updateDocumentWithAttribution. This
      // assertion previously named updateDocument, the pre-refactor contract.
      expect(mockDocumentService.updateDocumentWithAttribution).toHaveBeenCalled();
    });

    test('should throw error when updating nonexistent note', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        await expect(capturedContext.updateNote('nonexistent-note', { title: 'New Title' }))
          .rejects.toThrow('Note not found');
      });
    });
  });

  describe('Entity Conversion (convertEntity)', () => {
    const mockEntity: ExtractedEntity = {
      id: 'entity-1',
      text: 'Galadriel the Wise',
      type: 'npc' as EntityType,
      confidence: 0.9,
      isConverted: false,
      createdAt: '2025-06-15T00:00:00.000Z',
      extraData: {
        name: 'Galadriel',
        title: 'the Wise',
        race: 'Elf'
      }
    };

    /**
     * Boilerplate for the cases below: create a note, put one entity on it,
     * convert it, and hand back the `initialData` the create route was given.
     */
    const convertAndCapture = async (
      entity: ExtractedEntity,
      type: EntityType
    ): Promise<Record<string, unknown>> => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => expect(capturedContext.isLoading).toBe(false));

      await act(async () => {
        createdId = await capturedContext.createNote('Session 12', 'Test content');
      });
      await act(async () => {
        await capturedContext.updateNote(createdId, { extractedEntities: [entity] });
      });
      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', type);
      });

      const call = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1];
      return call[1].state.initialData as Record<string, unknown>;
    };

    describe('the note sentence the entity was read out of', () => {
      /*
        `context` used to survive only when the model returned no
        `description`. The moment it wrote one -- which is the common case, and
        the case where provenance matters most -- the sentence the fact came
        from was dropped, and so was the note it came from. `context` is not a
        key of `initialData`, so the quick-add carry never saw it either.
      */
      test('is kept even when the model also wrote a description', async () => {
        const initialData = await convertAndCapture({
          ...mockEntity,
          extraData: {
            name: 'Galadriel',
            description: 'Lady of Lothlorien.',
            context: 'Galadriel gave each of us a parting gift.',
          },
        }, 'npc' as EntityType);

        expect(initialData.description).toContain('Lady of Lothlorien.');
        expect(initialData.description)
          .toContain('Galadriel gave each of us a parting gift.');
      });

      test('leads with the description and puts the sentence under it', async () => {
        const initialData = await convertAndCapture({
          ...mockEntity,
          extraData: {
            name: 'Galadriel',
            description: 'Lady of Lothlorien.',
            context: 'Galadriel gave each of us a parting gift.',
          },
        }, 'npc' as EntityType);

        const text = initialData.description as string;
        expect(text.indexOf('Lady of Lothlorien.'))
          .toBeLessThan(text.indexOf('Galadriel gave each of us'));
      });

      test('falls back to the note provenance when the model wrote no description', async () => {
        const initialData = await convertAndCapture({
          ...mockEntity,
          extraData: { name: 'Galadriel', context: 'She gave us gifts.' },
        }, 'npc' as EntityType);

        expect(initialData.description).toContain('Created from note: Session 12');
        expect(initialData.description).toContain('She gave us gifts.');
      });

      test('is not repeated when the description already contains it', async () => {
        const sentence = 'Galadriel gave each of us a parting gift.';
        const initialData = await convertAndCapture({
          ...mockEntity,
          extraData: { name: 'Galadriel', description: sentence, context: sentence },
        }, 'npc' as EntityType);

        const text = initialData.description as string;
        expect(text.split(sentence)).toHaveLength(2); // i.e. it appears once
      });

      test('is kept for a converted location too', async () => {
        const initialData = await convertAndCapture({
          ...mockEntity,
          type: 'location' as EntityType,
          extraData: {
            name: 'Lothlorien',
            description: 'A golden wood.',
            context: 'We rested in Lothlorien for a month.',
          },
        }, 'location' as EntityType);

        expect(initialData.description).toContain('A golden wood.');
        expect(initialData.description).toContain('We rested in Lothlorien for a month.');
      });
    });

    test('should navigate to NPC creation with entity data', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        // Add entity to note
        await capturedContext.updateNote(createdId, {
          extractedEntities: [mockEntity]
        });
      });
      await act(async () => {
        const result = await capturedContext.convertEntity(createdId, 'entity-1', 'npc');
        expect(result).toBe(''); // Returns empty string for navigation
      });

      expect(mockNavigate).toHaveBeenCalledWith('/npcs/create', {
        state: {
          initialData: expect.objectContaining({
            name: 'Galadriel',
            title: 'the Wise',
            race: 'Elf'
          }),
          noteId: createdId,
          entityId: 'entity-1'
        }
      });
    });

    test('should navigate to location creation with entity data', async () => {
      const locationEntity: ExtractedEntity = {
        ...mockEntity,
        type: 'location',
        extraData: {
          name: 'Waterdeep',
          locationType: 'city',
          description: 'A great trading city'
        }
      };

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [locationEntity]
        });
      });
      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', 'location');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/locations/create', {
        state: {
          initialData: expect.objectContaining({
            name: 'Waterdeep',
            type: 'city'
          }),
          noteId: createdId,
          entityId: 'entity-1'
        }
      });
    });

    /*
      This replaces a case that asserted the two defects it was watching.

      It expected `objectives: ['Search the cave', 'Defeat the guardian']` --
      bare strings, where `Quest.objectives` is `QuestObjective[]` -- and
      `relatedNPCIds: ['npc-1', 'npc-2']`, whose id-shaped values disguised the
      fact that the model has no ids and was answering with names. Written
      against what the code did rather than what a quest needs, it made both
      defects look like the contract.

      What `convertEntity` owes a quest is now: the extractor's fields under
      the names the schema actually uses, unresolved, for the write boundary to
      turn into a document. `objectives` stays `string[]` here on purpose --
      `normaliseObjectives` converts it in `buildDocument`, which is the last
      point the type can be made to hold for every path, not just this one.
    */
    test('hands a quest the extractor fields, under the names the schema uses', async () => {
      const initialData = await convertAndCapture({
        ...mockEntity,
        type: 'quest' as EntityType,
        extraData: {
          title: 'Find the Lost Treasure',
          objectives: ['Search the cave', 'Defeat the guardian'],
          relatedNPCNames: ['Bilbo', 'Thorin'],
          locationName: 'The Lonely Mountain',
        },
      }, 'quest' as EntityType);

      expect(initialData).toMatchObject({
        title: 'Find the Lost Treasure',
        objectives: ['Search the cave', 'Defeat the guardian'],
        relatedNPCNames: ['Bilbo', 'Thorin'],
        location: 'The Lonely Mountain',
      });
    });

    test('does not put the quest people in an id-shaped field', async () => {
      // The whole defect in one assertion: names stored under
      // `relatedNPCIds` resolved to nothing on every consumer that read them.
      const initialData = await convertAndCapture({
        ...mockEntity,
        type: 'quest' as EntityType,
        extraData: { title: 'A quest', relatedNPCNames: ['Bilbo'] },
      }, 'quest' as EntityType);

      expect(initialData).not.toHaveProperty('relatedNPCIds');
    });

    test('stops pasting the people and the place into the description', async () => {
      /*
        The old branch appended "Related NPCs: ..." and "Location: ..." to the
        description. That was a workaround for the ids never resolving -- the
        names went into the prose so the reader could at least see them. Now
        that the relation itself works, keeping it would print every person
        twice, once as a link and once as text.
      */
      const initialData = await convertAndCapture({
        ...mockEntity,
        type: 'quest' as EntityType,
        extraData: {
          title: 'A quest',
          relatedNPCNames: ['Bilbo'],
          locationName: 'Erebor',
        },
      }, 'quest' as EntityType);

      expect(initialData.description).not.toContain('Related NPCs');
      expect(initialData.description).not.toContain('Location: Erebor');
    });

    test('writes the rumour itself, and opens its row', async () => {
      const rumorEntity: ExtractedEntity = {
        ...mockEntity,
        type: 'rumor',
        extraData: {
          title: 'Strange Lights in the Forest',
          content: 'Travelers report seeing strange lights',
          sourceType: 'traveler',
          status: 'unconfirmed'
        }
      };

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [rumorEntity]
        });
      });
      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', 'rumor');
      });

      // CHANGED DELIBERATELY in `15-9`. This navigated to `/rumors/create`
      // with the fields in router state, and a form there wrote the record.
      // A rumour has no page, and the fields were already complete before
      // that page opened -- so it was a review step for something nobody had
      // to review. The rumour is written here and its row opens in the list.
      expect(mockAddRumor).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Strange Lights in the Forest',
          content: 'Travelers report seeing strange lights',
          sourceType: 'traveler',
          status: 'unconfirmed'
        }),
        // No mark for a draft note; the title checked first (T163).
        undefined,
        { askOnSameName: true }
      );
      expect(mockNavigate).toHaveBeenCalledWith('/rumors?highlight=rumor-1');
      expect(mockNavigate).not.toHaveBeenCalledWith(
        '/rumors/create',
        expect.anything()
      );
    });

    // T163: the player's answer to "already exists", brought back by the
    // links panel: add to that rumour, or create under the name given.
    describe('with an answer to "already exists"', () => {
      const rumorEntity = (): ExtractedEntity => ({
        ...mockEntity,
        type: 'rumor',
        extraData: { title: 'Strange Lights', content: 'Lights over the fen', status: 'unconfirmed' },
      });
      const convertWith = async (answer: unknown) => {
        let capturedContext: any;
        render(
          <NoteProvider>
            <TestComponent onRender={(ctx) => capturedContext = ctx} />
          </NoteProvider>
        );
        await waitFor(() => expect(capturedContext.isLoading).toBe(false));
        await act(async () => {
          createdId = await capturedContext.createNote('Test Note', 'Test content');
        });
        await act(async () => {
          await capturedContext.updateNote(createdId, { extractedEntities: [rumorEntity()] });
        });
        let id: string | undefined;
        await act(async () => {
          id = await capturedContext.convertEntity(createdId, 'entity-1', 'rumor', answer);
        });
        return id;
      };

      test('adds the rumour to the one of that title, and opens its row', async () => {
        const id = await convertWith({ merge: 'strange-lights' });

        expect(id).toBe('strange-lights');
        expect(mockMergeIntoRecord).toHaveBeenCalledWith(
          'rumor',
          'strange-lights',
          expect.objectContaining({ title: 'Strange Lights', content: 'Lights over the fen' }),
          undefined
        );
        expect(mockAddRumor).not.toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/rumors?highlight=strange-lights');
      });

      test('creates it under another title, checked like the first', async () => {
        await convertWith({ createAs: 'Lights on the fen', anyway: false });

        expect(mockAddRumor).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Lights on the fen' }),
          undefined,
          { askOnSameName: true }
        );
      });

      test('creates it under the same title when kept on purpose', async () => {
        await convertWith({ createAs: 'Strange Lights', anyway: true });

        expect(mockAddRumor).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Strange Lights' }),
          undefined,
          { askOnSameName: false }
        );
      });
    });

    // T119: with no extracted title, the rumour is named after the passage the
    // extraction found, which can be longer than a title may be. It is cut to
    // fit rather than refused: the whole passage is still the rumour's content.
    test('cuts a title taken from a long passage to 200 characters', async () => {
      const passage = 'They say '.repeat(30);
      const rumorEntity: ExtractedEntity = {
        ...mockEntity,
        text: passage,
        type: 'rumor',
        extraData: { content: passage, status: 'unconfirmed' }
      };

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });
      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.updateNote(createdId, { extractedEntities: [rumorEntity] });
      });
      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', 'rumor');
      });

      expect(mockAddRumor).toHaveBeenCalledWith(
        expect.objectContaining({ title: passage.slice(0, 200), content: passage }),
        // No mark for a draft note; the title checked first (T163).
        undefined,
        { askOnSameName: true }
      );
    });

    test('should throw error when converting entity from nonexistent note', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        await expect(capturedContext.convertEntity('nonexistent-note', 'entity-1', 'npc'))
          .rejects.toThrow('Note not found');
      });
    });

    test('should throw error when converting nonexistent entity', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await expect(capturedContext.convertEntity(createdId, 'nonexistent-entity', 'npc'))
          .rejects.toThrow('Entity not found');
      });
    });
  });

  describe('Entity Conversion Marking (markEntityAsConverted)', () => {
    test('should mark entity as converted with created ID', async () => {
      const mockEntity: ExtractedEntity = {
        id: 'entity-1',
        text: 'Galadriel the Wise',
        type: 'npc',
        confidence: 0.9,
        isConverted: false,
        createdAt: '2025-06-15T00:00:00.000Z'
      };

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [mockEntity]
        });
      });
      await act(async () => {
        await capturedContext.markEntityAsConverted(createdId, 'entity-1', 'galadriel-the-wise');
      });

      const updatedNote = capturedContext.notes[0];
      const updatedEntity = updatedNote.extractedEntities[0];
      expect(updatedEntity.isConverted).toBe(true);
      expect(updatedEntity.convertedToId).toBe('galadriel-the-wise');
    });

    // T083: two conversions started from the same render -- converting one
    // extracted rumour, then the next, before the listener has delivered the
    // first mark. Each works from the note as stored, so neither undoes the
    // other.
    test('two conversions in a row both stay marked', async () => {
      const entity = (id: string): ExtractedEntity => ({
        id,
        text: id,
        type: 'rumor',
        confidence: 0.9,
        isConverted: false,
        createdAt: '2025-06-15T00:00:00.000Z'
      });

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });
      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [entity('entity-1'), entity('entity-2')]
        });
      });

      const convertTwiceFromOneRender = async () => {
        const sameRender = capturedContext;
        await act(async () => {
          await sameRender.markEntityAsConverted(createdId, 'entity-1', 'rumor-a');
          await sameRender.markEntityAsConverted(createdId, 'entity-2', 'rumor-b');
        });
        return capturedContext.notes[0].extractedEntities.map((e: ExtractedEntity) => e.convertedToId);
      };

      // A draft, still only in this tab...
      expect(await convertTwiceFromOneRender()).toEqual(['rumor-a', 'rumor-b']);

      // ...and a saved note, marked in the stored list.
      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [entity('entity-1'), entity('entity-2')]
        });
        await capturedContext.saveNote(createdId);
      });
      expect(mockDocumentService.createDocument).toHaveBeenCalled();
      expect(await convertTwiceFromOneRender()).toEqual(['rumor-a', 'rumor-b']);
      expect(mockDocumentService.updateDocumentAfterReading).toHaveBeenCalledTimes(2);
    });

    test('should throw error when marking entity in nonexistent note', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        await expect(capturedContext.markEntityAsConverted('nonexistent-note', 'entity-1', 'created-id'))
          .rejects.toThrow('Note not found');
      });
    });
  });

  describe('Note Retrieval (getNoteById)', () => {
    test('should retrieve note by ID', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });

      const note = capturedContext.getNoteById(createdId);
      expect(note).toBeDefined();
      expect(note?.title).toBe('Test Note');
    });

    test('should return undefined for nonexistent note', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      const note = capturedContext.getNoteById('nonexistent-note');
      expect(note).toBeUndefined();
    });
  });

  describe('Note Archiving (archiveNote)', () => {
    test('should archive note by setting status', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.archiveNote(createdId);
      });

      const note = capturedContext.notes[0];
      expect(note.status).toBe('archived');
    });
  });

  describe('Note Deletion (deleteNote)', () => {
    test('should delete note from Firebase, and the list follows without a re-read', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.saveNote(createdId); // Save it first
      });
      await act(async () => {
        await capturedContext.deleteNote(createdId);
      });

      expect(mockDocumentService.deleteDocument).toHaveBeenCalledWith(
        'groups/test-group/users/test-user/notes',
        createdId
      );
      // The listener carries the delete (T032): one first snapshot, no second read.
      expect(notesListener.firstSnapshot).toHaveBeenCalledTimes(1);
      expect(capturedContext.notes.find((note: Note) => note.id === createdId)).toBeUndefined();
    });

    test('should throw error when deleting without authentication', async () => {
      mockUseAuth.mockReturnValue({ user: null });

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        await expect(capturedContext.deleteNote('note-1'))
          .rejects.toThrow('User not authenticated or no active group');
      });
    });
  });

  describe('Data Loading and Filtering', () => {
    test('should filter notes by active campaign ID', async () => {
      const mockNotes: Note[] = [
        {
          id: 'note-1',
          title: 'Campaign 1 Note',
          content: 'Content',
          extractedEntities: [],
          status: 'active' as NoteStatus,
          tags: [],
          updatedAt: '2025-06-15T00:00:00.000Z',
          campaignId: 'test-campaign',
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          createdByCharacterName: 'Test Character',
          dateAdded: '2025-06-15T00:00:00.000Z',
          dateModified: '2025-06-15T00:00:00.000Z',
          modifiedBy: 'test-user',
          modifiedByUsername: 'Test User',
          modifiedByCharacterName: 'Test Character'
        },
        {
          id: 'note-2',
          title: 'Campaign 2 Note',
          content: 'Content',
          extractedEntities: [],
          status: 'active' as NoteStatus,
          tags: [],
          updatedAt: '2025-06-15T00:00:00.000Z',
          campaignId: 'other-campaign',
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          createdByCharacterName: 'Test Character',
          dateAdded: '2025-06-15T00:00:00.000Z',
          dateModified: '2025-06-15T00:00:00.000Z',
          modifiedBy: 'test-user',
          modifiedByUsername: 'Test User',
          modifiedByCharacterName: 'Test Character'
        }
      ];
      notesListener.firstSnapshot.mockResolvedValue(mockNotes);

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      // Should only show notes for active campaign, once the async fetch
      // has actually resolved and filtered them into state.
      await waitFor(() => {
        expect(capturedContext.notes).toHaveLength(1);
      });
      expect(capturedContext.notes[0].campaignId).toBe('test-campaign');
    });

    test('should show no notes when no active campaign', async () => {
      mockUseCampaigns.mockReturnValue({ activeCampaignId: null });

      const mockNotes: Note[] = [
        {
          id: 'note-1',
          title: 'Test Note',
          content: 'Content',
          extractedEntities: [],
          status: 'active' as NoteStatus,
          tags: [],
          updatedAt: '2025-06-15T00:00:00.000Z',
          campaignId: 'test-campaign',
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          createdByCharacterName: 'Test Character',
          dateAdded: '2025-06-15T00:00:00.000Z',
          dateModified: '2025-06-15T00:00:00.000Z',
          modifiedBy: 'test-user',
          modifiedByUsername: 'Test User',
          modifiedByCharacterName: 'Test Character'
        }
      ];
      notesListener.firstSnapshot.mockResolvedValue(mockNotes);

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      // Wait for the fetch to settle so this reflects the actual filtered
      // result, not just the pre-fetch initial state (which also happens
      // to be an empty array, coincidentally).
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });
      expect(capturedContext.notes).toHaveLength(0);
    });

    test('should handle loading states correctly', async () => {
      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      // isLoading starts true and only becomes false once the listener's
      // first snapshot arrives -- at least one microtask tick later, so this
      // must be awaited rather than checked synchronously after render().
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });
    });

    test('should handle errors gracefully', async () => {
      notesListener.firstSnapshot.mockRejectedValue(new Error('Firebase error'));

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      // The listener's error is only reflected in state once it is delivered,
      // which is asynchronous relative to render().
      await waitFor(() => {
        expect(capturedContext.error).toBe('Failed to fetch notes');
      });
      expect(capturedContext.notes).toEqual([]);
    });

    // RECOVERY-003: a failed listener stayed failed until a reload; there was
    // nothing to press.
    test('reopens a failed listener on retry, and clears the error', async () => {
      notesListener.firstSnapshot.mockRejectedValueOnce(new Error('Firebase error'));

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.error).toBe('Failed to fetch notes');
      });
      const opened = notesListener.subscribe.mock.calls.length;

      act(() => {
        capturedContext.retry();
      });

      // The new listener's first snapshot arrives a tick after the retry.
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });
      expect(capturedContext.error).toBeNull();
      expect(notesListener.subscribe.mock.calls.length).toBe(opened + 1);
    });

    test('shows the loading state, not an empty list, while a retry waits for its snapshot', async () => {
      notesListener.firstSnapshot.mockRejectedValueOnce(new Error('Firebase error'));

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.error).toBe('Failed to fetch notes');
      });

      notesListener.firstSnapshot.mockReturnValueOnce(new Promise(() => {}));
      act(() => {
        capturedContext.retry();
      });

      expect(capturedContext.isLoading).toBe(true);
      expect(capturedContext.error).toBeNull();
    });
  });

  describe('isLoading means "nothing to show yet", not "a fetch is in flight" (T044)', () => {
    // `NotesPage` and `NotePage` pass `isLoading` to `usePageGate`. Deleting a
    // note used to end in a refetch that raised `isLoading` again, so the gate
    // re-entered `resolving` and `GatedContent` swapped the page for its
    // skeleton. Since T032 a delete reads nothing at all.
    const makeNote = (id: string, campaignId = 'test-campaign'): Note => ({
      id,
      title: `Note ${id}`,
      content: 'Content',
      extractedEntities: [],
      status: 'active' as NoteStatus,
      tags: [],
      updatedAt: '2025-06-15T00:00:00.000Z',
      campaignId,
      createdBy: 'test-user',
      createdByUsername: 'Test User',
      dateAdded: '2025-06-15T00:00:00.000Z',
    });

    /** A first snapshot the test delivers by hand. */
    const deferred = () => {
      let resolve: (notes: Note[]) => void = () => {};
      const promise = new Promise<Note[]>((r) => { resolve = r; });
      return { promise, resolve };
    };

    test('a delete behind notes already on screen is never loading', async () => {
      const kept = makeNote('note-1');
      notesListener.firstSnapshot.mockResolvedValue([kept, makeNote('note-2')]);

      let capturedContext: any;
      const states: boolean[] = [];
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => { capturedContext = ctx; states.push(ctx.isLoading); }} />
        </NoteProvider>
      );
      await waitFor(() => expect(capturedContext.notes).toHaveLength(2));
      states.length = 0;

      await act(async () => {
        await capturedContext.deleteNote('note-2');
      });

      expect(capturedContext.notes.map((note: Note) => note.id)).toEqual([kept.id]);
      expect(states).not.toContain(true);
      expect(notesListener.firstSnapshot).toHaveBeenCalledTimes(1);
    });

    test('a first read with nothing on screen is loading', async () => {
      const firstRead = deferred();
      notesListener.firstSnapshot.mockReturnValue(firstRead.promise);

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      expect(capturedContext.isLoading).toBe(true);

      await act(async () => {
        firstRead.resolve([]);
      });
    });

    test('switching campaign empties the list rather than showing the last one', async () => {
      // Otherwise the rule above would keep the previous campaign's notes on
      // screen -- no longer behind a skeleton -- for the whole window between
      // the switch and the new listener's first snapshot.
      notesListener.firstSnapshot.mockResolvedValue([makeNote('note-1')]);

      let capturedContext: any;
      const { rerender } = render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => expect(capturedContext.notes).toHaveLength(1));

      const secondRead = deferred();
      notesListener.firstSnapshot.mockReturnValue(secondRead.promise);
      mockUseCampaigns.mockReturnValue({ activeCampaignId: 'other-campaign' });
      rerender(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      await waitFor(() =>
        expect(notesListener.subscribe).toHaveBeenCalledTimes(2)
      );
      expect(capturedContext.notes).toEqual([]);
      expect(capturedContext.isLoading).toBe(true);

      await act(async () => {
        secondRead.resolve([makeNote('note-1')]);
      });
    });
  });

  describe('Hook Usage Requirements', () => {
    test('should throw error when useNotes is used outside provider', () => {
      // Mock console.error to suppress error output in test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => render(<TestComponent />)).toThrow(
        'useNotes must be used within a NoteProvider'
      );

      consoleSpy.mockRestore();
    });
  });
  // T088 (DATA-005): converting a note's entity creates the record and marks
  // the entity in one commit. Created first and marked after, a failed mark
  // left the record behind and the note still offered to convert it again.
  describe('Converting into one commit (convertInto)', () => {
    const entity: ExtractedEntity = {
      id: 'entity-1',
      text: 'Strider',
      type: 'npc' as EntityType,
      confidence: 0.9,
      isConverted: false,
      createdAt: '2025-06-15T00:00:00.000Z',
      extraData: { name: 'Strider' },
    };
    const NOTES = 'groups/test-group/users/test-user/notes';

    /** Mounts the provider with one note holding `entity`, saved or a draft. */
    async function noteWithEntity(saved: boolean) {
      let context: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => context = ctx} />
        </NoteProvider>
      );
      await waitFor(() => expect(context.isLoading).toBe(false));
      await act(async () => {
        createdId = await context.createNote('Session 12', 'Met a ranger');
      });
      await act(async () => {
        await context.updateNote(createdId, { extractedEntities: [entity] });
      });
      if (saved) {
        await act(async () => {
          await context.saveNote(createdId);
        });
      }
      return () => context;
    }

    test("hands a saved note's mark to the create, to commit with it", async () => {
      const context = await noteWithEntity(true);
      const create = jest.fn().mockResolvedValue('strider');

      let id = '';
      await act(async () => {
        id = await context().convertInto(createdId, 'entity-1', create);
      });

      expect(id).toBe('strider');
      const alongside = create.mock.calls[0][0];
      expect(alongside).toMatchObject({ collection: NOTES, id: createdId });
      const stored = { ...context().getNoteById(createdId), id: createdId };
      expect(alongside.change(stored, 'strider').extractedEntities).toEqual([
        expect.objectContaining({ id: 'entity-1', isConverted: true, convertedToId: 'strider' }),
      ]);
      // No second write: the mark is the create's.
      expect(mockDocumentService.updateDocumentAfterReading).not.toHaveBeenCalled();
    });

    test('refuses an entity the stored note has already converted', async () => {
      const context = await noteWithEntity(true);
      const create = jest.fn().mockResolvedValue('strider');
      await act(async () => {
        await context().convertInto(createdId, 'entity-1', create);
      });
      const alongside = create.mock.calls[0][0];
      const converted = {
        id: createdId,
        extractedEntities: [{ ...entity, isConverted: true, convertedToId: 'strider' }],
      };

      expect(() => alongside.change(converted, 'strider-2')).toThrow(/already/i);
      expect(() => alongside.change(undefined, 'strider-2')).toThrow(/not found/i);
    });

    test('marks a draft in place once the record exists, since a draft has nothing stored to commit with', async () => {
      const context = await noteWithEntity(false);
      const create = jest.fn().mockResolvedValue('strider');

      await act(async () => {
        await context().convertInto(createdId, 'entity-1', create);
      });

      expect(create).toHaveBeenCalledWith();
      expect(context().getNoteById(createdId).extractedEntities[0])
        .toMatchObject({ isConverted: true, convertedToId: 'strider' });
    });

    test('leaves a draft unmarked when the create fails', async () => {
      const context = await noteWithEntity(false);
      const create = jest.fn().mockRejectedValue(new Error('offline'));

      await act(async () => {
        await expect(context().convertInto(createdId, 'entity-1', create)).rejects.toThrow('offline');
      });

      expect(context().getNoteById(createdId).extractedEntities[0].isConverted).toBe(false);
    });

    test('writes a rumour and its mark as one commit', async () => {
      const context = await noteWithEntity(true);
      await act(async () => {
        await context().updateNote(createdId, {
          extractedEntities: [{ ...entity, type: 'rumor', extraData: { title: 'Lights', content: 'In the woods' } }],
        });
      });
      mockDocumentService.updateDocumentAfterReading.mockClear();

      await act(async () => {
        await context().convertEntity(createdId, 'entity-1', 'rumor');
      });

      const [, alongside] = mockAddRumor.mock.calls[mockAddRumor.mock.calls.length - 1];
      expect(alongside).toMatchObject({ collection: NOTES, id: createdId });
      expect(mockDocumentService.updateDocumentAfterReading).not.toHaveBeenCalled();
    });
  });
});
