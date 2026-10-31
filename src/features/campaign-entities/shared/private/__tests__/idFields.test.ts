// src/features/campaign-entities/shared/private/__tests__/idFields.test.ts
import { privateIdsIn, rewriteIds } from '../idFields';

/**
 * T163: where a record names another by id. A shared record must never name
 * a private one, and a private record's new id must reach every field of its
 * author's records that named the old one.
 */

const PRIVATE = new Set(['npc:gollum', 'location:the-cave', 'quest:the-fish']);
const isPrivate = (kind: string, id: string) => PRIVATE.has(`${kind}:${id}`);

describe('privateIdsIn', () => {
  it('finds a private id in a list, a map and a list of objects', () => {
    expect(privateIdsIn('quest', { relatedNPCIds: ['bilbo', 'gollum'] }, isPrivate)).toEqual([
      { kind: 'npc', id: 'gollum' },
    ]);
    expect(privateIdsIn('npc', { connections: { relatedNPCs: ['gollum'], affiliations: ['gollum'] } }, isPrivate)).toEqual([
      { kind: 'npc', id: 'gollum' },
    ]);
    expect(
      privateIdsIn('quest', { keyLocations: [{ name: 'Cave', locationId: 'the-cave' }, { name: 'Shire' }] }, isPrivate)
    ).toEqual([{ kind: 'location', id: 'the-cave' }]);
  });

  it('finds a private id in a single field', () => {
    expect(privateIdsIn('location', { parentId: 'the-cave' }, isPrivate)).toEqual([{ kind: 'location', id: 'the-cave' }]);
    expect(privateIdsIn('rumor', { sourceNpcId: 'gollum', convertedToQuestId: 'the-fish' }, isPrivate)).toEqual([
      { kind: 'npc', id: 'gollum' },
      { kind: 'quest', id: 'the-fish' },
    ]);
  });

  it('reads an id by the kind its field names: a place called gollum is not the person', () => {
    expect(privateIdsIn('location', { parentId: 'gollum' }, isPrivate)).toEqual([]);
  });

  it('looks only at the fields written', () => {
    expect(privateIdsIn('quest', { title: 'gollum', description: 'the-cave' }, isPrivate)).toEqual([]);
    expect(privateIdsIn('npc', {}, isPrivate)).toEqual([]);
  });
});

describe('rewriteIds', () => {
  it('changes the id wherever it is named, and only there', () => {
    const quest = {
      relatedNPCIds: ['bilbo', 'gollum'],
      locationId: 'the-cave',
      keyLocations: [{ name: 'Cave', locationId: 'the-cave' }, { name: 'Shire', locationId: 'shire' }],
    };
    expect(rewriteIds('quest', quest, 'location', 'the-cave', 'the-cave-2')).toEqual({
      locationId: 'the-cave-2',
      keyLocations: [{ name: 'Cave', locationId: 'the-cave-2' }, { name: 'Shire', locationId: 'shire' }],
    });
    expect(rewriteIds('quest', quest, 'npc', 'gollum', 'gollum-2')).toEqual({ relatedNPCIds: ['bilbo', 'gollum-2'] });
  });

  it('rewrites a list inside a map and keeps the rest of the map', () => {
    const npc = { connections: { relatedNPCs: ['gollum'], affiliations: ['Misty Mountains'] } };
    expect(rewriteIds('npc', npc, 'npc', 'gollum', 'gollum-2')).toEqual({
      connections: { relatedNPCs: ['gollum-2'], affiliations: ['Misty Mountains'] },
    });
  });

  it('says nothing changes for a record that does not name the id', () => {
    expect(rewriteIds('rumor', { relatedNPCs: ['bilbo'] }, 'npc', 'gollum', 'gollum-2')).toBeNull();
    // A rumour's quest is named by its own kind only.
    expect(rewriteIds('rumor', { convertedToQuestId: 'gollum' }, 'npc', 'gollum', 'gollum-2')).toBeNull();
  });
});
