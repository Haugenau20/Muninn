// src/features/collaboration/notes/context/__tests__/NoteContext.bugs.test.tsx
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
jest.mock('features/campaign-entities', () => ({
  useRumors: () => ({ addRumor: mockAddRumor }),
  // "Add what you know to it" (T163), which a plain conversion never reaches.
  useMergeIntoRecord: () => jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate
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
  deleteDocument: jest.fn()
};

jest.mock('core/services/firebase/data/DocumentService', () => ({
  __esModule: true,
  default: {
    getInstance: () => mockDocumentService
  }
}));

// Mock user utilities - these should return proper values but consistently return empty/null
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

describe('NoteContext Bug Tests', () => {
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

    // Default empty collection, and writes that reach the listener.
    notesListener.reset();
    mockDocumentService.createDocument.mockImplementation(notesListener.create);
    mockDocumentService.updateDocumentWithAttribution.mockImplementation(notesListener.update);
    mockDocumentService.deleteDocument.mockImplementation(notesListener.remove);
  });

  describe('User Attribution Requirements', () => {
    test('should include proper user attribution metadata in created notes', async () => {
      // Mock utilities to return EXPECTED values (specification-based testing)
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      // The mount-time fetchNotes() call is async; without waiting for it
      // to settle first, its own setNotes(sortedNotes) call can resolve
      // *after* createNote() below and silently overwrite the new note
      // with the (empty) fetched collection.
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });

      const note = capturedContext.notes[0];

      // Test for EXPECTED behavior - fails until implementation is correct
      expect(note.createdByUsername).toBe('Test User'); // FAILS until bug fixed
      expect(note.createdByCharacterName).toBe('Test Character'); // FAILS until bug fixed
      expect(note.modifiedByUsername).toBe('Test User'); // FAILS until bug fixed
      expect(note.modifiedByCharacterName).toBe('Test Character'); // FAILS until bug fixed
    });

    test('should call user attribution utilities with correct profile data', async () => {
      getUserName.mockReturnValue('Test User'); // Expected return value
      getActiveCharacterName.mockReturnValue('Test Character'); // Expected return value

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

      // Verify utilities are called with correct profile data
      expect(getUserName).toHaveBeenCalledWith({
        userId: 'test-user',
        username: 'Test User',
        role: 'member',
        joinedAt: '2025-06-15T00:00:00.000Z',
        activeCharacterId: 'char-1',
        characters: [
          { id: 'char-1', name: 'Test Character' }
        ]
      });
      expect(getActiveCharacterName).toHaveBeenCalledWith({
        userId: 'test-user',
        username: 'Test User',
        role: 'member',
        joinedAt: '2025-06-15T00:00:00.000Z',
        activeCharacterId: 'char-1',
        characters: [
          { id: 'char-1', name: 'Test Character' }
        ]
      });
    });

    test('should include user attribution in note save operations', async () => {
      getUserName.mockReturnValue('Test User'); // Expected return value
      getActiveCharacterName.mockReturnValue('Test Character'); // Expected return value

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      // createNote and saveNote must be in separate act() calls: saveNote's
      // getNoteById is a useCallback closed over `notes` as of the last
      // committed render. Calling both inside one act() with no render in
      // between means saveNote still sees the pre-createNote (empty)
      // `notes` and throws "Note not found" -- a stale-closure test-timing
      // artifact, not the behavior under test.
      await act(async () => {
        createdId = await capturedContext.createNote('Test Note', 'Test content');
      });
      await act(async () => {
        await capturedContext.saveNote(createdId, { title: 'Updated Title' });
      });

      // Test for EXPECTED behavior - save operations should have proper attribution
      expect(mockDocumentService.createDocument).toHaveBeenCalledWith(
        'groups/test-group/users/test-user/notes',
        expect.objectContaining({
          modifiedByUsername: 'Test User', // FAILS until bug fixed
          modifiedByCharacterName: 'Test Character' // FAILS until bug fixed
        }),
        createdId
      );
    });
  });

  describe('ID Generation Requirements', () => {
    test('should not allocate an id an existing note holds', async () => {
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

      // Mock existing notes to test sequence calculation
      const existingNotes: Note[] = [
        {
          id: 'note-5', // Higher number to test max calculation
          title: 'Existing Note',
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

        // Ids are random since T029 -- the only requirement is that it is a
        // note id and not one already taken.
        expect(noteId).toMatch(/^note-[a-z0-9]+$/);
        expect(noteId).not.toBe('note-5');
      });
    });

    test('should reveal ID generation with malformed existing IDs', async () => {
      // Test with malformed note IDs that don't follow pattern
      const existingNotes: Note[] = [
        {
          id: 'invalid-id-format', // Doesn't match note-X pattern
          title: 'Malformed ID Note',
          content: 'Content',
          extractedEntities: [],
          status: 'active' as NoteStatus,
          tags: [],
          updatedAt: '2025-06-15T00:00:00.000Z',
          campaignId: 'test-campaign',
          createdBy: 'test-user',
          createdByUsername: '',
          createdByCharacterName: null,
          dateAdded: '2025-06-15T00:00:00.000Z',
          dateModified: '2025-06-15T00:00:00.000Z',
          modifiedBy: 'test-user',
          modifiedByUsername: '',
          modifiedByCharacterName: null
        }
      ];
      notesListener.firstSnapshot.mockResolvedValue(existingNotes);

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.notes).toHaveLength(1);
      });

      await act(async () => {
        const noteId = await capturedContext.createNote('New Note', 'New content');

        // An existing id in another shape does not disturb allocation.
        expect(noteId).toMatch(/^note-[a-z0-9]+$/);

        console.log('Generated ID with malformed existing IDs:', noteId);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Bug #1422 — notes for ALL campaigns share one flat collection at
  // `groups/{g}/users/{uid}/notes` and are joined to a campaign by a
  // `campaignId` field, but the list rendered is filtered to the active
  // campaign. Allocating an id from the filtered list reuses one that already
  // exists as soon as the active campaign has fewer notes than another, and
  // `createDocument` refuses to overwrite. Reproduced in the browser: with two
  // notes in campaign A and none in campaign B, creating B's first note failed
  // and rendered the raw internal error (including the user's uid) in the UI.
  // -------------------------------------------------------------------------
  describe('Cross-campaign ID collision (bug #1422)', () => {
    const noteInCampaign = (id: string, campaignId: string): Note => ({
      id,
      title: 'Existing Note',
      content: 'Content',
      extractedEntities: [],
      status: 'active' as NoteStatus,
      tags: [],
      updatedAt: '2025-06-15T00:00:00.000Z',
      campaignId,
      createdBy: 'test-user',
      createdByUsername: 'Test User',
      createdByCharacterName: 'Test Character',
      dateAdded: '2025-06-15T00:00:00.000Z',
      dateModified: '2025-06-15T00:00:00.000Z',
      modifiedBy: 'test-user',
      modifiedByUsername: 'Test User',
      modifiedByCharacterName: 'Test Character'
    });

    test('does not reuse an id held by a note in a different campaign', async () => {
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

      // Both notes belong to another campaign, so the active campaign renders
      // an EMPTY list -- while note-1 and note-2 are nonetheless taken.
      notesListener.firstSnapshot.mockResolvedValue([
        noteInCampaign('note-1', 'other-campaign'),
        noteInCampaign('note-2', 'other-campaign')
      ]);

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      // The active campaign genuinely has no notes to show ...
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });
      expect(capturedContext.notes).toHaveLength(0);

      await act(async () => {
        const noteId = await capturedContext.createNote('New Note', 'New content');

        // ... but the id must still clear the other campaign's notes.
        // Before the fix this returned 'note-1', colliding with an existing
        // document and making note creation impossible in this campaign.
        // Since T029 the context never sees the other campaign's notes, so
        // this holds because ids are random, not because it counted them.
        expect(noteId).toMatch(/^note-[a-z0-9]+$/);
        expect(['note-1', 'note-2']).not.toContain(noteId);
      });
    });

    test('allocates distinct ids for two creates before any refetch', async () => {
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

      notesListener.firstSnapshot.mockResolvedValue([
        noteInCampaign('note-1', 'other-campaign')
      ]);

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      let first: string = '';
      let second: string = '';
      await act(async () => {
        first = await capturedContext.createNote('First', 'content');
      });
      await act(async () => {
        second = await capturedContext.createNote('Second', 'content');
      });

      expect(first).toMatch(/^note-[a-z0-9]+$/);
      expect(second).toMatch(/^note-[a-z0-9]+$/);
      expect(first).not.toBe('note-1');
      expect(second).not.toBe('note-1');
      expect(first).not.toBe(second);
    });
  });

  describe('Entity Conversion Requirements', () => {
    test('should handle entity conversion with minimal data', async () => {
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

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

      // Add entity with missing required fields
      const incompleteEntity: ExtractedEntity = {
        id: 'entity-1',
        text: '', // EMPTY TEXT - should this be allowed?
        type: 'npc' as EntityType,
        confidence: 0.1, // VERY LOW CONFIDENCE - should this be converted?
        isConverted: false,
        createdAt: '2025-06-15T00:00:00.000Z',
        extraData: {} // EMPTY EXTRA DATA - will this cause issues?
      };

      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [incompleteEntity]
        });
      });

      await act(async () => {
        // BUG POTENTIAL: Should there be validation before conversion?
        const result = await capturedContext.convertEntity(createdId, 'entity-1', 'npc');
        expect(result).toBe(''); // Function completes without validation

        // Check what data gets passed to navigation
        expect(mockNavigate).toHaveBeenCalledWith('/npcs/create', {
          state: expect.objectContaining({
            initialData: expect.objectContaining({
              name: '', // EMPTY NAME from empty text
              description: expect.stringContaining('Created from note:')
            })
          })
        });

        // EXPECTED: Entity conversion should work with minimal but valid data
      });
    });

    /**
     * The extraction function's JSON schema offers a fourth rumour status,
     * `"unknown"` (`firebase/functions/src/entityExtraction.ts`), which
     * `RumorStatus` does not have. It reached Firestore through a converted
     * note, and the rumours list -- which groups by status -- then matched it
     * to none of its three groups and dropped the row entirely: no entry, no
     * count, no error. `RumorForm`'s `<select>` had been sanitising the value
     * by accident until `15-9` retired the form.
     */
    test('normalises a status the domain does not have', async () => {
      getActiveCharacterName.mockReturnValue('Test Character');

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

      const rumorEntity: ExtractedEntity = {
        id: 'entity-1',
        text: 'Harry Potter at Jedi Academy',
        type: 'rumor' as EntityType,
        confidence: 0.9,
        isConverted: false,
        createdAt: '2025-06-15T00:00:00.000Z',
        extraData: {
          // Schema-allowed by the extractor, absent from `RumorStatus`.
          status: 'unknown'
        }
      };

      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [rumorEntity]
        });
      });

      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', 'rumor');
      });

      // Unconfirmed is what an unverified rumour *is*, so nothing is lost by
      // saying so -- and the row stays visible.
      expect(mockAddRumor).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'unconfirmed' }),
        // No mark for a draft note; the title checked first (T163).
        undefined,
        { askOnSameName: true }
      );
    });

    test('keeps a status the domain does have', async () => {
      getActiveCharacterName.mockReturnValue('Test Character');

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
          extractedEntities: [{
            id: 'entity-1',
            text: 'A confirmed thing',
            type: 'rumor' as EntityType,
            confidence: 0.9,
            isConverted: false,
            createdAt: '2025-06-15T00:00:00.000Z',
            extraData: { status: 'confirmed' }
          } as ExtractedEntity]
        });
      });

      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', 'rumor');
      });

      expect(mockAddRumor).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'confirmed' }),
        // No mark for a draft note; the title checked first (T163).
        undefined,
        { askOnSameName: true }
      );
    });

    /**
     * The conversion wrote `sourceType` into `sourceName`, ignoring the
     * extractor's own `sourceName` field entirely -- so a rumour heard from
     * Gaffer Gamgee arrived with its source kind reading NPC and its source
     * name reading "npc": the same fact twice, once in the wrong field.
     */
    test('uses the extracted source name, not the source kind', async () => {
      getActiveCharacterName.mockReturnValue('Test Character');

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
          extractedEntities: [{
            id: 'entity-1',
            text: 'Strange visitors',
            type: 'rumor' as EntityType,
            confidence: 0.9,
            isConverted: false,
            createdAt: '2025-06-15T00:00:00.000Z',
            extraData: { sourceType: 'npc', sourceName: 'Gaffer Gamgee' }
          } as ExtractedEntity]
        });
      });

      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', 'rumor');
      });

      expect(mockAddRumor).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: 'npc', sourceName: 'Gaffer Gamgee' }),
        // No mark for a draft note; the title checked first (T163).
        undefined,
        { askOnSameName: true }
      );
    });

    test('leaves the source name empty when the extractor gave none', async () => {
      getActiveCharacterName.mockReturnValue('Test Character');

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
          extractedEntities: [{
            id: 'entity-1',
            text: 'Strange visitors',
            type: 'rumor' as EntityType,
            confidence: 0.9,
            isConverted: false,
            createdAt: '2025-06-15T00:00:00.000Z',
            extraData: { sourceType: 'tavern' }
          } as ExtractedEntity]
        });
      });

      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', 'rumor');
      });

      // Blank, not "tavern": the kind is already recorded next door, and the
      // row shows this string as the line under the rumour's name.
      expect(mockAddRumor).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: 'tavern', sourceName: '' }),
        // No mark for a draft note; the title checked first (T163).
        undefined,
        { askOnSameName: true }
      );
    });

    test('should handle rumor conversion with invalid source type', async () => {
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

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

      const rumorEntity: ExtractedEntity = {
        id: 'entity-1',
        text: 'Strange Rumor',
        type: 'rumor' as EntityType,
        confidence: 0.9,
        isConverted: false,
        createdAt: '2025-06-15T00:00:00.000Z',
        extraData: {
          sourceType: 'invalid-source-type' // NOT in valid list: ['npc', 'tavern', 'notice', 'traveler', 'other']
        }
      };

      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [rumorEntity]
        });
      });

      await act(async () => {
        await capturedContext.convertEntity(createdId, 'entity-1', 'rumor');

        // CHANGED DELIBERATELY in `15-9`. An unrecognised source used to be
        // coerced to 'other'. Since `15-9`'other' means "heard from none of
        // the other four" -- a real answer somebody chose -- so the extractor
        // guessing it would be answering on the reader's behalf. The kind is
        // left unset; the raw value is still preserved in sourceName, which
        // is the part that was always right.
        const written = mockAddRumor.mock.calls[0][0];
        expect(written).not.toHaveProperty('sourceType');
        expect(written.sourceName).toBe('invalid-source-type');

        // EXPECTED: Invalid source types should be handled gracefully
      });
    });
  });

  describe('Campaign Filtering Requirements', () => {
    test('should handle campaign switching properly', async () => {
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

      // Start with campaign A
      mockUseCampaigns.mockReturnValue({ activeCampaignId: 'campaign-a' });

      let capturedContext: any;
      const { rerender } = render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      await act(async () => {
        createdId = await capturedContext.createNote('Campaign A Note', 'Content for campaign A');
      });

      expect(capturedContext.notes).toHaveLength(1);
      expect(capturedContext.notes[0].campaignId).toBe('campaign-a');

      // Switch to campaign B
      mockUseCampaigns.mockReturnValue({ activeCampaignId: 'campaign-b' });

      rerender(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      // The campaignId change gives fetchNotes a new identity, so the
      // mount-style effect re-runs and re-fetches asynchronously again;
      // wait for that to actually settle before reading the result instead
      // of asserting against whatever was left over from before it ran.
      await waitFor(() => {
        expect(capturedContext.isLoading).toBe(false);
      });

      // BUG POTENTIAL: What happens to unsaved notes when campaign switches?
      // The unsaved note for campaign A should disappear since it's filtered by campaign
      expect(capturedContext.notes).toHaveLength(0);

      // EXPECTED: Campaign filtering should handle unsaved notes appropriately
    });
  });

  // NoteContext error handling and state consistency.
  //
  // This block was previously titled "Bug #024". No such bug was ever filed —
  // there is no 024-*.md and no tracker row, and this was the only reference to
  // the number anywhere in the repo. The block was written to go looking for a
  // defect in error handling and found the behaviour correct, so nothing was
  // ever filed and the speculative number stayed behind in the title.
  //
  // Both tests below assert *desirable* behaviour, not a defect: a failed fetch
  // surfaces an error, resolves loading and leaves no stale notes; a failed save
  // rejects and leaves the note still marked unsaved. They are specification
  // tests, not bug markers — do not read a red here as "#024 regressed".
  //
  // Renamed 2026-07-28 rather than filing #024 retroactively: a tracker row for
  // a defect that never existed is how this project acquired five entries it
  // later had to retract (#013, #014, #300, #021, #022).
  describe('Error Handling and State Management', () => {
    test('should reveal error handling in fetch operations', async () => {
      notesListener.firstSnapshot.mockRejectedValue(new Error('Firebase connection failed'));

      let capturedContext: any;
      render(
        <NoteProvider>
          <TestComponent onRender={(ctx) => capturedContext = ctx} />
        </NoteProvider>
      );

      // Should handle error gracefully -- but only once the rejected fetch
      // promise has actually been handled by the catch block, which is
      // asynchronous relative to render().
      await waitFor(() => {
        expect(capturedContext.error).toBe('Failed to fetch notes');
      });
      expect(capturedContext.notes).toEqual([]);
      expect(capturedContext.isLoading).toBe(false);

      // BUG POTENTIAL: Can notes still be created when in error state?
      await act(async () => {
        const noteId = await capturedContext.createNote('Test Note', 'Test content');
        expect(noteId).toMatch(/^note-[a-z0-9]+$/); // Should still work locally
      });

      console.log('Notes can be created locally even when fetch errors occur');
    });

    test('should handle partial Firebase failures correctly', async () => {
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

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

      // Simulate save failure
      mockDocumentService.createDocument.mockRejectedValue(new Error('Save failed'));

      await act(async () => {
        await expect(capturedContext.saveNote(createdId)).rejects.toThrow('Save failed');
      });

      // BUG POTENTIAL: Note should remain marked as unsaved after save failure
      const note = capturedContext.notes[0];
      expect(note.isUnsaved).toBe(true); // Should remain unsaved after failure

      // EXPECTED: Note should remain unsaved after save failure
    });
  });

  describe('Entity Data Processing Requirements', () => {
    test('should handle malformed entity extraData gracefully', async () => {
      getUserName.mockReturnValue('Test User');
      getActiveCharacterName.mockReturnValue('Test Character');

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

      const malformedEntity: ExtractedEntity = {
        id: 'entity-1',
        text: 'Test Entity',
        type: 'quest' as EntityType,
        confidence: 0.9,
        isConverted: false,
        createdAt: '2025-06-15T00:00:00.000Z',
        extraData: {
          objectives: 'not-an-array', // BUG: Should be array but is string
          relatedNPCIds: null, // BUG: Should be array but is null
          title: ['array', 'instead', 'of', 'string'] // BUG: Should be string but is array
        }
      };

      await act(async () => {
        await capturedContext.updateNote(createdId, {
          extractedEntities: [malformedEntity]
        });
      });

      await act(async () => {
        // Documents how malformed extraData is currently processed on the way
        // to the quest create form.
        await capturedContext.convertEntity(createdId, 'entity-1', 'quest');

        expect(mockNavigate).toHaveBeenCalledWith('/quests/create', {
          state: expect.objectContaining({
            initialData: expect.objectContaining({
              title: ['array', 'instead', 'of', 'string'], // Not validated — passes through
              objectives: 'not-an-array', // Not validated — passes through
              // `relatedNPCIds` IS normalized: convertEntity applies `|| []`, so a
              // null collapses to an empty array. That is the correct behaviour and
              // is asserted as such — the create form treats this as a list field,
              // and an empty list is valid where null would force every consumer to
              // null-guard. This assertion previously expected `null` to pass through
              // and was the last remaining NoteContext failure; it was speculative
              // (its own comment read "BUG POTENTIAL") rather than a specification,
              // and demanded the less defensible of the two behaviours.
              relatedNPCNames: []
            })
          })
        });

        // NOTE: `title` and `objectives` are still unvalidated. That is a genuine
        // robustness gap rather than a specification: nothing guarantees the AI
        // extractor cannot emit a non-string title. Left asserted as-is so the gap
        // stays visible; not filed as a bug because it is unproven that extraData
        // can actually reach this shape in production.
      });
    });
  });
});
