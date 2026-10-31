// src/features/campaign-entities/shared/private/__tests__/private.contexts.test.tsx
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { NPCProvider, useNPCs } from 'features/campaign-entities/npcs/context/NPCContext';
import { QuestProvider, useQuests } from 'features/campaign-entities/quests/context/QuestContext';
import { LocationProvider, useLocations } from 'features/campaign-entities/locations/context/LocationContext';
import { RumorProvider, useRumors } from 'features/campaign-entities/rumors/context/RumorContext';
import { PrivateRecordsValueProvider, type PrivateDoc, type PrivateRecordsValue } from '../PrivateRecordsContext';
import { PrivateLinkError } from '../usePrivateRouting';

/**
 * T163: the four contexts with private records among their own. A private
 * record's writes go to its author's private space; a shared record's write
 * that would name a private one is refused; places and rumours keep the two
 * apart; deleting one lets go of what was held for it.
 */

const SHARED = 'groups/g1/campaigns/c1';
const PRIVATE = 'groups/g1/users/u1/private/c1';

/** Every write, as `[collection, method, id, fields]`. */
let mockWrites: Array<[string | null, string, string, unknown]> = [];
let mockShared: Record<string, any[]> = {};
const mockBatch = jest.fn();
const mockCreateWithUpdates = jest.fn();

jest.mock('features/campaign-entities/shared/recordNotes', () => require('@/test-utils/record-notes-mock').recordNotesMock());
jest.mock('features/campaign-entities/shared/unlinkDeleted', () => ({
  ...jest.requireActual('features/campaign-entities/shared/unlinkDeleted'),
  unlinkDeletedQuietly: jest.fn(() => Promise.resolve()),
}));

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: { uid: 'u1' } }),
  useUser: () => ({
    userProfile: { username: 'Frodo' },
    activeGroupUserProfile: { username: 'Frodo', activeCharacterId: null },
  }),
  useGroups: () => ({ activeGroupId: 'g1' }),
  useCampaigns: () => ({ activeCampaignId: 'c1' }),
  useFirestore: () => ({ createDocumentWithUpdates: mockCreateWithUpdates }),
}));

jest.mock('shared/hooks/useCampaignCollection', () => ({
  useCampaignCollection: (collection: string) => ({
    items: mockShared[collection] ?? [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    hasRequiredContext: true,
    missingContext: null,
  }),
}));

jest.mock('shared/hooks/useFirebaseData', () => ({
  useFirebaseData: ({ collection }: { collection: string | null }) => {
    const all = () => [...Object.values(mockShared).flat()];
    return {
      error: null,
      addData: jest.fn(async (data: any, id: string) => {
        mockWrites.push([collection, 'add', id, data]);
        return id;
      }),
      updateData: jest.fn(async (id: string, fields: unknown) => {
        mockWrites.push([collection, 'update', id, fields]);
      }),
      updateDataAfterReading: jest.fn(async (id: string, decide: (read: (x: string) => Promise<any>) => Promise<unknown>) => {
        const fields = await decide(async (x) => all().find((record) => record.id === x) ?? { id: x });
        mockWrites.push([collection, 'update', id, fields]);
      }),
      deleteData: jest.fn(async (id: string) => {
        mockWrites.push([collection, 'delete', id, null]);
      }),
      updateManyAfterReading: jest.fn(),
      queryData: jest.fn(async () => []),
    };
  },
}));

jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: {
    document: {
      batchOperations: (ops: unknown) => mockBatch(ops),
      getDocument: jest.fn(async () => null),
    },
  },
}));

const priv = (fields: Record<string, unknown>) => ({ ...fields, isPrivate: true }) as PrivateDoc;

function space(records: Partial<PrivateRecordsValue['records']>, links: PrivateRecordsValue['links'] = []): PrivateRecordsValue {
  const all = { npc: [], location: [], quest: [], rumor: [], ...records };
  return {
    records: all,
    links,
    paths: {
      npc: `${PRIVATE}/npcs`,
      location: `${PRIVATE}/locations`,
      quest: `${PRIVATE}/quests`,
      rumor: `${PRIVATE}/rumors`,
      links: `${PRIVATE}/links`,
    },
    sessionNotes: { path: null, campaignId: null },
    campaignPaths: { npc: null, location: null, quest: null, rumor: null },
    isPrivate: (kind, id) => all[kind].some((record: PrivateDoc) => record.id === id),
    stamps: () => ({ creation: {}, modification: {} }),
  };
}

