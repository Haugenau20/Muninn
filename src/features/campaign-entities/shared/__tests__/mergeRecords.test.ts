// src/features/campaign-entities/shared/__tests__/mergeRecords.test.ts
import { describeMerge, mergeNote, planMerge } from '../mergeRecords';

/**
 * T163, "Add what you know to it": lists are joined, fields the record
 * leaves empty are filled, a field both fill differently goes into a note
 * signed by the writer, and nothing the record holds is overwritten.
 */

describe('planMerge', () => {
  describe('a person', () => {
    const grog = {
      id: 'grog',
      name: 'Grog',
      occupation: '',
      race: 'Half-orc',
      description: 'Runs the ferry.',
      status: 'missing',
      relationship: 'unknown',
      connections: { relatedNPCs: ['odile'], affiliations: ['Ferrymen'] },
      tags: [],
    };

    it('fills what the record leaves empty, and nothing else', () => {
      const plan = planMerge('npc', grog, { name: 'Grog', occupation: 'Smith', race: 'Half-orc' });
      expect(plan.fields).toEqual({ occupation: 'Smith' });
      expect(plan.added).toEqual(['Occupation: Smith']);
      expect(plan.differing).toEqual([]);
    });

    it('keeps a field both fill differently, and holds the new text for a note', () => {
      const plan = planMerge('npc', grog, { name: 'Grog', description: 'Owns a boat.' });
      expect(plan.fields).toEqual({});
      expect(plan.differing).toEqual([{ label: 'Description', value: 'Owns a boat.' }]);
    });

    it('reads text that differs only in case and spacing as the same', () => {
      const plan = planMerge('npc', grog, { name: 'Grog', description: '  runs the  FERRY. ' });
      expect(plan.differing).toEqual([]);
    });

    it('joins lists inside the connections map, keeping the other list in it', () => {
      const plan = planMerge('npc', grog, {
        name: 'Grog',
        connections: { relatedNPCs: ['odile', 'vesk'], affiliations: ['ferrymen', 'Harpers'] },
      });
      expect(plan.fields).toEqual({
        connections: { relatedNPCs: ['odile', 'vesk'], affiliations: ['Ferrymen', 'Harpers'] },
      });
      expect(plan.added).toEqual(['1 more people they know', 'Affiliations: Harpers']);
    });

    it('takes no quick-add default for an answer, and fills an unknown stance', () => {
      const plan = planMerge('npc', grog, { name: 'Grog', status: 'alive', relationship: 'hostile' });
      expect(plan.fields).toEqual({ relationship: 'hostile' });
      expect(plan.differing).toEqual([]);
    });

    it('notes a status both chose differently', () => {
      const plan = planMerge('npc', grog, { name: 'Grog', status: 'deceased' });
      expect(plan.fields).toEqual({});
      expect(plan.differing).toEqual([{ label: 'Status', value: 'deceased' }]);
    });
  });

  describe('a quest', () => {
    const quest = {
      id: 'find-the-ledger',
      title: 'Find the ledger',
      description: 'Before the magistrate does.',
      status: 'active',
      objectives: [{ id: 'o1', description: 'Search the mill', completed: true }],
      keyLocations: [{ name: 'The mill', description: '' }],
      relatedNPCIds: [],
      locationId: '',
      location: '',
    };

    it('adds objectives and places it lacks, matched by what they say', () => {
      const plan = planMerge('quest', quest, {
        title: 'Find the ledger',
        status: 'active',
        objectives: [
          { id: 'x1', description: 'search the mill', completed: false },
          { id: 'x2', description: 'Ask the ferryman', completed: false },
        ],
        keyLocations: [{ name: 'the Mill', description: 'again' }, { name: 'The ford', description: '' }],
      });
      expect(plan.fields.objectives).toEqual([
        quest.objectives[0],
        { id: 'x2', description: 'Ask the ferryman', completed: false },
      ]);
      expect(plan.fields.keyLocations).toEqual([...quest.keyLocations, { name: 'The ford', description: '' }]);
      expect(plan.fields).not.toHaveProperty('status');
      expect(plan.added).toEqual(['Objectives: Ask the ferryman', 'Places inside it: The ford']);
    });

    it('fills an empty place with the link and its name', () => {
      const plan = planMerge('quest', quest, { title: 'Find the ledger', locationId: 'mill', location: 'The mill' });
      expect(plan.fields).toEqual({ locationId: 'mill', location: 'The mill' });
      expect(plan.added).toContain('Place: The mill');
    });
  });

  describe('a place', () => {
    it('leaves a quick-add type alone, and notes one chosen differently', () => {
      const ford = { id: 'ford', name: 'Greywater Ford', type: 'landmark', status: 'visited', features: [] };
      expect(planMerge('location', ford, { name: 'Ford', type: 'poi', status: 'known' }).fields).toEqual({});
      expect(planMerge('location', ford, { name: 'Ford', type: 'town' }).differing).toEqual([
        { label: 'Type', value: 'town' },
      ]);
    });

    it('never moves the place: its parent is not merged', () => {
      const ford = { id: 'ford', name: 'Greywater Ford', parentId: '' };
      expect(planMerge('location', ford, { name: 'Ford', parentId: 'vale' }).fields).toEqual({});
    });
  });

  describe('a rumour', () => {
    it('fills where it was heard, and joins its people', () => {
      const smoke = { id: 'smoke', title: 'Smoke', content: 'Smoke over the hill', relatedNPCs: ['a'], relatedLocations: [] };
      const plan = planMerge('rumor', smoke, {
        title: 'Smoke',
        content: 'Smoke over the hill',
        locationId: 'plough',
        location: 'The Crooked Plough',
        relatedNPCs: ['a', 'b'],
        status: 'unconfirmed',
      });
      expect(plan.fields).toEqual({
        location: 'The Crooked Plough',
        locationId: 'plough',
        relatedNPCs: ['a', 'b'],
      });
    });
  });
});

describe('mergeNote', () => {
  it('signs a note with what differed, in the record’s own note shape', () => {
    const note = mergeNote('npc', 'Grog', [{ label: 'Description', value: 'Owns a boat.' }], 'Zendikarr');
    expect(note).toEqual({
      date: new Date().toISOString().slice(0, 10),
      text: 'Also recorded as “Grog”:\nDescription: Owns a boat.',
      author: 'Zendikarr',
    });
  });

  it('writes a rumour’s note as `content`', () => {
    expect(mergeNote('rumor', 'Smoke', [{ label: 'What was said', value: 'Ash' }])).toEqual({
      content: 'Also recorded as “Smoke”:\nWhat was said: Ash',
    });
  });

  it('writes no note when nothing differed', () => {
    expect(mergeNote('quest', 'Find it', [])).toBeNull();
  });

  it('keeps a note to what one note may hold', () => {
    const note = mergeNote('npc', 'Grog', [{ label: 'Background', value: 'x'.repeat(20_000) }]);
    expect((note!.text as string).length).toBe(10_000);
  });
});

describe('describeMerge', () => {
  it('lists what is added, then that a note keeps what differs', () => {
    expect(
      describeMerge({
        fields: {},
        added: ['Occupation: Smith'],
        differing: [{ label: 'Description', value: 'x' }, { label: 'Status', value: 'y' }],
      })
    ).toEqual(['Occupation: Smith', 'A note with what it says differently: description, status']);
  });
});
