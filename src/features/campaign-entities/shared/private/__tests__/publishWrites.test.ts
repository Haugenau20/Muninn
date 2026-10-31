// src/features/campaign-entities/shared/private/__tests__/publishWrites.test.ts
import { publishReads, publishWrites, type PublishInput, type PublishItem } from '../publishWrites';
import type { HeldLink, PrivateDoc } from '../PrivateRecordsContext';

/**
 * T163: what one publish writes. The records move into the campaign (or into
 * a same-named one), their notes with them; held links are written onto their
 * owners; links to records still private are held the other way; every id
 * that changes is changed wherever the author's records name it.
 */

const C = 'groups/g1/campaigns/c1';
const P = 'groups/g1/users/u1/private/c1';
const stamps = {
  creation: { createdBy: 'u1', modifiedBy: 'u1', createdAt: 'NOW', modifiedAt: 'NOW' },
  modification: { modifiedBy: 'u1', modifiedAt: 'NOW' },
};
const priv = (fields: Record<string, unknown>) => ({ ...fields, isPrivate: true, createdBy: 'u1' }) as unknown as PrivateDoc;

function input(items: PublishItem[], extra: { records?: Partial<PublishInput['space']['records']>; links?: HeldLink[] } = {}): PublishInput {
  const records = { npc: [], location: [], quest: [], rumor: [], ...extra.records };
  for (const item of items) {
    if (!records[item.kind].some((record: PrivateDoc) => record.id === item.record.id)) {
      records[item.kind] = [...records[item.kind], item.record];
    }
  }
  return {
    items,
    space: {
      paths: { npc: `${P}/npcs`, location: `${P}/locations`, quest: `${P}/quests`, rumor: `${P}/rumors`, links: `${P}/links` },
      records,
      links: extra.links ?? [],
    },
    shared: { npc: `${C}/npcs`, location: `${C}/locations`, quest: `${C}/quests`, rumor: `${C}/rumors` },
    stamps,
    author: 'Zendikarr',
  };
}

const noneRead = () => undefined;
const writesTo = (writes: ReturnType<typeof publishWrites>, collection: string) =>
  writes.filter((write) => write.collection === collection);

const gollum = priv({ id: 'gollum', name: 'Gollum', occupation: 'Fisher', connections: { relatedNPCs: [], affiliations: [] } });

describe('a record of its own', () => {
  it('is created in the campaign, freshly stamped and unmarked, and leaves the private space', () => {
    const writes = publishWrites(
      input([{ kind: 'npc', record: gollum, notes: [{ id: 'n1', text: 'Lost a ring', createdBy: 'u1' }], target: { kind: 'own', id: 'gollum' } }]),
      noneRead
    );

    expect(writes).toEqual(expect.arrayContaining([
      {
        type: 'create',
        collection: `${C}/npcs`,
        id: 'gollum',
        data: { name: 'Gollum', occupation: 'Fisher', connections: { relatedNPCs: [], affiliations: [] }, ...stamps.creation },
      },
      { type: 'set', collection: `${C}/npcs/gollum/notes`, id: 'n1', data: { text: 'Lost a ring', ...stamps.creation } },
      { type: 'delete', collection: `${P}/npcs/gollum/notes`, id: 'n1' },
      { type: 'delete', collection: `${P}/npcs`, id: 'gollum' },
    ]));
    for (const write of writes) expect(write.data?.isPrivate).toBeUndefined();
  });

  it('is read for, so the commit creates it only if nobody took the id', () => {
    const reads = publishReads(input([{ kind: 'npc', record: gollum, notes: [], target: { kind: 'own', id: 'gollum' } }]));
    expect(reads).toEqual([{ collection: `${C}/npcs`, id: 'gollum' }]);
  });

  it('takes the name it was published under', () => {
    const writes = publishWrites(
      input([{ kind: 'npc', record: gollum, notes: [], target: { kind: 'own', id: 'smeagol', name: 'Sméagol' } }]),
      noneRead
    );
    expect(writes.find((write) => write.type === 'create')).toMatchObject({ id: 'smeagol', data: { name: 'Sméagol' } });
  });
});

