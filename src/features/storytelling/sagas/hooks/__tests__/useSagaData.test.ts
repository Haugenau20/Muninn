// src/features/storytelling/sagas/hooks/__tests__/useSagaData.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSagaData } from '../useSagaData';
import { SagaData, SagaContentInput } from 'features/storytelling/sagas/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGetDocument = jest.fn();
const mockSetDocument = jest.fn();
const mockUpdateDocument = jest.fn();

jest.mock('@/features/user-management', () => ({
  useFirestore: jest.fn(),
  useAuth: jest.fn(),
  useUser: jest.fn(),
  useGroups: jest.fn(),
  useCampaigns: jest.fn(),
}));

const { useFirestore, useAuth, useUser, useGroups, useCampaigns } = require('@/features/user-management');

// Mock user utilities so attribution can be verified against EXPECTED values
// (specification-based mocking).
// `core/attribution` (used by the production code) is NOT mocked: it is exercised
// for real, using these mocked utilities as its dependency boundary.
jest.mock('core/utils/user-utils', () => ({
  getUserName: jest.fn(),
  getActiveCharacterName: jest.fn(),
}));

const { getUserName, getActiveCharacterName } = require('core/utils/user-utils');

/** A realistic `activeGroupUserProfile`, matching `GroupUserProfile` from `types/user.ts`. */
const defaultProfile = {
  userId: 'user-1',
  username: 'GroupUsername',
  role: 'member' as const,
  joinedAt: '2025-01-01T00:00:00.000Z',
  activeCharacterId: 'char-1',
  characters: [{ id: 'char-1', name: 'Aria' }],
};

