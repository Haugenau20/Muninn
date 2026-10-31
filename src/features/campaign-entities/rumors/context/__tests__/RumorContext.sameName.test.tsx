// src/features/campaign-entities/rumors/context/__tests__/RumorContext.sameName.test.tsx

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { RumorProvider, useRumors } from '../RumorContext';
import { Rumor } from '../../types';
import { SameNameError } from '../../../shared/sameName';

/**
 * T163: a combine or a conversion whose title a record already carries.
 * Asked to, it stops with a `SameNameError`; given `into`, it adds to that
 * record instead of creating one, in one commit with every mark and note the
 * new record would have had: sources marked combined, or converted, into it.
 */

const RUMORS = 'groups/group-1/campaigns/campaign-1/rumors';
const QUESTS = 'groups/group-1/campaigns/campaign-1/quests';

let mockLoaded: Rumor[] = [];
const mockCreateWithUpdates = jest.fn();
const mockMergeIntoDocument = jest.fn();
const mockGetDocument = jest.fn();

jest.mock('features/campaign-entities/shared/recordNotes', () => require('@/test-utils/record-notes-mock').recordNotesMock());

jest.mock('@/features/user-management', () => ({
  useGroups: () => ({ activeGroupId: 'group-1' }),
  useCampaigns: () => ({ activeCampaignId: 'campaign-1' }),
  useAuth: () => ({ user: { uid: 'u1' } }),
  useUser: () => ({
    userProfile: { uid: 'u1' },
    activeGroupUserProfile: { username: 'Pip', activeCharacterId: null, characters: [] },
  }),
  useFirestore: () => ({ createDocumentWithUpdates: mockCreateWithUpdates }),
}));

jest.mock('../../hooks/useRumorData', () => ({
  useRumorData: () => ({ rumors: mockLoaded, loading: false, error: null }),
}));

jest.mock('shared/hooks/useFirebaseData', () => ({
  useFirebaseData: () => ({
    addData: jest.fn(),
    updateData: jest.fn(),
    updateDataAfterReading: jest.fn(),
    deleteData: jest.fn(),
    error: null,
  }),
}));

jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: {
    document: {
      mergeIntoDocument: (...args: unknown[]) => mockMergeIntoDocument(...args),
      getDocument: (...args: unknown[]) => mockGetDocument(...args),
    },
  },
}));

const rumor = (id: string, title = `Rumour ${id}`): Rumor => ({
  id,
  title,
  content: `Heard ${id}`,
  status: 'unconfirmed',
  sourceType: 'tavern',
  sourceName: 'Barliman',
  relatedNPCs: [`npc-${id}`],
  relatedLocations: [],
  notes: [],
  createdBy: 'u0',
  createdByUsername: 'Author',
  dateAdded: '2026-10-01T00:00:00.000Z',
});

let context: ReturnType<typeof useRumors>;
const Probe = () => {
  context = useRumors();
  return null;
};

async function renderContext() {
  render(
    <RumorProvider>
      <Probe />
    </RumorProvider>
  );
  await waitFor(() => expect(context).toBeDefined());
}

/** Run the decision handed to `mergeIntoDocument`, against a server of `held`. */
async function decide(target: object, held: Rumor[]) {
  const [, , , decision] = mockMergeIntoDocument.mock.calls[0];
  return decision(target, async (id: string) => held.find((r) => r.id === id));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoaded = [rumor('a'), rumor('b'), rumor('smoke', 'Smoke over the hill')];
  mockCreateWithUpdates.mockResolvedValue(undefined);
  mockMergeIntoDocument.mockResolvedValue(undefined);
  mockGetDocument.mockResolvedValue(null);
});

