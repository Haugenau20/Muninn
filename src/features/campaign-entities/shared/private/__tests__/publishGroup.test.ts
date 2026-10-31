// src/features/campaign-entities/shared/private/__tests__/publishGroup.test.ts
import { blockedByParent, findPublishGroup } from '../publishGroup';
import type { PrivateDoc, PrivateKind } from '../PrivateRecordsContext';

/**
 * T163: records joined by a conversion or a combine publish together,
 * followed both ways; a place waits for a private parent.
 */

const priv = (fields: Record<string, unknown>) => ({ ...fields, isPrivate: true }) as PrivateDoc;
const space = (records: Partial<Record<PrivateKind, PrivateDoc[]>>) => ({
  npc: [], location: [], quest: [], rumor: [], ...records,
});

describe('findPublishGroup', () => {
  it('is the record alone when nothing joins it', async () => {
    const group = await findPublishGroup({ kind: 'npc', id: 'gollum' }, space({ npc: [priv({ id: 'gollum' })] }), async () => []);
    expect(group).toEqual([{ kind: 'npc', id: 'gollum' }]);
  });

  it('takes a converted rumour’s quest, and the quest every rumour converted into it', async () => {
    const records = space({
      rumor: [
        priv({ id: 'a', convertedToQuestId: 'fish' }),
        priv({ id: 'b', convertedToQuestId: 'fish' }),
        priv({ id: 'c' }),
      ],
      quest: [priv({ id: 'fish' })],
    });
    const group = await findPublishGroup({ kind: 'rumor', id: 'a' }, records, async () => []);
    expect(group).toEqual([
      { kind: 'rumor', id: 'a' },
      { kind: 'quest', id: 'fish' },
      { kind: 'rumor', id: 'b' },
    ]);
  });

  it('follows a combine both ways through the rumours’ notes, then the conversion beyond it', async () => {
    const records = space({
      rumor: [priv({ id: 'a' }), priv({ id: 'b' }), priv({ id: 'ab', convertedToQuestId: 'fish' })],
      quest: [priv({ id: 'fish' })],
    });
    const notes: Record<string, string[]> = {
      a: ['Combined into rumour: ab'],
      b: ['Combined into rumour: ab'],
      ab: ['Combined from rumours: a, b'],
    };
    const group = await findPublishGroup({ kind: 'rumor', id: 'a' }, records, async (id) => notes[id] ?? []);
    expect(group.map((ref) => `${ref.kind}:${ref.id}`).sort()).toEqual(['quest:fish', 'rumor:a', 'rumor:ab', 'rumor:b']);
  });

  it('stops at a record that is not the author’s private one', async () => {
    const records = space({ rumor: [priv({ id: 'a', convertedToQuestId: 'shared-quest' })] });
    const group = await findPublishGroup({ kind: 'rumor', id: 'a' }, records, async () => ['Combined into rumour: shared']);
    expect(group).toEqual([{ kind: 'rumor', id: 'a' }]);
  });
});

describe('blockedByParent', () => {
  const cave = priv({ id: 'cave', name: 'The cave', parentId: '' });
  const ledge = priv({ id: 'ledge', name: 'Ledge', parentId: 'cave' });

  it('stops a place whose parent is still private', () => {
    expect(blockedByParent([{ kind: 'location', id: 'ledge' }], space({ location: [cave, ledge] }))).toBe(
      'Ledge is inside The cave, which is private: publish The cave first.'
    );
  });

  it('lets a place go with its parent, or under a shared one', () => {
    expect(
      blockedByParent([{ kind: 'location', id: 'cave' }, { kind: 'location', id: 'ledge' }], space({ location: [cave, ledge] }))
    ).toBeNull();
    const underShared = priv({ id: 'nook', name: 'Nook', parentId: 'shire' });
    expect(blockedByParent([{ kind: 'location', id: 'nook' }], space({ location: [underShared] }))).toBeNull();
  });
});
