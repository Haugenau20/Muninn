// src/features/campaign-entities/rumors/components/__tests__/RumorBatchActions.test.tsx

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RumorBatchActions from '../RumorBatchActions';
import { Rumor } from '../../types';

// ---------------------------------------------------------------------------
// Mock children dialogs and confirmation dialog
// ---------------------------------------------------------------------------
jest.mock('../CombineRumorsDialog', () => ({
  __esModule: true,
  default: ({ open, onClose, rumorIds, onCombine }: any) =>
    open ? (
      <div data-testid="combine-dialog">
        <span>combine-open:{rumorIds.length}</span>
        <button onClick={onClose}>close-combine</button>
        <button
          onClick={() => {
            // Swallow the rethrow from handleCombineSubmit so it doesn't become
            // an unhandled rejection in the test.
            Promise.resolve(onCombine(rumorIds, { title: 't', content: 'c' })).catch(() => {});
          }}
        >
          submit-combine
        </button>
      </div>
    ) : null,
}));

jest.mock('../ConvertToQuestDialog', () => ({
  __esModule: true,
  default: ({ open, onClose, rumorIds, onConvert }: any) =>
    open ? (
      <div data-testid="convert-dialog">
        <span>convert-open:{rumorIds.length}</span>
        <button onClick={onClose}>close-convert</button>
        <button
          onClick={() => {
            Promise.resolve(onConvert(rumorIds, { title: 't' })).catch(() => {});
          }}
        >
          submit-convert
        </button>
      </div>
    ) : null,
}));

// Converting now lands on the quest that was just authored (`15-5` item 11),
// so this component navigates.
const mockNavigateToPage = jest.fn();
jest.mock('shared/hooks/useNavigation', () => ({
  useNavigation: () => ({ navigateToPage: mockNavigateToPage }),
}));

jest.mock('shared/components/DeleteConfirmationDialog', () => ({
  __esModule: true,
  default: ({ isOpen, onClose, onConfirm, itemName, message }: any) =>
    isOpen ? (
      <div data-testid="delete-dialog">
        <span>{itemName}</span>
        <span>{message}</span>
        <button onClick={onClose}>cancel-delete</button>
        <button onClick={onConfirm}>confirm-delete</button>
      </div>
    ) : null,
}));

// ---------------------------------------------------------------------------
// Mock useRumors context
// ---------------------------------------------------------------------------
const mockUpdateRumorStatus = jest.fn();
const mockDeleteRumor = jest.fn();
const mockCombineRumors = jest.fn();
const mockConvertToQuest = jest.fn();

jest.mock('../../context/RumorContext', () => ({
  useRumors: jest.fn(),
}));

// Converting checks the title against the quests (T163).
jest.mock('../../../quests/context/QuestContext', () => ({
  useQuests: jest.fn(() => ({ quests: [] })),
}));
const { useRumors } = require('../../context/RumorContext');

function makeRumor(id: string): Rumor {
  return {
    id,
    title: `Rumour ${id}`,
    content: 'content',
    status: 'unconfirmed',
    sourceType: 'tavern',
    sourceName: 'Tavern',
    location: '',
    locationId: '',
    sourceNpcId: '',
    relatedNPCs: [],
    relatedLocations: [],
    notes: [],
    createdBy: 'u1',
    createdByUsername: 'u',
    dateAdded: '2024-01-15T10:00:00.000Z',
    modifiedBy: 'u1',
    modifiedByUsername: 'u',
    dateModified: '2024-01-15T10:00:00.000Z',
  } as Rumor;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateRumorStatus.mockResolvedValue(undefined);
  mockDeleteRumor.mockResolvedValue(undefined);
  mockCombineRumors.mockResolvedValue('new-rumor-id');
  mockConvertToQuest.mockResolvedValue('new-quest-id');
  (useRumors as jest.Mock).mockReturnValue({
    rumors: [makeRumor('r1'), makeRumor('r2'), makeRumor('r3')],
    // The batch actions write the whole selection at once (T032, PERF-06).
    updateRumorsStatus: mockUpdateRumorStatus,
    deleteRumors: mockDeleteRumor,
    combineRumors: mockCombineRumors,
    convertToQuest: mockConvertToQuest,
  });
});