describe('combining under a title a rumour carries', () => {
  it('stops when asked, and writes nothing', async () => {
    await renderContext();

    const err = await context
      .combineRumors(['a', 'b'], { title: 'smoke over the hill', content: 'x' }, { askOnSameName: true })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(SameNameError);
    expect(err).toMatchObject({ existingId: 'smoke' });
    expect(mockCreateWithUpdates).not.toHaveBeenCalled();
  });

  it('adds to that rumour instead, marking each source combined into it', async () => {
    await renderContext();

    await expect(
      context.combineRumors(['a', 'b'], { title: 'Smoke over the hill' }, { into: 'smoke' })
    ).resolves.toBe('smoke');

    expect(mockCreateWithUpdates).not.toHaveBeenCalled();
    expect(mockMergeIntoDocument).toHaveBeenCalledWith(RUMORS, 'smoke', RUMORS, expect.any(Function));
    const writes = await decide(rumor('smoke', 'Smoke over the hill'), mockLoaded);

    // Its people gain the sources'; its own text stays, and theirs goes into a note.
    expect(writes.fields).toEqual({ relatedNPCs: ['npc-smoke', 'npc-a', 'npc-b'] });
    expect(writes.updates).toEqual([
      { id: 'a', data: { status: 'confirmed' } },
      { id: 'b', data: { status: 'confirmed' } },
    ]);
    const notes = writes.notes.map((n: any) => [n.under, n.data.content.split('\n')[0]]);
    expect(notes).toEqual([
      ['target', 'Combined from rumours: a, b'],
      ['target', 'Also recorded as “Smoke over the hill”:'],
      [{ updated: 'a' }, 'Combined into rumour: smoke'],
      [{ updated: 'b' }, 'Combined into rumour: smoke'],
    ]);
  });

  it('does not mark the rumour combined into itself when it was one of the sources', async () => {
    await renderContext();
    await context.combineRumors(['smoke', 'a'], { title: 'Smoke over the hill' }, { into: 'smoke' });

    const writes = await decide(rumor('smoke', 'Smoke over the hill'), mockLoaded);
    expect(writes.updates).toEqual([{ id: 'a', data: { status: 'confirmed' } }]);
    expect(writes.notes.some((n: any) => n.under?.updated === 'smoke')).toBe(false);
    expect(writes.notes[0].data.content).toBe('Combined from rumours: a');
  });
});

describe('converting under a title a quest carries', () => {
  it('stops at a quest that took the id a moment ago with the same title', async () => {
    const { DocumentAlreadyExistsError } = jest.requireActual('core/services/firebase/data/DocumentAlreadyExistsError');
    mockCreateWithUpdates.mockRejectedValue(new DocumentAlreadyExistsError(QUESTS, 'find-the-fire'));
    mockGetDocument.mockResolvedValue({ id: 'find-the-fire', title: 'Find the fire' });
    await renderContext();

    const err = await context
      .convertToQuest(['a'], { title: 'Find the fire' }, { askOnSameName: true })
      .then(() => null, (e: unknown) => e);

    expect(err).toMatchObject({ name: 'SameNameError', kind: 'quest', existingId: 'find-the-fire' });
    expect(mockGetDocument).toHaveBeenCalledWith(QUESTS, 'find-the-fire');
  });

  it('adds to that quest instead, marking every rumour converted into it', async () => {
    await renderContext();

    await expect(
      context.convertToQuest(['a', 'b'], {
        title: 'Find the fire',
        description: 'Follow the smoke',
        objectives: [{ id: 'o1', description: 'Climb the hill', completed: false }],
        status: 'active',
      }, { into: 'find-the-fire' })
    ).resolves.toBe('find-the-fire');

    expect(mockCreateWithUpdates).not.toHaveBeenCalled();
    expect(mockMergeIntoDocument).toHaveBeenCalledWith(QUESTS, 'find-the-fire', RUMORS, expect.any(Function));
    const writes = await decide(
      { id: 'find-the-fire', title: 'Find the fire', description: 'Already written', objectives: [] },
      mockLoaded
    );

    expect(writes.fields).toEqual({
      objectives: [{ id: 'o1', description: 'Climb the hill', completed: false }],
    });
    expect(writes.updates).toEqual([
      { id: 'a', data: { convertedToQuestId: 'find-the-fire' } },
      { id: 'b', data: { convertedToQuestId: 'find-the-fire' } },
    ]);
    expect(writes.notes.map((n: any) => n.under)).toEqual([{ updated: 'a' }, { updated: 'b' }, 'target']);
    expect(writes.notes[0].data).toEqual({ content: 'Converted to quest: find-the-fire' });
    // The quest's note, of what its description said differently, signed.
    expect(writes.notes[2].data).toMatchObject({
      text: 'Also recorded as “Find the fire”:\nDescription: Follow the smoke',
      author: 'Pip',
    });
  });

  it('refuses when a rumour the page still shows has gone from the server', async () => {
    mockLoaded = [...mockLoaded, rumor('gone')];
    await renderContext();
    await context.convertToQuest(['a', 'gone'], { title: 'Find the fire' }, { into: 'find-the-fire' });

    const server = mockLoaded.filter((r) => r.id !== 'gone');
    await expect(decide({ id: 'find-the-fire', title: 'Find the fire' }, server)).rejects.toThrow(
      'One or more rumours not found'
    );
  });
});
