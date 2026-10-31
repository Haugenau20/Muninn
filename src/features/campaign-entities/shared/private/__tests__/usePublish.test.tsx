// src/features/campaign-entities/shared/private/__tests__/usePublish.test.tsx
import React from 'react';
import { renderHook } from '@testing-library/react';
import { usePublish, type PublishQuestions } from '../usePublish';
import { PrivateRecordsValueProvider, type PrivateDoc, type PrivateRecordsValue } from '../PrivateRecordsContext';
import { DocumentAlreadyExistsError } from 'core/services/firebase/data/DocumentAlreadyExistsError';

/**
 * T163: publishing asks before it writes -- every record that goes, and each
 * one whose name a shared record carries -- then commits once, under the
 * next free id when someone took one meanwhile.
 */

const C = 'groups/g1/campaigns/c1';
const P = 'groups/g1/users/u1/private/c1';

let mockLists: Record<string, any[]> = {};
const mockCommit = jest.fn();
const mockGetCollection = jest.fn();

jest.mock('../../../npcs/context/NPCContext', () => ({ useNPCs: () => ({ npcs: mockLists.npcs }) }));
jest.mock('../../../quests/context/QuestContext', () => ({ useQuests: () => ({ quests: mockLists.quests }) }));
jest.mock('../../../locations/context/LocationContext', () => ({ useLocations: () => ({ locations: mockLists.locations }) }));
jest.mock('../../../rumors/context/RumorContext', () => ({ useRumors: () => ({ rumors: mockLists.rumors }) }));
jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: {
    document: {
      commitAfterReading: (...args: unknown[]) => mockCommit(...args),
      getCollectionFromServer: (path: string) => mockGetCollection(path),
    },
  },
}));

const priv = (fields: Record<string, unknown>) => ({ ...fields, isPrivate: true }) as PrivateDoc;
const gollum = priv({ id: 'gollum', name: 'Gollum', connections: { relatedNPCs: [], affiliations: [] } });

function space(records: Partial<PrivateRecordsValue['records']>): PrivateRecordsValue {
  const all = { npc: [], location: [], quest: [], rumor: [], ...records };
  return {
    records: all,
    links: [],
    paths: { npc: `${P}/npcs`, location: `${P}/locations`, quest: `${P}/quests`, rumor: `${P}/rumors`, links: `${P}/links` },
    campaignPaths: { npc: `${C}/npcs`, location: `${C}/locations`, quest: `${C}/quests`, rumor: `${C}/rumors` },
    sessionNotes: { path: null, campaignId: null },
    isPrivate: (kind, id) => all[kind].some((record: PrivateDoc) => record.id === id),
    stamps: () => ({ creation: {}, modification: {} }),
    author: 'Zendikarr',
  };
}

const publishWith = (value: PrivateRecordsValue) =>
  renderHook(() => usePublish(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <PrivateRecordsValueProvider value={value}>{children}</PrivateRecordsValueProvider>
    ),
  }).result.current;

/** The writes the commit would make, decided against nothing read. */
async function writesOf(call = 0) {
  const [, decide] = mockCommit.mock.calls[call];
  return decide((collection: string, id: string) => mockLists[collection.split('/').pop()!]?.find((r) => r.id === id));
}

const ask = (overrides: Partial<PublishQuestions> = {}): PublishQuestions => ({
  confirm: jest.fn(async () => true),
  sameName: jest.fn(async () => ({ action: 'cancel' as const })),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLists = { npcs: [{ id: 'bilbo', name: 'Bilbo' }, gollum], quests: [], locations: [], rumors: [] };
  mockCommit.mockResolvedValue(undefined);
  mockGetCollection.mockResolvedValue([]);
});

it('names what goes before anything is written, and writes nothing when told no', async () => {
  const questions = ask({ confirm: jest.fn(async () => false) });
  const outcome = await publishWith(space({ npc: [gollum] }))('npc', 'gollum', questions);

  expect(questions.confirm).toHaveBeenCalledWith([{ kind: 'npc', id: 'gollum', name: 'Gollum' }]);
  expect(outcome).toEqual({ published: false });
  expect(mockCommit).not.toHaveBeenCalled();
});

