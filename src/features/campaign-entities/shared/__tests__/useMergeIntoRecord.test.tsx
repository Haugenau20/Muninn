// src/features/campaign-entities/shared/__tests__/useMergeIntoRecord.test.tsx
import { renderHook } from '@testing-library/react';
import { useMergeIntoRecord } from '../useMergeIntoRecord';

/**
 * T163, "Add what you know to it": the merge's one transaction -- the fields
 * the existing record lacked, the note of what differed signed by the acting
 * character, and the change that pointed at the newcomer, now pointing at
 * the existing record.
 */

const mockMergeIntoDocument = jest.fn();
let mockProfile: any = { username: 'gandlaf', activeCharacterId: 'c1', characters: [{ id: 'c1', name: 'Zendikarr' }] };

jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: { document: { mergeIntoDocument: (...args: unknown[]) => mockMergeIntoDocument(...args) } },
}));

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
  useUser: () => ({ activeGroupUserProfile: mockProfile }),
  useGroups: () => ({ activeGroupId: 'g1' }),
  useCampaigns: () => ({ activeCampaignId: 'c1' }),
}));

const NPCS = 'groups/g1/campaigns/c1/npcs';

/** Run the decision the hook handed the service, against `target`. */
async function decideOn(target: object, read: (id: string) => Promise<unknown> = async () => undefined) {
  const [, , , decide] = mockMergeIntoDocument.mock.calls[0];
  return decide(target, read);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { username: 'gandlaf', activeCharacterId: 'c1', characters: [{ id: 'c1', name: 'Zendikarr' }] };
  mockMergeIntoDocument.mockResolvedValue(undefined);
});

it('adds to the record of the same name and resolves with its id', async () => {
  const { result } = renderHook(() => useMergeIntoRecord());

  await expect(result.current('npc', 'grog', { name: 'Grog', occupation: 'Smith' })).resolves.toBe('grog');

  expect(mockMergeIntoDocument).toHaveBeenCalledWith(NPCS, 'grog', NPCS, expect.any(Function));
  const writes = await decideOn({ id: 'grog', name: 'Grog', occupation: '' });
  expect(writes).toEqual({ fields: { occupation: 'Smith' }, updates: [], notes: [] });
});

it('works the fields out from the record as the server holds it, not the page’s copy', async () => {
  const { result } = renderHook(() => useMergeIntoRecord());
  await result.current('npc', 'grog', { name: 'Grog', occupation: 'Smith' });

  // Someone filled it in meanwhile: nothing to add, and their word is kept.
  const writes = await decideOn({ id: 'grog', name: 'Grog', occupation: 'Ferryman' });
  expect(writes.fields).toEqual({});
  expect(writes.notes).toHaveLength(1);
  expect(writes.notes[0]).toMatchObject({
    under: 'target',
    data: { text: 'Also recorded as “Grog”:\nOccupation: Smith', author: 'Zendikarr' },
  });
});

it('signs the note with the username when there is no character', async () => {
  mockProfile = { username: 'gandlaf', characters: [] };
  const { result } = renderHook(() => useMergeIntoRecord());
  await result.current('npc', 'grog', { name: 'Grog', description: 'Owns a boat.' });

  const writes = await decideOn({ id: 'grog', name: 'Grog', description: 'Runs the ferry.' });
  expect(writes.notes[0].data.author).toBe('gandlaf');
});

it('commits the change that pointed at the newcomer with it, naming the existing record', async () => {
  const change = jest.fn((current: any, id: string) => ({ marked: `${current.id}->${id}` }));
  const { result } = renderHook(() => useMergeIntoRecord());
  await result.current('quest', 'find-it', { title: 'Find it' }, {
    collection: 'groups/g1/users/user-1/notes',
    id: 'session-9',
    change,
  });

  expect(mockMergeIntoDocument).toHaveBeenCalledWith(
    'groups/g1/campaigns/c1/quests',
    'find-it',
    'groups/g1/users/user-1/notes',
    expect.any(Function)
  );
  const writes = await decideOn({ id: 'find-it', title: 'Find it' }, async (id) => ({ id }));
  expect(writes.updates).toEqual([{ id: 'session-9', data: { marked: 'session-9->find-it' } }]);
  expect(change).toHaveBeenCalledWith({ id: 'session-9' }, 'find-it');
});

it('writes the same note on a retried transaction, not a second one', async () => {
  const { result } = renderHook(() => useMergeIntoRecord());
  await result.current('rumor', 'smoke', { title: 'Smoke', content: 'Ash on the wind' });

  const target = { id: 'smoke', title: 'Smoke', content: 'Smoke over the hill' };
  const first = await decideOn(target);
  const again = await decideOn(target);
  expect(first.notes[0].id).toBe(again.notes[0].id);
  expect(first.notes[0].data).toEqual({ content: 'Also recorded as “Smoke”:\nWhat was said: Ash on the wind' });
});
