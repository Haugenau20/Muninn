// src/features/campaign-entities/npcs/context/__tests__/NPCContext.batch.test.tsx

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { NPCProvider, useNPCs } from 'features/campaign-entities/npcs/context/NPCContext';

/**
 * T017: the NPC directory's batch actions. Each is ONE batched write for the
 * whole selection -- never a loop over the single-record methods, which would
 * be a round trip per NPC and could leave half the selection changed.
 */

const mockBatchOperations = jest.fn();
const mockUpdateData = jest.fn();
const mockDeleteData = jest.fn();
const mockRemoveImage = jest.fn();
const mockRecordReleased = jest.fn();
const mockClearReleased = jest.fn();
let mockNpcs: any[] = [];
let mockHasRequiredContext = true;

// Notes are documents of their own (T133); see the mock.
jest.mock('features/campaign-entities/shared/recordNotes', () => require('@/test-utils/record-notes-mock').recordNotesMock());

jest.mock('features/user-management', () => ({
  // The provider's writes name the active group and campaign by full path (T082).
  useGroups: () => ({ activeGroupId: 'group-1' }),
  useCampaigns: () => ({ activeCampaignId: 'campaign-1' }),
  useAuth: () => ({ user: { uid: 'user-1' } }),
  useUser: () => ({
    userProfile: { username: 'Frodo' },
    activeGroupUserProfile: { username: 'Frodo', activeCharacterId: null },
  }),
}));

jest.mock('features/campaign-entities/npcs/hooks/useNPCData', () => ({
  useNPCData: () => ({
    npcs: mockNpcs,
    loading: false,
    error: null,
    refreshNPCs: jest.fn(),
    hasRequiredContext: mockHasRequiredContext,
  }),
}));

jest.mock('shared/hooks/useFirebaseData', () => ({
  useFirebaseData: () => ({
    addData: jest.fn(),
    updateData: mockUpdateData,
    deleteData: mockDeleteData,
    error: null,
  }),
}));

jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: { document: { batchOperations: (ops: unknown) => mockBatchOperations(ops) } },
  images: {
    remove: (path: string) => mockRemoveImage(path),
    recordReleasedImage: (path: string) => mockRecordReleased(path),
    clearReleasedImage: (path: string) => mockClearReleased(path),
  },
}));

const portrait = {
  path: 'groups/g1/campaigns/c1/npcs/n1/p.webp',
  url: 'https://example/p',
  width: 1,
  height: 1,
  uploadedBy: 'user-1',
  uploadedAt: '2026-09-24T12:00:00.000Z',
};

let context: ReturnType<typeof useNPCs>;
const Probe = () => {
  context = useNPCs();
  return null;
};

async function renderContext() {
  render(
    <NPCProvider>
      <Probe />
    </NPCProvider>
  );
  await waitFor(() => expect(context).toBeDefined());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasRequiredContext = true;
  mockNpcs = [
    { id: 'n1', name: 'Bilbo', status: 'alive', image: portrait },
    { id: 'n2', name: 'Frodo', status: 'alive' },
    { id: 'n3', name: 'Sam', status: 'missing' },
  ];
  mockBatchOperations.mockResolvedValue(undefined);
  mockRemoveImage.mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('NPCContext.updateNPCsStatus', () => {
  it('sets the status of every selected NPC in one batch, attributed to the writer', async () => {
    await renderContext();

    await act(async () => {
      await context.updateNPCsStatus(['n1', 'n3'], 'deceased');
    });

    expect(mockBatchOperations).toHaveBeenCalledTimes(1);
    const writes = mockBatchOperations.mock.calls[0][0];
    expect(writes.map((w: any) => [w.type, w.collection, w.id, w.data.status])).toEqual([
      ['update', 'groups/group-1/campaigns/campaign-1/npcs', 'n1', 'deceased'],
      ['update', 'groups/group-1/campaigns/campaign-1/npcs', 'n3', 'deceased'],
    ]);
    for (const write of writes) {
      expect(write.data.modifiedBy).toBe('user-1');
      // The server's clock only (T132).
      expect(write.data.modifiedAt).toBeDefined();
      expect(write.data).not.toHaveProperty('dateModified');
    }
    expect(mockUpdateData).not.toHaveBeenCalled();
  });

  it('writes nothing when any selected NPC is unknown', async () => {
    await renderContext();

    await expect(context.updateNPCsStatus(['n1', 'gone'], 'deceased')).rejects.toThrow(
      'One or more NPCs not found'
    );
    expect(mockBatchOperations).not.toHaveBeenCalled();
  });

  it('refuses without a group and campaign', async () => {
    mockHasRequiredContext = false;
    await renderContext();

    await expect(context.updateNPCsStatus(['n1'], 'deceased')).rejects.toThrow(
      'No group or campaign selected'
    );
    expect(mockBatchOperations).not.toHaveBeenCalled();
  });
});

describe('NPCContext.deleteNPCs', () => {
  it('deletes every selected NPC in one batch', async () => {
    await renderContext();

    await act(async () => {
      await context.deleteNPCs(['n1', 'n2']);
    });

    expect(mockBatchOperations).toHaveBeenCalledTimes(1);
    expect(mockBatchOperations).toHaveBeenCalledWith([
      { type: 'delete', id: 'n1', collection: 'groups/group-1/campaigns/campaign-1/npcs' },
      { type: 'delete', id: 'n2', collection: 'groups/group-1/campaigns/campaign-1/npcs' },
    ]);
    expect(mockDeleteData).not.toHaveBeenCalled();
  });

  it('removes the deleted NPCs\' portraits, after the documents', async () => {
    await renderContext();

    await act(async () => {
      await context.deleteNPCs(['n1', 'n2']);
    });

    await waitFor(() => expect(mockRemoveImage).toHaveBeenCalledWith(portrait.path));
    expect(mockRemoveImage).toHaveBeenCalledTimes(1);
    expect(mockBatchOperations.mock.invocationCallOrder[0]).toBeLessThan(
      mockRemoveImage.mock.invocationCallOrder[0]
    );
  });

  it('keeps the portraits when the batch fails', async () => {
    mockBatchOperations.mockRejectedValue(new Error('permission-denied'));
    await renderContext();

    await expect(context.deleteNPCs(['n1'])).rejects.toThrow('permission-denied');
    expect(mockRemoveImage).not.toHaveBeenCalled();
  });

  // T084: the sweep's record of each portrait goes in before the batch.
  it('records the portraits as released before the batch', async () => {
    await renderContext();

    await act(async () => {
      await context.deleteNPCs(['n1', 'n2']);
    });

    expect(mockRecordReleased).toHaveBeenCalledTimes(1);
    expect(mockRecordReleased).toHaveBeenCalledWith(portrait.path);
    expect(mockRecordReleased.mock.invocationCallOrder[0]).toBeLessThan(
      mockBatchOperations.mock.invocationCallOrder[0]
    );
    await waitFor(() => expect(mockClearReleased).toHaveBeenCalledWith(portrait.path));
  });
});
