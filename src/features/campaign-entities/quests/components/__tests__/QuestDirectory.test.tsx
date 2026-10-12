// src/features/campaign-entities/quests/components/__tests__/QuestDirectory.test.tsx
import React from 'react';
import { render, screen, fireEvent, within, waitFor, getDefaultNormalizer } from '@testing-library/react';
import QuestDirectory from '../QuestDirectory';
import type { Quest, QuestObjective } from '../../types';
import type { NPC } from '../../../npcs/types';
import type { Location } from '../../../locations/types';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';

// ---------------------------------------------------------------------------
// Context mocks
//
// QuestDirectory reaches its Firebase-backed data through sibling context
// modules plus the `features/user-management` barrel and
// `shared/hooks/useNavigation`. None of those, once mocked, touch react-router
// or any provider tree, so no router/provider wrapper is needed.
//
// These tests were QuestsPage's until the roster moved out of the page into
// this directory — the same split the other three entities have always had.
// They exercise roster behaviour, so they followed the roster; what stayed
// behind in QuestsPage.test.tsx is the page's own header and context guards.
// ---------------------------------------------------------------------------

let mockUser: { uid: string } | null = { uid: 'user-1' };

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: mockUser }),
}));

interface QuestContextMock {
  quests: Quest[];
  loading: boolean;
  error: string | null;
  deleteQuest: jest.Mock;
  updateQuest?: jest.Mock;
  updateQuestObjective?: jest.Mock;
}

const mockDeleteQuest = jest.fn().mockResolvedValue(undefined);
// `15-3` wires the row to the two mutations it already had but never called.
const mockUpdateQuest = jest.fn().mockResolvedValue(undefined);
const mockUpdateQuestObjective = jest.fn().mockResolvedValue(undefined);

let mockQuestContext: QuestContextMock = {
  quests: [],
  loading: false,
  error: null,
  deleteQuest: mockDeleteQuest,
  updateQuest: mockUpdateQuest,
  updateQuestObjective: mockUpdateQuestObjective,
};

let mockGetNPCById: (id: string) => NPC | undefined = () => undefined;
let mockLocations: Location[] = [];

jest.mock('../../context/QuestContext', () => ({
  useQuests: () => mockQuestContext,
}));

jest.mock('../../../npcs/context/NPCContext', () => ({
  useNPCs: () => ({ npcs: [], getNPCById: mockGetNPCById }),
}));

jest.mock('../../../locations/context/LocationContext', () => ({
  useLocations: () => ({ locations: mockLocations }),
}));

const mockNavigateToPage = jest.fn();
const mockCreatePath = jest.fn(
  (path: string, _params?: Record<string, string>, query?: Record<string, string>) =>
    query && Object.keys(query).length
      ? `${path}?${new URLSearchParams(query).toString()}`
      : path
);
const mockGetCurrentQueryParams = jest.fn(() => ({} as Record<string, string>));

jest.mock('shared/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToPage: mockNavigateToPage,
    createPath: mockCreatePath,
    getCurrentQueryParams: mockGetCurrentQueryParams,
  }),
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: `quest-${Math.random().toString(36).slice(2)}`,
    title: 'Test Quest',
    description: 'A test quest',
    status: 'active',
    objectives: [],
    createdBy: 'user-1',
    createdByUsername: 'TestUser',
    dateAdded: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeObjective(overrides: Partial<QuestObjective> = {}): QuestObjective {
  return {
    id: `obj-${Math.random().toString(36).slice(2)}`,
    description: 'Do a thing',
    completed: false,
    ...overrides,
  };
}

