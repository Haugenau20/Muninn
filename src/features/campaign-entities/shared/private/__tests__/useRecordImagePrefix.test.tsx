// src/features/campaign-entities/shared/private/__tests__/useRecordImagePrefix.test.tsx
import React from 'react';
import { renderHook } from '@testing-library/react';
import { useRecordImagePrefix } from '../useRecordImagePrefix';
import { PrivateRecordsValueProvider, type PrivateRecordsValue } from '../PrivateRecordsContext';

/**
 * T163: a private record's picture goes to its author's own folder, which only
 * they read; a shared record's to the campaign's.
 */

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: { uid: 'u1' } }),
  useGroups: () => ({ activeGroupId: 'g1' }),
  useCampaigns: () => ({ activeCampaignId: 'c1' }),
}));

const space = { isPrivate: (kind: string, id: string) => kind === 'npc' && id === 'gollum' } as unknown as PrivateRecordsValue;
const prefixOf = (kind: 'npc' | 'location', id?: string) =>
  renderHook(() => useRecordImagePrefix(kind, id), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <PrivateRecordsValueProvider value={space}>{children}</PrivateRecordsValueProvider>
    ),
  }).result.current;

it('puts a private person’s picture in their author’s folder', () => {
  expect(prefixOf('npc', 'gollum')).toBe('groups/g1/users/u1/campaigns/c1/npcs/gollum');
});

it('puts a shared one’s in the campaign’s', () => {
  expect(prefixOf('npc', 'bilbo')).toBe('groups/g1/campaigns/c1/npcs/bilbo');
  expect(prefixOf('location', 'shire')).toBe('groups/g1/campaigns/c1/locations/shire');
});

it('has no folder until the record is known', () => {
  expect(prefixOf('npc', undefined)).toBeNull();
});
