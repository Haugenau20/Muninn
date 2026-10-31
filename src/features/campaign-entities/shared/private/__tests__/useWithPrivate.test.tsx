// src/features/campaign-entities/shared/private/__tests__/useWithPrivate.test.tsx
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useWithPrivate } from '../useWithPrivate';
import { PrivateRecordsValueProvider, type PrivateRecordsValue, type PrivateDoc } from '../PrivateRecordsContext';

/**
 * T163: a kind's list as its author sees it -- the campaign's records with
 * the links they hold for them, and their private records beside them.
 */

const mockRekey = jest.fn();
jest.mock('../rekey', () => ({
  rekeyPrivateRecord: (...args: unknown[]) => mockRekey(...args),
}));

const byName = (records: Array<{ id: string; name: string }>) =>
  [...records].sort((a, b) => a.name.localeCompare(b.name));

const value = (overrides: Partial<PrivateRecordsValue> = {}): PrivateRecordsValue => ({
  records: { npc: [], location: [], quest: [], rumor: [] },
  links: [],
  paths: { npc: 'p/npcs', location: 'p/locations', quest: 'p/quests', rumor: 'p/rumors', links: 'p/links' },
  sessionNotes: { path: null, campaignId: null },
  isPrivate: () => false,
  stamps: () => ({ creation: {}, modification: {} }),
  ...overrides,
});

const listOf = (shared: Array<{ id: string; name: string }>, space: PrivateRecordsValue) =>
  renderHook(() => useWithPrivate('npc', shared, byName), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <PrivateRecordsValueProvider value={space}>{children}</PrivateRecordsValueProvider>
    ),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRekey.mockResolvedValue(undefined);
});

it('is the shared list itself while the author holds nothing private', () => {
  const shared = [{ id: 'bilbo', name: 'Bilbo' }];
  expect(listOf(shared, value()).result.current).toBe(shared);
});

it('adds the author’s private records, marked, and arranges the list as before', () => {
  const shared = [{ id: 'bilbo', name: 'Bilbo' }];
  const gollum = { id: 'gollum', name: 'Gollum', isPrivate: true } as PrivateDoc;
  const aragorn = { id: 'aragorn', name: 'Aragorn', isPrivate: true } as PrivateDoc;

  const list = listOf(shared, value({ records: { npc: [gollum, aragorn], location: [], quest: [], rumor: [] } }))
    .result.current;

  expect(list.map((npc) => npc.id)).toEqual(['aragorn', 'bilbo', 'gollum']);
  expect(list.find((npc) => npc.id === 'gollum')).toMatchObject({ isPrivate: true });
});

it('moves a private record whose id someone else took, and leaves it out meanwhile', async () => {
  const shared = [{ id: 'grog', name: 'Grog' }];
  const mine = { id: 'grog', name: 'Grog', isPrivate: true } as PrivateDoc;
  const space = value({ records: { npc: [mine], location: [], quest: [], rumor: [] } });

  const { result } = listOf(shared, space);

  expect(result.current.filter((npc) => npc.id === 'grog')).toEqual([shared[0]]);
  await waitFor(() => expect(mockRekey).toHaveBeenCalledTimes(1));
  expect(mockRekey).toHaveBeenCalledWith('npc', 'grog', 'grog-2', space, { creation: {}, modification: {} });
});