function makeNPC(overrides: Partial<NPC> = {}): NPC {
  return {
    id: 'npc-1',
    name: 'Elder Willow',
    status: 'alive',
    relationship: 'friendly',
    description: 'A wise elder',
    connections: { relatedNPCs: [], affiliations: [], relatedQuests: [] },
    notes: [],
    createdBy: 'user-1',
    createdByUsername: 'TestUser',
    dateAdded: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 'loc-1',
    name: 'Forest Clearing',
    type: 'landmark',
    status: 'known',
    description: 'A quiet clearing',
    createdBy: 'user-1',
    createdByUsername: 'TestUser',
    dateAdded: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

const questActiveDragon = makeQuest({
  id: 'q1',
  title: 'Find the Dragon',
  description: 'A quest about a red dragon terrorizing the valley',
  status: 'active',
  location: 'Dungeon',
  levelRange: '3-5',
  background: 'The dragon arrived three winters ago.',
  objectives: [
    makeObjective({ id: 'o1', description: 'Scout the lair entrance', completed: true }),
    makeObjective({ id: 'o2', description: 'Slay the dragon', completed: false }),
  ],
  leads: ['Ask the blacksmith about dragon scales'],
  complications: ['The lair is full of traps'],
  rewards: ['500 gold', 'Dragon scale armor'],
  keyLocations: [{ name: "Dragon's Lair", description: 'A cave in the mountains' }],
  relatedNPCIds: ['npc-1'],
});

const questCompletedLich = makeQuest({
  id: 'q2',
  title: 'Slay the Lich',
  description: 'A necromantic affair threatens the kingdom',
  status: 'completed',
  location: 'Crypt',
  dateCompleted: '1492-03-10',
  levelRange: '5-8',
  objectives: [makeObjective({ id: 'o3', description: 'Retrieve the phylactery', completed: true })],
  relatedNPCIds: [],
});

const questFailedPrincess = makeQuest({
  id: 'q3',
  title: 'Rescue the Princess',
  description: 'A classic adventure gone wrong',
  status: 'failed',
  location: 'Dungeon',
  objectives: [],
});

const questActiveHerbs = makeQuest({
  id: 'q4',
  title: 'Collect Herbs',
  description: 'A mundane errand for the herbalist',
  status: 'active',
  location: 'Forest',
  objectives: [
    makeObjective({ id: 'o4', description: 'Gather 10 herbs', completed: false }),
    makeObjective({ id: 'o5', description: 'Return to herbalist', completed: false }),
    makeObjective({ id: 'o6', description: 'Report findings', completed: true }),
  ],
  relatedNPCIds: ['npc-1', 'npc-missing'],
  keyLocations: [
    { name: 'Forest Clearing', description: 'A quiet clearing' },
    { name: 'Unknown Ruins', description: 'Ancient, unmapped ruins' },
  ],
});

const sampleQuests = [questActiveDragon, questCompletedLich, questFailedPrincess, questActiveHerbs];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(<QuestDirectory quests={mockQuestContext.quests} />);
}

const expandButton = (title: string | RegExp) =>
  screen.getByRole('button', { name: typeof title === 'string' ? new RegExp(`Expand ${title}`) : title });

const collapseButton = (title: string) =>
  screen.getByRole('button', { name: new RegExp(`Collapse ${title}`) });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
/** Open a status group that `15-3` collapses by default (T015). */
const openGroup = (name: RegExp | string) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('QuestDirectory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteQuest.mockResolvedValue(undefined);
    mockUpdateQuest.mockResolvedValue(undefined);
    mockUpdateQuestObjective.mockResolvedValue(undefined);
    mockUser = { uid: 'user-1' };
    mockQuestContext = {
      quests: [...sampleQuests],
      loading: false,
      error: null,
      deleteQuest: mockDeleteQuest,
      updateQuest: mockUpdateQuest,
      updateQuestObjective: mockUpdateQuestObjective,
    };
    mockGetNPCById = (id: string) => (id === 'npc-1' ? makeNPC() : undefined);
    mockLocations = [makeLocation({ name: 'Forest Clearing' })];
    mockGetCurrentQueryParams.mockReturnValue({});
  });

  // -------------------------------------------------------------------------
  // Loading state — the directory's own; the page owns the context guards and
  // the error branch, and covers them in its own suite.
  // -------------------------------------------------------------------------
  describe('loading state', () => {
    it('renders a loading indicator and no rows', () => {
      mockQuestContext = { ...mockQuestContext, loading: true, quests: [] };
      const { container } = render(<QuestDirectory quests={[]} isLoading />);
      expect(screen.getByRole('status', { name: /loading quests/i })).toBeInTheDocument();
      expect(container.querySelectorAll('.section-loading').length).toBeGreaterThan(3);
      expect(container.querySelector('.animate-spin')).toBeNull();
      expect(screen.queryByText('Find the Dragon')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Status bar — one bar that replaced three stat cards
  // -------------------------------------------------------------------------
  describe('status bar', () => {
    it('shows the true total, unaffected by filters', () => {
      renderPage();
      expect(screen.getByText('4')).toBeInTheDocument();
      expect(screen.getByText('sworn so far')).toBeInTheDocument();
    });

    it('labels every one of the three statuses, each with a word', () => {
      renderPage();
      // active=2, completed=1, failed=1
      expect(screen.getByRole('button', { name: '2 active' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 completed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 failed' })).toBeInTheDocument();
    });

    it('keeps a zero-count status band visible, with reduced opacity', () => {
      mockQuestContext.quests = [questActiveDragon, questActiveHerbs];
      renderPage();
      const failedBand = screen.getByRole('button', { name: '0 failed' });
      expect(failedBand).toBeInTheDocument();
      expect(failedBand.className).toContain('opacity-50');
    });

    it('is honest that active + completed does not equal the total once a failed quest exists', () => {
      renderPage();
      // active(2) + completed(1) = 3, but total is 4 because of the 1 failed quest.
      // All three bands together (2 + 1 + 1) do sum to the total of 4.
      const active = screen.getByRole('button', { name: '2 active' });
      const completed = screen.getByRole('button', { name: '1 completed' });
      const failed = screen.getByRole('button', { name: '1 failed' });
      expect(active).toBeInTheDocument();
      expect(completed).toBeInTheDocument();
      expect(failed).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('filters rows by clicking a band', () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: '1 failed' }));
      expect(screen.getByText('Rescue the Princess')).toBeInTheDocument();
      expect(screen.queryByText('Find the Dragon')).not.toBeInTheDocument();
      expect(screen.queryByText('Slay the Lich')).not.toBeInTheDocument();
    });

    it('clicking the active band a second time clears the filter back to all', () => {
      renderPage();
      const failedBand = () => screen.getByRole('button', { name: '1 failed' });

      fireEvent.click(failedBand());
      expect(failedBand()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText('Find the Dragon')).not.toBeInTheDocument();

      fireEvent.click(failedBand());
      expect(failedBand()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Find the Dragon')).toBeInTheDocument();
    });

    it('does not change the bar counts when a text search narrows the visible rows', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'dragon' },
      });
      expect(screen.getByRole('button', { name: '2 active' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 completed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 failed' })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Grouping — fixed status order, empty groups skipped
  // -------------------------------------------------------------------------
  describe('grouping by status', () => {
    it('renders one group per non-empty status, in Active/Completed/Failed order', () => {
      renderPage();
      const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
      expect(headings).toEqual(['Active Quests', 'Completed Quests', 'Failed Quests']);
    });

    it('labels each group heading with its own count', () => {
      renderPage();
      const activeHeading = screen.getByRole('heading', { name: 'Active Quests' });
      expect(activeHeading.parentElement).toHaveTextContent('2');
      // The completed group's heading now lives inside its collapse control,
      // so the count is a sibling of that button rather than of the heading.
      const completedHeading = screen.getByRole('heading', { name: 'Completed Quests' });
      expect(completedHeading.closest('section')).toHaveTextContent('1');
    });

    it('omits a group entirely once filtering leaves it empty', () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: '2 active' }));
      const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
      expect(headings).toEqual(['Active Quests']);
    });
  });

  // -------------------------------------------------------------------------
  // Empty states
  // -------------------------------------------------------------------------
  describe('empty states', () => {
    it('shows a generic message when there are no quests at all', () => {
      mockQuestContext.quests = [];
      renderPage();
      expect(screen.getByText(/nothing taken on yet/i)).toBeInTheDocument();
      expect(screen.getByText(/what the party agreed to do/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /add the first quest/i })
      ).toBeInTheDocument();
    });

    it("shows the example campaign's quests under it, as rows that do nothing", () => {
      mockQuestContext.quests = [];
      renderPage();
      const example = screen.getByTestId('roster-example');
      EXAMPLE_CAMPAIGN.quests.forEach((quest) =>
        expect(within(example).getByText(quest.title)).toBeInTheDocument()
      );
      // The real row's cells: where it happens, its state and its objectives.
      expect(within(example).getByText('Cinderford')).toBeInTheDocument();
      expect(within(example).getByText('Completed')).toBeInTheDocument();
      expect(within(example).getByText('1 of 3 objectives')).toBeInTheDocument();
      expect(within(example).queryAllByRole('button', { hidden: true })).toHaveLength(0);
      const action = screen.getByRole('button', { name: /add the first quest/i });
      expect(action.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('a campaign with one quest shows no example', () => {
      mockQuestContext.quests = [questActiveDragon];
      renderPage();
      expect(screen.queryByTestId('roster-example')).not.toBeInTheDocument();
    });

    it('shows a status-specific message when a status filter yields nothing', () => {
      mockQuestContext.quests = [questActiveDragon];
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: '0 failed' }));
      expect(screen.getByText(/no quests match these filters/i)).toBeInTheDocument();
      expect(screen.queryByTestId('roster-example')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /add the first quest/i })
      ).not.toBeInTheDocument();
    });

    it('shows a search-specific message when a search yields nothing', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'zzznomatch' },
      });
      expect(screen.getByText(/no quests match these filters/i)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /add the first quest/i })
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Row rendering — collapsed
  // -------------------------------------------------------------------------
  describe('location filter', () => {
    // The options and the filter comparison both key off the resolved name, so
    // picking a human-readable option must actually match quests stored by id.
    it('offers resolved display names and filters quests stored by id by them', () => {
      mockLocations = [makeLocation({ id: 'mines-of-moria', name: 'Mines of Moria' })];
      mockQuestContext.quests = [
        makeQuest({ id: 'q-moria', title: 'Escape from Moria', locationId: 'mines-of-moria', location: 'mines-of-moria' }),
        makeQuest({ id: 'q-other', title: 'Elsewhere Entirely', location: 'somewhere-else' }),
      ];
      renderPage();

      const select = screen.getByRole('combobox', { name: 'Filter by location' });
      expect(within(select).getByRole('option', { name: 'Mines of Moria' })).toBeInTheDocument();

      fireEvent.change(select, { target: { value: 'Mines of Moria' } });
      expect(screen.getByText('Escape from Moria')).toBeInTheDocument();
      expect(screen.queryByText('Elsewhere Entirely')).not.toBeInTheDocument();
    });
  });

  describe('collapsed row', () => {
    it('shows title, status word and location', () => {
      renderPage();
      const row = within(expandButton('Find the Dragon'));
      expect(row.getByText('Find the Dragon')).toBeInTheDocument();
      expect(row.getByText('Active')).toBeInTheDocument();
      expect(row.getByText('Dungeon')).toBeInTheDocument();
    });

    // CHANGED (T063): the location is the line under the title now, as an
    // NPC's title is, and an empty second line stays empty -- it used to be a
    // column of its own, where a dash marked the gap.
    it('leaves the line under the title empty when the quest has no location', () => {
      mockQuestContext.quests = [makeQuest({ id: 'q-no-loc', title: 'No Location Quest' })];
      renderPage();
      const row = within(expandButton('No Location Quest'));
      expect(row.queryByText('—')).not.toBeInTheDocument();
      // The blank line, matched as written: the default normaliser trims it.
      expect(
        row.getByText(' ', {
          normalizer: getDefaultNormalizer({ trim: false, collapseWhitespace: false }),
        })
      ).toBeInTheDocument();
    });

    // #1412: `quest.location` holds an id, so this cell printed slugs.
    it('shows the location\'s display name, not its id', () => {
      mockLocations = [makeLocation({ id: 'mines-of-moria', name: 'Mines of Moria' })];
      mockQuestContext.quests = [
        makeQuest({ id: 'q-moria', title: 'Escape from Moria', locationId: 'mines-of-moria', location: 'mines-of-moria' }),
      ];
      renderPage();
      const row = within(expandButton('Escape from Moria'));
      expect(row.getByText('Mines of Moria')).toBeInTheDocument();
      expect(row.queryByText('mines-of-moria')).not.toBeInTheDocument();
    });

    it('leaves an unresolvable location visible as itself rather than prettified', () => {
      mockLocations = [];
      mockQuestContext.quests = [
        makeQuest({ id: 'q-lost', title: 'Lost Quest', location: 'lothlorien' }),
      ];
      renderPage();
      const row = within(expandButton('Lost Quest'));
      expect(row.getByText('lothlorien')).toBeInTheDocument();
    });

    it('shows objective progress as "<completed> of <total> objectives"', () => {
      renderPage();
      const row = within(expandButton('Find the Dragon'));
      expect(row.getByText('1 of 2 objectives')).toBeInTheDocument();
    });

    it('renders a proportional progress bar sized to the completion ratio', () => {
      renderPage();
      const row = expandButton('Find the Dragon');
      // `.progress-bar-open`, not `.progress-bar-active`: the latter stayed on
      // the accent for reading progress in storytelling, which is not a rank.
      const bar = row.querySelector('.progress-bar-open') as HTMLElement;
      expect(bar).toBeTruthy();
      expect(bar.style.width).toBe('50%');
    });

    it('says "No objectives" and omits the progress bar when there are none', () => {
      renderPage();
      openGroup('Failed Quests');
      const row = expandButton('Rescue the Princess');
      expect(within(row).getByText('No objectives')).toBeInTheDocument();
      expect(row.querySelector('.progress-bar-failed')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Row expansion
  // -------------------------------------------------------------------------
  describe('row expansion', () => {
    it('starts collapsed', () => {
      renderPage();
      expect(expandButton('Find the Dragon')).toHaveAttribute('aria-expanded', 'false');
    });

    it('expands in place on activation and shows expanded fields', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      expect(collapseButton('Find the Dragon')).toHaveAttribute('aria-expanded', 'true');
      // `15-3` bounds the expansion to four facts. The description is the text
      // itself rather than a labelled field, and the objectives are tickable.
      expect(screen.getByText('A quest about a red dragon terrorizing the valley')).toBeInTheDocument();
      expect(screen.getByText('Objectives')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: /Status of Find the Dragon/ })).toBeInTheDocument();
    });

    it('collapses again on a second activation', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      fireEvent.click(collapseButton('Find the Dragon'));
      expect(screen.queryByText('A quest about a red dragon terrorizing the valley')).not.toBeInTheDocument();
    });

    it('only expands one row at a time', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      // T015 collapses this group by default; open it to reach the row.
      openGroup('Completed Quests');
      fireEvent.click(expandButton('Slay the Lich'));

      expect(expandButton('Find the Dragon')).toHaveAttribute('aria-expanded', 'false');
      expect(collapseButton('Slay the Lich')).toHaveAttribute('aria-expanded', 'true');
    });

    it('highlights the row matching the ?highlight= query param', () => {
      mockGetCurrentQueryParams.mockReturnValue({ highlight: 'q1' });
      const { container } = renderPage();
      const highlighted = container.querySelector('#quest-q1');
      expect(highlighted?.className).toContain('highlighted-item');
      const notHighlighted = container.querySelector('#quest-q2');
      expect(notHighlighted?.className).not.toContain('highlighted-item');
    });
  });

  // -------------------------------------------------------------------------
  // Expanded content — the richest part of the quest model
  // -------------------------------------------------------------------------
  describe('expanded content — objectives', () => {
    it('gives every objective a real checkbox, named by the objective (T016)', () => {
      // The marker it replaces was a decorative `<div aria-hidden>`: a keyboard
      // could not reach it and a screen reader never saw it.
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));

      expect(screen.getByRole('checkbox', { name: 'Scout the lair entrance' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Slay the dragon' })).not.toBeChecked();
    });

    it('writes through updateQuestObjective when one is ticked', async () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Slay the dragon' }));

      await waitFor(() =>
        expect(mockUpdateQuestObjective).toHaveBeenCalledWith('q1', 'o2', true)
      );
    });

    it('does not tick optimistically: the box waits for the write', async () => {
      let resolve!: () => void;
      mockUpdateQuestObjective.mockImplementationOnce(
        () => new Promise<void>((r) => { resolve = r; })
      );
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Slay the dragon' }));

      expect(screen.getByRole('checkbox', { name: 'Slay the dragon' })).not.toBeChecked();
      expect(screen.getByText('Saving…')).toBeInTheDocument();
      resolve();
      await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    });

    it('reverts and says why when the write is refused', async () => {
      mockUpdateQuestObjective.mockRejectedValueOnce(new Error('Permission denied'));
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Slay the dragon' }));

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Permission denied')
      );
      expect(screen.getByRole('checkbox', { name: 'Slay the dragon' })).not.toBeChecked();
    });

    it('keeps no prep material in the row at all, and offers the page instead', () => {
      // `15-3` bounded the expansion to four facts and parked the surplus
      // behind a second, closed disclosure, because `/quests/:questId` did not
      // exist yet. It does now, so the disclosure is gone rather than closed:
      // a row with a hidden ninth section is still a row that has to decide
      // what to hide.
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));

      expect(screen.queryByRole('button', { name: /^Prep/ })).not.toBeInTheDocument();
      expect(
        screen.queryByText('The dragon arrived three winters ago.')
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Ask the blacksmith about dragon scales')).not.toBeInTheDocument();
      expect(screen.queryByText('500 gold')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'More info' })).toBeInTheDocument();
    });

    it('opens the quest’s own page from the expanded row', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      fireEvent.click(screen.getByRole('button', { name: 'More info' }));
      expect(mockNavigateToPage).toHaveBeenCalledWith('/quests/q1');
    });

    it('keeps the way in out of the collapsed row (D41)', () => {
      // The collapsed row is the highest-frequency surface in the product and
      // does not get a second control; a row that is already open has said it
      // wants more.
      renderPage();
      expect(screen.queryByRole('button', { name: 'More info' })).not.toBeInTheDocument();
    });

    it('offers the status ladder as buttons, not a dropdown', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));

      const ladder = screen.getByRole('group', { name: /Status of Find the Dragon/ });
      expect(within(ladder).getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(ladder).getByRole('button', { name: 'Completed' })).toBeInTheDocument();
      expect(within(ladder).getByRole('button', { name: 'Failed' })).toBeInTheDocument();
    });

    it('changes a quest status from the row, in one click', async () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));

      const ladder = screen.getByRole('group', { name: /Status of Find the Dragon/ });
      fireEvent.click(within(ladder).getByRole('button', { name: 'Completed' }));

      await waitFor(() =>
        expect(mockUpdateQuest).toHaveBeenCalledWith(
          'q1',
          expect.objectContaining({ status: 'completed' })
        )
      );
    });

    it('shows completed objectives struck through and muted, pending ones plain', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));

      const completedText = screen.getByText('Scout the lair entrance');
      const pendingText = screen.getByText('Slay the dragon');

      expect(completedText.className).toContain('line-through');
      expect(completedText.className).toContain('typography-secondary');
      expect(pendingText.className).not.toContain('line-through');
      // A ticked objective keeps its place: it is not moved to the bottom.
      const descriptions = screen
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent);
      expect(descriptions[0]).toContain('Scout the lair entrance');
    });

    it('states "No objectives recorded" honestly instead of hiding the field', () => {
      renderPage();
      // T015 collapses this group by default; open it to reach the row.
      openGroup('Failed Quests');
      fireEvent.click(expandButton('Rescue the Princess'));
      expect(screen.getByText('No objectives recorded')).toBeInTheDocument();
    });
  });

  describe('expanded content — the four facts, and nothing else', () => {
    it('always shows the description', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      expect(
        screen.getByText('A quest about a red dragon terrorizing the valley')
      ).toBeInTheDocument();
    });

    it('carries none of the prep material the page now owns', () => {
      // Background, leads, complications, rewards, level range, completion
      // date and key locations are read once while prepping -- which is when
      // you are on the quest's page. Together they made this row about 1,100px
      // tall (§3).
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));

      expect(screen.queryByText('No background written yet')).not.toBeInTheDocument();
      expect(screen.queryByText('The lair is full of traps')).not.toBeInTheDocument();
      expect(screen.queryByText('Dragon scale armor')).not.toBeInTheDocument();
      expect(screen.queryByText('3-5')).not.toBeInTheDocument();
      expect(screen.queryByText(/Dragon's Lair/)).not.toBeInTheDocument();
    });

    it('never renders a second NPC list (D15.7)', () => {
      // `importantNPCs` is deleted: two fields for one relationship, both
      // rendered, is why the same person appeared twice on one card.
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));

      expect(screen.queryByText('No important NPCs recorded')).not.toBeInTheDocument();
      expect(screen.getAllByText('Elder Willow')).toHaveLength(1);
    });
  });

  describe('expanded content — who is in it', () => {
    it('renders a resolvable related NPC as a button that opens their page', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      fireEvent.click(screen.getByRole('button', { name: /Elder Willow/ }));
      expect(mockNavigateToPage).toHaveBeenCalledWith('/npcs/npc-1');
    });

    it('flags a related NPC id that does not resolve, instead of silently dropping it', () => {
      renderPage();
      fireEvent.click(expandButton('Collect Herbs'));
      expect(
        screen.getByText('Someone no longer in the directory')
      ).toBeInTheDocument();
    });

    it('states emptiness honestly when nobody is attached', () => {
      renderPage();
      // T015 collapses this group by default; open it to reach the row.
      openGroup('Failed Quests');
      fireEvent.click(expandButton('Rescue the Princess'));
      expect(screen.getByText('Nobody attached yet')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Deleting moved to the page (`15-5` item 12)
  // -------------------------------------------------------------------------
  describe('what the row no longer does', () => {
    it('offers neither Edit nor Delete', () => {
      // Delete belongs beside the record it destroys, next to everything that
      // loses a link -- not in a list of five rows where the wrong one is one
      // mis-click away. Editing happens on the page, in place (§7).
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));

      expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('never calls deleteQuest', () => {
      renderPage();
      fireEvent.click(expandButton('Find the Dragon'));
      expect(mockDeleteQuest).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Search filter
  // -------------------------------------------------------------------------
  describe('search filter', () => {
    it('filters by title', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'dragon' },
      });
      expect(screen.getByText('Find the Dragon')).toBeInTheDocument();
      expect(screen.queryByText('Slay the Lich')).not.toBeInTheDocument();
    });

    it('filters by description', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'necromantic' },
      });
      expect(screen.getByText('Slay the Lich')).toBeInTheDocument();
      expect(screen.queryByText('Find the Dragon')).not.toBeInTheDocument();
    });

    it('also searches objective descriptions, not just title and description', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'phylactery' },
      });
      expect(screen.getByText('Slay the Lich')).toBeInTheDocument();
      expect(screen.queryByText('Find the Dragon')).not.toBeInTheDocument();
      expect(screen.queryByText('Collect Herbs')).not.toBeInTheDocument();
    });

    it('is case-insensitive', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'DRAGON' },
      });
      expect(screen.getByText('Find the Dragon')).toBeInTheDocument();
    });

    it('clears back to the full list when the search is cleared', () => {
      renderPage();
      const search = screen.getByPlaceholderText('Search quests...');
      fireEvent.change(search, { target: { value: 'dragon' } });
      fireEvent.change(search, { target: { value: '' } });
      expect(screen.getByText('Find the Dragon')).toBeInTheDocument();
      expect(screen.getByText('Slay the Lich')).toBeInTheDocument();
    });

    // Bug #1415's regression test. It used to pin the defective behaviour
    // (matching only the raw relatedNPCIds string, never the NPC's resolved
    // name). Inverted here to assert the fix: searching a related NPC's
    // *name* finds every quest that NPC is related to.
    it('matches search text against the related NPC\'s resolved name, not just its raw id', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'willow' },
      });
      // Both quests relate to npc-1, which mockGetNPCById resolves to "Elder Willow".
      expect(screen.getByText('Find the Dragon')).toBeInTheDocument();
      expect(screen.getByText('Collect Herbs')).toBeInTheDocument();
      // Unrelated to that NPC, and no other clause matches "willow".
      expect(screen.queryByText('Slay the Lich')).not.toBeInTheDocument();
      expect(screen.queryByText('Rescue the Princess')).not.toBeInTheDocument();
    });

    // The id check is kept as a fallback (`||`), not replaced, so a deep
    // link or a copy-pasted id still finds the quest even though the typed
    // text isn't the NPC's name.
    it('also matches a raw NPC id typed verbatim, as a fallback for deep links and copy-pasted ids', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'npc-1' },
      });
      expect(screen.getByText('Find the Dragon')).toBeInTheDocument();
      expect(screen.getByText('Collect Herbs')).toBeInTheDocument();
    });

    // An id that no longer resolves to an NPC (e.g. the NPC was deleted)
    // must not be silently dropped from search -- it still matches on its
    // raw text via the same fallback, mirroring the expanded "Related NPCs"
    // row, which surfaces an unresolvable id instead of hiding it.
    it('still matches an unresolvable (deleted) NPC id via the raw-id fallback', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'npc-missing' },
      });
      expect(screen.getByText('Collect Herbs')).toBeInTheDocument();
      expect(screen.queryByText('Find the Dragon')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Location filter — stays a <select>, unbounded set of values
  // -------------------------------------------------------------------------
  describe('location filter', () => {
    it('renders a location select with every unique location, when any quest has one', () => {
      renderPage();
      const select = screen.getByRole('combobox');
      const optionLabels = within(select)
        .getAllByRole('option')
        .map(o => o.textContent);
      expect(optionLabels).toEqual(['All Locations', 'Crypt', 'Dungeon', 'Forest']);
    });

    it('omits the location select entirely when no quest has a location', () => {
      mockQuestContext.quests = [makeQuest({ id: 'q-x', title: 'No Location' })];
      renderPage();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('filters rows by the selected location', () => {
      renderPage();
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Dungeon' } });
      expect(screen.getByText('Find the Dragon')).toBeInTheDocument();
      expect(screen.getByText('Rescue the Princess')).toBeInTheDocument();
      expect(screen.queryByText('Slay the Lich')).not.toBeInTheDocument();
      expect(screen.queryByText('Collect Herbs')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Combined filters
  // -------------------------------------------------------------------------
  describe('combined filters', () => {
    it('applies status and location filters together', () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: '2 active' }));
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Dungeon' } });
      expect(screen.getByText('Find the Dragon')).toBeInTheDocument();
      expect(screen.queryByText('Collect Herbs')).not.toBeInTheDocument();
      expect(screen.queryByText('Rescue the Princess')).not.toBeInTheDocument();
    });

    it('applies search and status filters together', () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search quests...'), {
        target: { value: 'herbs' },
      });
      fireEvent.click(screen.getByRole('button', { name: '2 active' }));
      expect(screen.getByText('Collect Herbs')).toBeInTheDocument();
      expect(screen.queryByText('Find the Dragon')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Row anatomy — one encoding per fact
  // -------------------------------------------------------------------------
  describe('row anatomy', () => {
    test('carries exactly one identity mark, derived from the id', () => {
      renderPage();
      const row = within(expandButton('Find the Dragon'));
      const marks = row.getAllByTestId('entity-sigil');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('F');
    });

    test('states status as a word and nothing else', () => {
      renderPage();
      const row = expandButton('Find the Dragon');
      expect(within(row).getByText('Active')).toBeInTheDocument();
      expect(row.querySelectorAll('.bg-status-active')).toHaveLength(0);
      expect(row.querySelectorAll('.bg-status-completed')).toHaveLength(0);
      expect(row.querySelectorAll('.bg-status-failed')).toHaveLength(0);
    });
  });


  // -------------------------------------------------------------------------
  // T101: a campaign with thousands of quests mounted every row. Each status
  // group now mounts a page at a time, folded or not.
  // -------------------------------------------------------------------------
  describe('large campaigns', () => {
    const many = (status: Quest['status'], count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) =>
        makeQuest({ id: `${prefix}-${i}`, title: `${prefix} quest ${i}`, status })
      );
    /** Rows on the page, folded ones included, by their expand control. */
    const rowsOf = (prefix: string) =>
      screen.queryAllByRole('button', { name: new RegExp(`^(Expand|Collapse) ${prefix} quest `), hidden: true }).length;

    beforeEach(() => {
      mockQuestContext.quests = [...many('active', 250, 'open'), ...many('completed', 150, 'done')];
    });

    it('mounts one page of each group, while the headings still count them all', () => {
      renderPage();
      expect(rowsOf('open')).toBe(100);
      expect(rowsOf('done')).toBe(100);
      expect(screen.getByText('250')).toBeInTheDocument();
      expect(screen.getByText('150')).toBeInTheDocument();
    });

    it('adds a page to the group whose "Show more" was pressed, and to no other', () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /show .*more/i }));
      expect(rowsOf('open')).toBe(200);
      expect(rowsOf('done')).toBe(100);
    });

    it('offers no "Show more" for a folded group until it is opened', () => {
      renderPage();
      // Only the active group's.
      expect(screen.getAllByRole('button', { name: /show .*more/i })).toHaveLength(1);
      openGroup(/Completed Quests/);
      expect(screen.getAllByRole('button', { name: /show .*more/i })).toHaveLength(2);
    });

    it('opens a folded group for a deep link, and mounts the linked row however far down', () => {
      mockGetCurrentQueryParams.mockReturnValue({ highlight: 'done-140' });
      renderPage();
      expect(screen.getByRole('button', { name: /Completed Quests/ })).toHaveAttribute('aria-expanded', 'true');
      // Opened for the link, so in reach of a reader rather than merely mounted.
      expect(screen.getByRole('button', { name: /^(Expand|Collapse) done quest 140$/ })).toBeVisible();
    });
  });
});
