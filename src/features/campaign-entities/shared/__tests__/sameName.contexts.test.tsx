// src/features/campaign-entities/shared/__tests__/sameName.contexts.test.tsx
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { NPCProvider, useNPCs } from 'features/campaign-entities/npcs/context/NPCContext';
import { QuestProvider, useQuests } from 'features/campaign-entities/quests/context/QuestContext';
import { LocationProvider, useLocations } from 'features/campaign-entities/locations/context/LocationContext';
import { RumorProvider, useRumors } from 'features/campaign-entities/rumors/context/RumorContext';
import { SameNameError } from '../sameName';
import { DocumentAlreadyExistsError } from 'core/services/firebase/data/DocumentAlreadyExistsError';

/**
 * T163: each of the four creates, asked to, stops at a name a record already
 * carries -- one the client holds, or one written a moment ago that took the
 * id -- with a `SameNameError` naming it, and writes nothing. Without the
 * option, or for a record that only shares the slug, it goes on to `-2`.
 */

const mockAddData = jest.fn();
const mockGetDocument = jest.fn();
let mockLoaded: Record<string, any[]> = {};

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
  useUser: () => ({
    userProfile: { username: 'Frodo' },
    activeGroupUserProfile: { username: 'Frodo', activeCharacterId: null },
  }),
  useGroups: () => ({ activeGroupId: 'g1' }),
  useCampaigns: () => ({ activeCampaignId: 'c1' }),
  useFirestore: () => ({ createDocumentWithUpdates: jest.fn() }),
}));

jest.mock('features/campaign-entities/npcs/hooks/useNPCData', () => ({
  useNPCData: () => ({ npcs: mockLoaded.npcs, loading: false, error: null, refreshNPCs: jest.fn(), hasRequiredContext: true }),
}));
jest.mock('features/campaign-entities/quests/hooks/useQuestData', () => ({
  useQuestData: () => ({
    quests: mockLoaded.quests,
    loading: false,
    error: null,
    getQuestById: (id: string) => mockLoaded.quests.find((quest) => quest.id === id),
    refreshQuests: jest.fn(),
    hasRequiredContext: true,
  }),
}));
jest.mock('features/campaign-entities/locations/hooks/useLocationData', () => ({
  useLocationData: () => ({
    locations: mockLoaded.locations,
    loading: false,
    error: null,
    refreshLocations: jest.fn(),
    hasRequiredContext: true,
  }),
}));
jest.mock('features/campaign-entities/rumors/hooks/useRumorData', () => ({
  useRumorData: () => ({ rumors: mockLoaded.rumors, loading: false, error: null }),
}));

jest.mock('shared/hooks/useFirebaseData', () => ({
  useFirebaseData: () => ({
    addData: mockAddData,
    updateData: jest.fn(),
    updateDataAfterReading: jest.fn(),
    deleteData: jest.fn(),
    error: null,
  }),
}));

jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: { document: { getDocument: (...args: unknown[]) => mockGetDocument(...args) } },
}));

/** One kind's provider, its create, and a record of it called Grog. */
const KINDS = [
  {
    kind: 'npc',
    list: 'npcs',
    Provider: NPCProvider,
    useCreate: () => useNPCs().addNPC,
    record: (name: string) => ({ name, status: 'alive', relationship: 'unknown', description: '', connections: { relatedNPCs: [], affiliations: [] }, notes: [] }),
    nameField: 'name',
  },
  {
    kind: 'quest',
    list: 'quests',
    Provider: QuestProvider,
    useCreate: () => useQuests().addQuest,
    record: (name: string) => ({ title: name, description: '', status: 'active', objectives: [] }),
    nameField: 'title',
  },
  {
    kind: 'location',
    list: 'locations',
    Provider: LocationProvider,
    useCreate: () => useLocations().createLocation,
    record: (name: string) => ({ name, type: 'poi', status: 'known', description: '', parentId: '', features: [], connectedNPCs: [], notes: [], tags: [] }),
    nameField: 'name',
  },
  {
    kind: 'rumor',
    list: 'rumors',
    Provider: RumorProvider,
    useCreate: () => useRumors().addRumor,
    record: (name: string) => ({ title: name, content: '', status: 'unconfirmed', sourceName: '', relatedNPCs: [], relatedLocations: [], notes: [] }),
    nameField: 'title',
  },
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockLoaded = { npcs: [], quests: [], locations: [], rumors: [] };
  mockAddData.mockResolvedValue(undefined);
  mockGetDocument.mockResolvedValue(null);
});

describe.each(KINDS)('a $kind', ({ kind, list, Provider, useCreate, record, nameField }) => {
  let create: (data: any, alongside?: any, options?: any) => Promise<string>;
  const Probe = () => {
    create = useCreate() as typeof create;
    return null;
  };
  const renderIt = async () => {
    render(
      <Provider>
        <Probe />
      </Provider>
    );
    await waitFor(() => expect(create).toBeDefined());
  };
  const caught = (promise: Promise<unknown>) => promise.then(() => null, (err: unknown) => err);

  it('stops at a name a record the client holds carries, and writes nothing', async () => {
    mockLoaded[list] = [{ id: 'grog', ...record('Grog') }];
    await renderIt();

    const err = await caught(create(record('the grog'), undefined, { askOnSameName: true }));

    expect(err).toBeInstanceOf(SameNameError);
    expect(err).toMatchObject({ kind, existingId: 'grog', existingName: 'Grog' });
    expect(mockAddData).not.toHaveBeenCalled();
  });

  it('creates a second one as -2 when not asked, as before', async () => {
    mockLoaded[list] = [{ id: 'grog', ...record('Grog') }];
    await renderIt();

    await expect(create(record('Grog'))).resolves.toBe('grog-2');
  });

  it('stops at a record written a moment ago that took the id with the same name', async () => {
    mockAddData.mockImplementation(async (_data: unknown, id: string) => {
      if (id === 'grog') throw new DocumentAlreadyExistsError(list, id);
    });
    mockGetDocument.mockResolvedValue({ id: 'grog', [nameField]: 'Grog' });
    await renderIt();

    const err = await caught(create(record('Grog'), undefined, { askOnSameName: true }));

    expect(err).toMatchObject({ name: 'SameNameError', existingId: 'grog' });
    expect(mockGetDocument).toHaveBeenCalledWith(`groups/g1/campaigns/c1/${list}`, 'grog');
    expect(mockAddData).toHaveBeenCalledTimes(1);
  });

  it('goes on to -2 past a record that only shares the slug', async () => {
    mockAddData.mockImplementation(async (_data: unknown, id: string) => {
      if (id === 'grog') throw new DocumentAlreadyExistsError(list, id);
    });
    mockGetDocument.mockResolvedValue({ id: 'grog', [nameField]: 'Grog the Bold' });
    await renderIt();

    await expect(create(record('Grog'), undefined, { askOnSameName: true })).resolves.toBe('grog-2');
  });
});
