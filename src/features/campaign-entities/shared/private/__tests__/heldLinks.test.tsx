// src/features/campaign-entities/shared/private/__tests__/heldLinks.test.tsx
import React from 'react';
import { renderHook } from '@testing-library/react';
import { withHeldLinks, useLinkPrivacy } from '../heldLinks';
import { PrivateRecordsValueProvider, type HeldLink, type PrivateRecordsValue } from '../PrivateRecordsContext';

/**
 * T163: a link between a private record and a shared one that owns it is
 * held in the author's private space. Their copy of the owner shows it; the
 * shared record never carries the private id.
 */

const mockSetDocument = jest.fn();
const mockDeleteDocument = jest.fn();
jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: {
    document: {
      setDocument: (...args: unknown[]) => mockSetDocument(...args),
      deleteDocument: (...args: unknown[]) => mockDeleteDocument(...args),
    },
  },
}));

const held = (id: string, from: HeldLink['from'], to: HeldLink['to']): HeldLink => ({ id, from, to });

describe('withHeldLinks', () => {
  const cave = { id: 'the-cave', name: 'The cave' } as any;
  const locationOf = (id: string) => (id === 'the-cave' ? cave : undefined);

  it('shows a held link on the author’s copy of its owner', () => {
    const quests = [
      { id: 'the-ring', title: 'The ring', relatedNPCIds: ['bilbo'] },
      { id: 'other', title: 'Other', relatedNPCIds: [] },
    ];
    const links = [held('l1', { kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'the-ring' })];

    const seen = withHeldLinks('quest', quests, links, locationOf);

    expect(seen[0].relatedNPCIds).toEqual(['bilbo', 'gollum']);
    expect(seen[1]).toBe(quests[1]);
    // The record as read is not changed.
    expect(quests[0].relatedNPCIds).toEqual(['bilbo']);
  });

  it('gives a quest held to a private place that place, by name', () => {
    const quests = [{ id: 'the-ring', title: 'The ring', locationId: '', keyLocations: [] }];
    const links = [held('l1', { kind: 'location', id: 'the-cave' }, { kind: 'quest', id: 'the-ring' })];

    expect(withHeldLinks('quest', quests, links, locationOf)[0]).toMatchObject({
      locationId: 'the-cave',
      location: 'The cave',
    });
  });

  it('leaves the list as it is with no link held to its kind', () => {
    const npcs = [{ id: 'bilbo', name: 'Bilbo' }];
    const links = [held('l1', { kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'the-ring' })];
    expect(withHeldLinks('npc', npcs, links, locationOf)).toBe(npcs);
  });
});

describe('useLinkPrivacy', () => {
  const LINKS = 'groups/g1/users/u1/private/c1/links';
  const space = (links: HeldLink[]): PrivateRecordsValue => ({
    records: { npc: [], location: [], quest: [], rumor: [] },
    links,
    paths: { npc: null, location: null, quest: null, rumor: null, links: LINKS },
    sessionNotes: { path: null, campaignId: null },
    campaignPaths: { npc: null, location: null, quest: null, rumor: null },
    isPrivate: (kind, id) => kind === 'npc' && id === 'gollum',
    stamps: () => ({ creation: { createdAt: 'NOW' }, modification: {} }),
  });
  const privacyFrom = (value: PrivateRecordsValue) => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PrivateRecordsValueProvider value={value}>{children}</PrivateRecordsValueProvider>
    );
    return renderHook(() => useLinkPrivacy(), { wrapper }).result.current;
  };

  beforeEach(() => jest.clearAllMocks());

  it('answers which ends are private', () => {
    const privacy = privacyFrom(space([]));
    expect(privacy.isPrivate({ kind: 'npc', id: 'gollum' })).toBe(true);
    expect(privacy.isPrivate({ kind: 'npc', id: 'bilbo' })).toBe(false);
  });

  it('holds a link as its two ends, once', async () => {
    const privacy = privacyFrom(space([]));
    await privacy.hold({ kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'the-ring' });

    expect(mockSetDocument).toHaveBeenCalledWith(LINKS, expect.any(String), {
      from: { kind: 'npc', id: 'gollum' },
      to: { kind: 'quest', id: 'the-ring' },
      createdAt: expect.anything(),
    });

    const again = privacyFrom(space([held('l1', { kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'the-ring' })]));
    mockSetDocument.mockClear();
    await again.hold({ kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'the-ring' });
    expect(mockSetDocument).not.toHaveBeenCalled();
  });

  it('lets go of every copy of a held link, and of no other', async () => {
    const privacy = privacyFrom(
      space([
        held('l1', { kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'the-ring' }),
        held('l2', { kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'the-ring' }),
        held('l3', { kind: 'npc', id: 'gollum' }, { kind: 'location', id: 'bag-end' }),
      ])
    );
    await privacy.release({ kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'the-ring' });

    expect(mockDeleteDocument.mock.calls).toEqual([
      [LINKS, 'l1'],
      [LINKS, 'l2'],
    ]);
  });
});
