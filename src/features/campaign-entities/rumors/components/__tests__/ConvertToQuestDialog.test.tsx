// src/features/campaign-entities/rumors/components/__tests__/ConvertToQuestDialog.test.tsx

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConvertToQuestDialog from '../ConvertToQuestDialog';
import { Rumor } from '../../types';

// ---------------------------------------------------------------------------
// Mock Dialog (bug #150)
// ---------------------------------------------------------------------------
jest.mock('../../../../../core/components/Dialog', () => ({
  __esModule: true,
  default: ({ open, title, children }: any) =>
    open ? (
      <div data-testid="dialog" role="dialog">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    ) : null,
}));

// ---------------------------------------------------------------------------
// Mock crypto.randomUUID (JSDOM lacks it — bug #300)
// ---------------------------------------------------------------------------
let uuidCounter = 0;
beforeEach(() => {
  uuidCounter = 0;
  Object.defineProperty(global, 'crypto', {
    value: {
      randomUUID: () => `mock-uuid-${++uuidCounter}`,
    },
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
function makeRumor(id: string, overrides: Partial<Rumor> = {}): Rumor {
  return {
    id,
    title: `Rumor ${id}`,
    content: `content-${id}`,
    status: 'unconfirmed',
    sourceType: 'tavern',
    sourceName: `Source-${id}`,
    location: 'Loc-' + id,
    locationId: '',
    sourceNpcId: '',
    relatedNPCs: ['npc-a'],
    relatedLocations: [],
    notes: [],
    createdBy: 'u1',
    createdByUsername: 'u',
    dateAdded: '2024-01-15T10:00:00.000Z',
    modifiedBy: 'u1',
    modifiedByUsername: 'u',
    dateModified: '2024-01-15T10:00:00.000Z',
    ...overrides,
  } as Rumor;
}

describe('ConvertToQuestDialog', () => {
  describe('rendering', () => {
    test('should not render when open=false', () => {
      render(
        <ConvertToQuestDialog
          open={false}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1')]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
    });

    test('should render dialog with title "Convert to Quest"', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1')]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.getByText('Convert to Quest')).toBeInTheDocument();
    });

    test('should render all selected rumor titles', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1', 'r2']}
          rumors={[makeRumor('r1'), makeRumor('r2')]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.getByText('Rumor r1')).toBeInTheDocument();
      expect(screen.getByText('Rumor r2')).toBeInTheDocument();
    });

    test('should render source name and location for each source rumor', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1', { location: 'Bree' })]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.getByText(/Source: Source-r1/)).toBeInTheDocument();
      expect(screen.getByText(/Location: Bree/)).toBeInTheDocument();
    });
  });

  describe('pre-populated form (single rumor)', () => {
    test('should use rumor title as quest title', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1', { title: 'The Lost Crown' })]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.getByDisplayValue('The Lost Crown')).toBeInTheDocument();
    });

    test('should use rumor content as quest description', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1', { content: 'goblins took it' })]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.getByDisplayValue('goblins took it')).toBeInTheDocument();
    });

    test('should pre-fill location from the rumor', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1', { location: 'Bree' })]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.getByDisplayValue('Bree')).toBeInTheDocument();
    });

    test('should start with one empty objective for single rumor', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1')]}
          onConvert={jest.fn()}
        />,
      );
      const placeholderInputs = screen.getAllByPlaceholderText('Objective description');
      expect(placeholderInputs).toHaveLength(1);
    });
  });

  describe('pre-populated form (multiple rumors)', () => {
    test('should prefix title with "Quest:"', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1', 'r2']}
          rumors={[
            makeRumor('r1', { title: 'A' }),
            makeRumor('r2', { title: 'B' }),
          ]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.getByDisplayValue('Quest: A')).toBeInTheDocument();
    });

    test('should populate one objective per source rumor', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1', 'r2']}
          rumors={[makeRumor('r1'), makeRumor('r2')]}
          onConvert={jest.fn()}
        />,
      );
      const objectives = screen.getAllByPlaceholderText('Objective description');
      expect(objectives).toHaveLength(2);
      expect((objectives[0] as HTMLInputElement).value).toContain('Investigate');
    });

    test('should combine content for description', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1', 'r2']}
          rumors={[
            makeRumor('r1', { content: 'aaa' }),
            makeRumor('r2', { content: 'bbb' }),
          ]}
          onConvert={jest.fn()}
        />,
      );
      const descriptions = screen
        .getAllByRole('textbox')
        .map((el) => (el as HTMLTextAreaElement).value);
      const combined = descriptions.find((v) => v.includes('aaa') && v.includes('bbb'));
      expect(combined).toBeTruthy();
    });
  });

  describe('add/remove objectives', () => {
    test('should add a new empty objective when Add Objective clicked', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1')]}
          onConvert={jest.fn()}
        />,
      );
      expect(screen.getAllByPlaceholderText('Objective description')).toHaveLength(1);
      fireEvent.click(screen.getByText('Add Objective'));
      expect(screen.getAllByPlaceholderText('Objective description')).toHaveLength(2);
    });

    test('should disable remove when only one objective remains', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1')]}
          onConvert={jest.fn()}
        />,
      );
      const removeButtons = screen
        .getAllByRole('button')
        .filter((b) => b.querySelector('svg') && !b.textContent?.match(/Cancel|Quest|Add|Convert/));
      removeButtons.forEach((b) => expect(b).toBeDisabled());
    });

    test('should remove the right objective when its X is clicked', () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1', 'r2']}
          rumors={[makeRumor('r1'), makeRumor('r2')]}
          onConvert={jest.fn()}
        />,
      );
      // Start with 2 objectives → click first X → 1 left
      const removeButtons = screen
        .getAllByRole('button')
        .filter((b) => b.querySelector('svg') && !b.textContent?.match(/Cancel|Quest|Add|Convert/));
      fireEvent.click(removeButtons[0]);
      expect(screen.getAllByPlaceholderText('Objective description')).toHaveLength(1);
    });
  });

  describe('validation', () => {
    test('should show error when title cleared', async () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1')]}
          onConvert={jest.fn()}
        />,
      );
      const titleInput = screen.getByDisplayValue('Rumor r1');
      await userEvent.clear(titleInput);
      fireEvent.click(screen.getByText('Create Quest'));
      await waitFor(() => {
        expect(screen.getByText('Title and description are required')).toBeInTheDocument();
      });
    });

    test('should show error when objectives have empty descriptions', async () => {
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1']}
          rumors={[makeRumor('r1')]}
          onConvert={jest.fn()}
        />,
      );
      // The single auto-objective is empty by default for single-rumor case
      fireEvent.click(screen.getByText('Create Quest'));
      await waitFor(() => {
        expect(screen.getByText('All objectives must have descriptions')).toBeInTheDocument();
      });
    });
  });

  describe('submit', () => {
    test('should call onConvert with rumor IDs and quest data', async () => {
      const onConvert = jest.fn().mockResolvedValue('quest-1');
      const onClose = jest.fn();
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={onClose}
          rumorIds={['r1', 'r2']}
          rumors={[makeRumor('r1'), makeRumor('r2')]}
          onConvert={onConvert}
        />,
      );
      fireEvent.click(screen.getByText('Create Quest'));
      await waitFor(() => {
        expect(onConvert).toHaveBeenCalledTimes(1);
      });
      const [ids, questData] = onConvert.mock.calls[0];
      expect(ids).toEqual(['r1', 'r2']);
      expect(questData).toHaveProperty('title', 'Quest: Rumor r1');
      expect(questData).toHaveProperty('status', 'active');
      expect(questData).toHaveProperty('objectives');
      expect(questData.objectives).toHaveLength(2);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('should deduplicate relatedNPCs across multiple source rumors', async () => {
      const onConvert = jest.fn().mockResolvedValue('q1');
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1', 'r2']}
          rumors={[
            makeRumor('r1', { relatedNPCs: ['npc-1', 'npc-2'] }),
            makeRumor('r2', { relatedNPCs: ['npc-1', 'npc-3'] }),
          ]}
          onConvert={onConvert}
        />,
      );
      fireEvent.click(screen.getByText('Create Quest'));
      await waitFor(() => {
        expect(onConvert).toHaveBeenCalled();
      });
      const [, questData] = onConvert.mock.calls[0];
      expect(new Set(questData.relatedNPCIds)).toEqual(new Set(['npc-1', 'npc-2', 'npc-3']));
    });

    // The quest's creation time is the server's, stamped by the write (T132).
    test('should send no client-clock creation date', async () => {
      const onConvert = jest.fn().mockResolvedValue('q1');
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1', 'r2']}
          rumors={[makeRumor('r1'), makeRumor('r2')]}
          onConvert={onConvert}
        />,
      );
      fireEvent.click(screen.getByText('Create Quest'));
      await waitFor(() => {
        expect(onConvert).toHaveBeenCalled();
      });
      const [, questData] = onConvert.mock.calls[0];
      expect(questData).not.toHaveProperty('dateAdded');
    });

    test('should show error if onConvert rejects', async () => {
      const onConvert = jest.fn().mockRejectedValueOnce(new Error('bad'));
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={jest.fn()}
          rumorIds={['r1', 'r2']}
          rumors={[makeRumor('r1'), makeRumor('r2')]}
          onConvert={onConvert}
        />,
      );
      fireEvent.click(screen.getByText('Create Quest'));
      await waitFor(() => {
        expect(screen.getByText('bad')).toBeInTheDocument();
      });
    });

    test('should call onClose when Cancel is clicked', () => {
      const onClose = jest.fn();
      render(
        <ConvertToQuestDialog
          open={true}
          onClose={onClose}
          rumorIds={['r1']}
          rumors={[makeRumor('r1')]}
          onConvert={jest.fn()}
        />,
      );
      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
