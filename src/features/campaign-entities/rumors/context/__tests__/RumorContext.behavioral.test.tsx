// src/features/campaign-entities/rumors/context/__tests__/RumorContext.behavioral.test.tsx

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { RumorProvider, useRumors } from '../RumorContext';
import { Rumor, RumorStatus, RumorNote, SourceType } from '../../types';
import { updateAfterReadingThrough, createWithUpdatesThrough } from '@/test-utils/update-after-reading';

/**
 * Rumor Context Behavioral Testing
 * 
 * Tests ACTUAL Rumor context behavior with mocked Firebase dependencies.
 * This tests the real Rumor context logic (black box) while mocking external dependencies.
 * 
 * STRATEGY:
 * - Use real RumorProvider and useRumors hook
 * - Mock Firebase dependencies (useAuth, useFirebaseData, etc.)
 * - Test actual Rumor context behavior and logic
 * - Verify correct data is passed to Firebase (without testing Firebase itself)
 */

// Mock Firebase dependencies
const mockUseAuth = jest.fn();
const mockUseUser = jest.fn();
const mockUseFirestore = jest.fn();
/** One commit for every multi-rumour write (T032, PERF-06). */
const mockBatchOperations = jest.fn().mockResolvedValue(undefined);
const mockUseRumorData = jest.fn();
const mockUseFirebaseData = jest.fn();

// Mock the Firebase context hooks
// Notes are documents of their own (T133); see the mock.
jest.mock('features/campaign-entities/shared/recordNotes', () => require('@/test-utils/record-notes-mock').recordNotesMock());

jest.mock('@/features/user-management', () => ({
  // The provider's writes name the active group and campaign by full path (T082).
  useGroups: () => ({ activeGroupId: 'group-1' }),
  useCampaigns: () => ({ activeCampaignId: 'campaign-1' }),
  useAuth: () => mockUseAuth(),
  useUser: () => mockUseUser(),
  useFirestore: () => mockUseFirestore(),
}));

// Mock the data hooks
jest.mock('../../hooks/useRumorData', () => ({
  useRumorData: () => mockUseRumorData(),
}));

jest.mock('shared/hooks/useFirebaseData', () => ({
  useFirebaseData: () => mockUseFirebaseData(),
}));

// Batch actions commit through `commitEntityWrites` (T088 folded the
// context's own copy of it in).
jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: { document: { batchOperations: (ops: unknown) => mockBatchOperations(ops) } },
}));

// Mock user utilities for proper testing
jest.mock('core/utils/user-utils', () => ({
  getUserName: jest.fn(),
  getActiveCharacterName: jest.fn()
}));

const { getUserName, getActiveCharacterName } = require('core/utils/user-utils');

// Test component that uses the Rumor context
const RumorTestComponent = ({ onContextChange }: { onContextChange: (context: any) => void }) => {
  const rumorContext = useRumors();
  
  React.useEffect(() => {
    onContextChange(rumorContext);
  }, [rumorContext, onContextChange]);
  
  return <div data-testid="rumor-test">Rumour Context Test</div>;
};

