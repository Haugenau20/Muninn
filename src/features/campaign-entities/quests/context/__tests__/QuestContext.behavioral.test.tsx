// src/context/__tests__/QuestContext.behavioral.test.tsx

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { QuestProvider, useQuests } from '../QuestContext';
import { Quest, QuestStatus } from '../../types';

/**
 * Quest Context Behavioral Testing
 * 
 * Tests ACTUAL Quest context behavior with mocked Firebase dependencies.
 * This tests the real Quest context logic (black box) while mocking external dependencies.
 * 
 * STRATEGY:
 * - Use real QuestProvider and useQuests hook
 * - Mock Firebase dependencies (useAuth, useFirebaseData, etc.)
 * - Test actual Quest context behavior and logic
 * - Verify correct data is passed to Firebase (without testing Firebase itself)
 */

// Mock Firebase dependencies
const mockUseAuth = jest.fn();
const mockUseUser = jest.fn();
const mockUseGroups = jest.fn();
const mockUseCampaigns = jest.fn();
const mockUseQuestData = jest.fn();
const mockUseFirebaseData = jest.fn();

// A quest's notes are documents of their own (T163), deleted with it; see the mock.
jest.mock('features/campaign-entities/shared/recordNotes', () => require('@/test-utils/record-notes-mock').recordNotesMock());

// Mock the Firebase context hooks
jest.mock('@/features/user-management', () => ({
  useAuth: () => mockUseAuth(),
  useUser: () => mockUseUser(),
  useGroups: () => mockUseGroups(),
  useCampaigns: () => mockUseCampaigns(),
}));

// Mock the data hooks
jest.mock('../../hooks/useQuestData', () => ({
  useQuestData: () => mockUseQuestData(),
}));

jest.mock('shared/hooks/useFirebaseData', () => ({
  useFirebaseData: () => mockUseFirebaseData(),
}));

// Mock user utilities for proper testing
jest.mock('core/utils/user-utils', () => ({
  getUserName: jest.fn(),
  getActiveCharacterName: jest.fn()
}));

const { getUserName, getActiveCharacterName } = require('core/utils/user-utils');

// Test component that uses the Quest context
const QuestTestComponent = ({ onContextChange }: { onContextChange: (context: any) => void }) => {
  const questContext = useQuests();
  
  React.useEffect(() => {
    onContextChange(questContext);
  }, [questContext, onContextChange]);
  
  return <div data-testid="quest-test">Quest Context Test</div>;
};