/** A fully persisted saga document — used to simulate `getDocument`'s return value. */
const makeSaga = (overrides: Partial<SagaData> = {}): SagaData => ({
  title: 'The Great Saga',
  content: 'Long ago in a land of dragons...',
  lastUpdated: '2025-06-01T00:00:00.000Z',
  version: '1.0.0',
  createdBy: 'user-1',
  createdByUsername: 'TestUser',
  dateAdded: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

/** The content-only shape a caller (e.g. SagaEditPage) supplies to saveSaga/updateSaga. */
const makeSagaInput = (overrides: Partial<SagaContentInput> = {}): SagaContentInput => ({
  title: 'The Great Saga',
  content: 'Long ago in a land of dragons...',
  lastUpdated: '2025-06-01T00:00:00.000Z',
  version: '1.0.0',
  ...overrides,
});

const setupFirestoreMock = () => {
  (useFirestore as jest.Mock).mockReturnValue({
    getDocument: mockGetDocument,
    setDocument: mockSetDocument,
    updateDocument: mockUpdateDocument,
  });
};

const setupContextMocks = (
  groupId: string | null = 'group-1',
  campaignId: string | null = 'campaign-1',
  user: unknown = { uid: 'user-1' },
  activeGroupUserProfile: unknown = defaultProfile
) => {
  (useAuth as jest.Mock).mockReturnValue({ user });
  (useUser as jest.Mock).mockReturnValue({ activeGroupUserProfile });
  (useGroups as jest.Mock).mockReturnValue({ activeGroupId: groupId });
  (useCampaigns as jest.Mock).mockReturnValue({ activeCampaignId: campaignId });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useSagaData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFirestoreMock();
    setupContextMocks();
    getUserName.mockReturnValue('GroupUsername');
    getActiveCharacterName.mockReturnValue('Aria');
    mockGetDocument.mockResolvedValue(null);
    mockSetDocument.mockResolvedValue(undefined);
    mockUpdateDocument.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------
  describe('return shape', () => {
    test('should expose all required properties', async () => {
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current).toHaveProperty('saga');
      expect(result.current).toHaveProperty('loading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('fetchSaga');
      expect(result.current).toHaveProperty('saveSaga');
      expect(result.current).toHaveProperty('updateSaga');
      expect(result.current).toHaveProperty('hasRequiredContext');
    });

    test('should start with null saga', async () => {
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.saga).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // hasRequiredContext
  // -------------------------------------------------------------------------
  describe('hasRequiredContext', () => {
    test('should be true when both groupId and campaignId are present', async () => {
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasRequiredContext).toBe(true);
    });

    test('should be false when groupId is null', async () => {
      setupContextMocks(null, 'campaign-1');
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasRequiredContext).toBe(false);
    });

    test('should be false when campaignId is null', async () => {
      setupContextMocks('group-1', null);
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasRequiredContext).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // fetchSaga
  // -------------------------------------------------------------------------
  describe('fetchSaga', () => {
    test('should return null and not fetch when no activeGroupId', async () => {
      setupContextMocks(null, 'campaign-1');
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.saga).toBeNull();
      expect(mockGetDocument).not.toHaveBeenCalled();
    });

    test('should return null and not fetch when no activeCampaignId', async () => {
      setupContextMocks('group-1', null);
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.saga).toBeNull();
      expect(mockGetDocument).not.toHaveBeenCalled();
    });

    test('should fetch saga from correct document path', async () => {
      const saga = makeSaga();
      mockGetDocument.mockResolvedValue(saga);

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockGetDocument).toHaveBeenCalledWith('groups/group-1/campaigns/campaign-1/saga', 'sagaData');
    });

    test('should set saga state after successful fetch', async () => {
      const saga = makeSaga({ title: 'Epic Adventure' });
      mockGetDocument.mockResolvedValue(saga);

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.saga).toEqual(saga);
    });

    test('should handle fetch errors gracefully', async () => {
      mockGetDocument.mockRejectedValue(new Error('Firestore error'));

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error).toBe('Failed to load saga data');
      expect(result.current.saga).toBeNull();
    });

    test('should return saga from manual fetchSaga call', async () => {
      const saga = makeSaga({ title: 'Manual Fetch Saga' });
      mockGetDocument.mockResolvedValue(saga);

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let fetchedSaga: SagaData | null = null;
      await act(async () => {
        fetchedSaga = await result.current.fetchSaga();
      });

      expect(fetchedSaga).toEqual(saga);
    });
  });

  // -------------------------------------------------------------------------
  // saveSaga
  // -------------------------------------------------------------------------
  describe('saveSaga', () => {
    test('should call setDocument with the domain fields plus computed attribution', async () => {
      mockGetDocument.mockResolvedValue(null);
      const input = makeSagaInput({ title: 'New Saga' });

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.saveSaga(input);
      });

      expect(mockSetDocument).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/saga',
        'sagaData',
        expect.objectContaining({
          title: 'New Saga',
          content: input.content,
          lastUpdated: input.lastUpdated,
          version: input.version,
          createdBy: 'user-1',
          createdByUsername: 'GroupUsername',
        })
      );
    });

    test('should update saga state after successful save', async () => {
      mockGetDocument.mockResolvedValue(null);
      const input = makeSagaInput({ title: 'Saved Saga' });

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.saveSaga(input);
      });

      expect(result.current.saga).toEqual(
        expect.objectContaining({ title: 'Saved Saga', createdBy: 'user-1' })
      );
    });

    test('should return true on successful save', async () => {
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let saveResult: boolean = false;
      await act(async () => {
        saveResult = await result.current.saveSaga(makeSagaInput());
      });

      expect(saveResult).toBe(true);
    });

    test('should return false when no activeGroupId', async () => {
      setupContextMocks(null, 'campaign-1');
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let saveResult: boolean = true;
      await act(async () => {
        saveResult = await result.current.saveSaga(makeSagaInput());
      });

      expect(saveResult).toBe(false);
    });

    test('should return false when no activeCampaignId', async () => {
      setupContextMocks('group-1', null);
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let saveResult: boolean = true;
      await act(async () => {
        saveResult = await result.current.saveSaga(makeSagaInput());
      });

      expect(saveResult).toBe(false);
    });

    test('should return false when user is not authenticated', async () => {
      setupContextMocks('group-1', 'campaign-1', null);
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let saveResult: boolean = true;
      await act(async () => {
        saveResult = await result.current.saveSaga(makeSagaInput());
      });

      expect(saveResult).toBe(false);
      expect(mockSetDocument).not.toHaveBeenCalled();
    });

    test('should return false when setDocument throws', async () => {
      mockSetDocument.mockRejectedValue(new Error('Write failed'));

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let saveResult: boolean = true;
      await act(async () => {
        saveResult = await result.current.saveSaga(makeSagaInput());
      });

      expect(saveResult).toBe(false);
      expect(result.current.error).toBe('Failed to save saga data');
    });
  });

  // -------------------------------------------------------------------------
  // saveSaga — attribution (bug #1203)
  //
  // Sagas are a singleton, upserted document: `saveSaga` is the ONLY write path
  // and must decide for itself whether this is a creation or a modification —
  // no page or component may supply `created*` / `modified*` fields (bug #1203).
  // -------------------------------------------------------------------------
  describe('saveSaga — attribution', () => {
    test('writes creation attribution (including character fields) on the first save of a new saga', async () => {
      mockGetDocument.mockResolvedValue(null); // no saga exists yet
      setupContextMocks('group-1', 'campaign-1', { uid: 'user-2' });
      getUserName.mockReturnValue('GroupHero');
      getActiveCharacterName.mockReturnValue('Aria');

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.saveSaga(makeSagaInput({ title: 'Brand New Saga' }));
      });

      expect(mockSetDocument).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/saga',
        'sagaData',
        expect.objectContaining({
          createdBy: 'user-2',
          createdByUsername: 'GroupHero',
          createdByCharacterId: 'char-1',
          createdByCharacterName: 'Aria',
        })
      );
    });

    test('preserves the original creator and creation date on a subsequent save by a different user', async () => {
      const originalSaga = makeSaga({
        createdBy: 'user-original',
        createdByUsername: 'OriginalAuthor',
        createdByCharacterId: 'char-orig',
        createdByCharacterName: 'Original Character',
        dateAdded: '2024-01-01T00:00:00.000Z',
      });
      mockGetDocument.mockResolvedValue(originalSaga);
      setupContextMocks('group-1', 'campaign-1', { uid: 'user-editor' });
      getUserName.mockReturnValue('EditorName');
      getActiveCharacterName.mockReturnValue('Editor Character');

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.saga).toEqual(originalSaga));

      await act(async () => {
        await result.current.saveSaga(
          makeSagaInput({ title: 'Updated Title', content: 'Updated content' })
        );
      });

      expect(mockSetDocument).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/saga',
        'sagaData',
        expect.objectContaining({
          createdBy: 'user-original',
          createdByUsername: 'OriginalAuthor',
          createdByCharacterId: 'char-orig',
          createdByCharacterName: 'Original Character',
          dateAdded: '2024-01-01T00:00:00.000Z',
        })
      );
    });

    test('writes modification attribution on a subsequent save', async () => {
      const originalSaga = makeSaga({
        createdBy: 'user-original',
        createdByUsername: 'OriginalAuthor',
        dateAdded: '2024-01-01T00:00:00.000Z',
      });
      mockGetDocument.mockResolvedValue(originalSaga);
      setupContextMocks('group-1', 'campaign-1', { uid: 'user-editor' });
      getUserName.mockReturnValue('EditorName');
      getActiveCharacterName.mockReturnValue('Editor Character');

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.saga).toEqual(originalSaga));

      await act(async () => {
        await result.current.saveSaga(makeSagaInput({ title: 'Updated Title' }));
      });

      expect(mockSetDocument).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/saga',
        'sagaData',
        expect.objectContaining({
          modifiedBy: 'user-editor',
          modifiedByUsername: 'EditorName',
          modifiedByCharacterId: 'char-1',
          modifiedByCharacterName: 'Editor Character',
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // saveSaga — stale cache guard (bug #1203, narrower reopening)
  //
  // `fetchSaga` can leave `saga` state at `null` even though a document exists
  // in Firestore (e.g. the initial read failed or returned nothing transiently).
  // `saveSaga` must not trust that cached state alone to decide create-vs-modify:
  // guessing "no saga" when one actually exists would overwrite the real
  // creator/creation date — the exact loss bug #1203 describes, through a
  // narrower door.
  // -------------------------------------------------------------------------
  describe('saveSaga — stale cache guard', () => {
    test('confirms against Firestore before treating a save as creation when cached state is null', async () => {
      const existingSaga = makeSaga({
        createdBy: 'user-A',
        createdByUsername: 'AuthorA',
        dateAdded: '2024-01-01T00:00:00.000Z',
      });

      // First call: the initial `fetchSaga` on mount — simulates a transient
      // read failure/empty result that leaves `saga` state at null.
      // Second call: saveSaga's own confirmation read, which finds the real document.
      mockGetDocument
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingSaga);

      setupContextMocks('group-1', 'campaign-1', { uid: 'user-B' });
      getUserName.mockReturnValue('EditorB');
      getActiveCharacterName.mockReturnValue('Editor Character B');

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));
      // Cached state is stale/empty, exactly as in the bug.
      expect(result.current.saga).toBeNull();

      await act(async () => {
        await result.current.saveSaga(makeSagaInput({ title: 'Updated Title' }));
      });

      expect(mockGetDocument).toHaveBeenCalledTimes(2);
      expect(mockSetDocument).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/saga',
        'sagaData',
        expect.objectContaining({
          createdBy: 'user-A',
          createdByUsername: 'AuthorA',
          dateAdded: '2024-01-01T00:00:00.000Z',
          modifiedBy: 'user-B',
          modifiedByUsername: 'EditorB',
        })
      );
    });

    test('does not re-confirm against Firestore when cached saga state already has createdBy', async () => {
      const existingSaga = makeSaga({
        createdBy: 'user-A',
        dateAdded: '2024-01-01T00:00:00.000Z',
      });
      mockGetDocument.mockResolvedValue(existingSaga);

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.saga).toEqual(existingSaga));

      mockGetDocument.mockClear();

      await act(async () => {
        await result.current.saveSaga(makeSagaInput({ title: 'Another Title' }));
      });

      expect(mockGetDocument).not.toHaveBeenCalled();
    });

    test('writes full creation attribution when there is genuinely no existing document', async () => {
      // Both the initial fetch and saveSaga's own confirmation read resolve null.
      mockGetDocument.mockResolvedValue(null);
      setupContextMocks('group-1', 'campaign-1', { uid: 'user-new' });
      getUserName.mockReturnValue('NewAuthor');
      getActiveCharacterName.mockReturnValue('New Character');

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.saga).toBeNull();

      await act(async () => {
        await result.current.saveSaga(makeSagaInput({ title: 'First Ever Saga' }));
      });

      expect(mockGetDocument).toHaveBeenCalledTimes(2);
      expect(mockSetDocument).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/saga',
        'sagaData',
        expect.objectContaining({
          createdBy: 'user-new',
          createdByUsername: 'NewAuthor',
          modifiedBy: 'user-new',
          modifiedByUsername: 'NewAuthor',
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateSaga
  // -------------------------------------------------------------------------
  describe('updateSaga', () => {
    test('should call updateDocument with the updates plus computed modification attribution', async () => {
      mockGetDocument.mockResolvedValue(makeSaga({ title: 'Old Title' }));

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const updates = { title: 'New Title' };

      await act(async () => {
        await result.current.updateSaga(updates);
      });

      expect(mockUpdateDocument).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/saga',
        'sagaData',
        expect.objectContaining({
          title: 'New Title',
          modifiedBy: 'user-1',
          modifiedByUsername: 'GroupUsername',
        })
      );
    });

    test('should merge updates into existing saga state', async () => {
      const initialSaga = makeSaga({ title: 'Original Title' });
      mockGetDocument.mockResolvedValue(initialSaga);

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.saga?.title).toBe('Original Title'));

      await act(async () => {
        await result.current.updateSaga({ title: 'Updated Title' });
      });

      expect(result.current.saga?.title).toBe('Updated Title');
      // Other fields should be unchanged
      expect(result.current.saga?.content).toBe(initialSaga.content);
    });

    test('should return true on successful update', async () => {
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let updateResult: boolean = false;
      await act(async () => {
        updateResult = await result.current.updateSaga({ title: 'New Title' });
      });

      expect(updateResult).toBe(true);
    });

    test('should return false when no activeGroupId', async () => {
      setupContextMocks(null, 'campaign-1');
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let updateResult: boolean = true;
      await act(async () => {
        updateResult = await result.current.updateSaga({ title: 'New' });
      });

      expect(updateResult).toBe(false);
    });

    test('should return false when no activeCampaignId', async () => {
      setupContextMocks('group-1', null);
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let updateResult: boolean = true;
      await act(async () => {
        updateResult = await result.current.updateSaga({ title: 'New' });
      });

      expect(updateResult).toBe(false);
    });

    test('should return false when user is not authenticated', async () => {
      setupContextMocks('group-1', 'campaign-1', null);
      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let updateResult: boolean = true;
      await act(async () => {
        updateResult = await result.current.updateSaga({ title: 'New' });
      });

      expect(updateResult).toBe(false);
      expect(mockUpdateDocument).not.toHaveBeenCalled();
    });

    test('should return false and set error when updateDocument throws', async () => {
      mockUpdateDocument.mockRejectedValue(new Error('Update failed'));

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let updateResult: boolean = true;
      await act(async () => {
        updateResult = await result.current.updateSaga({ title: 'New' });
      });

      expect(updateResult).toBe(false);
      expect(result.current.error).toBe('Failed to update saga data');
    });
  });

  // -------------------------------------------------------------------------
  // updateSaga — attribution (bug #1203)
  // -------------------------------------------------------------------------
  describe('updateSaga — attribution', () => {
    test('writes modification attribution and never touches created* fields', async () => {
      const originalSaga = makeSaga({
        createdBy: 'user-original',
        createdByUsername: 'OriginalAuthor',
        dateAdded: '2024-01-01T00:00:00.000Z',
      });
      mockGetDocument.mockResolvedValue(originalSaga);
      setupContextMocks('group-1', 'campaign-1', { uid: 'user-editor' });
      getUserName.mockReturnValue('EditorName');
      getActiveCharacterName.mockReturnValue('Editor Character');

      const { result } = renderHook(() => useSagaData());
      await waitFor(() => expect(result.current.saga).toEqual(originalSaga));

      await act(async () => {
        await result.current.updateSaga({ title: 'New Title' });
      });

      expect(mockUpdateDocument).toHaveBeenCalledWith(
        'groups/group-1/campaigns/campaign-1/saga',
        'sagaData',
        expect.objectContaining({
          title: 'New Title',
          modifiedBy: 'user-editor',
          modifiedByUsername: 'EditorName',
          modifiedByCharacterId: 'char-1',
          modifiedByCharacterName: 'Editor Character',
        })
      );

      const [, , calledWith] = mockUpdateDocument.mock.calls[0];
      expect(calledWith).not.toHaveProperty('createdBy');
      expect(calledWith).not.toHaveProperty('createdByUsername');
      expect(calledWith).not.toHaveProperty('dateAdded');
    });
  });
});
