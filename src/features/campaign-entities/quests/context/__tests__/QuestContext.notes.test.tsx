// src/features/campaign-entities/quests/context/__tests__/QuestContext.notes.test.tsx

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { QuestProvider, useQuests } from 'features/campaign-entities/quests/context/QuestContext';

/**
 * T163: a quest keeps notes, as a person, a place and a rumour do, each a
 * document of its own under it (`quests/{id}/notes/{noteId}`, the shape
 * T133 gave the other three). Deleting a quest deletes its notes first: a
 * deleted record's subcollection is not deleted with it.
 */

const {
  addRecordNote: mockAddRecordNote,
  deleteRecordNotes: mockDeleteRecordNotes,
} = jest.requireMock('features/campaign-entities/shared/recordNotes');
const mockDeleteData = jest.fn();
const mockBatchOperations = jest.fn();
let mockQuests: any[] = [];
let mockUser: { uid: string } | null = { uid: 'user-1' };

const QUESTS_PATH = 'groups/g1/campaigns/c1/quests';

// Notes are documents of their own; see the mock.
jest.mock('features/campaign-entities/shared/recordNotes', () => require('@/test-utils/record-notes-mock').recordNotesMock());

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: mockUser }),
  useUser: () => ({
    userProfile: mockUser ? { username: 'Frodo' } : null,
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
    updateData: jest.fn(),
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
  mockUser = { uid: 'user-1' };
  mockQuests = [
    { id: 'q1', title: 'The Ring', status: 'active', objectives: [] },
    { id: 'q2', title: 'The Shire', status: 'active', objectives: [] },
  ];
  mockDeleteData.mockResolvedValue(undefined);
  mockBatchOperations.mockResolvedValue(undefined);
});

describe('adding a note to a quest', () => {
  it('writes the note as a document of its own under the quest', async () => {
    await renderContext();
    const note = { date: '2026-10-31', text: 'Took the long road', author: 'Zendikarr' };

    await act(async () => {
      await context.addQuestNote('q1', note);
    });

    expect(mockAddRecordNote).toHaveBeenCalledTimes(1);
    expect(mockAddRecordNote).toHaveBeenCalledWith(QUESTS_PATH, 'q1', note);
  });

  it('refuses a note on a quest it does not know, and writes nothing', async () => {
    await renderContext();

    await expect(context.addQuestNote('gone', { date: '2026-10-31', text: 'Lost' })).rejects.toThrow(
      'Quest not found'
    );
    expect(mockAddRecordNote).not.toHaveBeenCalled();
  });

  it('refuses a note from someone signed out, and writes nothing', async () => {
    mockUser = null;
    await renderContext();

    await expect(context.addQuestNote('q1', { date: '2026-10-31', text: 'Anonymous' })).rejects.toThrow(
      'User must be authenticated to add notes'
    );
    expect(mockAddRecordNote).not.toHaveBeenCalled();
  });
});

describe('deleting quests takes their notes with them', () => {
  it('deletes a quest’s notes before the quest', async () => {
    const order: string[] = [];
    mockDeleteRecordNotes.mockImplementation(async () => {
      order.push('notes');
    });
    mockDeleteData.mockImplementation(async () => {
      order.push('quest');
    });
    await renderContext();

    await act(async () => {
      await context.deleteQuest('q1');
    });

    expect(mockDeleteRecordNotes).toHaveBeenCalledWith(QUESTS_PATH, ['q1']);
    expect(order).toEqual(['notes', 'quest']);
  });

  it('deletes every selected quest’s notes before the batch', async () => {
    const order: string[] = [];
    mockDeleteRecordNotes.mockImplementation(async () => {
      order.push('notes');
    });
    mockBatchOperations.mockImplementation(async () => {
      order.push('quests');
    });
    await renderContext();

    await act(async () => {
      await context.deleteQuests(['q1', 'q2']);
    });

    expect(mockDeleteRecordNotes).toHaveBeenCalledWith(QUESTS_PATH, ['q1', 'q2']);
    expect(order).toEqual(['notes', 'quests']);
  });
});