/** Renders the four providers inside a private space, and hands back their values. */
async function contexts(value: PrivateRecordsValue) {
  const got: Record<string, any> = {};
  const Probe = () => {
    got.npcs = useNPCs();
    got.quests = useQuests();
    got.locations = useLocations();
    got.rumors = useRumors();
    return null;
  };
  render(
    <PrivateRecordsValueProvider value={value}>
      <NPCProvider>
        <LocationProvider>
          <RumorProvider>
            <QuestProvider>
              <Probe />
            </QuestProvider>
          </RumorProvider>
        </LocationProvider>
      </NPCProvider>
    </PrivateRecordsValueProvider>
  );
  await waitFor(() => expect(got.npcs).toBeDefined());
  return got;
}

const gollum = priv({ id: 'gollum', name: 'Gollum', connections: { relatedNPCs: [], affiliations: [] } });
const cave = priv({ id: 'the-cave', name: 'The cave', parentId: '' });

beforeEach(() => {
  jest.clearAllMocks();
  mockWrites = [];
  mockShared = {
    npcs: [{ id: 'bilbo', name: 'Bilbo', connections: { relatedNPCs: [], affiliations: [] } }, { id: 'grog', name: 'Grog' }],
    quests: [{ id: 'ring', title: 'The ring', objectives: [], relatedNPCIds: [] }],
    locations: [{ id: 'shire', name: 'The Shire', parentId: '' }],
    rumors: [{ id: 'smoke', title: 'Smoke', relatedNPCs: [], relatedLocations: [] }],
  };
  mockBatch.mockResolvedValue(undefined);
  mockCreateWithUpdates.mockResolvedValue(undefined);
});

describe('creating privately', () => {
  it('writes to the author’s private space, under an id free in both lists', async () => {
    const got = await contexts(space({ npc: [priv({ id: 'grog-2', name: 'Grog' })] }));

    await expect(got.npcs.addNPC({ name: 'Grog' }, undefined, { private: true })).resolves.toBe('grog-3');
    expect(mockWrites).toEqual([[`${PRIVATE}/npcs`, 'add', 'grog-3', expect.objectContaining({ name: 'Grog' })]]);
  });

  it('lists the private record beside the shared ones, marked', async () => {
    const got = await contexts(space({ npc: [gollum] }));
    expect(got.npcs.npcs.map((npc: any) => [npc.id, Boolean(npc.isPrivate)])).toEqual([
      ['bilbo', false],
      ['gollum', true],
      ['grog', false],
    ]);
  });
});

describe('writing to a record', () => {
  it('sends a private record’s writes to its author’s space, and a shared one’s to the campaign', async () => {
    const got = await contexts(space({ npc: [gollum] }));

    await got.npcs.updateNPC('gollum', { occupation: 'Fisher' });
    await got.npcs.updateNPC('bilbo', { occupation: 'Burglar' });

    expect(mockWrites).toEqual([
      [`${PRIVATE}/npcs`, 'update', 'gollum', { occupation: 'Fisher' }],
      [`${SHARED}/npcs`, 'update', 'bilbo', { occupation: 'Burglar' }],
    ]);
  });

  it('refuses a shared record’s write that would name a private one, fields or a change alike', async () => {
    const got = await contexts(space({ npc: [gollum] }));

    await expect(got.quests.updateQuest('ring', { relatedNPCIds: ['gollum'] })).rejects.toBeInstanceOf(PrivateLinkError);
    await expect(
      got.quests.updateQuest('ring', (current: any) => ({ relatedNPCIds: [...current.relatedNPCIds, 'gollum'] }))
    ).rejects.toBeInstanceOf(PrivateLinkError);
    expect(mockWrites).toEqual([]);
  });

  it('lets a private record name a shared one', async () => {
    const got = await contexts(space({ quest: [priv({ id: 'the-fish', title: 'The fish', objectives: [], relatedNPCIds: [] })] }));
    await got.quests.updateQuest('the-fish', { relatedNPCIds: ['bilbo'] });
    expect(mockWrites).toEqual([[`${PRIVATE}/quests`, 'update', 'the-fish', { relatedNPCIds: ['bilbo'] }]]);
  });

  it('never writes the in-memory mark', async () => {
    const got = await contexts(space({ npc: [gollum] }));
    await got.npcs.updateNPC('gollum', { ...gollum, occupation: 'Fisher' });
    expect(mockWrites[0][3]).not.toHaveProperty('isPrivate');
  });
});

