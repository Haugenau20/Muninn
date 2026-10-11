// src/features/storytelling/chapters/context/__tests__/StoryContext.behavioral.test.tsx

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { StoryProvider, useStory } from '../StoryContext';
import { Chapter } from 'features/storytelling/chapters/types';

/**
 * Story Context Behavioral Testing
 *
 * Tests ACTUAL Story context behavior with mocked Firebase dependencies.
 * This tests the real Story context logic (black box) while mocking external dependencies.
 *
 * STRATEGY:
 * - Use real StoryProvider and useStory hook
 * - Mock Firebase dependencies (useAuth, useChapterData, etc.)
 * - Test actual Story context behavior and logic
 * - Verify correct data is passed to Firebase (without testing Firebase itself)
 */

// Mock Firebase dependencies
const mockUseAuth = jest.fn();
const mockUseUser = jest.fn();
const mockUseCampaigns = jest.fn();
const mockUseChapterData = jest.fn();
const mockUseFirebaseData = jest.fn();

// Mock the Firebase context hooks
// No reader in these suites has saved progress.
const mockStoryFirestore = { getDocument: async () => null };

jest.mock('@/features/user-management', () => ({
  useAuth: () => mockUseAuth(),
  useUser: () => mockUseUser(),
  useCampaigns: () => mockUseCampaigns(),
  // StoryContext reads the reader's own progress document (T073). One object,
  // so `getDocument` is as stable as the real hook's `useCallback`.
  useGroups: () => ({ activeGroupId: 'group-1' }),
  useFirestore: () => mockStoryFirestore,
}));

// Mock the data hooks
jest.mock('features/storytelling/chapters/hooks/useChapterData', () => ({
  useChapterData: () => mockUseChapterData(),
}));

jest.mock('shared/hooks/useFirebaseData', () => ({
  useFirebaseData: () => mockUseFirebaseData(),
}));

// Mock Firebase services
jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: {
    document: {
      setDocument: jest.fn(),
      createDocument: jest.fn(),
      getDocument: jest.fn(),
      batchOperations: jest.fn()
    }
  },
}));

// Mock user utilities for proper testing
jest.mock('core/utils/user-utils', () => ({
  getUserName: jest.fn(),
  getActiveCharacterName: jest.fn()
}));

const { getUserName, getActiveCharacterName } = require('core/utils/user-utils');

// Test component that uses the Story context
const StoryTestComponent = ({ onContextChange }: { onContextChange: (context: any) => void }) => {
  const storyContext = useStory();
  
  React.useEffect(() => {
    onContextChange(storyContext);
  }, [storyContext, onContextChange]);
  
  return <div data-testid="story-test">Story Context Test</div>;
};

