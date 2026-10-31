// src/features/campaign-entities/shared/private/__tests__/privateMarks.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NPCRowCells from '../../../npcs/components/NPCRowCells';
import QuestRowCells from '../../../quests/components/QuestRowCells';
import LocationRowCells from '../../../locations/components/LocationRowCells';
import RumorRowCells from '../../../rumors/components/RumorRowCells';
import RumorComposer from '../../../rumors/components/RumorComposer';

/**
 * T163: a private record is marked where it sits beside the campaign's own,
 * and the rumour composer, the one way to add a rumour by hand, can keep one
 * private.
 */

const rows = (isPrivate: boolean) => [
  <NPCRowCells key="npc" npc={{ name: 'Gollum', status: 'alive', relationship: 'unknown', isPrivate }} />,
  <QuestRowCells key="quest" quest={{ title: 'The fish', status: 'active', objectivesDone: 0, objectivesTotal: 0, isPrivate }} />,
  <LocationRowCells key="location" location={{ name: 'The cave', type: 'poi', status: 'known', isPrivate }} inside="" />,
  <RumorRowCells
    key="rumor"
    rumor={{ name: 'Riddles', untitled: false, status: 'unconfirmed', convertedToQuest: false, unsaved: false, isPrivate }}
  />,
];

describe('the rows', () => {
  it.each(['npc', 'quest', 'location', 'rumor'])('mark a private %s', (kind) => {
    const row = rows(true).find((element) => element.key === kind)!;
    render(<div>{row}</div>);
    expect(screen.getByText('Private')).toHaveAttribute('title', 'Only you see this until you publish it');
  });

  it.each(['npc', 'quest', 'location', 'rumor'])('leave a shared %s unmarked', (kind) => {
    const row = rows(false).find((element) => element.key === kind)!;
    render(<div>{row}</div>);
    expect(screen.queryByText('Private')).not.toBeInTheDocument();
  });

  it('keep a rumour’s "Unsaved" beside its mark', () => {
    render(
      <RumorRowCells
        rumor={{ name: 'Riddles', untitled: false, status: 'unconfirmed', convertedToQuest: false, unsaved: true, isPrivate: true }}
      />
    );
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });
});

describe('the rumour composer', () => {
  const field = () => screen.getByLabelText('Heard something? Write it down here');

  it('adds a shared rumour unless "Private" is ticked', async () => {
    const onAdd = jest.fn().mockResolvedValue('r1');
    render(<RumorComposer onAdd={onAdd} />);
    await userEvent.type(field(), 'Smoke over the hill{Enter}');
    expect(onAdd).toHaveBeenCalledWith('Smoke over the hill');
  });

  it('keeps it to the player who heard it, and stays ticked for the next', async () => {
    const onAdd = jest.fn().mockResolvedValue('r1');
    render(<RumorComposer onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /private/i }));
    await userEvent.type(field(), 'Riddles in the dark{Enter}');
    expect(onAdd).toHaveBeenCalledWith('Riddles in the dark', { private: true });
    expect(screen.getByRole('checkbox', { name: /private/i })).toBeChecked();
  });
});
