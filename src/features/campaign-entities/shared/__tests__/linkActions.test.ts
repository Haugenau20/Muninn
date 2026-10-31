// src/features/campaign-entities/shared/__tests__/linkActions.test.ts
//
// T131: a link added or removed from either page lands in its owner, and
// removing one clears the old second half too.
import { createLinkActions, LinkDeps } from '../linkActions';
import { resolveRecordChange } from '@/test-utils/update-after-reading';

type Store = Record<string, any>;

/** Actions over an in-memory campaign, recording every write as resolved fields. */
function setup(records: { npcs?: any[]; quests?: any[]; locations?: any[]; rumors?: any[] }) {
  const npcs = records.npcs ?? [];
  const quests = records.quests ?? [];
  const locations = records.locations ?? [];
  const rumors = records.rumors ?? [];
  const writes: Array<[string, string, any]> = [];
  const writer = (kind: string, list: any[]) => async (id: string, change: any) => {
    const current: Store = list.find((record) => record.id === id) ?? { id };
    writes.push([kind, id, resolveRecordChange(change, current)]);
  };
  const deps: LinkDeps = {
    npcs,
    quests,
    locations,
    updateNPC: writer('npc', npcs),
    updateQuest: writer('quest', quests),
    updateLocation: writer('location', locations),
    updateRumor: writer('rumor', rumors),
  };
  return { ...createLinkActions(deps), writes };
}

const npc = (id: string, connections: Partial<Record<string, string[]>> = {}, extra = {}) => ({
  id,
  name: id,
  connections: { relatedNPCs: [], affiliations: [], relatedQuests: [], ...connections },
  ...extra,
});

describe('person ↔ quest', () => {
  it('writes the quest, whichever end it starts from', async () => {
    for (const [a, b] of [
      [{ kind: 'npc', id: 'frodo' }, { kind: 'quest', id: 'ring' }],
      [{ kind: 'quest', id: 'ring' }, { kind: 'npc', id: 'frodo' }],
    ] as const) {
      const { link, writes } = setup({ npcs: [npc('frodo')], quests: [{ id: 'ring', relatedNPCIds: ['sam'] }] });
      await link(a, b);
      expect(writes).toEqual([['quest', 'ring', { relatedNPCIds: ['sam', 'frodo'] }]]);
    }
  });

  it("removes it from the quest, and leaves the person's old list alone", async () => {
    const { unlink, writes } = setup({
      npcs: [npc('frodo', { relatedQuests: ['ring', 'other'] })],
      quests: [{ id: 'ring', relatedNPCIds: ['frodo'] }],
    });
    await unlink({ kind: 'npc', id: 'frodo' }, { kind: 'quest', id: 'ring' });
    expect(writes).toEqual([['quest', 'ring', { relatedNPCIds: [] }]]);
  });
});

describe('person ↔ place', () => {
  it('adds the person to the place, replacing nothing', async () => {
    const { link, writes } = setup({ npcs: [npc('strider', {}, { locationId: 'bree' })], locations: [{ id: 'rivendell' }] });
    await link({ kind: 'npc', id: 'strider' }, { kind: 'location', id: 'rivendell' });
    expect(writes).toEqual([['location', 'rivendell', { connectedNPCs: ['strider'] }]]);
  });

  it('removes the person from the place that lists them, and leaves the person alone', async () => {
    const { unlink, writes } = setup({
      npcs: [npc('strider', {}, { locationId: 'bree', location: 'Bree' })],
      locations: [{ id: 'bree', connectedNPCs: ['strider', 'nob'] }],
    });
    await unlink({ kind: 'npc', id: 'strider' }, { kind: 'location', id: 'bree' });
    expect(writes).toEqual([['location', 'bree', { connectedNPCs: ['nob'] }]]);
  });
});