describe('links', () => {
  it('writes each link held for it onto its owner, and lets the held link go', () => {
    const links: HeldLink[] = [{ id: 'l1', from: { kind: 'npc', id: 'gollum' }, to: { kind: 'quest', id: 'ring' } }];
    const i = input([{ kind: 'npc', record: gollum, notes: [], target: { kind: 'own', id: 'gollum' } }], { links });
    const ring = { id: 'ring', title: 'The ring', relatedNPCIds: ['bilbo'] };

    expect(publishReads(i)).toEqual(expect.arrayContaining([{ collection: `${C}/quests`, id: 'ring' }]));
    const writes = publishWrites(i, (collection, id) => (collection === `${C}/quests` && id === 'ring' ? ring : undefined));

    expect(writes).toEqual(expect.arrayContaining([
      { type: 'update', collection: `${C}/quests`, id: 'ring', data: { relatedNPCIds: ['bilbo', 'gollum'], ...stamps.modification } },
      { type: 'delete', collection: `${P}/links`, id: 'l1' },
    ]));
  });

  it('lets a held link go without writing when its owner was deleted meanwhile', () => {
    const links: HeldLink[] = [{ id: 'l1', from: { kind: 'npc', id: 'gollum' }, to: { kind: 'quest', id: 'gone' } }];
    const writes = publishWrites(input([{ kind: 'npc', record: gollum, notes: [], target: { kind: 'own', id: 'gollum' } }], { links }), noneRead);
    expect(writesTo(writes, `${C}/quests`)).toEqual([]);
    expect(writes).toContainEqual({ type: 'delete', collection: `${P}/links`, id: 'l1' });
  });

  it('holds, the other way round, a link it owns to a record still private', () => {
    const fish = priv({ id: 'fish', title: 'The fish', relatedNPCIds: ['bilbo', 'gollum'], objectives: [] });
    const writes = publishWrites(
      input([{ kind: 'quest', record: fish, notes: [], target: { kind: 'own', id: 'fish' } }], { records: { npc: [gollum] } }),
      noneRead
    );

    expect(writes.find((write) => write.type === 'create')?.data).toMatchObject({ relatedNPCIds: ['bilbo'] });
    expect(writesTo(writes, `${P}/links`)).toEqual([{
      type: 'set',
      collection: `${P}/links`,
      id: expect.any(String),
      data: { from: { kind: 'npc', id: 'gollum' }, to: { kind: 'quest', id: 'fish' }, createdAt: 'NOW' },
    }]);
  });

  it('clears, without holding, a rumour’s private source: it is not a link of its own', () => {
    const riddles = priv({ id: 'riddles', title: 'Riddles', sourceNpcId: 'gollum', sourceName: 'Gollum', relatedNPCs: [], relatedLocations: [] });
    const writes = publishWrites(
      input([{ kind: 'rumor', record: riddles, notes: [], target: { kind: 'own', id: 'riddles' } }], { records: { npc: [gollum] } }),
      noneRead
    );
    expect(writes.find((write) => write.type === 'create')?.data).toMatchObject({ sourceNpcId: '', sourceName: 'Gollum' });
    expect(writesTo(writes, `${P}/links`)).toEqual([]);
  });
});

describe('an id that changes', () => {
  const fish = priv({ id: 'fish', title: 'The fish', relatedNPCIds: [], objectives: [] });
  const riddles = priv({ id: 'riddles', title: 'Riddles', convertedToQuestId: 'fish', relatedNPCs: [], relatedLocations: [] });

  it('is renamed in the records published with it, marks in their notes included', () => {
    const writes = publishWrites(
      input([
        { kind: 'rumor', record: riddles, notes: [{ id: 'm1', content: 'Converted to quest: fish' }], target: { kind: 'own', id: 'riddles' } },
        { kind: 'quest', record: fish, notes: [], target: { kind: 'own', id: 'fish-2' } },
      ]),
      noneRead
    );

    expect(writes.find((write) => write.type === 'create' && write.id === 'riddles')?.data).toMatchObject({ convertedToQuestId: 'fish-2' });
    expect(writes).toContainEqual({
      type: 'set',
      collection: `${C}/rumors/riddles/notes`,
      id: 'm1',
      data: { content: 'Converted to quest: fish-2', ...stamps.creation },
    });
  });

  it('is renamed in the author’s records that stay private', () => {
    const plans = priv({ id: 'plans', title: 'Plans', relatedNPCIds: ['gollum'], objectives: [] });
    const writes = publishWrites(
      input([{ kind: 'npc', record: gollum, notes: [], target: { kind: 'own', id: 'gollum-2' } }], { records: { quest: [plans] } }),
      noneRead
    );
    expect(writes).toContainEqual({
      type: 'update',
      collection: `${P}/quests`,
      id: 'plans',
      data: { relatedNPCIds: ['gollum-2'], ...stamps.modification },
    });
  });
});