it('publishes under its own id, in one commit', async () => {
  const outcome = await publishWith(space({ npc: [gollum] }))('npc', 'gollum', ask());

  expect(outcome).toEqual({ published: true, ids: { 'npc:gollum': 'gollum' } });
  expect(mockCommit).toHaveBeenCalledTimes(1);
  expect(await writesOf()).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'create', collection: `${C}/npcs`, id: 'gollum' }),
    { type: 'delete', collection: `${P}/npcs`, id: 'gollum' },
  ]));
});

it('takes the next free id when someone took it meanwhile, and says where it went', async () => {
  mockCommit.mockRejectedValueOnce(new DocumentAlreadyExistsError(`${C}/npcs`, 'gollum'));

  const outcome = await publishWith(space({ npc: [gollum] }))('npc', 'gollum', ask());

  expect(mockCommit).toHaveBeenCalledTimes(2);
  expect(outcome).toEqual({ published: true, ids: { 'npc:gollum': 'gollum-2' } });
  expect((await writesOf(1)).find((write: any) => write.type === 'create')).toMatchObject({ id: 'gollum-2' });
});

describe('a shared record of the same name', () => {
  const mine = priv({ id: 'grog-private', name: 'Grog', occupation: 'Smith' });
  beforeEach(() => {
    mockLists.npcs = [{ id: 'grog', name: 'Grog', occupation: '' }, mine];
  });

  it('is asked about, with what adding would write', async () => {
    const questions = ask();
    await publishWith(space({ npc: [mine] }))('npc', 'grog-private', questions);
    expect(questions.sameName).toHaveBeenCalledWith({
      kind: 'npc',
      name: 'Grog',
      existingId: 'grog',
      existingName: 'Grog',
      preview: ['Occupation: Smith'],
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('is added to when the author says so', async () => {
    const outcome = await publishWith(space({ npc: [mine] }))(
      'npc',
      'grog-private',
      ask({ sameName: jest.fn(async () => ({ action: 'merge' as const })) })
    );
    expect(outcome).toEqual({ published: true, ids: { 'npc:grog-private': 'grog' } });
    expect(await writesOf()).toContainEqual(
      expect.objectContaining({ type: 'update', collection: `${C}/npcs`, id: 'grog', data: expect.objectContaining({ occupation: 'Smith' }) })
    );
  });

  it('is left alone when it is published under another name', async () => {
    const outcome = await publishWith(space({ npc: [mine] }))(
      'npc',
      'grog-private',
      ask({ sameName: jest.fn(async () => ({ action: 'create' as const, name: 'Grog the Younger' })) })
    );
    expect(outcome).toEqual({ published: true, ids: { 'npc:grog-private': 'grog-the-younger' } });
  });

  it('is opened instead, publishing nothing', async () => {
    const outcome = await publishWith(space({ npc: [mine] }))(
      'npc',
      'grog-private',
      ask({ sameName: jest.fn(async () => ({ action: 'open' as const })) })
    );
    expect(outcome).toEqual({ published: false, open: { kind: 'npc', id: 'grog' } });
    expect(mockCommit).not.toHaveBeenCalled();
  });
});

it('refuses a place inside a private one, before asking anything', async () => {
  const cave = priv({ id: 'cave', name: 'The cave', parentId: '' });
  const ledge = priv({ id: 'ledge', name: 'Ledge', parentId: 'cave' });
  const questions = ask();
  await expect(publishWith(space({ location: [cave, ledge] }))('location', 'ledge', questions)).rejects.toThrow(
    'Ledge is inside The cave, which is private: publish The cave first.'
  );
  expect(questions.confirm).not.toHaveBeenCalled();
});

it('takes the rumours converted into a quest with it, named in the question', async () => {
  const fish = priv({ id: 'fish', title: 'The fish', objectives: [], relatedNPCIds: [] });
  const riddles = priv({ id: 'riddles', title: 'Riddles', convertedToQuestId: 'fish', relatedNPCs: [], relatedLocations: [] });
  const questions = ask();
  await publishWith(space({ quest: [fish], rumor: [riddles] }))('quest', 'fish', questions);
  expect(questions.confirm).toHaveBeenCalledWith([
    { kind: 'quest', id: 'fish', name: 'The fish' },
    { kind: 'rumor', id: 'riddles', name: 'Riddles' },
  ]);
});
