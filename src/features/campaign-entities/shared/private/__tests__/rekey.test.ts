// src/features/campaign-entities/shared/private/__tests__/rekey.test.ts
import { rekeyWrites } from '../rekey';
import type { PrivateDoc, PrivateKind, HeldLink } from '../PrivateRecordsContext';

/**
 * T163: renaming one of the author's private records -- when another player
 * took its id for a shared record -- reaches everything of theirs that names
 * it, in one batch, and nothing shared.
 */

const mockGetCollection = jest.fn();
jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: {
    document: { getCollectionFromServer: (path: string) => mockGetCollection(path) },
  },
}));

const P = 'groups/g1/users/u1/private/c1';
const doc = (fields: Record<string, unknown>) => ({ ...fields, isPrivate: true }) as PrivateDoc;
const stamps = {
  creation: { createdBy: 'u1', modifiedBy: 'u1', createdAt: 'NOW', modifiedAt: 'NOW' },
  modification: { modifiedBy: 'u1', modifiedAt: 'NOW' },
};

const space = (links: HeldLink[] = []) => ({
  paths: {
    npc: `${P}/npcs`,
    location: `${P}/locations`,
    quest: `${P}/quests`,
    rumor: `${P}/rumors`,
    links: `${P}/links`,
  } as Record<PrivateKind | 'links', string>,
  records: {
    npc: [doc({ id: 'gollum', name: 'Gollum', createdBy: 'u1', createdAt: 'THEN' })],
    location: [],
    quest: [doc({ id: 'the-fish', title: 'The fish', relatedNPCIds: ['bilbo', 'gollum'] })],
    rumor: [doc({ id: 'riddles', title: 'Riddles', relatedNPCs: ['gollum'], sourceNpcId: 'gollum' })],
  },
  links,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCollection.mockResolvedValue([{ id: 'n1', text: 'Lost a ring', createdBy: 'u1', createdAt: 'THEN' }]);
});

it('moves the record and its notes, freshly stamped, and deletes the old ones', async () => {
  const ops = await rekeyWrites('npc', 'gollum', 'gollum-2', space(), stamps);

  expect(mockGetCollection).toHaveBeenCalledWith(`${P}/npcs/gollum/notes`);
  expect(ops).toEqual(expect.arrayContaining([
    { type: 'set', collection: `${P}/npcs`, id: 'gollum-2', data: { name: 'Gollum', ...stamps.creation } },
    { type: 'set', collection: `${P}/npcs/gollum-2/notes`, id: 'n1', data: { text: 'Lost a ring', ...stamps.creation } },
    { type: 'delete', collection: `${P}/npcs/gollum/notes`, id: 'n1' },
    { type: 'delete', collection: `${P}/npcs`, id: 'gollum' },
  ]));
  // The in-memory mark never reaches a document.
  for (const op of ops) expect((op.data as Record<string, unknown> | undefined)?.isPrivate).toBeUndefined();
});

it('renames it in every other private record that names it', async () => {
  const ops = await rekeyWrites('npc', 'gollum', 'gollum-2', space(), stamps);

  expect(ops).toEqual(expect.arrayContaining([
    {
      type: 'update',
      collection: `${P}/quests`,
      id: 'the-fish',
      data: { relatedNPCIds: ['bilbo', 'gollum-2'], ...stamps.modification },
    },
    {
      type: 'update',
      collection: `${P}/rumors`,
      id: 'riddles',
      data: { relatedNPCs: ['gollum-2'], sourceNpcId: 'gollum-2', ...stamps.modification },
    },
  ]));
});

it('replaces each held link with one at the new id, never changing one in place', async () => {
  const ops = await rekeyWrites('npc', 'gollum', 'gollum-2', space([
    { id: 'l1', from: { kind: 'npc', id: 'gollum' }, to: { kind: 'quest', id: 'the-ring' } },
    { id: 'l2', from: { kind: 'npc', id: 'bilbo' }, to: { kind: 'quest', id: 'the-ring' } },
  ]), stamps);

  const linkOps = ops.filter((op) => op.collection === `${P}/links`);
  expect(linkOps).toEqual([
    { type: 'delete', collection: `${P}/links`, id: 'l1' },
    {
      type: 'set',
      collection: `${P}/links`,
      id: expect.not.stringMatching(/^l1$/),
      data: { from: { kind: 'npc', id: 'gollum-2' }, to: { kind: 'quest', id: 'the-ring' }, createdAt: 'NOW' },
    },
  ]);
});

it('touches nothing outside the author’s private space', async () => {
  const ops = await rekeyWrites('npc', 'gollum', 'gollum-2', space(), stamps);
  for (const op of ops) expect(op.collection.startsWith(`${P}/`)).toBe(true);
});

it('refuses a record that is no longer there', async () => {
  await expect(rekeyWrites('npc', 'smeagol', 'smeagol-2', space(), stamps)).rejects.toThrow(
    'That private record is not here any more.'
  );
});
