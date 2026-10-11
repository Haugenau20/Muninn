// src/features/campaign-entities/quests/context/__tests__/QuestContext.batch.test.tsx

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { QuestProvider, useQuests } from 'features/campaign-entities/quests/context/QuestContext';

/**
 * T017: the quest directory's batch actions, each ONE batched write for the
 * whole selection -- never a loop over the single-quest methods.
 */

const mockBatchOperations = jest.fn();
const mockUpdateData = jest.fn();
const mockDeleteData = jest.fn();
let mockQuests: any[] = [];

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
  useUser: () => ({
    userProfile: { username: 'Frodo' },
    activeGroupUserProfile: { username: 'Frodo', activeCharacterId: null },
  }),
  useGroups: () => ({ activeGroupId: 'g1' }),
  useCampaigns: () => ({ activeCampaignId: 'c1' }),
}));

jest.mock('features/campaign-entities/quests/hooks/useQuestData', () => ({
  useQuestData: () => ({
    quests: mockQuests,
    loading: false,
    error: null,
    getQuestById: (id: string) => mockQuests.find((quest) => quest.id === id),
    refreshQuests: jest.fn(),
    hasRequiredContext: true,
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
}));

let context: ReturnType<typeof useQuests>;
const Probe = () => {
  context = useQuests();
  return null;
};

async function renderContext() {
  render(
    <QuestProvider>
      <Probe />
    </QuestProvider>
  );
  await waitFor(() => expect(context).toBeDefined());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuests = [
    { id: 'q1', title: 'The Ring', status: 'active', objectives: [] },
    { id: 'q2', title: 'The Shire', status: 'active', objectives: [] },
    { id: 'q3', title: 'Moria', status: 'failed', objectives: [] },
  ];
  mockBatchOperations.mockResolvedValue(undefined);
});

describe('QuestContext.updateQuestsStatus', () => {
  it('sets the status of every selected quest in one batch, attributed to the writer', async () => {
    await renderContext();

    await act(async () => {
      await context.updateQuestsStatus(['q1', 'q3'], 'failed');
    });

    expect(mockBatchOperations).toHaveBeenCalledTimes(1);
    const writes = mockBatchOperations.mock.calls[0][0];
    expect(writes.map((w: any) => [w.type, w.collection, w.id, w.data.status])).toEqual([
      ['update', 'groups/g1/campaigns/c1/quests', 'q1', 'failed'],
      ['update', 'groups/g1/campaigns/c1/quests', 'q3', 'failed'],
    ]);
    for (const write of writes) {
      expect(write.data.modifiedBy).toBe('user-1');
      expect(write.data).not.toHaveProperty('dateCompleted');
    }
    expect(mockUpdateData).not.toHaveBeenCalled();
  });

  it('stamps the completion date when completing, as the single-quest change does', async () => {
    await renderContext();

    await act(async () => {
      await context.updateQuestsStatus(['q1', 'q2'], 'completed');
    });

    const writes = mockBatchOperations.mock.calls[0][0];
    for (const write of writes) {
      expect(typeof write.data.dateCompleted).toBe('string');
      expect(new Date(write.data.dateCompleted).toISOString()).toBe(write.data.dateCompleted);
      expect(write.data).not.toHaveProperty('dateModified');
    }
  });

  it('writes nothing when any selected quest is unknown', async () => {
    await renderContext();

    await expect(context.updateQuestsStatus(['q1', 'gone'], 'completed')).rejects.toThrow(
      'One or more quests not found'
    );
    expect(mockBatchOperations).not.toHaveBeenCalled();
  });
});

describe('QuestContext.deleteQuests', () => {
  it('deletes every selected quest in one batch', async () => {
    await renderContext();

    await act(async () => {
      await context.deleteQuests(['q2', 'q3']);
    });

    expect(mockBatchOperations).toHaveBeenCalledTimes(1);
    expect(mockBatchOperations).toHaveBeenCalledWith([
      { type: 'delete', id: 'q2', collection: 'groups/g1/campaigns/c1/quests' },
      { type: 'delete', id: 'q3', collection: 'groups/g1/campaigns/c1/quests' },
    ]);
    expect(mockDeleteData).not.toHaveBeenCalled();
  });
});