describe('RumorBatchActions', () => {
  describe('rendering', () => {
    test('should return null when no rumors selected', () => {
      const { container } = render(
        <RumorBatchActions selectedRumors={new Set()} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    test('should render selection count label', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
      expect(screen.getByText(/2 rumours selected/i)).toBeInTheDocument();
    });

    test('should render all 6 action buttons when at least one rumor is selected', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      expect(screen.getByText('Mark Confirmed')).toBeInTheDocument();
      expect(screen.getByText('Mark Unconfirmed')).toBeInTheDocument();
      expect(screen.getByText('Mark False')).toBeInTheDocument();
      expect(screen.getByText('Combine')).toBeInTheDocument();
      expect(screen.getByText('Convert to Quest')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('Combine button availability', () => {
    test('should disable Combine when only 1 rumor selected', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      expect(screen.getByText('Combine').closest('button')).toBeDisabled();
    });

    test('should enable Combine when 2+ rumors selected', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
      expect(screen.getByText('Combine').closest('button')).not.toBeDisabled();
    });
  });

  describe('batch status updates', () => {
    test('should update every selected rumor in one call when Mark Confirmed clicked', async () => {
      const onComplete = jest.fn();
      render(
        <RumorBatchActions
          selectedRumors={new Set(['r1', 'r2'])}
          onComplete={onComplete}
        />,
      );
      fireEvent.click(screen.getByText('Mark Confirmed'));
      await waitFor(() => {
        expect(mockUpdateRumorStatus).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdateRumorStatus).toHaveBeenCalledWith(['r1', 'r2'], 'confirmed');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('should pass "unconfirmed" status when Mark Unconfirmed clicked', async () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      fireEvent.click(screen.getByText('Mark Unconfirmed'));
      await waitFor(() => {
        expect(mockUpdateRumorStatus).toHaveBeenCalledWith(['r1'], 'unconfirmed');
      });
    });

    test('should pass "false" status when Mark False clicked', async () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      fireEvent.click(screen.getByText('Mark False'));
      await waitFor(() => {
        expect(mockUpdateRumorStatus).toHaveBeenCalledWith(['r1'], 'false');
      });
    });

    test('should show error message on status update failure', async () => {
      mockUpdateRumorStatus.mockRejectedValueOnce(new Error('Network error'));
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      fireEvent.click(screen.getByText('Mark Confirmed'));
      await waitFor(() => {
        expect(screen.getByText(/Failed to update rumour status: Network error/i)).toBeInTheDocument();
      });
    });
  });

  describe('combine flow', () => {
    test('should open combine dialog when Combine clicked', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
      fireEvent.click(screen.getByText('Combine'));
      expect(screen.getByTestId('combine-dialog')).toBeInTheDocument();
      expect(screen.getByText('combine-open:2')).toBeInTheDocument();
    });

    test('should close combine dialog on close', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
      fireEvent.click(screen.getByText('Combine'));
      fireEvent.click(screen.getByText('close-combine'));
      expect(screen.queryByTestId('combine-dialog')).not.toBeInTheDocument();
    });

    test('should call combineRumors with selected IDs on submit', async () => {
      const onComplete = jest.fn();
      render(
        <RumorBatchActions
          selectedRumors={new Set(['r1', 'r2'])}
          onComplete={onComplete}
        />,
      );
      fireEvent.click(screen.getByText('Combine'));
      fireEvent.click(screen.getByText('submit-combine'));
      await waitFor(() => {
        expect(mockCombineRumors).toHaveBeenCalledWith(
          ['r1', 'r2'],
          { title: 't', content: 'c' },
          // Stopped at a title a rumour already carries (T163).
          { askOnSameName: true },
        );
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('should show error message on combine failure', async () => {
      mockCombineRumors.mockRejectedValueOnce(new Error('bad combine'));
      render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
      fireEvent.click(screen.getByText('Combine'));
      fireEvent.click(screen.getByText('submit-combine'));
      await waitFor(() => {
        expect(screen.getByText(/Failed to combine rumours: bad combine/i)).toBeInTheDocument();
      });
    });
  });

  describe('convert to quest flow', () => {
    test('should open convert dialog when Convert to Quest clicked', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      fireEvent.click(screen.getByText('Convert to Quest'));
      expect(screen.getByTestId('convert-dialog')).toBeInTheDocument();
    });

    test('should call convertToQuest with selected IDs on submit', async () => {
      const onComplete = jest.fn();
      render(
        <RumorBatchActions
          selectedRumors={new Set(['r1', 'r2'])}
          onComplete={onComplete}
        />,
      );
      fireEvent.click(screen.getByText('Convert to Quest'));
      fireEvent.click(screen.getByText('submit-convert'));
      await waitFor(() => {
        // Stopped at a title a quest already carries (T163).
        expect(mockConvertToQuest).toHaveBeenCalledWith(['r1', 'r2'], { title: 't' }, { askOnSameName: true });
      });
      // A rumour could be converted into a quest and then not refer to it --
      // the quest existed and nothing on screen led to it.
      await waitFor(() => {
        expect(mockNavigateToPage).toHaveBeenCalledWith('/quests/new-quest-id');
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('should show error message on convert failure', async () => {
      mockConvertToQuest.mockRejectedValueOnce(new Error('bad convert'));
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      fireEvent.click(screen.getByText('Convert to Quest'));
      fireEvent.click(screen.getByText('submit-convert'));
      await waitFor(() => {
        expect(screen.getByText(/Failed to convert rumours to quest: bad convert/i)).toBeInTheDocument();
      });
    });
  });

  describe('delete flow', () => {
    test('should open delete confirmation when Delete clicked', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
      fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
    });

    test('should include rumor count in delete dialog itemName', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
      fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByText('2 rumours')).toBeInTheDocument();
    });

    test('should close delete dialog when cancel clicked', () => {
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      fireEvent.click(screen.getByText('Delete'));
      fireEvent.click(screen.getByText('cancel-delete'));
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    });

    test('should delete every selected rumor in one call on confirm', async () => {
      const onComplete = jest.fn();
      render(
        <RumorBatchActions
          selectedRumors={new Set(['r1', 'r2'])}
          onComplete={onComplete}
        />,
      );
      fireEvent.click(screen.getByText('Delete'));
      fireEvent.click(screen.getByText('confirm-delete'));
      await waitFor(() => {
        expect(mockDeleteRumor).toHaveBeenCalledTimes(1);
      });
      expect(mockDeleteRumor).toHaveBeenCalledWith(['r1', 'r2']);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('should show error message on delete failure', async () => {
      mockDeleteRumor.mockRejectedValueOnce(new Error('bad delete'));
      render(<RumorBatchActions selectedRumors={new Set(['r1'])} />);
      fireEvent.click(screen.getByText('Delete'));
      fireEvent.click(screen.getByText('confirm-delete'));
      await waitFor(() => {
        expect(screen.getByText(/Failed to delete rumours: bad delete/i)).toBeInTheDocument();
      });
    });
  });
});

// T163: a combine's or a conversion's title a record already carries stops
// at "already exists", and "Add to" joins into that record instead.
describe('RumorBatchActions -- already exists', () => {
  const { useQuests } = require('../../../quests/context/QuestContext');
  const { SameNameError } = jest.requireActual('../../../shared/sameName');
  afterEach(() => (useQuests as jest.Mock).mockReturnValue({ quests: [] }));

  test('a conversion titled as a quest the page holds asks, then converts into it', async () => {
    (useQuests as jest.Mock).mockReturnValue({
      quests: [{ id: 'the-t-quest', title: 'T', description: '', status: 'active', objectives: [] }],
    });
    mockConvertToQuest.mockResolvedValue('the-t-quest');
    render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
    fireEvent.click(screen.getByText('Convert to Quest'));
    fireEvent.click(screen.getByText('submit-convert'));

    await screen.findByRole('dialog', { name: 'A T already exists' });
    expect(mockConvertToQuest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add to T' }));
    await waitFor(() =>
      expect(mockConvertToQuest).toHaveBeenCalledWith(['r1', 'r2'], { title: 't' }, { into: 'the-t-quest' })
    );
    await waitFor(() => expect(mockNavigateToPage).toHaveBeenCalledWith('/quests/the-t-quest'));
  });

  test('a combine stopped by the context asks, then combines into that rumour', async () => {
    mockCombineRumors
      .mockRejectedValueOnce(new SameNameError('rumor', 'r3', 'Rumour r3'))
      .mockResolvedValueOnce('r3');
    const onComplete = jest.fn();
    render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Combine'));
    fireEvent.click(screen.getByText('submit-combine'));

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Rumour r3' }));
    await waitFor(() =>
      expect(mockCombineRumors).toHaveBeenLastCalledWith(['r1', 'r2'], { title: 't', content: 'c' }, { into: 'r3' })
    );
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  test('cancelling leaves the combine dialog open, and nothing written', async () => {
    mockCombineRumors.mockRejectedValueOnce(new SameNameError('rumor', 'r3', 'Rumour r3'));
    render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
    fireEvent.click(screen.getByText('Combine'));
    fireEvent.click(screen.getByText('submit-combine'));

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('combine-dialog')).toBeInTheDocument();
    expect(mockCombineRumors).toHaveBeenCalledTimes(1);
  });

  test('keeping the title on purpose combines anyway, as a second rumour of it', async () => {
    mockCombineRumors
      .mockRejectedValueOnce(new SameNameError('rumor', 'r3', 'Rumour r3'))
      .mockResolvedValueOnce('t-2');
    render(<RumorBatchActions selectedRumors={new Set(['r1', 'r2'])} />);
    fireEvent.click(screen.getByText('Combine'));
    fireEvent.click(screen.getByText('submit-combine'));

    fireEvent.click(await screen.findByRole('button', { name: 'Choose a name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Combine t' }));
    await waitFor(() =>
      expect(mockCombineRumors).toHaveBeenLastCalledWith(['r1', 'r2'], { title: 't', content: 'c' }, { askOnSameName: false })
    );
  });
});