describe('QuestContext Behavioral Testing', () => {
  let questContext: any;
  let mockAddData: jest.Mock;
  let mockUpdateData: jest.Mock;
  let mockDeleteData: jest.Mock;
  let mockRefreshQuests: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    questContext = null;
    
    // Setup user utilities to return expected values
    getUserName.mockReturnValue('Test User');
    getActiveCharacterName.mockReturnValue('Test Character');

    // Create mock Firebase operations
    mockAddData = jest.fn();
    mockUpdateData = jest.fn();
    mockDeleteData = jest.fn();
    mockRefreshQuests = jest.fn();

    // Setup default mock returns
    mockUseAuth.mockReturnValue({
      user: null, // Start unauthenticated
    });

    mockUseUser.mockReturnValue({
      userProfile: null,
      activeGroupUserProfile: null,
    });

    mockUseGroups.mockReturnValue({
      activeGroupId: null,
    });

    mockUseCampaigns.mockReturnValue({
      activeCampaignId: null,
    });

    mockUseQuestData.mockReturnValue({
      quests: [],
      loading: false,
      error: null,
      getQuestById: jest.fn().mockReturnValue(undefined),
      refreshQuests: mockRefreshQuests,
      hasRequiredContext: false,
    });

    mockUseFirebaseData.mockReturnValue({
      addData: mockAddData,
      updateData: mockUpdateData,
      deleteData: mockDeleteData,
    });
  });

  const renderQuestContext = () => {
    const handleContextChange = (context: any) => {
      questContext = context;
    };

    return render(
      <QuestProvider>
        <QuestTestComponent onContextChange={handleContextChange} />
      </QuestProvider>
    );
  };

  describe('Quest Context Initialization Behavior', () => {
    test('should provide empty quest list when no data loaded', async () => {
      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Quest context should start with empty list
      expect(questContext.quests).toEqual([]);
      expect(questContext.error).toBeNull();
      expect(questContext.isLoading).toBe(false);
    });

    test('should provide all required Quest operations', async () => {
      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: All Quest operations should be available as functions
      const requiredOperations = [
        'addQuest', 'updateQuest', 'deleteQuest', 'getQuestById',
        'getQuestsByStatus', 'getQuestsByLocation', 'getQuestsByNPC',
        'updateQuestStatus', 'updateQuestObjective', 'markQuestCompleted',
        'markQuestFailed', 'refreshQuests'
      ];

      requiredOperations.forEach(operation => {
        expect(typeof questContext[operation]).toBe('function');
      });
    });

    test('should reflect loading state from useQuestData', async () => {
      // Mock loading state
      mockUseQuestData.mockReturnValue({
        quests: [],
        loading: true,
        error: null,
        getQuestById: jest.fn(),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: false,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Loading state should be reflected correctly
      expect(questContext.isLoading).toBe(true);
    });
  });

  describe('Quest Authentication Behavior', () => {
    test('should reject quest creation when user not authenticated', async () => {
      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      const questData = {
        title: 'Test Quest',
        description: 'A test quest',
        status: 'active' as QuestStatus,
        objectives: []
      };

      // BEHAVIOR: Should throw authentication error for unauthenticated user
      await expect(questContext.addQuest(questData)).rejects.toThrow(
        'User must be authenticated to add quests'
      );

      // BEHAVIOR: Firebase should not be called when authentication fails
      expect(mockAddData).not.toHaveBeenCalled();
    });

    test('should reject quest creation when no group context', async () => {
      // Mock authenticated user but no group context
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      mockUseUser.mockReturnValue({
        userProfile: { uid: 'test-user' },
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

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      const questData = {
        title: 'Test Quest',
        description: 'A test quest',
        status: 'active' as QuestStatus,
        objectives: []
      };

      // BEHAVIOR: Should throw group context error
      await expect(questContext.addQuest(questData)).rejects.toThrow(
        'Group and campaign context must be set to add quests'
      );

      // BEHAVIOR: Firebase should not be called when context validation fails
      expect(mockAddData).not.toHaveBeenCalled();
    });

    test('should allow quest creation with full authentication context', async () => {
      // Mock full authentication context
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      mockUseUser.mockReturnValue({
        userProfile: { uid: 'test-user' },
        activeGroupUserProfile: { 
          userId: 'test-user', 
          username: 'TestUser',
          role: 'member',
          joinedAt: '2025-06-15T00:00:00.000Z',
          activeCharacterId: 'char-1',
          characters: [
            { id: 'char-1', name: 'Test Character' }
          ]
        },
      });

      mockUseGroups.mockReturnValue({
        activeGroupId: 'test-group',
      });

      mockUseCampaigns.mockReturnValue({
        activeCampaignId: 'test-campaign',
      });

      // Mock successful Firebase operation
      mockAddData.mockResolvedValue(undefined);
      mockRefreshQuests.mockResolvedValue([]);

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      const questData = {
        title: 'Test Quest',
        description: 'A test quest',
        status: 'active' as QuestStatus,
        objectives: []
      };

      // BEHAVIOR: Should succeed with proper authentication
      await act(async () => {
        const result = await questContext.addQuest(questData);
        expect(typeof result).toBe('string'); // Should return quest ID
      });

      // BEHAVIOR: Should call Firebase with correctly formatted quest data
      expect(mockAddData).toHaveBeenCalledTimes(1);
      const [questDataSent, questId] = mockAddData.mock.calls[0];

      // Verify correct data sent to Firebase
      expect(questDataSent).toMatchObject({
        title: 'Test Quest',
        description: 'A test quest',
        status: 'active',
        objectives: [],
      });

      // Attribution is applied by DocumentService and asserted in DocumentService.test.ts
      expect(questDataSent.id).toBe(questId); // ID should match
      expect(Array.isArray(questDataSent.objectives)).toBe(true);

      // BEHAVIOR: Should refresh quests after creation
      // The listener carries the write (T032): nothing re-reads the collection.
      expect(mockRefreshQuests).not.toHaveBeenCalled();
    });
  });

  describe('Quest ID Generation Behavior', () => {
    beforeEach(() => {
      // Setup full auth context for ID generation tests
      mockUseAuth.mockReturnValue({ user: { uid: 'test-user' } });
      mockUseUser.mockReturnValue({
        userProfile: { uid: 'test-user' },
        activeGroupUserProfile: { 
          userId: 'test-user', 
          username: 'TestUser',
          role: 'member',
          joinedAt: '2025-06-15T00:00:00.000Z',
          activeCharacterId: 'char-1',
          characters: [
            { id: 'char-1', name: 'Test Character' }
          ]
        },
      });
      mockUseGroups.mockReturnValue({ activeGroupId: 'test-group' });
      mockUseCampaigns.mockReturnValue({ activeCampaignId: 'test-campaign' });
      mockAddData.mockResolvedValue(undefined);
      mockRefreshQuests.mockResolvedValue([]);
    });

    test('should generate predictable IDs from quest titles', async () => {
      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      const questData = {
        title: 'Save the Village',
        description: 'A heroic quest',
        status: 'active' as QuestStatus,
        objectives: []
      };

      await act(async () => {
        await questContext.addQuest(questData);
      });

      // BEHAVIOR: Should generate consistent ID from title
      const [questDataSent] = mockAddData.mock.calls[0];
      expect(questDataSent.id).toBe('save-the-village');
    });

    test('should generate unique IDs for similar titles', async () => {
      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // SPECIFICATION TEST: Similar titles should generate unique IDs.
      // (This comment was always correct; before 2026-07-28 the assertions at
      // the bottom of this test denied it. See the note there.)
      const questData1 = {
        title: 'Save the Village',
        description: 'First quest',
        status: 'active' as QuestStatus,
        objectives: []
      };

      const questData2 = {
        title: 'SAVE THE VILLAGE', // Different case, should get unique ID
        description: 'Second quest',
        status: 'active' as QuestStatus,
        objectives: []
      };

      await act(async () => {
        await questContext.addQuest(questData1);
        await questContext.addQuest(questData2);
      });

      // BEHAVIOR: Both quests should be sent to Firebase
      expect(mockAddData).toHaveBeenCalledTimes(2);

      const [firstQuestData] = mockAddData.mock.calls[0];
      const [secondQuestData] = mockAddData.mock.calls[1];

      // ✅ CORRECTED 2026-07-28, under explicit authorisation, alongside the fix
      // for the #002/#004/#009/#012 ID-collision cluster.
      //
      // This was a CHARACTERIZATION TEST, and the clearest specimen found in
      // this codebase: its name says "should generate unique IDs", line 382
      // says "SPECIFICATION TEST: Similar titles should generate unique IDs",
      // and line 391 says "should get unique ID" — then the assertions
      // demanded the ids be IDENTICAL, with a comment rationalising the
      // collision as "intentional". Name and assertions contradicted each
      // other inside a single test body, and it passed only because the defect
      // existed. It also contradicted QuestContext.bugs.test.tsx's #004
      // markers, which demanded the opposite in the same codebase.
      //
      // Two quests whose titles differ only by case are two different quests.
      // The second no longer silently overwrites the first via setDoc.
      // Disambiguation is collision-only, so the first quest keeps the clean
      // slug and only the colliding second one is suffixed.
      expect(firstQuestData.id).toBe('save-the-village');
      expect(secondQuestData.id).not.toBe('save-the-village');
      expect(secondQuestData.id).not.toBe(firstQuestData.id);
    });
  });

  describe('Quest Retrieval Behavior', () => {
    test('should return undefined for nonexistent quest', async () => {
      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Should return undefined for missing quest
      const result = questContext.getQuestById('nonexistent-quest');
      expect(result).toBeUndefined();
    });

    test('should filter quests by status correctly', async () => {
      // Mock quest data
      const mockQuests = [
        { id: '1', status: 'active', title: 'Active Quest' },
        { id: '2', status: 'completed', title: 'Completed Quest' },
        { id: '3', status: 'active', title: 'Another Active Quest' },
      ];

      mockUseQuestData.mockReturnValue({
        quests: mockQuests,
        loading: false,
        error: null,
        getQuestById: jest.fn(),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: true,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Should filter by status correctly
      const activeQuests = questContext.getQuestsByStatus('active');
      const completedQuests = questContext.getQuestsByStatus('completed');
      const failedQuests = questContext.getQuestsByStatus('failed');

      expect(activeQuests).toHaveLength(2);
      expect(completedQuests).toHaveLength(1);
      expect(failedQuests).toHaveLength(0);

      expect(activeQuests[0].status).toBe('active');
      expect(activeQuests[1].status).toBe('active');
      expect(completedQuests[0].status).toBe('completed');
    });
  });

  describe('Quest Relationship Filtering Behavior', () => {
    test('should filter quests by NPC correctly', async () => {
      // CHANGED DELIBERATELY in `15-5`: `importantNPCs` is deleted (`D15.7`),
      // so quest 2 -- which named the NPC only in that free-text list -- is no
      // longer found. The clause that found it compared `npc.name === npcId`,
      // a display name against a document id, and could only ever match when
      // someone had typed an id into a name field. The fixture keeps that
      // shape to record what was dropped.
      const mockQuests = [
        {
          id: '1',
          title: 'Quest with NPC ID',
          relatedNPCIds: ['npc-123', 'npc-456'],
        },
        {
          id: '2',
          title: 'Quest naming the NPC in free text only',
          relatedNPCIds: [],
        },
        {
          id: '3',
          title: 'Quest without NPC',
          relatedNPCIds: ['other-npc'],
        },
      ];

      mockUseQuestData.mockReturnValue({
        quests: mockQuests,
        loading: false,
        error: null,
        getQuestById: jest.fn(),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: true,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: one relation list, matched by id
      const npcQuests = questContext.getQuestsByNPC('npc-123');

      expect(npcQuests).toHaveLength(1);
      expect(npcQuests[0].id).toBe('1');
    });

    test('should filter quests by location correctly', async () => {
      // Mock quest data with location relationships
      const mockQuests = [
        {
          id: '1',
          title: 'Quest with location ID',
          locationId: 'dungeon-123',
          location: 'dungeon-123',
          keyLocations: []
        },
        {
          id: '2',
          title: 'Quest with key location',
          location: 'other-location',
          keyLocations: [{ name: 'dungeon-123', description: 'Dark dungeon' }]
        },
        {
          id: '3',
          title: 'Quest elsewhere',
          location: 'different-location',
          keyLocations: []
        },
      ];

      mockUseQuestData.mockReturnValue({
        quests: mockQuests,
        loading: false,
        error: null,
        getQuestById: jest.fn(),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: true,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Should find quests by location ID and key location name.
      // `getQuestsByLocation` takes a `Location` record: its `id` matches
      // quest 1's `locationId`, and its `name` matches quest 2's
      // `keyLocations[0].name`.
      const locationQuests = questContext.getQuestsByLocation({ id: 'dungeon-123', name: 'dungeon-123' });

      expect(locationQuests).toHaveLength(2); // Should find both direct and key location matches
      expect(locationQuests[0].id).toBe('1');
      expect(locationQuests[1].id).toBe('2');
    });

    // `locationId` is the reference; free text in `location` is what a
    // player wrote and places no quest, even when it reads like the place's
    // id or name. It used to match, for documents written before `locationId`;
    // production has none left (T079).
    test('should match by locationId only, never by free text that reads like the place', async () => {
      const minesOfMoria = { id: 'mines-of-moria', name: 'Mines of Moria' };
      const rivendellLocation = { id: 'rivendell', name: 'Rivendell' };

      const mockQuests = [
        // Migrated: canonical locationId set.
        { id: '1', title: 'Quest with locationId', locationId: 'mines-of-moria', location: 'Mines of Moria', keyLocations: [] },
        // Free text that reads like the place's id.
        { id: '2', title: 'Quest without locationId (id)', location: 'mines-of-moria', keyLocations: [] },
        // Free text that reads like the place's name.
        { id: '3', title: 'Quest without locationId (name)', location: 'Mines of Moria', keyLocations: [] },
        // Unrelated location entirely.
        { id: '4', title: 'Quest elsewhere', locationId: 'rivendell', location: 'Rivendell', keyLocations: [] },
      ];

      mockUseQuestData.mockReturnValue({
        quests: mockQuests,
        loading: false,
        error: null,
        getQuestById: jest.fn(),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: true,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      const matches = questContext.getQuestsByLocation(minesOfMoria);
      const unrelated = questContext.getQuestsByLocation(rivendellLocation);

      expect(matches.map((quest: any) => quest.id).sort()).toEqual(['1']);
      expect(unrelated.map((quest: any) => quest.id)).toEqual(['4']);
      expect(matches.some((quest: any) => quest.id === '4')).toBe(false);
    });

    // `keyLocations` is a separate concept from `location`/`locationId` --
    // named locations mentioned in the quest write-up, not a reference to a
    // Location record -- and is matched on name, case-insensitively, against
    // the given Location's own name.
    test('also matches via a keyLocation whose name matches, case-insensitively', async () => {
      const dungeon = { id: 'dungeon-123', name: 'Dark Dungeon' };

      const mockQuests = [
        { id: '1', title: 'Quest with key location', location: 'other-location', keyLocations: [{ name: 'dark dungeon', description: 'A cave' }] },
        { id: '2', title: 'Quest without it', location: 'different-location', keyLocations: [] },
      ];

      mockUseQuestData.mockReturnValue({
        quests: mockQuests,
        loading: false,
        error: null,
        getQuestById: jest.fn(),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: true,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      const matches = questContext.getQuestsByLocation(dungeon);
      expect(matches.map((quest: any) => quest.id)).toEqual(['1']);
    });

    // #1421: a place stored with the location's id still matches after the
    // location is renamed, and an id never matches a different location.
    test('matches a keyLocation by the locationId it stored, whatever its name says', async () => {
      const renamed = { id: 'dungeon-123', name: 'The Deep Halls' };
      const other = { id: 'other', name: 'Dark Dungeon' };

      const mockQuests = [
        { id: '1', title: 'Quest with a linked place', location: 'elsewhere', keyLocations: [{ name: 'Dark Dungeon', description: '', locationId: 'dungeon-123' }] },
      ];

      mockUseQuestData.mockReturnValue({
        quests: mockQuests,
        loading: false,
        error: null,
        getQuestById: jest.fn(),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: true,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      expect(questContext.getQuestsByLocation(renamed).map((quest: any) => quest.id)).toEqual(['1']);
      expect(questContext.getQuestsByLocation(other)).toEqual([]);
    });
  });

  describe('Quest Update Behavior', () => {
    beforeEach(() => {
      // Setup auth for update operations
      mockUseAuth.mockReturnValue({ user: { uid: 'test-user' } });
      mockUseUser.mockReturnValue({
        userProfile: { uid: 'test-user' },
        activeGroupUserProfile: { 
          userId: 'test-user', 
          username: 'TestUser',
          role: 'member',
          joinedAt: '2025-06-15T00:00:00.000Z',
          activeCharacterId: 'char-1',
          characters: [
            { id: 'char-1', name: 'Test Character' }
          ]
        },
      });
      mockUseGroups.mockReturnValue({ activeGroupId: 'test-group' });
      mockUseCampaigns.mockReturnValue({ activeCampaignId: 'test-campaign' });
      mockUpdateData.mockResolvedValue(undefined);
      mockRefreshQuests.mockResolvedValue([]);
    });

    test('should reject updates to nonexistent quest', async () => {
      // Mock getQuestById to return undefined
      mockUseQuestData.mockReturnValue({
        quests: [],
        loading: false,
        error: null,
        getQuestById: jest.fn().mockReturnValue(undefined),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: true,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Should reject status update for nonexistent quest
      await expect(
        questContext.updateQuestStatus('nonexistent-quest', 'completed')
      ).rejects.toThrow('Quest not found');

      // BEHAVIOR: Firebase should not be called
      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('should update quest status with proper metadata', async () => {
      const existingQuest = {
        id: 'test-quest',
        title: 'Test Quest',
        status: 'active',
        objectives: []
      };

      mockUseQuestData.mockReturnValue({
        quests: [existingQuest],
        loading: false,
        error: null,
        getQuestById: jest.fn().mockReturnValue(existingQuest),
        refreshQuests: mockRefreshQuests,
        hasRequiredContext: true,
      });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Should update quest status successfully
      await act(async () => {
        await questContext.updateQuestStatus('test-quest', 'completed');
      });

      // BEHAVIOR: Should call Firebase with updated quest data
      expect(mockUpdateData).toHaveBeenCalledTimes(1);
      const [questId, updatedQuestData] = mockUpdateData.mock.calls[0];

      expect(questId).toBe('test-quest');
      expect(updatedQuestData.status).toBe('completed');
      expect(updatedQuestData.dateCompleted).toBeDefined(); // Should set completion date
      // Attribution is applied by DocumentService and asserted in DocumentService.test.ts

      // BEHAVIOR: Should refresh quests after update
      // The listener carries the write (T032): nothing re-reads the collection.
      expect(mockRefreshQuests).not.toHaveBeenCalled();
    });
  });

  describe('Quest Deletion Behavior', () => {
    beforeEach(() => {
      // Setup auth for delete operations
      mockUseAuth.mockReturnValue({ user: { uid: 'test-user' } });
      mockUseGroups.mockReturnValue({ activeGroupId: 'test-group' });
      mockUseCampaigns.mockReturnValue({ activeCampaignId: 'test-campaign' });
      mockDeleteData.mockResolvedValue(undefined);
      mockRefreshQuests.mockResolvedValue([]);
    });

    test('should delete quest without re-reading the collection', async () => {
      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Should delete quest successfully
      await act(async () => {
        await questContext.deleteQuest('test-quest');
      });

      // BEHAVIOR: Should call Firebase delete with quest ID
      expect(mockDeleteData).toHaveBeenCalledWith('test-quest');

      // BEHAVIOR: Should refresh quests after deletion
      // The listener carries the write (T032): nothing re-reads the collection.
      expect(mockRefreshQuests).not.toHaveBeenCalled();
    });

    test('should reject deletion without authentication', async () => {
      // Remove authentication
      mockUseAuth.mockReturnValue({ user: null });

      renderQuestContext();

      await waitFor(() => {
        expect(questContext).toBeDefined();
      });

      // BEHAVIOR: Should reject deletion for unauthenticated user
      await expect(questContext.deleteQuest('test-quest')).rejects.toThrow(
        'User must be authenticated to delete quests'
      );

      // BEHAVIOR: Firebase should not be called
      expect(mockDeleteData).not.toHaveBeenCalled();
    });
  });
});