describe('StoryContext Behavioral Testing', () => {
  let storyContext: any;
  let mockUpdateData: jest.Mock;
  let mockDeleteData: jest.Mock;
  let mockUpdateProgressData: jest.Mock;
  let mockRefreshChapters: jest.Mock;
  let mockFirebaseServices: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    storyContext = null;

    // Setup user utilities to return expected values
    getUserName.mockReturnValue('Test User');
    getActiveCharacterName.mockReturnValue('Test Character');

    // Create mock Firebase operations
    mockUpdateData = jest.fn();
    mockDeleteData = jest.fn();
    mockUpdateProgressData = jest.fn();
    mockRefreshChapters = jest.fn();

    // Get mocked Firebase services
    mockFirebaseServices = require('core/services/firebase').default;

    // Setup default mock returns
    mockUseAuth.mockReturnValue({
      user: null, // Start unauthenticated
    });

    mockUseUser.mockReturnValue({
      userProfile: null,
      activeGroupUserProfile: null,
    });

    // A campaign exists exactly when the test says the context is ready. Set
    // separately, the two could claim a ready context with no campaign -- a
    // state the app never has, in which writes now refuse (T082).
    mockUseCampaigns.mockImplementation(() => ({
      activeCampaignId: mockUseChapterData().hasRequiredContext ? 'campaign-1' : null,
    }));

    mockUseChapterData.mockReturnValue({
      chapters: [],
      loading: false,
      error: null,
      refreshChapters: mockRefreshChapters,
      hasRequiredContext: false, // Start without context
    });

    // Mock Firebase data operations
    mockUseFirebaseData.mockReturnValue({
      updateData: mockUpdateData,
      deleteData: mockDeleteData,
      // The real hook exposes getData; StoryContext re-fetches progress with it
      // once the campaign context resolves.
      getData: jest.fn().mockResolvedValue([]),
    });

    // Mock Firebase services
    mockFirebaseServices.document.setDocument.mockResolvedValue(undefined);
    mockFirebaseServices.document.createDocument.mockResolvedValue('mock-id');
    mockFirebaseServices.document.getDocument.mockResolvedValue({});
    mockFirebaseServices.document.batchOperations.mockResolvedValue(undefined);
  });

  /**
   * The writes of the one batch the last structural change committed (T032).
   * Insert, delete and move are each exactly one `batchOperations` call, so a
   * partial change cannot be left behind.
   */
  const committedBatch = (): Array<{ type: string; collection: string; id: string; data?: any }> => {
    const calls = mockFirebaseServices.document.batchOperations.mock.calls;
    expect(calls).toHaveLength(1);
    return calls[0][0];
  };

  /** The campaign's chapters, where every chapter write goes. */
  const CHAPTERS = 'groups/group-1/campaigns/campaign-1/chapters';

  /** The `order` each chapter is moved to by the committed batch, by id. */
  const movesIn = (batch: Array<{ type: string; id: string; data?: any }>) =>
    Object.fromEntries(
      batch.filter((write) => write.type === 'update').map((write) => [write.id, write.data.order])
    );

  const renderStoryContext = () => {
    const handleContextChange = (context: any) => {
      storyContext = context;
    };

    return render(
      <StoryProvider>
        <StoryTestComponent onContextChange={handleContextChange} />
      </StoryProvider>
    );
  };

  describe('Story Context Initialization Behavior', () => {
    test('should provide empty chapters list when no data loaded', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: Story context should start with empty chapters list
      expect(storyContext.chapters).toEqual([]);
      expect(storyContext.isLoading).toBe(false);
      // A missing group/campaign is a STATE, and this context already publishes
      // it as `hasRequiredContext`. It no longer also fabricates a sentence out
      // of it: only the page knows whether the visitor is signed out, still
      // resolving, or between campaigns, and the wording now lives in
      // shared/components/gated/gated-page-copy.ts.
      expect(storyContext.error).toBeNull();
      expect(storyContext.hasRequiredContext).toBe(false);
    });

    test('should provide all required story operations', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: All story operations should be available as functions
      const requiredOperations = [
        'getChapterById', 'updateChapterProgress', 'updateCurrentChapter',
        'getNextChapter', 'getPreviousChapter', 'markChapterComplete',
        'getReadingProgress', 'createChapter', 'updateChapter', 'deleteChapter',
        'reorderChapters'
      ];

      requiredOperations.forEach(operation => {
        expect(typeof storyContext[operation]).toBe('function');
      });
    });

    test('reports missing context as state, not as an error message', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // This used to assert 'Please select a group and campaign'. That
      // assertion encoded a layering mistake: `error` is for real failures, and
      // filling it with a selection prompt meant StoryPage rendered that prompt
      // through its error branch -- telling a signed-out visitor to use a
      // switcher Header only renders for signed-in members.
      expect(storyContext.error).toBeNull();
      // The state itself is still published, for callers that need it.
      expect(storyContext.hasRequiredContext).toBe(false);
    });
  });

  describe('Story Authentication Requirements', () => {
    test('should reject createChapter when user not authenticated', async () => {
      mockUseChapterData.mockReturnValue({
        chapters: [],
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true, // Context available but not authenticated
      });

      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      const chapterData: Omit<Chapter, 'id'> = {
        title: 'Test Chapter',
        content: 'A test chapter for authentication checking',
        order: 1,
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      // BEHAVIOR: Should reject when not authenticated
      await expect(storyContext.createChapter(chapterData)).rejects.toThrow(
        'You must be signed in to create chapters'
      );

      expect(mockFirebaseServices.document.setDocument).not.toHaveBeenCalled();
    });

    test('should reject updateChapter when user not authenticated', async () => {
      mockUseChapterData.mockReturnValue({
        chapters: [{
          id: 'chapter-01',
          title: 'Test Chapter',
          content: 'Test content',
          order: 1,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }],
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });

      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: Should reject when not authenticated
      await expect(storyContext.updateChapter('chapter-01', { title: 'Updated' })).rejects.toThrow(
        'You must be signed in to update chapters'
      );

      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('should reject deleteChapter when user not authenticated', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: Should reject when not authenticated
      await expect(storyContext.deleteChapter('chapter-01')).rejects.toThrow(
        'You must be signed in to delete chapters'
      );

      expect(mockDeleteData).not.toHaveBeenCalled();
    });

    test('should reject operations when no group/campaign context', async () => {
      // Setup authenticated but no context
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      const chapterData: Omit<Chapter, 'id'> = {
        title: 'Test Chapter',
        content: 'Test content',
        order: 1,
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      // BEHAVIOR: Should reject when no active group or campaign
      await expect(storyContext.createChapter(chapterData)).rejects.toThrow(
        'No active group or campaign selected'
      );
    });
  });

  describe('Chapter Creation Behavior', () => {
    beforeEach(() => {
      // Setup authenticated state with context
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

      mockUseChapterData.mockReturnValue({
        chapters: [],
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });
    });

    test('should create chapter with basic data structure', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      const chapterData: Omit<Chapter, 'id'> = {
        title: 'The Beginning',
        content: 'Our adventure starts in the tavern...',
        order: 1,
        summary: 'The party meets',
        createdBy: 'test-user',
        createdByUsername: 'Test User',
        dateAdded: '2025-06-15T00:00:00.000Z'
      };

      let chapterId = '';
      await act(async () => {
        chapterId = await storyContext.createChapter(chapterData);
      });

      // BEHAVIOR: one batch, writing the chapter under the id it returned --
      // and since T134 its text as a document of its own beside it, the
      // chapter keeping only the text's length.
      expect(committedBatch()).toEqual([
        {
          type: 'set',
          collection: 'groups/group-1/campaigns/campaign-1/chapters',
          id: chapterId,
          data: expect.objectContaining({
            title: 'The Beginning',
            contentLength: 'Our adventure starts in the tavern...'.length,
            order: 1,
            id: chapterId
          })
        },
        {
          type: 'set',
          collection: `groups/group-1/campaigns/campaign-1/chapters/${chapterId}/body`,
          id: 'text',
          data: { content: 'Our adventure starts in the tavern...' }
        }
      ]);
      expect(committedBatch()[0].data).not.toHaveProperty('content');
    });

    // REWRITTEN (T032, PERF-05). This pinned ids derived from order
    // (`chapter-05` for order 5), which is what made every insert, delete and
    // move re-key every chapter after it. A chapter's id is now its identity
    // alone; its place is the `order` field.
    test('gives every new chapter its own id, which says nothing about its order', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      const ids: string[] = [];
      for (const order of [1, 5]) {
        await act(async () => {
          ids.push(await storyContext.createChapter({
            title: `Chapter ${order}`,
            content: 'Test content',
            order,
          }));
        });
      }

      expect(ids[0]).not.toBe(ids[1]);
      ids.forEach((id) => {
        expect(id).toMatch(/^chapter-[a-z0-9]+$/);
        expect(id).not.toMatch(/^chapter-\d+$/);
      });
    });

    test('should handle chapter insertion with reordering', async () => {
      const existingChapters = [
        {
          id: 'chapter-01',
          title: 'Chapter 1',
          content: 'First chapter',
          order: 1,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        },
        {
          id: 'chapter-02',
          title: 'Chapter 2',
          content: 'Second chapter',
          order: 2,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      mockUseChapterData.mockReturnValue({
        chapters: existingChapters,
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });

      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // Insert chapter at order 2 (should shift existing chapter 2 to order 3)
      let chapterId = '';
      await act(async () => {
        chapterId = await storyContext.createChapter({
          title: 'Inserted Chapter',
          content: 'This chapter is inserted',
          order: 2,
        });
      });

      // BEHAVIOR: in one batch, chapter-02 keeps its id and moves to order 3,
      // chapter-01 is untouched, and the new chapter takes order 2.
      const batch = committedBatch();
      expect(movesIn(batch)).toEqual({ 'chapter-02': 3 });
      expect(batch).toContainEqual({
        type: 'set',
        collection: 'groups/group-1/campaigns/campaign-1/chapters',
        id: chapterId,
        data: expect.objectContaining({ title: 'Inserted Chapter', order: 2 })
      });
      expect(mockFirebaseServices.document.setDocument).not.toHaveBeenCalled();
      expect(mockDeleteData).not.toHaveBeenCalled();
    });

    test('stamps a new chapter with creation attribution for the current user, in the same batch', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      let chapterId = '';
      await act(async () => {
        chapterId = await storyContext.createChapter({
          title: 'The Beginning',
          content: 'Our adventure starts in the tavern...',
          order: 1,
        });
      });

      // A genuine new chapter carries the creator's attribution -- the fields
      // `createDocument` would stamp -- inside the batch, so the write that
      // creates it is atomic with any shift it causes.
      const [write] = committedBatch();
      expect(write).toEqual({
        type: 'set',
        collection: 'groups/group-1/campaigns/campaign-1/chapters',
        id: chapterId,
        data: expect.objectContaining({
          title: 'The Beginning',
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          createdByCharacterName: 'Test Character',
          modifiedBy: 'test-user',
        })
      });
      expect(mockFirebaseServices.document.setDocument).not.toHaveBeenCalled();
      expect(mockFirebaseServices.document.createDocument).not.toHaveBeenCalled();
    });
  });

  describe('Attribution Regression Guard — Reorder Must Not Reattribute Existing Chapters', () => {
    test('reordering a chapter authored by user A, performed by user B, writes only order to the chapters it passes and only modified* to the one it moves', async () => {
      // The acting user for this reorder is B -- a different person than the
      // original author of every chapter involved.
      mockUseAuth.mockReturnValue({
        user: { uid: 'user-b' },
      });

      mockUseUser.mockReturnValue({
        userProfile: { name: 'User B' },
        activeGroupUserProfile: {
          userId: 'user-b',
          username: 'User B',
          role: 'member',
          joinedAt: '2025-06-15T00:00:00.000Z',
          activeCharacterId: 'char-b',
          characters: [
            { id: 'char-b', name: 'Character B' }
          ]
        },
      });

      getUserName.mockReturnValue('User B');
      getActiveCharacterName.mockReturnValue('Character B');

      const byA = {
        createdBy: 'user-a',
        createdByUsername: 'User A',
        dateAdded: '2025-01-01T00:00:00.000Z',
        modifiedBy: 'user-a',
        modifiedByUsername: 'User A',
        dateModified: '2025-01-01T00:00:00.000Z'
      };
      mockUseChapterData.mockReturnValue({
        chapters: [
          { id: 'chapter-01', title: 'Chapter 1', content: 'First chapter', order: 1, ...byA },
          { id: 'chapter-02', title: 'Chapter 2', content: 'Second chapter', order: 2, ...byA },
          { id: 'chapter-03', title: 'Chapter 3', content: 'Third chapter', order: 3, ...byA }
        ],
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });

      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // User B moves chapter-01 from order 1 to order 3.
      await act(async () => {
        await storyContext.updateChapter('chapter-01', { order: 3 });
      });

      const batch = committedBatch();

      // The chapters it passes only change place: their documents get
      // `order` and nothing else, so A's created* and modified* fields
      // cannot be touched -- reordering never reattributes (#1203).
      expect(batch).toContainEqual({ type: 'update', collection: 'groups/group-1/campaigns/campaign-1/chapters', id: 'chapter-02', data: { order: 1 } });
      expect(batch).toContainEqual({ type: 'update', collection: 'groups/group-1/campaigns/campaign-1/chapters', id: 'chapter-03', data: { order: 2 } });

      // The chapter B actually moved gets B's modification stamp, and no
      // created* field at all -- so A's creation survives.
      const moved = batch.find((write) => write.id === 'chapter-01')!;
      expect(moved.data).toEqual(expect.objectContaining({
        order: 3,
        modifiedBy: 'user-b',
        modifiedByUsername: 'User B',
      }));
      expect(Object.keys(moved.data).filter((key) => key.startsWith('created') || key === 'dateAdded')).toEqual([]);
      expect(batch).toHaveLength(3);
    });
  });

  describe('Chapter Retrieval Behavior', () => {
    beforeEach(() => {
      const mockChapters: Chapter[] = [
        {
          id: 'chapter-01',
          title: 'The Beginning',
          content: 'Our story begins...',
          order: 1,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        },
        {
          id: 'chapter-02',
          title: 'The Journey',
          content: 'The adventure continues...',
          order: 2,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        },
        {
          id: 'chapter-03',
          title: 'The End',
          content: 'Our story concludes...',
          order: 3,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      mockUseChapterData.mockReturnValue({
        chapters: mockChapters,
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });
    });

    test('should retrieve chapter by ID correctly', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: Should find existing chapter
      const chapter = storyContext.getChapterById('chapter-02');
      expect(chapter).toEqual(expect.objectContaining({
        id: 'chapter-02',
        title: 'The Journey',
        order: 2
      }));

      // BEHAVIOR: Should return undefined for non-existent chapter
      const nonExistent = storyContext.getChapterById('non-existent');
      expect(nonExistent).toBeUndefined();
    });

    test('should navigate chapters correctly', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: Should get next chapter correctly
      const nextChapter = storyContext.getNextChapter('chapter-01');
      expect(nextChapter).toEqual(expect.objectContaining({
        id: 'chapter-02',
        title: 'The Journey'
      }));

      // BEHAVIOR: Should get previous chapter correctly
      const prevChapter = storyContext.getPreviousChapter('chapter-02');
      expect(prevChapter).toEqual(expect.objectContaining({
        id: 'chapter-01',
        title: 'The Beginning'
      }));

      // BEHAVIOR: Should return undefined for navigation beyond bounds
      expect(storyContext.getNextChapter('chapter-03')).toBeUndefined();
      expect(storyContext.getPreviousChapter('chapter-01')).toBeUndefined();
    });

    test('should calculate reading progress correctly', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: Should calculate progress based on completed chapters
      // With no completed chapters, progress should be 0
      const initialProgress = storyContext.getReadingProgress();
      expect(initialProgress).toBe(0);
    });
  });

  describe('Chapter Update Behavior', () => {
    let mockChapters: Chapter[];

    beforeEach(() => {
      mockChapters = [
        {
          id: 'chapter-01',
          title: 'Test Chapter',
          content: 'A test chapter for updates',
          order: 1,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      // Setup authenticated state with context
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

      mockUseChapterData.mockReturnValue({
        chapters: mockChapters,
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });

      mockUpdateData.mockResolvedValue(undefined);
    });

    test('should update chapter with basic metadata', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      await act(async () => {
        await storyContext.updateChapter('chapter-01', {
          title: 'Updated Chapter Title',
          content: 'Updated chapter content'
        });
      });

      // BEHAVIOR: Should update with basic metadata. Since T134 the text goes
      // to its own document, in one batch with the chapter's fields; the
      // chapter's own copy is emptied, so the newer text is the one read.
      expect(committedBatch()).toEqual([
        {
          type: 'update',
          collection: 'groups/group-1/campaigns/campaign-1/chapters',
          id: 'chapter-01',
          data: expect.objectContaining({
            title: 'Updated Chapter Title',
            content: null,
            contentLength: 'Updated chapter content'.length,
            modifiedBy: 'test-user',
          })
        },
        {
          type: 'set',
          collection: 'groups/group-1/campaigns/campaign-1/chapters/chapter-01/body',
          id: 'text',
          data: { content: 'Updated chapter content' }
        }
      ]);
    });

    test('changes the fields alone through one attributed update, when the text is not among them', async () => {
      renderStoryContext();
      await waitFor(() => expect(storyContext).toBeDefined());

      await act(async () => {
        await storyContext.updateChapter('chapter-01', { title: 'Renamed' });
      });

      expect(mockUpdateData).toHaveBeenCalledWith('chapter-01', expect.objectContaining({ title: 'Renamed', modifiedBy: 'test-user' }));
      expect(mockFirebaseServices.document.batchOperations).not.toHaveBeenCalled();
    });

    test('a save in flight is not loading (T044)', async () => {
      // `isLoading` feeds `usePageGate` on every story page. It used to fold
      // in a write-in-flight flag, so pressing Save on `ChapterEditPage`
      // re-entered `resolving` and `GatedContent` swapped the form for its
      // skeleton until the write returned. Loading means "there is nothing to
      // show yet"; a write behind content already on screen is neither.
      let finishWrite: () => void = () => {};
      mockUpdateData.mockReturnValue(
        new Promise<void>((resolve) => { finishWrite = resolve; })
      );
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      let save: Promise<void> = Promise.resolve();
      act(() => {
        save = storyContext.updateChapter('chapter-01', { title: 'Updated' });
      });

      // `updateChapter` refreshes before it writes, so wait until the write
      // itself is pending.
      await waitFor(() => expect(mockUpdateData).toHaveBeenCalled());
      expect(storyContext.isLoading).toBe(false);

      await act(async () => {
        finishWrite();
        await save;
      });
    });

    test('should reject update for non-existent chapter', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: Should reject update for non-existent chapter
      await expect(storyContext.updateChapter('non-existent', { title: 'Updated' })).rejects.toThrow(
        'Chapter not found'
      );

      expect(mockUpdateData).not.toHaveBeenCalled();
    });

    test('should handle complex chapter reordering', async () => {
      const multipleChapters = [
        { id: 'chapter-01', title: 'Chapter 1', content: 'First chapter', order: 1, createdBy: 'test-user', createdByUsername: 'Test User', dateAdded: '2025-06-15T00:00:00.000Z' },
        { id: 'chapter-02', title: 'Chapter 2', content: 'Second chapter', order: 2, createdBy: 'test-user', createdByUsername: 'Test User', dateAdded: '2025-06-15T00:00:00.000Z' },
        { id: 'chapter-03', title: 'Chapter 3', content: 'Third chapter', order: 3, createdBy: 'test-user', createdByUsername: 'Test User', dateAdded: '2025-06-15T00:00:00.000Z' }
      ];

      mockUseChapterData.mockReturnValue({
        chapters: multipleChapters,
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });

      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // Move chapter 1 to position 3
      await act(async () => {
        await storyContext.updateChapter('chapter-01', { order: 3 });
      });

      // BEHAVIOR: every chapter lands in its new place, under the id it
      // already had. Rewritten for T032: ids used to encode order, so this
      // asserted the rotation of documents between ids; now nothing changes
      // id and the outcome is read straight off the orders.
      expect(movesIn(committedBatch())).toEqual({
        'chapter-01': 3,
        'chapter-02': 1,
        'chapter-03': 2
      });
      expect(mockDeleteData).not.toHaveBeenCalled();
      // The listener carries the write (T032): nothing re-reads the collection.
      expect(mockRefreshChapters).not.toHaveBeenCalled();
    });

    test('should not delete any chapter when a reorder write fails partway (bug #017)', async () => {
      // Regression test for the atomicity half of bug #017.
      //
      // updateChapter's reorder path once deleted every affected chapter and
      // only then recreated them, so a failure partway lost chapters for good.
      // Since T032 a move is one batch: Firestore applies all of it or none of
      // it. What this pins: when the commit fails, it is the only write that
      // was attempted -- nothing was deleted or written on the side.
      const multipleChapters = [
        { id: 'chapter-01', title: 'Chapter 1', content: 'First', order: 1, createdBy: 'test-user', createdByUsername: 'Test User', dateAdded: '2025-06-15T00:00:00.000Z' },
        { id: 'chapter-02', title: 'Chapter 2', content: 'Second', order: 2, createdBy: 'test-user', createdByUsername: 'Test User', dateAdded: '2025-06-15T00:00:00.000Z' },
        { id: 'chapter-03', title: 'Chapter 3', content: 'Third', order: 3, createdBy: 'test-user', createdByUsername: 'Test User', dateAdded: '2025-06-15T00:00:00.000Z' }
      ];

      mockUseChapterData.mockReturnValue({
        chapters: multipleChapters,
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });

      mockFirebaseServices.document.batchOperations.mockRejectedValue(new Error('Firestore write failed'));

      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      await act(async () => {
        await expect(
          storyContext.updateChapter('chapter-01', { order: 3 })
        ).rejects.toThrow('Firestore write failed');
      });

      expect(mockFirebaseServices.document.batchOperations).toHaveBeenCalledTimes(1);
      expect(mockDeleteData).not.toHaveBeenCalled();
      expect(mockUpdateData).not.toHaveBeenCalled();
      expect(mockFirebaseServices.document.setDocument).not.toHaveBeenCalled();
    });
  });

  describe('Structural changes are one batch (T032, PERF-05)', () => {
    const chapterAt = (order: number) => ({
      id: `chapter-${order}`,
      title: `Chapter ${order}`,
      content: 'Text',
      order,
      createdBy: 'test-user',
      createdByUsername: 'Test User',
      dateAdded: '2025-06-15T00:00:00.000Z'
    });

    const withChapters = (chapters: ReturnType<typeof chapterAt>[]) => {
      mockUseAuth.mockReturnValue({ user: { uid: 'test-user' } });
      mockUseChapterData.mockReturnValue({
        chapters,
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });
    };

    test('inserting at the front of 32 chapters is one commit, not ~100 serial operations', async () => {
      withChapters(Array.from({ length: 32 }, (_, index) => chapterAt(index + 1)));
      renderStoryContext();
      await waitFor(() => expect(storyContext).toBeDefined());

      await act(async () => {
        await storyContext.createChapter({ title: 'Prologue', content: 'Before it all', order: 1 });
      });

      const batch = committedBatch();
      // 32 moves, the new chapter, and its text's own document (T134).
      expect(batch).toHaveLength(34);
      expect(movesIn(batch)['chapter-32']).toBe(33);
      expect(mockFirebaseServices.document.getDocument).not.toHaveBeenCalled();
      expect(mockFirebaseServices.document.setDocument).not.toHaveBeenCalled();
      expect(mockDeleteData).not.toHaveBeenCalled();
    });

    test('a change that would rewrite more than 500 chapters is refused whole, before anything is written', async () => {
      withChapters(Array.from({ length: 500 }, (_, index) => chapterAt(index + 1)));
      renderStoryContext();
      await waitFor(() => expect(storyContext).toBeDefined());

      await act(async () => {
        await expect(
          storyContext.createChapter({ title: 'Prologue', content: 'Before it all', order: 1 })
        ).rejects.toThrow('one change can rewrite at most 500');
      });

      expect(mockFirebaseServices.document.batchOperations).not.toHaveBeenCalled();
    });

    test('renumbering closes gaps by moving only the chapters out of place', async () => {
      withChapters([chapterAt(1), chapterAt(3), chapterAt(7)]);
      renderStoryContext();
      await waitFor(() => expect(storyContext).toBeDefined());

      await act(async () => {
        await storyContext.reorderChapters();
      });

      expect(movesIn(committedBatch())).toEqual({ 'chapter-3': 2, 'chapter-7': 3 });
    });

    // T017: deleting several chapters at once.
    test('deleting several chapters is one commit that closes every gap', async () => {
      withChapters(Array.from({ length: 5 }, (_, index) => chapterAt(index + 1)));
      renderStoryContext();
      await waitFor(() => expect(storyContext).toBeDefined());

      await act(async () => {
        await storyContext.deleteChapters(['chapter-2', 'chapter-4']);
      });

      expect(mockFirebaseServices.document.batchOperations).toHaveBeenCalledTimes(1);
      const batch = committedBatch();
      // Each with its text's own document (T134), in the same commit.
      expect(batch.filter((write) => write.type === 'delete').map((write) => `${write.collection}/${write.id}`))
        .toEqual([
          `${CHAPTERS}/chapter-2/body/text`, `${CHAPTERS}/chapter-2`,
          `${CHAPTERS}/chapter-4/body/text`, `${CHAPTERS}/chapter-4`,
        ]);
      expect(movesIn(batch)).toEqual({ 'chapter-3': 2, 'chapter-5': 3 });
    });

    test('deleting several chapters skips one already gone from the list', async () => {
      withChapters([chapterAt(1), chapterAt(2), chapterAt(3)]);
      renderStoryContext();
      await waitFor(() => expect(storyContext).toBeDefined());

      await act(async () => {
        await storyContext.deleteChapters(['chapter-1', 'chapter-99']);
      });

      const batch = committedBatch();
      expect(batch.filter((write) => write.type === 'delete' && write.collection === CHAPTERS).map((write) => write.id))
        .toEqual(['chapter-1']);
      expect(movesIn(batch)).toEqual({ 'chapter-2': 1, 'chapter-3': 2 });
    });

    test('deleting several chapters refuses a signed-out caller, writing nothing', async () => {
      withChapters([chapterAt(1), chapterAt(2)]);
      mockUseAuth.mockReturnValue({ user: null });
      renderStoryContext();
      await waitFor(() => expect(storyContext).toBeDefined());

      await expect(storyContext.deleteChapters(['chapter-1'])).rejects.toThrow('You must be signed in to delete chapters');
      expect(mockFirebaseServices.document.batchOperations).not.toHaveBeenCalled();
    });
  });

  // T088 (DATA-007): two people inserting at once both write the same order
  // -- concurrent inserts gave 1, 2, 3, 3. A shared order is made harmless
  // rather than prevented: readers see chapters numbered by place, with a
  // fixed tiebreak, and every structural change rewrites whatever is out of
  // place, so the duplicate is gone after the next one.
  describe('A shared order is harmless, and the next change heals it (T088)', () => {
    const at = (id: string, order: number, dateAdded = '2026-01-01T00:00:00.000Z') => ({
      id, title: id, content: 'Text', order, createdBy: 'test-user', createdByUsername: 'Test User', dateAdded,
    });
    // `d` and `c` share order 3; `c` was written first. Listed out of order,
    // as a listener may deliver them.
    const STORED = [
      at('a', 1),
      at('d', 3, '2026-02-01T00:00:00.000Z'),
      at('b', 2),
      at('c', 3, '2026-01-15T00:00:00.000Z'),
    ];

    const withStored = async () => {
      mockUseAuth.mockReturnValue({ user: { uid: 'test-user' } });
      mockUseChapterData.mockReturnValue({
        chapters: STORED,
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });
      renderStoryContext();
      await waitFor(() => expect(storyContext).toBeDefined());
    };

    test('readers see every chapter numbered by its place, the one written first first', async () => {
      await withStored();

      expect(storyContext.chapters.map((c: Chapter) => [c.id, c.order])).toEqual([
        ['a', 1], ['b', 2], ['c', 3], ['d', 4],
      ]);
      expect(storyContext.getChapterById('d').order).toBe(4);
    });

    test('adding a chapter at the end puts it after all four, and heals the shared order', async () => {
      await withStored();
      await act(async () => {
        await storyContext.createChapter({ title: 'New', content: 'Text' });
      });

      const batch = committedBatch();
      expect(movesIn(batch)).toEqual({ d: 4 });
      expect(batch.find((write) => write.type === 'set')?.data.order).toBe(5);
    });

    test('inserting at a place moves everything after it on, by place', async () => {
      await withStored();
      await act(async () => {
        await storyContext.createChapter({ title: 'New', content: 'Text', order: 2 });
      });

      const batch = committedBatch();
      expect(movesIn(batch)).toEqual({ b: 3, c: 4, d: 5 });
      expect(batch.find((write) => write.type === 'set')?.data.order).toBe(2);
    });

    test('deleting closes the gap and heals the shared order', async () => {
      await withStored();
      await act(async () => {
        await storyContext.deleteChapter('b');
      });

      // `d` stores 3 and is now third: already in place, so not written.
      expect(movesIn(committedBatch())).toEqual({ c: 2 });
    });

    test('moving the last chapter to the front renumbers every other one by place', async () => {
      await withStored();
      await act(async () => {
        await storyContext.updateChapter('d', { order: 1 });
      });

      expect(movesIn(committedBatch())).toEqual({ d: 1, a: 2, b: 3, c: 4 });
    });

    test('moving a chapter to the place it already shows writes no other chapter', async () => {
      await withStored();
      await act(async () => {
        await storyContext.updateChapter('d', { order: 4, title: 'Renamed' });
      });

      expect(mockFirebaseServices.document.batchOperations).not.toHaveBeenCalled();
      expect(mockUpdateData).toHaveBeenCalledWith('d', expect.objectContaining({ title: 'Renamed' }));
    });

    test('renumbering writes only the chapters out of place', async () => {
      await withStored();
      await act(async () => {
        await storyContext.reorderChapters();
      });

      expect(movesIn(committedBatch())).toEqual({ d: 4 });
    });
  });

  describe('Chapter Deletion Behavior', () => {
    beforeEach(() => {
      const mockChapters = [
        {
          id: 'chapter-01',
          title: 'Chapter 1',
          content: 'First chapter',
          order: 1,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        },
        {
          id: 'chapter-02',
          title: 'Chapter 2',
          content: 'Second chapter',
          order: 2,
          createdBy: 'test-user',
          createdByUsername: 'Test User',
          dateAdded: '2025-06-15T00:00:00.000Z'
        }
      ];

      // Setup authenticated state with context
      mockUseAuth.mockReturnValue({
        user: { uid: 'test-user' },
      });

      mockUseChapterData.mockReturnValue({
        chapters: mockChapters,
        loading: false,
        error: null,
        refreshChapters: mockRefreshChapters,
        hasRequiredContext: true,
      });

      mockDeleteData.mockResolvedValue(undefined);
      mockFirebaseServices.document.setDocument.mockResolvedValue(undefined);
      mockFirebaseServices.document.getDocument.mockResolvedValue({});
    });

    test('should delete chapter successfully with reordering', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      await act(async () => {
        await storyContext.deleteChapter('chapter-01');
      });

      // BEHAVIOR: one batch deletes the chapter -- and since T134 its text's
      // own document, which would outlive it -- and moves the later one back
      // into its place, keeping its id.
      expect(committedBatch()).toEqual([
        { type: 'delete', collection: 'groups/group-1/campaigns/campaign-1/chapters/chapter-01/body', id: 'text' },
        { type: 'delete', collection: 'groups/group-1/campaigns/campaign-1/chapters', id: 'chapter-01' },
        { type: 'update', collection: 'groups/group-1/campaigns/campaign-1/chapters', id: 'chapter-02', data: { order: 1 } }
      ]);
      // The listener carries the write (T032): nothing re-reads the collection.
      expect(mockRefreshChapters).not.toHaveBeenCalled();
    });

    test('should reject deletion for non-existent chapter', async () => {
      renderStoryContext();

      await waitFor(() => {
        expect(storyContext).toBeDefined();
      });

      // BEHAVIOR: Should reject deletion for non-existent chapter
      await expect(storyContext.deleteChapter('non-existent')).rejects.toThrow(
        'Chapter not found'
      );

      expect(mockDeleteData).not.toHaveBeenCalled();
    });
  });

  describe('useStory Hook Behavior', () => {
    test('should throw error when used outside StoryProvider', () => {
      // Create a test component that uses the hook outside of provider
      const TestComponent = () => {
        useStory();
        return <div>Test</div>;
      };

      // BEHAVIOR: Should throw error when used outside provider
      expect(() => render(<TestComponent />)).toThrow(
        'useStory must be used within a StoryProvider'
      );
    });
  });
});