describe('place ↔ quest', () => {
  const erebor = { id: 'erebor', name: 'Erebor', relatedQuests: [] as string[] };

  it("makes the place the quest's own location when it has none", async () => {
    const { link, writes } = setup({ locations: [erebor], quests: [{ id: 'q' }] });
    await link({ kind: 'location', id: 'erebor' }, { kind: 'quest', id: 'q' });
    expect(writes).toEqual([['quest', 'q', { locationId: 'erebor', location: 'Erebor' }]]);
  });

  it('adds it as one of the places of a quest that has a location', async () => {
    const { link, writes } = setup({ locations: [erebor], quests: [{ id: 'q', locationId: 'dale' }] });
    await link({ kind: 'quest', id: 'q' }, { kind: 'location', id: 'erebor' });
    expect(writes).toEqual([
      ['quest', 'q', { keyLocations: [{ name: 'Erebor', description: '', locationId: 'erebor' }] }],
    ]);
  });

  it("removes every way the quest names the place, and leaves the place's old list alone", async () => {
    const { unlink, writes } = setup({
      locations: [{ ...erebor, relatedQuests: ['q'] }],
      quests: [{ id: 'q', locationId: 'erebor', keyLocations: [{ name: 'erebor' }, { name: 'Dale', description: 'x' }] }],
    });
    await unlink({ kind: 'quest', id: 'q' }, { kind: 'location', id: 'erebor' });
    expect(writes).toEqual([
      ['quest', 'q', { locationId: '', location: '', keyLocations: [{ name: 'Dale', description: 'x' }] }],
    ]);
  });

  it('writes nothing to a quest that does not name the place', async () => {
    const { unlink, writes } = setup({ locations: [erebor], quests: [{ id: 'q', locationId: 'dale' }] });
    await unlink({ kind: 'quest', id: 'q' }, { kind: 'location', id: 'erebor' });
    expect(writes).toEqual([]);
  });
});

describe('rumour links', () => {
  it('writes the rumour for a place and for a person', async () => {
    const { link, writes } = setup({ rumors: [{ id: 'r', relatedNPCs: [], relatedLocations: [] }] });
    await link({ kind: 'location', id: 'bree' }, { kind: 'rumor', id: 'r' });
    await link({ kind: 'rumor', id: 'r' }, { kind: 'npc', id: 'frodo' });
    expect(writes).toEqual([
      ['rumor', 'r', { relatedLocations: ['bree'] }],
      ['rumor', 'r', { relatedNPCs: ['frodo'] }],
    ]);
  });

  it('clears where it was heard too, when that is the place unlinked', async () => {
    const { unlink, writes } = setup({ rumors: [{ id: 'r', locationId: 'bree', relatedLocations: ['bree'] }] });
    await unlink({ kind: 'rumor', id: 'r' }, { kind: 'location', id: 'bree' });
    expect(writes).toEqual([['rumor', 'r', { relatedLocations: [], locationId: '', location: '' }]]);
  });
});

describe('person ↔ person', () => {
  it('stores the link once: nothing when the other already holds it', async () => {
    const { link, writes } = setup({ npcs: [npc('arwen'), npc('aragorn', { relatedNPCs: ['arwen'] })] });
    await link({ kind: 'npc', id: 'arwen' }, { kind: 'npc', id: 'aragorn' });
    expect(writes).toEqual([]);
  });

  it('otherwise on the person whose page added it', async () => {
    const { link, writes } = setup({ npcs: [npc('arwen'), npc('aragorn')] });
    await link({ kind: 'npc', id: 'arwen' }, { kind: 'npc', id: 'aragorn' });
    expect(writes).toEqual([['npc', 'arwen', { connections: { relatedNPCs: ['aragorn'], affiliations: [], relatedQuests: [] } }]]);
  });

  it('removes it from whichever side holds it, from either page', async () => {
    const { unlink, writes } = setup({ npcs: [npc('arwen'), npc('aragorn', { relatedNPCs: ['arwen', 'legolas'] })] });
    await unlink({ kind: 'npc', id: 'arwen' }, { kind: 'npc', id: 'aragorn' });
    expect(writes).toEqual([
      ['npc', 'aragorn', { connections: { relatedNPCs: ['legolas'], affiliations: [], relatedQuests: [] } }],
    ]);
  });
});

it('refuses a pair that cannot be linked', async () => {
  const { link } = setup({});
  await expect(link({ kind: 'quest', id: 'a' }, { kind: 'quest', id: 'b' })).rejects.toThrow(/cannot be linked/);
});