describe('added to a same-named shared record', () => {
  const grog = { id: 'grog', name: 'Grog', occupation: '', description: 'Runs the ferry.' };
  const mine = priv({ id: 'grog-private', name: 'Grog', occupation: 'Smith', description: 'Owns a boat.' });

  it('fills what it lacks, notes what differs, signed, and brings its notes under it', () => {
    const i = input([{ kind: 'npc', record: mine, notes: [{ id: 'n1', text: 'Met at the quay' }], target: { kind: 'merge', into: 'grog' } }]);
    expect(publishReads(i)).toEqual([{ collection: `${C}/npcs`, id: 'grog' }]);

    const writes = publishWrites(i, (collection, id) => (collection === `${C}/npcs` && id === 'grog' ? grog : undefined));

    expect(writes).toEqual(expect.arrayContaining([
      { type: 'update', collection: `${C}/npcs`, id: 'grog', data: { occupation: 'Smith', ...stamps.modification } },
      {
        type: 'set',
        collection: `${C}/npcs/grog/notes`,
        id: expect.any(String),
        data: expect.objectContaining({ text: 'Also recorded as “Grog”:\nDescription: Owns a boat.', author: 'Zendikarr' }),
      },
      { type: 'set', collection: `${C}/npcs/grog/notes`, id: 'n1', data: { text: 'Met at the quay', ...stamps.creation } },
      { type: 'delete', collection: `${P}/npcs`, id: 'grog-private' },
    ]));
    expect(writes.some((write) => write.type === 'create')).toBe(false);
  });

  it('refuses when that record was deleted meanwhile', () => {
    expect(() =>
      publishWrites(input([{ kind: 'npc', record: mine, notes: [], target: { kind: 'merge', into: 'grog' } }]), noneRead)
    ).toThrow('Grog was to be added to a record that has since been deleted.');
  });
});

describe('the author’s session notes, and their notes’ order', () => {
  const NOTES = 'groups/g1/users/u1/notes';

  it('points a session note’s mark at where the record went, from the note as read', () => {
    const i = {
      ...input([{ kind: 'npc' as const, record: gollum, notes: [], target: { kind: 'own' as const, id: 'gollum-2' } }]),
      marks: { path: NOTES, noteIds: ['session-3'] },
    };
    expect(publishReads(i)).toContainEqual({ collection: NOTES, id: 'session-3' });

    const session = {
      id: 'session-3',
      extractedEntities: [
        { id: 'e1', type: 'npc', convertedToId: 'gollum' },
        { id: 'e2', type: 'npc', convertedToId: 'bilbo' },
      ],
    };
    const writes = publishWrites(i, (collection, id) => (collection === NOTES && id === 'session-3' ? session : undefined));
    expect(writesTo(writes, NOTES)).toEqual([{
      type: 'update',
      collection: NOTES,
      id: 'session-3',
      data: {
        extractedEntities: [
          { id: 'e1', type: 'npc', convertedToId: 'gollum-2' },
          { id: 'e2', type: 'npc', convertedToId: 'bilbo' },
        ],
      },
    }]);
  });

  it('keeps when each note was first written, for its order', () => {
    const writes = publishWrites(
      input([{
        kind: 'npc',
        record: gollum,
        notes: [{ id: 'n1', text: 'Lost a ring', createdAt: 'THEN' }],
        target: { kind: 'own', id: 'gollum' },
      }]),
      noneRead
    );
    expect(writes).toContainEqual({
      type: 'set',
      collection: `${C}/npcs/gollum/notes`,
      id: 'n1',
      data: { text: 'Lost a ring', recordedAt: 'THEN', ...stamps.creation },
    });
  });
});