describe('deleting a private record', () => {
  it('deletes it in its author’s space, and lets go of the links held for it', async () => {
    const got = await contexts(
      space({ npc: [gollum] }, [
        { id: 'l1', from: { kind: 'npc', id: 'gollum' }, to: { kind: 'quest', id: 'ring' } },
        { id: 'l2', from: { kind: 'npc', id: 'smeagol' }, to: { kind: 'quest', id: 'ring' } },
      ])
    );

    await got.npcs.deleteNPC('gollum');

    expect(mockWrites).toEqual([[`${PRIVATE}/npcs`, 'delete', 'gollum', null]]);
    expect(mockBatch).toHaveBeenCalledWith([{ type: 'delete', collection: `${PRIVATE}/links`, id: 'l1' }]);
  });
});

describe('places', () => {
  it('refuses a shared place inside a private one, created or moved there', async () => {
    const got = await contexts(space({ location: [cave] }));

    await expect(
      got.locations.createLocation({ name: 'A ledge', parentId: 'the-cave', type: 'poi', status: 'known' })
    ).rejects.toThrow('A place inside a private one is private too.');
    await expect(got.locations.moveLocation('shire', 'the-cave')).rejects.toThrow(
      'A shared place cannot sit inside a private one.'
    );
    expect(mockWrites).toEqual([]);
  });

  it('puts a private place inside a shared one', async () => {
    const got = await contexts(space({ location: [cave] }));
    await got.locations.moveLocation('the-cave', 'shire');
    expect(mockWrites).toEqual([[`${PRIVATE}/locations`, 'update', 'the-cave', { parentId: 'shire' }]]);
  });

  it('deletes a private place and the private places inside it, deepest first', async () => {
    const ledge = priv({ id: 'ledge', name: 'Ledge', parentId: 'the-cave' });
    const got = await contexts(space({ location: [cave, ledge] }));

    await got.locations.deleteLocation('the-cave', 'delete-subtree');

    expect(mockWrites).toEqual([
      [`${PRIVATE}/locations`, 'delete', 'ledge', null],
      [`${PRIVATE}/locations`, 'delete', 'the-cave', null],
    ]);
  });
});

describe('rumours combined or converted', () => {
  const riddles = priv({ id: 'riddles', title: 'Riddles', relatedNPCs: [], relatedLocations: [] });
  const fish = priv({ id: 'fish', title: 'Fish', relatedNPCs: [], relatedLocations: [] });

  it('never mixes private and shared ones', async () => {
    const got = await contexts(space({ rumor: [riddles] }));

    await expect(got.rumors.combineRumors(['riddles', 'smoke'], { title: 'Both' })).rejects.toThrow(
      'Private and shared rumours cannot be combined or converted together.'
    );
    await expect(got.rumors.convertToQuest(['riddles', 'smoke'], { title: 'Both' })).rejects.toThrow(
      'Private and shared rumours cannot be combined or converted together.'
    );
    expect(mockCreateWithUpdates).not.toHaveBeenCalled();
  });

  it('combines private ones into a private rumour, and converts them into a private quest', async () => {
    const got = await contexts(space({ rumor: [riddles, fish] }));

    await got.rumors.combineRumors(['riddles', 'fish'], { title: 'Riddles and fish' });
    expect(mockCreateWithUpdates).toHaveBeenLastCalledWith(
      `${PRIVATE}/rumors`, 'riddles-and-fish', `${PRIVATE}/rumors`, expect.any(Function)
    );

    await got.rumors.convertToQuest(['riddles', 'fish'], { title: 'Find the fish' });
    expect(mockCreateWithUpdates).toHaveBeenLastCalledWith(
      `${PRIVATE}/quests`, 'find-the-fish', `${PRIVATE}/rumors`, expect.any(Function)
    );
  });
});