// T163: a private record's id never reaches a shared one. A link whose owner
// is shared and whose other end is private is held instead.
describe('links to private records', () => {
  const privately = (records: Parameters<typeof setup>[0], privateIds: string[]) => {
    const held: Array<['hold' | 'release', string, string]> = [];
    const npcs = records.npcs ?? [];
    const quests = records.quests ?? [];
    const locations = records.locations ?? [];
    const writes: Array<[string, string, any]> = [];
    const writer = (kind: string, list: any[]) => async (id: string, change: any) => {
      writes.push([kind, id, resolveRecordChange(change, list.find((record) => record.id === id) ?? { id })]);
    };
    const actions = createLinkActions({
      npcs,
      quests,
      locations,
      updateNPC: writer('npc', npcs),
      updateQuest: writer('quest', quests),
      updateLocation: writer('location', locations),
      updateRumor: writer('rumor', records.rumors ?? []),
      privacy: {
        isPrivate: (end) => privateIds.includes(`${end.kind}:${end.id}`),
        hold: async (from, to) => {
          held.push(['hold', `${from.kind}:${from.id}`, `${to.kind}:${to.id}`]);
        },
        release: async (from, to) => {
          held.push(['release', `${from.kind}:${from.id}`, `${to.kind}:${to.id}`]);
        },
      },
    });
    return { ...actions, writes, held };
  };

  it('holds a private person on a shared quest, and writes nothing shared', async () => {
    const { link, writes, held } = privately(
      { npcs: [npc('gollum')], quests: [{ id: 'ring', relatedNPCIds: [] }] },
      ['npc:gollum']
    );
    await link({ kind: 'quest', id: 'ring' }, { kind: 'npc', id: 'gollum' });
    expect(writes).toEqual([]);
    expect(held).toEqual([['hold', 'npc:gollum', 'quest:ring']]);
  });

  it('writes a shared person into a private quest, which owns the link', async () => {
    const { link, writes, held } = privately(
      { npcs: [npc('bilbo')], quests: [{ id: 'the-fish', relatedNPCIds: [] }] },
      ['quest:the-fish']
    );
    await link({ kind: 'npc', id: 'bilbo' }, { kind: 'quest', id: 'the-fish' });
    expect(writes).toEqual([['quest', 'the-fish', { relatedNPCIds: ['bilbo'] }]]);
    expect(held).toEqual([]);
  });

  it('holds a shared quest to a private place, owner and all', async () => {
    const { link, writes, held } = privately(
      { quests: [{ id: 'ring', locationId: '' }], locations: [{ id: 'the-cave', name: 'The cave' }] },
      ['location:the-cave']
    );
    await link({ kind: 'location', id: 'the-cave' }, { kind: 'quest', id: 'ring' });
    expect(writes).toEqual([]);
    expect(held).toEqual([['hold', 'location:the-cave', 'quest:ring']]);
  });

  it('stores two people on the private one of them, so nothing is held', async () => {
    const { link, writes, held } = privately({ npcs: [npc('bilbo'), npc('gollum')] }, ['npc:gollum']);
    await link({ kind: 'npc', id: 'bilbo' }, { kind: 'npc', id: 'gollum' });
    expect(writes).toEqual([['npc', 'gollum', { connections: expect.objectContaining({ relatedNPCs: ['bilbo'] }) }]]);
    expect(held).toEqual([]);
  });

  it('lets go of a held link, and the shared owner is not written', async () => {
    const { unlink, writes, held } = privately(
      { npcs: [npc('gollum')], quests: [{ id: 'ring', relatedNPCIds: [] }] },
      ['npc:gollum']
    );
    await unlink({ kind: 'npc', id: 'gollum' }, { kind: 'quest', id: 'ring' });
    expect(writes).toEqual([]);
    expect(held).toEqual([['release', 'npc:gollum', 'quest:ring']]);
  });

  it('links two shared records as before', async () => {
    const { link, writes, held } = privately(
      { npcs: [npc('bilbo')], quests: [{ id: 'ring', relatedNPCIds: [] }] },
      ['npc:gollum']
    );
    await link({ kind: 'npc', id: 'bilbo' }, { kind: 'quest', id: 'ring' });
    expect(writes).toEqual([['quest', 'ring', { relatedNPCIds: ['bilbo'] }]]);
    expect(held).toEqual([]);
  });
});