describe('RumorContext Behavioral Testing', () => {
  let rumorContext: any;
  let mockAddData: jest.Mock;
  let mockUpdateData: jest.Mock;
  let mockDeleteData: jest.Mock;
  let mockSetDocument: jest.Mock;
  let mockRefreshRumors: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    rumorContext = null;

    // Setup user utilities to return expected values
    getUserName.mockReturnValue('Test User');
    getActiveCharacterName.mockReturnValue('Test Character');

    // Create mock Firebase operations
    mockAddData = jest.fn();
    mockUpdateData = jest.fn();
    mockDeleteData = jest.fn();
    mockSetDocument = jest.fn();
    mockRefreshRumors = jest.fn();

    // Setup default mock returns
    mockUseAuth.mockReturnValue({
      user: null, // Start unauthenticated
    });

    mockUseUser.mockReturnValue({
      userProfile: null,
      activeGroupUserProfile: null,
    });

    mockUseFirestore.mockReturnValue({
      setDocument: mockSetDocument,
    });

    mockUseRumorData.mockReturnValue({
      rumors: [],
      loading: false,
      error: null,
      refreshRumors: mockRefreshRumors,
    });

    mockUseFirebaseData.mockReturnValue({
      addData: mockAddData,
      updateData: mockUpdateData,
      // Lists are worked out from the record (T083): this suite's records.
      updateDataAfterReading: updateAfterReadingThrough(mockUpdateData, (id) => (mockUseRumorData()?.rumors ?? []).find((r: any) => r.id === id)),
      deleteData: mockDeleteData,
    });
  });

  const renderRumorContext = () => {
    const handleContextChange = (context: any) => {
      rumorContext = context;
    };

    return render(
      <RumorProvider>
        <RumorTestComponent onContextChange={handleContextChange} />
      </RumorProvider>
    );
  };

  describe('Rumor Context Initialization Behavior', () => {
    test('should provide empty rumor list when no data loaded', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Rumor context should start with empty list
      expect(rumorContext.rumors).toEqual([]);
      expect(rumorContext.isLoading).toBe(false);
      expect(rumorContext.error).toBe(null);
    });

    test('should provide all required rumor operations', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: All rumor operations should be available as functions
      const requiredOperations = [
        'getRumorById', 'getRumorsByStatus', 'getRumorsByLocation',
        'getRumorsByNPC', 'updateRumorStatus', 'updateRumorNote',
        'addRumor', 'updateRumor', 'deleteRumor', 'combineRumors', 'convertToQuest'
      ];

      requiredOperations.forEach(operation => {
        expect(typeof rumorContext[operation]).toBe('function');
      });
    });
  });

  describe('Rumor Authentication Requirements', () => {
    test('should reject addRumor when user not authenticated', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const rumorData: Omit<Rumor, 'id'> = {
        title: 'Test Rumour',
        content: 'A test rumour for authentication checking',
        status: 'unconfirmed' as RumorStatus,
        sourceType: 'tavern' as SourceType,
        sourceName: 'Test Tavern',
        relatedNPCs: [],
        relatedLocations: [],
        notes: [],
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      // BEHAVIOR: Should reject when not authenticated
      await expect(rumorContext.addRumor(rumorData)).rejects.toThrow(
        'User must be authenticated to add rumours'
      );

      expect(mockAddData).not.toHaveBeenCalled();
    });

    test('should reject updateRumor when user not authenticated', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const rumor: Rumor = {
        id: 'test-rumor',
        title: 'Test Rumour',
        content: 'A test rumour',
        status: 'unconfirmed' as RumorStatus,
        sourceType: 'tavern' as SourceType,
        sourceName: 'Test Tavern',
        relatedNPCs: [],
        relatedLocations: [],
        notes: [],
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      // BEHAVIOR: Should reject when not authenticated
      await expect(rumorContext.updateRumor(rumor.id, { title: rumor.title })).rejects.toThrow(
        'User must be authenticated to update rumours'
      );

      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('should reject updateRumorStatus when user not authenticated', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Should reject when not authenticated
      await expect(rumorContext.updateRumorStatus('test-id', 'confirmed')).rejects.toThrow(
        'User must be authenticated to update rumour status'
      );

      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('should reject updateRumorNote when user not authenticated', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const note: RumorNote = {
        id: 'note-1',
        content: 'Test note',
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      // BEHAVIOR: Should reject when not authenticated
      await expect(rumorContext.updateRumorNote('test-id', note)).rejects.toThrow(
        'User must be authenticated to add notes'
      );

      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('should reject deleteRumor when user not authenticated', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Should reject when not authenticated
      await expect(rumorContext.deleteRumor('test-id')).rejects.toThrow(
        'User must be authenticated to delete rumours'
      );

      expect(mockDeleteData).not.toHaveBeenCalled();
    });
  });

  describe('Rumor Creation Behavior', () => {
    beforeEach(() => {
      // Setup authenticated state
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      mockUseUser.mockReturnValue({
        userProfile: { name: 'Test User' },
        activeGroupUserProfile: { 
          userId: 'test-user', 
          username: 'Test User',
          role: 'member',
          joinedAt: '2025-06-15T00:00:00.000Z',
          activeCharacterId: 'char-1',
          characters: [
            { id: 'char-1', name: 'Test Character' }
          ]
        },
      });
    });

    test('should create rumor with basic data structure', async () => {
      mockAddData.mockResolvedValue(undefined);

      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const rumorData: Omit<Rumor, 'id'> = {
        title: 'Dragons in the North',
        content: 'Travelers speak of dragons returning to the northern mountains',
        status: 'unconfirmed' as RumorStatus,
        sourceType: 'traveler' as SourceType,
        sourceName: 'Northern Merchant',
        location: 'Neverwinter',
        relatedNPCs: [],
        relatedLocations: [],
        notes: [],
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      await act(async () => {
        const rumorId = await rumorContext.addRumor(rumorData);
        expect(rumorId).toBe('dragons-in-the-north');
      });

      // BEHAVIOR: Should add rumor with generated ID and basic metadata
      expect(mockAddData).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Dragons in the North',
          content: 'Travelers speak of dragons returning to the northern mountains',
          status: 'unconfirmed',
          sourceType: 'traveler',
          sourceName: 'Northern Merchant',
          id: 'dragons-in-the-north',
          createdBy: 'test-user',
          modifiedBy: 'test-user',
          relatedNPCs: [],
          relatedLocations: [],
          notes: []
        }),
        'dragons-in-the-north'
      );
    });

    test('should generate rumor ID from title correctly', async () => {
      mockAddData.mockResolvedValue(undefined);

      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const testCases = [
        { title: 'The Dragon Returns', expectedId: 'the-dragon-returns' },
        { title: 'Strange Lights in Sky', expectedId: 'strange-lights-in-sky' },
        { title: '   Spaced Out Title   ', expectedId: 'spaced-out-title' },
        { title: 'Numbers123AndSymbols!@#', expectedId: 'numbers123andsymbols' }
      ];

      for (const testCase of testCases) {
        mockAddData.mockClear();

        const rumorData: Omit<Rumor, 'id'> = {
          title: testCase.title,
          content: 'Test content',
          status: 'unconfirmed' as RumorStatus,
          sourceType: 'other' as SourceType,
          sourceName: 'Test Source',
          relatedNPCs: [],
          relatedLocations: [],
          notes: [],
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        };

        await act(async () => {
          const rumorId = await rumorContext.addRumor(rumorData);
          expect(rumorId).toBe(testCase.expectedId);
        });

        expect(mockAddData).toHaveBeenCalledWith(
          expect.objectContaining({ id: testCase.expectedId }),
          testCase.expectedId
        );
      }
    });

    test('should create multiple rumors with predictable IDs', async () => {
      mockAddData.mockResolvedValue(undefined);

      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const rumor1 = { 
        title: 'Orc Raids',
        content: 'Orcs attacking villages',
        status: 'confirmed' as RumorStatus,
        sourceType: 'npc' as SourceType,
        sourceName: 'Village Guard',
        relatedNPCs: [],
        relatedLocations: [],
        notes: [],
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      const rumor2 = { 
        title: 'Treasure Map',
        content: 'Old map found in tavern',
        status: 'unconfirmed' as RumorStatus,
        sourceType: 'tavern' as SourceType,
        sourceName: 'The Prancing Pony',
        relatedNPCs: [],
        relatedLocations: [],
        notes: [],
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      await act(async () => {
        await rumorContext.addRumor(rumor1);
        await rumorContext.addRumor(rumor2);
      });

      // BEHAVIOR: Different titles should generate different IDs
      const [firstCall, secondCall] = mockAddData.mock.calls;
      expect(firstCall[1]).toBe('orc-raids');
      expect(secondCall[1]).toBe('treasure-map');
    });
  });

  describe('Rumor Retrieval Behavior', () => {
    beforeEach(() => {
      const mockRumors: Rumor[] = [
        {
          id: 'dragon-sighting',
          title: 'Dragon Sighting',
          content: 'A red dragon was seen near the mountains',
          status: 'confirmed',
          sourceType: 'npc',
          sourceName: 'Mountain Guide',
          sourceNpcId: 'guide-1',
          locationId: 'mountains',
          relatedNPCs: ['guide-1', 'witness-1'],
          relatedLocations: ['mountains'],
          notes: [],
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        },
        {
          id: 'treasure-rumor',
          title: 'Hidden Treasure',
          content: 'Gold buried near the old oak tree',
          status: 'unconfirmed',
          sourceType: 'tavern',
          sourceName: 'The Drunk Dragon',
          locationId: 'forest',
          relatedNPCs: [],
          relatedLocations: ['forest'],
          notes: [],
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        },
        {
          id: 'false-alarm',
          title: 'Ghost Stories',
          content: 'Ghosts in the cemetery turned out to be false',
          status: 'false',
          sourceType: 'other',
          sourceName: 'Town Gossip',
          relatedNPCs: [],
          relatedLocations: [],
          notes: [],
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      mockUseRumorData.mockReturnValue({
        rumors: mockRumors,
        loading: false,
        error: null,
        refreshRumors: mockRefreshRumors,
      });
    });

    test('should retrieve rumor by ID correctly', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Should find existing rumor
      const rumor = rumorContext.getRumorById('dragon-sighting');
      expect(rumor).toEqual(expect.objectContaining({
        id: 'dragon-sighting',
        title: 'Dragon Sighting',
        status: 'confirmed'
      }));

      // BEHAVIOR: Should return undefined for non-existent rumor
      const nonExistent = rumorContext.getRumorById('non-existent');
      expect(nonExistent).toBeUndefined();
    });

    test('should filter rumors by status correctly', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Should filter by rumor status
      const confirmed = rumorContext.getRumorsByStatus('confirmed');
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].title).toBe('Dragon Sighting');

      const unconfirmed = rumorContext.getRumorsByStatus('unconfirmed');
      expect(unconfirmed).toHaveLength(1);
      expect(unconfirmed[0].title).toBe('Hidden Treasure');

      const falseRumors = rumorContext.getRumorsByStatus('false');
      expect(falseRumors).toHaveLength(1);
      expect(falseRumors[0].title).toBe('Ghost Stories');
    });

    test('should filter rumors by location correctly', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Should filter by location ID
      const mountainRumors = rumorContext.getRumorsByLocation('mountains');
      expect(mountainRumors).toHaveLength(1);
      expect(mountainRumors[0].title).toBe('Dragon Sighting');

      const forestRumors = rumorContext.getRumorsByLocation('forest');
      expect(forestRumors).toHaveLength(1);
      expect(forestRumors[0].title).toBe('Hidden Treasure');

      // BEHAVIOR: Should return empty array for non-matching location
      const noLocation = rumorContext.getRumorsByLocation('nonexistent');
      expect(noLocation).toHaveLength(0);
    });

    // Documents the deliberate decision (see RumorContext.tsx) not to add a
    // legacy `location` fallback here: Rumors have always stored a display
    // *name* in `location`, never an id, so comparing an incoming id against
    // it would not recover any real un-migrated matches.
    test('does not fall back to matching a legacy free-text location', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // 'Dragon Sighting' has no locationId of 'northern mountains', and its
      // free-text `location` (if any) is a name, not this id -- so passing
      // the sort of value a legacy `location` field might hold must not match.
      const result = rumorContext.getRumorsByLocation('northern mountains');
      expect(result).toHaveLength(0);
    });

    test('should filter rumors by NPC correctly', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Should find rumors by source NPC ID
      const guideRumors = rumorContext.getRumorsByNPC('guide-1');
      expect(guideRumors).toHaveLength(1);
      expect(guideRumors[0].title).toBe('Dragon Sighting');

      // BEHAVIOR: Should find rumors by related NPC ID
      const witnessRumors = rumorContext.getRumorsByNPC('witness-1');
      expect(witnessRumors).toHaveLength(1);
      expect(witnessRumors[0].title).toBe('Dragon Sighting');

      // BEHAVIOR: Should return empty array for non-related NPC
      const noNPC = rumorContext.getRumorsByNPC('nonexistent');
      expect(noNPC).toHaveLength(0);
    });
  });

  describe('Rumor Update Behavior', () => {
    let mockRumors: Rumor[];

    beforeEach(() => {
      mockRumors = [
        {
          id: 'test-rumor',
          title: 'Test Rumour',
          content: 'A test rumour for updates',
          status: 'unconfirmed' as RumorStatus,
          sourceType: 'tavern' as SourceType,
          sourceName: 'Test Tavern',
          relatedNPCs: [],
          relatedLocations: [],
          notes: [],
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      // Setup authenticated state
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      mockUseUser.mockReturnValue({
        userProfile: { name: 'Test User' },
        activeGroupUserProfile: { 
          userId: 'test-user', 
          username: 'Test User',
          role: 'member',
          joinedAt: '2025-06-15T00:00:00.000Z',
          activeCharacterId: 'char-1',
          characters: [
            { id: 'char-1', name: 'Test Character' }
          ]
        },
      });

      mockUseRumorData.mockReturnValue({
        rumors: mockRumors,
        loading: false,
        error: null,
        refreshRumors: mockRefreshRumors,
      });

      mockUpdateData.mockResolvedValue(undefined);
    });

    test('should update rumor with basic metadata', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      await act(async () => {
        await rumorContext.updateRumor('test-rumor', {
          title: 'Updated Rumour Title',
          content: 'Updated rumour content'
        });
      });

      // BEHAVIOR: Should update with basic metadata
      expect(mockUpdateData).toHaveBeenCalledWith(
        'test-rumor',
        expect.objectContaining({
          title: 'Updated Rumour Title',
          content: 'Updated rumour content',
          modifiedBy: 'test-user',
        })
      );
    });

    test('should update rumor status correctly', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      await act(async () => {
        await rumorContext.updateRumorStatus('test-rumor', 'confirmed');
      });

      // BEHAVIOR: Should update status in database
      expect(mockUpdateData).toHaveBeenCalledWith(
        'test-rumor',
        expect.objectContaining({
          status: 'confirmed',
          modifiedBy: 'test-user',
        })
      );
    });

    test('should reject status update for non-existent rumor', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Should reject status update for non-existent rumor
      await expect(rumorContext.updateRumorStatus('non-existent', 'confirmed')).rejects.toThrow(
        'Rumour not found'
      );

      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('should add rumor note correctly', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const newNote: RumorNote = {
        id: 'note-1',
        content: 'Additional investigation revealed more details',
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      await act(async () => {
        await rumorContext.updateRumorNote('test-rumor', newNote);
      });

      // BEHAVIOR: The note is a document of its own under the rumour (T133,
      // maintainer 2026-10-08), not one more entry in its array. Only the
      // text is the context's: the write attributes it, as every document.
      const { addRecordNote } = jest.requireMock('features/campaign-entities/shared/recordNotes');
      expect(addRecordNote).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/rumors',
        'test-rumor',
        { content: 'Additional investigation revealed more details' }
      );
      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('should reject note update for non-existent rumor', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const note: RumorNote = {
        id: 'note-1',
        content: 'Test note',
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      // BEHAVIOR: Should reject note update for non-existent rumor
      await expect(rumorContext.updateRumorNote('non-existent', note)).rejects.toThrow(
        'Rumour not found'
      );

      expect(mockUpdateData).not.toHaveBeenCalled();
    });
  });

  describe('Rumor Deletion Behavior', () => {
    beforeEach(() => {
      const mockRumors = [
        {
          id: 'test-rumor',
          title: 'Test Rumour',
          content: 'A test rumour for deletion',
          status: 'unconfirmed' as RumorStatus,
          sourceType: 'tavern' as SourceType,
          sourceName: 'Test Tavern',
          relatedNPCs: [],
          relatedLocations: [],
          notes: [],
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      // Setup authenticated state
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      mockUseRumorData.mockReturnValue({
        rumors: mockRumors,
        loading: false,
        error: null,
        refreshRumors: mockRefreshRumors,
      });

      mockDeleteData.mockResolvedValue(undefined);
    });

    test('should delete rumor successfully', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      await act(async () => {
        await rumorContext.deleteRumor('test-rumor');
      });

      // BEHAVIOR: Should delete rumor from database
      expect(mockDeleteData).toHaveBeenCalledWith('test-rumor');
      // The listener carries the write (T032): nothing re-reads the collection.
      expect(mockRefreshRumors).not.toHaveBeenCalled();
    });
  });

  describe('Rumor Combine Behavior', () => {
    beforeEach(() => {
      const mockRumors = [
        {
          id: 'rumor-1',
          title: 'Dragon Sighting A',
          content: 'Red dragon seen in mountains',
          status: 'unconfirmed' as RumorStatus,
          sourceType: 'npc' as SourceType,
          sourceName: 'Guide A',
          relatedNPCs: ['npc-1'],
          relatedLocations: ['mountain-1'],
          notes: [],
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      // Setup authenticated state
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      mockUseUser.mockReturnValue({
        userProfile: { name: 'Test User' },
        activeGroupUserProfile: { 
          userId: 'test-user', 
          username: 'Test User',
          role: 'member',
          joinedAt: '2025-06-15T00:00:00.000Z',
          activeCharacterId: 'char-1',
          characters: [
            { id: 'char-1', name: 'Test Character' }
          ]
        },
      });

      mockUseRumorData.mockReturnValue({
        rumors: mockRumors,
        loading: false,
        error: null,
        refreshRumors: mockRefreshRumors,
      });

      mockAddData.mockResolvedValue(undefined);
      mockUpdateData.mockResolvedValue(undefined);
    });

    test('should reject combining non-existent rumors', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      // BEHAVIOR: Should reject when some rumors don't exist
      await expect(rumorContext.combineRumors(['rumor-1', 'non-existent'], {})).rejects.toThrow(
        'One or more rumours not found'
      );

      expect(mockAddData).not.toHaveBeenCalled();
    });
  });

  describe('Batch actions are one write (T032, PERF-06)', () => {
    const rumorWith = (id: string): Rumor => ({
      id,
      title: `Rumour ${id}`,
      content: 'Heard in the tavern',
      status: 'unconfirmed' as RumorStatus,
      sourceType: 'tavern' as SourceType,
      sourceName: 'Barliman',
      relatedNPCs: [],
      relatedLocations: [],
      notes: [],
      createdBy: 'author',
      createdByUsername: 'Author',
      dateAdded: '2025-06-15T00:00:00.000Z'
    });

    beforeEach(() => {
      mockUseAuth.mockReturnValue({ user: { uid: 'test-user' } });
      mockUseUser.mockReturnValue({
        userProfile: { name: 'Test User' },
        activeGroupUserProfile: { userId: 'test-user', username: 'Test User', activeCharacterId: null, characters: [] },
      });
      mockUseRumorData.mockReturnValue({
        rumors: [rumorWith('r1'), rumorWith('r2'), rumorWith('r3')],
        loading: false,
        error: null,
        refreshRumors: mockRefreshRumors,
      });
      mockBatchOperations.mockClear();
      mockBatchOperations.mockResolvedValue(undefined);
    });

    test('marking several rumours commits one batch, writing status and modification only', async () => {
      renderRumorContext();
      await waitFor(() => expect(rumorContext).toBeDefined());

      await act(async () => {
        await rumorContext.updateRumorsStatus(['r1', 'r3'], 'confirmed');
      });

      expect(mockBatchOperations).toHaveBeenCalledTimes(1);
      const [writes] = mockBatchOperations.mock.calls[0];
      expect(writes.map((write: any) => [write.type, write.collection, write.id])).toEqual([
        ['update', 'groups/group-1/campaigns/campaign-1/rumors', 'r1'],
        ['update', 'groups/group-1/campaigns/campaign-1/rumors', 'r3'],
      ]);
      writes.forEach((write: any) => {
        expect(write.data).toEqual(expect.objectContaining({ status: 'confirmed', modifiedBy: 'test-user' }));
        // The author's created* fields are not part of the write.
        expect(write.data.createdBy).toBeUndefined();
      });
      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('marking a rumour that is not loaded writes nothing', async () => {
      renderRumorContext();
      await waitFor(() => expect(rumorContext).toBeDefined());

      await expect(rumorContext.updateRumorsStatus(['r1', 'gone'], 'confirmed')).rejects.toThrow(
        'One or more rumours not found'
      );
      expect(mockBatchOperations).not.toHaveBeenCalled();
    });

    test('deleting several rumours commits one batch', async () => {
      renderRumorContext();
      await waitFor(() => expect(rumorContext).toBeDefined());

      await act(async () => {
        await rumorContext.deleteRumors(['r1', 'r2']);
      });

      expect(mockBatchOperations).toHaveBeenCalledWith([
        { type: 'delete', collection: 'groups/group-1/campaigns/campaign-1/rumors', id: 'r1' },
        { type: 'delete', collection: 'groups/group-1/campaigns/campaign-1/rumors', id: 'r2' },
      ]);
      expect(mockDeleteData).not.toHaveBeenCalled();
    });
  });

  describe('Rumor Convert To Quest Behavior', () => {
    let mockCreateDocument: jest.Mock;
    /** What the conversion's one transaction commits (T088, DATA-005). */
    let mockCommit: jest.Mock;

    beforeEach(() => {
      const mockRumors: Rumor[] = [
        {
          id: 'rumor-to-convert',
          title: 'Quest Worthy Rumour',
          content: 'This rumour should become a quest',
          status: 'confirmed' as RumorStatus,
          sourceType: 'npc' as SourceType,
          sourceName: 'Quest Giver',
          relatedNPCs: ['quest-giver-1'],
          relatedLocations: ['quest-location'],
          notes: [],
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      // Authenticated state with a full profile so the attribution helpers
      // have real username/character data to resolve.
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      mockUseUser.mockReturnValue({
        userProfile: { name: 'Test User' },
        activeGroupUserProfile: {
          userId: 'test-user',
          username: 'Test User',
          role: 'member',
          joinedAt: '2025-06-15T00:00:00.000Z',
          activeCharacterId: 'char-1',
          characters: [
            { id: 'char-1', name: 'Test Character' }
          ]
        },
      });

      mockUseRumorData.mockReturnValue({
        rumors: mockRumors,
        loading: false,
        error: null,
        refreshRumors: mockRefreshRumors,
      });

      mockCreateDocument = jest.fn().mockResolvedValue('investigate-dragon-rumours');
      mockCommit = jest.fn().mockResolvedValue(undefined);
      mockUseFirestore.mockReturnValue({
        setDocument: mockSetDocument,
        createDocument: mockCreateDocument,
        createDocumentWithUpdates: createWithUpdatesThrough<Rumor>(
          (id) => mockRumors.find((rumor) => rumor.id === id),
          mockCommit
        ),
      });

      mockUpdateData.mockResolvedValue(undefined);
    });

    test('should create the quest document through the attribution-aware create path, in the same commit as the rumour marks, with the caller\'s domain data', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      const questData = {
        title: 'Investigate Dragon Rumours',
        description: 'Look into the dragon sightings',
        status: 'active'
      };

      await act(async () => {
        const questId = await rumorContext.convertToQuest(['rumor-to-convert'], questData);
        expect(questId).toBe('investigate-dragon-rumours');
      });

      // BEHAVIOR: convertToQuest creates a brand new quest document, so it
      // must go through an attribution-aware create path, not the plain
      // setDocument path. Since T088 (DATA-005) that create commits together
      // with the rumour marks: one commit, never a quest without them.
      expect(mockCommit).toHaveBeenCalledTimes(1);
      expect(mockCommit).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/quests',
        'investigate-dragon-rumours',
        'groups/group-1/campaigns/campaign-1/rumors',
        expect.objectContaining({
          create: expect.objectContaining({
            title: 'Investigate Dragon Rumours',
            description: 'Look into the dragon sightings',
            status: 'active',
            id: 'investigate-dragon-rumours'
          })
        })
      );
      expect(mockSetDocument).not.toHaveBeenCalled();
      expect(mockCreateDocument).not.toHaveBeenCalled();

      // The context itself should not hand-roll creation attribution onto the
      // quest document object -- DocumentService stamps createdBy*/modifiedBy*
      // fields for documents it writes.
      const questPayload = mockCommit.mock.calls[0][3].create;
      expect(questPayload).not.toHaveProperty('createdByUsername');
      expect(questPayload).not.toHaveProperty('modifiedByUsername');
    });

    test('records the conversion as a note of its own on each converted rumour, in the same commit', async () => {
      renderRumorContext();

      await waitFor(() => {
        expect(rumorContext).toBeDefined();
      });

      await act(async () => {
        await rumorContext.convertToQuest(['rumor-to-convert'], { title: 'Investigate Dragon Rumours' });
      });

      // BEHAVIOR: Since T088 (DATA-005) the converted rumours are marked in
      // the quest's own commit. The note recording the conversion was an
      // entry appended to the rumour's array, carrying attribution the
      // context built; since T133 (maintainer, 2026-10-08) it is a document
      // of its own under the rumour, in the same commit, and attributed by
      // the write like every document -- so the rumour is no longer rewritten.
      const { updates, notes } = mockCommit.mock.calls[0][3];
      expect(updates).toEqual([
        { id: 'rumor-to-convert', data: { convertedToQuestId: 'investigate-dragon-rumours' } }
      ]);
      expect(notes).toEqual([
        {
          under: { updated: 'rumor-to-convert' },
          id: expect.any(String),
          data: { content: 'Converted to quest: investigate-dragon-rumours' }
        }
      ]);
    });
  });

  describe('useRumors Hook Behavior', () => {
    test('should throw error when used outside RumorProvider', () => {
      // Create a test component that uses the hook outside of provider
      const TestComponent = () => {
        useRumors();
        return <div>Test</div>;
      };

      // BEHAVIOR: Should throw error when used outside provider
      expect(() => render(<TestComponent />)).toThrow(
        'useRumors must be used within a RumorProvider'
      );
    });
  });
});