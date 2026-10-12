// src/features/campaign-entities/locations/components/__tests__/LocationDirectory.test.tsx
//
// `15-4` turns this directory into a **tree of rows**. What it replaces expanded
// a parent into a full record card, printed a "Locations in X" heading, and
// nested a *child record card* inside it — two records at identical weight,
// unbounded as depth grows. Large parts of this suite changed with it, and the
// changes are deliberate rather than convenient:
//
// - The whole row was one expand button, and §6.1 split it into two targets so
//   the name could open the page. That split is now reverted, deliberately —
//   see the "the row opens the row" block for the defect it caused and the
//   rule that replaces it.
// - The expansion held nine labelled fields, Edit and Delete. It now holds the
//   bounded four-fact summary; notes, tags, last-visited, the record line and
//   the destructive action moved to `/locations/:locationId` (§3).
// - Children nested under a "Locations in X" group heading. They are one-line
//   rows at 30px indent behind a hairline rail.
// - Searching flattens the tree and shows each hit with its path.

import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import LocationDirectory from '../LocationDirectory';
import { EXAMPLE_CAMPAIGN } from 'shared/example-campaign/example-campaign';
import { Location } from '../../types';
import * as highlightTarget from 'shared/hooks/useHighlightTarget';

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

jest.mock('shared/context/NavigationContext', () => ({
  useNavigation: jest.fn(),
}));

jest.mock('../../../npcs/context/NPCContext', () => ({
  useNPCs: jest.fn(() => ({ npcs: [], getNPCById: jest.fn(() => undefined) })),
}));
jest.mock('../../../quests/context/QuestContext', () => ({
  useQuests: jest.fn(() => ({ quests: [], getQuestById: jest.fn(() => undefined) })),
}));

jest.mock('../../context/LocationContext', () => ({
  useLocations: jest.fn(() => ({
    updateLocationStatus: jest.fn(),
  })),
}));

jest.mock('@/features/user-management', () => ({
  useAuth: jest.fn(() => ({ user: { uid: 'user-1' } })),
  useFirebase: jest.fn(() => ({ activeGroupId: 'group-1' })),
}));

jest.mock('shared/utils/attribution-utils', () => ({
  determineAttributionActor: jest.fn(() => ''),
  fetchAttributionUsernames: jest.fn().mockResolvedValue({}),
}));
jest.mock('core/services/firebase', () => ({ default: {} }));

const { useNavigation } = require('shared/context/NavigationContext');
const { useLocations } = require('../../context/LocationContext');
const { useNPCs } = require('../../../npcs/context/NPCContext');
const { useQuests } = require('../../../quests/context/QuestContext');

const mockNavigateToPage = jest.fn();
const mockUpdateLocationStatus = jest.fn().mockResolvedValue(undefined);
const mockCreatePath = jest.fn(
  (path: string, _p: unknown, query?: Record<string, string>) =>
    query ? `${path}?${new URLSearchParams(query).toString()}` : path
);

function setupMocks(queryParams: Record<string, string> = {}) {
  (useNavigation as jest.Mock).mockReturnValue({
    navigateToPage: mockNavigateToPage,
    createPath: mockCreatePath,
    getCurrentQueryParams: jest.fn(() => queryParams),
  });
  (useLocations as jest.Mock).mockReturnValue({
    updateLocationStatus: mockUpdateLocationStatus,
  });
  (useNPCs as jest.Mock).mockReturnValue({ npcs: [], getNPCById: jest.fn(() => undefined) });
  (useQuests as jest.Mock).mockReturnValue({ quests: [], getQuestById: jest.fn(() => undefined) });
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeLocation(id: string, name: string, overrides: Partial<Location> = {}): Location {
  return {
    id,
    name,
    type: 'city',
    status: 'known',
    description: `Description for ${name}`,
    features: [],
    connectedNPCs: [],
    notes: [],
    tags: [],
    createdBy: 'user-1',
    createdByUsername: 'TestUser',
    dateAdded: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/** The roster's search box. */
const searchInput = () => screen.getByPlaceholderText('Search locations...');

/**
 * The twisty, which is on every row -- see the §6.1 block below for why it is
 * no longer conditional on having something inside.
 */
const twisty = (name: string | RegExp) =>
  screen.getByRole('button', { name: new RegExp(`^Expand ${name}$`) });

const openTwisty = (name: string) => fireEvent.click(twisty(name));

const collapseTwisty = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^Collapse ${name}$`) });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocationDirectory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  describe('loading state', () => {
    test('shows the rhythm of the rows that are coming, not a spinner', () => {
      const { container } = render(<LocationDirectory locations={[]} isLoading={true} />);
      expect(screen.getByRole('status', { name: /loading locations/i })).toBeInTheDocument();
      expect(container.querySelectorAll('.section-loading').length).toBeGreaterThan(3);
      expect(container.querySelector('.animate-spin')).toBeNull();
    });

    test('should not render search bar when isLoading is true', () => {
      render(<LocationDirectory locations={[]} isLoading={true} />);
      expect(screen.queryByPlaceholderText('Search locations...')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    test('says what the collection is for, and offers the action that fills it', () => {
      render(<LocationDirectory locations={[]} />);
      expect(screen.getByText(/muninn hasn't been anywhere yet/i)).toBeInTheDocument();
      expect(screen.getByText("ᛗ")).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText(/regions, cities, dungeons/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /add the first location/i })
      ).toBeInTheDocument();
    });

    test("shows the example campaign's places under it, as rows that do nothing", () => {
      render(<LocationDirectory locations={[]} />);
      const example = screen.getByTestId('roster-example');
      EXAMPLE_CAMPAIGN.locations.forEach((place) =>
        expect(within(example).getByText(place.name)).toBeInTheDocument()
      );
      // The real row's cells, and the tree: the town sits inside the region.
      expect(within(example).getByText('Explored')).toBeInTheDocument();
      expect(within(example).getByText('1 inside · 1 NPC · 1 quest')).toBeInTheDocument();
      expect(within(example).getByText('2 NPCs · 1 quest')).toBeInTheDocument();
      expect(within(example).getAllByTestId('roster-indent')).toHaveLength(1);
      expect(within(example).queryAllByRole('button', { hidden: true })).toHaveLength(0);
      const action = screen.getByRole('button', { name: /add the first location/i });
      expect(action.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('a campaign with one place shows no example', () => {
      render(<LocationDirectory locations={[makeLocation('loc-1', 'Silverkeep')]} />);
      expect(screen.queryByTestId('roster-example')).not.toBeInTheDocument();
    });

    test('a list emptied by a filter shows no example', () => {
      render(<LocationDirectory locations={[makeLocation('loc-1', 'Silverkeep')]} />);
      fireEvent.change(screen.getByPlaceholderText('Search locations...'), {
        target: { value: 'nowhere like this' },
      });
      expect(screen.getByText(/no locations match these filters/i)).toBeInTheDocument();
      expect(screen.queryByTestId('roster-example')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // The row: one line until asked
  // -------------------------------------------------------------------------
  describe('one line per place', () => {
    test('renders every location it is given', () => {
      render(
        <LocationDirectory
          locations={[makeLocation('loc-1', 'Silverkeep'), makeLocation('loc-2', 'Ironhold')]}
        />
      );
      expect(screen.getByText('Silverkeep')).toBeInTheDocument();
      expect(screen.getByText('Ironhold')).toBeInTheDocument();
    });

    test('carries mark, name, type in words, knowledge step and what is inside', () => {
      (useNPCs as jest.Mock).mockReturnValue({
        npcs: [],
        getNPCById: jest.fn(() => ({ id: 'npc-1', name: 'Aldric', relationship: 'friendly' })),
      });
      // The quest names the place (T131).
      (useQuests as jest.Mock).mockReturnValue({
        quests: [{ id: 'q-1', title: 'Find the Amulet', status: 'active', locationId: 'loc-1' }],
        getQuestById: jest.fn(() => undefined),
      });
      const parent = makeLocation('loc-1', 'Silverkeep', {
        type: 'city',
        status: 'visited',
        connectedNPCs: ['npc-1'],
      });
      const child = makeLocation('loc-2', 'The Rusty Anchor', { parentId: 'loc-1' });
      const { container } = render(<LocationDirectory locations={[parent, child]} />);

      const row = within(container.querySelector('#location-loc-1') as HTMLElement);
      expect(row.getByText('Silverkeep')).toBeInTheDocument();
      expect(row.getByText('City')).toBeInTheDocument();
      expect(row.getByText('Visited')).toBeInTheDocument();
      expect(row.getByText('1 inside · 1 NPC · 1 quest')).toBeInTheDocument();
      expect(row.getAllByTestId('entity-sigil')).toHaveLength(1);
    });

    test('says nothing about what is inside when there is nothing inside', () => {
      const { container } = render(
        <LocationDirectory locations={[makeLocation('loc-1', 'Silverkeep')]} />
      );
      const row = within(container.querySelector('#location-loc-1') as HTMLElement);
      expect(row.queryByText(/inside/)).not.toBeInTheDocument();
    });

    test('renders type filters as visible pills rather than a select', () => {
      render(<LocationDirectory locations={[]} />);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      for (const label of ['All', 'Regions', 'Cities', 'Towns', 'Villages', 'Dungeons', 'Landmarks', 'Buildings', 'POIs']) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      }
    });

    test('renders the group name as a real heading, not a control', () => {
      render(<LocationDirectory locations={[makeLocation('loc-1', 'Silverkeep')]} />);
      expect(screen.getByRole('heading', { name: 'Locations' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Locations' })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // The row opens the row; *More info* opens the page
  // -------------------------------------------------------------------------
  //
  // CHANGED DELIBERATELY, and this block is the spec that changed. §6.1 split
  // the row into two targets -- the twisty opened the branch, the name opened
  // the page -- and gave a place with nothing inside no twisty at all. That
  // was written when a location row had nothing to expand into *except* its
  // children. §1.3 then gave every row a bounded summary, and the two rules
  // together left a leaf with no control that opened it: its description,
  // features, knowledge ladder, people and quests were unreachable from the
  // directory, and clicking its name left for the page.
  //
  // Reported from the running app and confirmed on `/locations`, where all
  // five places were leaves and not one could be opened. So the row now
  // behaves like a quest row and an NPC row: the row opens the row, and the
  // page is reached through *More info* in the expansion (D41).
  describe('the row opens the row, and More info opens the page', () => {
    const parent = makeLocation('parent-1', 'Kingdom of Valor');
    const child = makeLocation('child-1', 'Silverkeep', { parentId: 'parent-1' });

    test('a place with nothing inside can still be opened', () => {
      render(<LocationDirectory locations={[makeLocation('leaf', 'Bare Rock')]} />);
      openTwisty('Bare Rock');

      expect(collapseTwisty('Bare Rock')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Description for Bare Rock')).toBeInTheDocument();
    });

    test('the twisty opens the row and does not navigate', () => {
      render(<LocationDirectory locations={[parent, child]} />);
      openTwisty('Kingdom of Valor');

      expect(collapseTwisty('Kingdom of Valor')).toHaveAttribute('aria-expanded', 'true');
      expect(mockNavigateToPage).not.toHaveBeenCalled();
    });

    test('the name opens the row too, and does not navigate', () => {
      render(<LocationDirectory locations={[parent, child]} />);
      fireEvent.click(screen.getByText('Kingdom of Valor'));

      expect(mockNavigateToPage).not.toHaveBeenCalled();
      expect(collapseTwisty('Kingdom of Valor')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Silverkeep')).toBeInTheDocument();
    });

    test('the collapsed row carries no second control at all (D41)', () => {
      render(<LocationDirectory locations={[makeLocation('leaf', 'Bare Rock')]} />);

      expect(screen.queryByRole('button', { name: 'Open Bare Rock' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'More info' })).not.toBeInTheDocument();
    });

    test('More info, once the row is open, is the way to the place', () => {
      render(<LocationDirectory locations={[makeLocation('leaf', 'Bare Rock')]} />);
      openTwisty('Bare Rock');

      fireEvent.click(screen.getByRole('button', { name: 'More info' }));
      expect(mockNavigateToPage).toHaveBeenCalledWith('/locations/leaf');
    });
  });

  // -------------------------------------------------------------------------
  // The bounded summary
  // -------------------------------------------------------------------------
  describe('the expansion is a bounded summary (§1.3, §3)', () => {
    const withChild = [
      makeLocation('loc-1', 'Silverkeep', { features: ['Seven gates', 'White towers'] }),
      makeLocation('loc-2', 'Cellar', { parentId: 'loc-1' }),
    ];

    test('holds the four facts a row carries, and nothing else', () => {
      render(<LocationDirectory locations={withChild} />);
      openTwisty('Silverkeep');

      expect(screen.getByText('Description for Silverkeep')).toBeInTheDocument();
      expect(screen.getByText('Seven gates · White towers')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Knowledge of Silverkeep' })).toBeInTheDocument();
      expect(screen.getByText('Who is here')).toBeInTheDocument();
      expect(screen.getByText('Quests here')).toBeInTheDocument();
    });

    test('does not expand into the record: notes, tags and history are on the page', () => {
      render(
        <LocationDirectory
          locations={[
            makeLocation('loc-1', 'Silverkeep', {
              tags: ['elven'],
              notes: [{ date: '2025-05-31T19:27:30.387Z', text: 'A council was held.' }],
              lastVisited: '2025-05-31',
            }),
            makeLocation('loc-2', 'Cellar', { parentId: 'loc-1' }),
          ]}
        />
      );
      openTwisty('Silverkeep');

      // §3: the row holds what can be read while scanning five of them. These
      // are read once, while prepping, which is what a page is for.
      expect(screen.queryByText('elven')).not.toBeInTheDocument();
      expect(screen.queryByText('A council was held.')).not.toBeInTheDocument();
      expect(screen.queryByText(/Last visited/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Recorded by/i)).not.toBeInTheDocument();
    });

    test('carries no destructive action: Delete is on the page, beside what it destroys', () => {
      render(<LocationDirectory locations={withChild} />);
      openTwisty('Silverkeep');

      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    });

    test('states an empty summary honestly rather than hiding it', () => {
      render(
        <LocationDirectory
          locations={[
            makeLocation('bare', 'Bare Rock', { description: '' }),
            makeLocation('in', 'Crack', { parentId: 'bare' }),
          ]}
        />
      );
      openTwisty('Bare Rock');

      expect(screen.getByText('Nothing written about this place yet')).toBeInTheDocument();
      expect(screen.getByText('None recorded')).toBeInTheDocument();
      expect(screen.getByText('Nobody recorded here')).toBeInTheDocument();
      expect(screen.getByText('No quests here')).toBeInTheDocument();
    });

    test('navigates to an NPC listed in the summary', () => {
      (useNPCs as jest.Mock).mockReturnValue({
        npcs: [],
        getNPCById: jest.fn(() => ({ id: 'npc-1', name: 'Aldric', title: 'Guard' })),
      });
      render(
        <LocationDirectory
          locations={[
            makeLocation('loc-1', 'Silverkeep', { connectedNPCs: ['npc-1'] }),
            makeLocation('loc-2', 'Cellar', { parentId: 'loc-1' }),
          ]}
        />
      );
      openTwisty('Silverkeep');
      fireEvent.click(screen.getByRole('button', { name: /Aldric/ }));
      // The NPC's own page (T014); a highlighted directory row until then.
      expect(mockNavigateToPage).toHaveBeenCalledWith('/npcs/npc-1');
    });

    test('navigates to a quest listed in the summary, whose status is a word', () => {
      (useQuests as jest.Mock).mockReturnValue({
        quests: [{ id: 'q-1', title: 'Find the Amulet', status: 'active', locationId: 'loc-1' }],
        getQuestById: jest.fn(() => ({ id: 'q-1', title: 'Find the Amulet', status: 'active' })),
      });
      render(
        <LocationDirectory
          locations={[
            makeLocation('loc-1', 'Silverkeep'),
            makeLocation('loc-2', 'Cellar', { parentId: 'loc-1' }),
          ]}
        />
      );
      openTwisty('Silverkeep');
      const quest = screen.getByRole('button', { name: /Find the Amulet/ });
      expect(within(quest).getByText('· Active')).toBeInTheDocument();
      fireEvent.click(quest);
      // The quest's own page since `15-5`; a highlighted directory row until then.
      expect(mockNavigateToPage).toHaveBeenCalledWith('/quests/q-1');
    });
  });

  // -------------------------------------------------------------------------
  // The tree
  // -------------------------------------------------------------------------
  describe('a tree of rows, not cards inside cards (§6.1)', () => {
    const region = makeLocation('region-1', 'Kingdom of Valor');
    const city = makeLocation('city-1', 'Silverkeep', { parentId: 'region-1' });
    const building = makeLocation('building-1', 'The Rusty Anchor', {
      parentId: 'city-1',
      type: 'building',
    });

    test('does not render a child until its parent is opened', () => {
      render(<LocationDirectory locations={[region, city]} />);
      expect(screen.queryByText('Silverkeep')).not.toBeInTheDocument();

      openTwisty('Kingdom of Valor');
      expect(screen.getByText('Silverkeep')).toBeInTheDocument();
    });

    test('never prints a "Locations in X" heading, because the child is a row', () => {
      render(<LocationDirectory locations={[region, city]} />);
      openTwisty('Kingdom of Valor');

      expect(
        screen.queryByRole('heading', { name: /Locations in/ })
      ).not.toBeInTheDocument();
    });

    test('carries the hierarchy in indentation, 30px per level', () => {
      const { container } = render(<LocationDirectory locations={[region, city, building]} />);
      openTwisty('Kingdom of Valor');
      openTwisty('Silverkeep');

      // The shared row's indent (`RosterRow`'s `depth`, T063); the row used
      // to pad its own line instead. A top-level row has none.
      const indentOf = (id: string) =>
        (
          container.querySelector(
            `#location-${id} > div > div > [data-testid="roster-indent"]`
          ) as HTMLElement | null
        )?.style.width ?? '0px';

      expect(indentOf('region-1')).toBe('0px');
      expect(indentOf('city-1')).toBe('30px');
      expect(indentOf('building-1')).toBe('60px');
    });

    test('caps the visual indent at four levels so the name column never collapses', () => {
      // Six levels of nesting. The logical depth keeps counting; the indent
      // stops, or a name eight levels down has no column left to sit in.
      const chain = Array.from({ length: 6 }, (_, i) =>
        makeLocation(`n${i}`, `Level ${i}`, i === 0 ? {} : { parentId: `n${i - 1}` })
      );
      const { container } = render(<LocationDirectory locations={chain} />);
      for (let i = 0; i < 5; i += 1) openTwisty(`Level ${i}`);

      // The shared row's indent (`RosterRow`'s `depth`, T063); the row used
      // to pad its own line instead. A top-level row has none.
      const indentOf = (id: string) =>
        (
          container.querySelector(
            `#location-${id} > div > div > [data-testid="roster-indent"]`
          ) as HTMLElement | null
        )?.style.width ?? '0px';

      expect(indentOf('n4')).toBe('120px');
      expect(indentOf('n5')).toBe('120px');
      expect(screen.getByText('Level 5')).toBeInTheDocument();
    });

    test('a child opens its own summary in place, independently of its parent', () => {
      render(<LocationDirectory locations={[region, city, building]} />);
      openTwisty('Kingdom of Valor');
      openTwisty('Silverkeep');

      expect(collapseTwisty('Silverkeep')).toHaveAttribute('aria-expanded', 'true');
      expect(collapseTwisty('Kingdom of Valor')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('The Rusty Anchor')).toBeInTheDocument();
    });

    test('collapsing a branch takes what is inside with it', () => {
      render(<LocationDirectory locations={[region, city]} />);
      openTwisty('Kingdom of Valor');
      fireEvent.click(collapseTwisty('Kingdom of Valor'));
      expect(screen.queryByText('Silverkeep')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // §6.1: search flattens
  // -------------------------------------------------------------------------
  describe('search flattens the tree (§6.1)', () => {
    const region = makeLocation('region-1', 'Beleriand');
    const city = makeLocation('city-1', 'Gondolin', { parentId: 'region-1' });
    const square = makeLocation('square-1', "King's Square", { parentId: 'city-1' });

    test('shows a nested match without opening its ancestors', () => {
      // A filtered tree with orphaned parents is unreadable, and an ancestor
      // dragged on screen matches nothing the reader asked for.
      render(<LocationDirectory locations={[region, city, square]} />);
      fireEvent.change(searchInput(), { target: { value: "King's" } });

      expect(screen.getByText("King's Square")).toBeInTheDocument();
      expect(screen.queryByText('Beleriand')).not.toBeInTheDocument();
      expect(screen.queryByText('Gondolin')).not.toBeInTheDocument();
    });

    test('shows each hit with the path it sits on', () => {
      render(<LocationDirectory locations={[region, city, square]} />);
      fireEvent.change(searchInput(), { target: { value: "King's" } });
      expect(screen.getByText('in Beleriand · Gondolin')).toBeInTheDocument();
    });

    test('says so, rather than leaving the flattening to be inferred', () => {
      render(<LocationDirectory locations={[region, city, square]} />);
      fireEvent.change(searchInput(), { target: { value: 'Gondolin' } });
      expect(screen.getByText(/Searching flattens the tree/)).toBeInTheDocument();
    });

    test('renders each match once, never twice', () => {
      // A flat list that also drew its hits' children would put two elements
      // with the same id in the document, and `?highlight=` scrolls to the
      // first one it finds.
      const { container } = render(<LocationDirectory locations={[region, city, square]} />);
      fireEvent.change(searchInput(), { target: { value: 'o' } });
      const ids = Array.from(container.querySelectorAll('[id^="location-"]')).map(
        (node) => node.id
      );
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('matches on description as well as name, case-insensitively', () => {
      render(
        <LocationDirectory
          locations={[
            makeLocation('loc-1', 'Silverkeep', { description: 'A mighty fortress' }),
            makeLocation('loc-2', 'Ironhold', { description: 'A quiet mining town' }),
          ]}
        />
      );
      fireEvent.change(searchInput(), { target: { value: 'MIGHTY FORTRESS' } });
      expect(screen.getByText('Silverkeep')).toBeInTheDocument();
      expect(screen.queryByText('Ironhold')).not.toBeInTheDocument();
    });

    test('a collection emptied by a filter offers no create action', () => {
      render(<LocationDirectory locations={[makeLocation('loc-1', 'Silverkeep')]} />);
      fireEvent.change(searchInput(), { target: { value: 'zzznomatch' } });
      expect(screen.getByText(/no locations match these filters/i)).toBeInTheDocument();
      expect(screen.queryByText("ᛗ")).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /add the first location/i })
      ).not.toBeInTheDocument();
    });

    test('clearing the search restores the tree', () => {
      render(<LocationDirectory locations={[region, city, square]} />);
      fireEvent.change(searchInput(), { target: { value: "King's" } });
      fireEvent.change(searchInput(), { target: { value: '' } });

      expect(screen.getByText('Beleriand')).toBeInTheDocument();
      expect(screen.queryByText("King's Square")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Pills narrow the tree; they do not flatten it
  // -------------------------------------------------------------------------
  describe('type and status filters', () => {
    test('should filter locations by type', () => {
      render(
        <LocationDirectory
          locations={[
            makeLocation('loc-1', 'Silverkeep', { type: 'city' }),
            makeLocation('loc-2', 'Dark Cave', { type: 'dungeon' }),
          ]}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Cities' }));
      expect(screen.getByText('Silverkeep')).toBeInTheDocument();
      expect(screen.queryByText('Dark Cave')).not.toBeInTheDocument();
    });

    test('clicking "All" after a type filter restores every location', () => {
      render(
        <LocationDirectory
          locations={[
            makeLocation('loc-1', 'Silverkeep', { type: 'city' }),
            makeLocation('loc-2', 'Dark Cave', { type: 'dungeon' }),
          ]}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Dungeons' }));
      expect(screen.queryByText('Silverkeep')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'All' }));
      expect(screen.getByText('Silverkeep')).toBeInTheDocument();
      expect(screen.getByText('Dark Cave')).toBeInTheDocument();
    });

    test('marks the active pill as pressed', () => {
      render(<LocationDirectory locations={[makeLocation('loc-1', 'Silverkeep')]} />);
      const cities = screen.getByRole('button', { name: 'Cities' });
      expect(cities).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(cities);
      expect(cities).toHaveAttribute('aria-pressed', 'true');
    });

    test('keeps an ancestor visible, and opens it, to reveal a deep match', () => {
      // A pill narrows a tree that is still a tree, so the connecting ancestors
      // have to be both rendered *and* expanded, or the match is unreachable
      // (#1414 was exactly the two disagreeing).
      const region = makeLocation('region-1', 'Kingdom of Valor', { status: 'known' });
      const city = makeLocation('city-1', 'Silverkeep', {
        parentId: 'region-1',
        status: 'known',
      });
      const building = makeLocation('building-1', 'The Rusty Anchor', {
        parentId: 'city-1',
        type: 'building',
        status: 'visited',
      });
      render(<LocationDirectory locations={[region, city, building]} />);

      fireEvent.click(screen.getByRole('button', { name: '1 visited' }));

      expect(collapseTwisty('Kingdom of Valor')).toBeInTheDocument();
      expect(collapseTwisty('Silverkeep')).toBeInTheDocument();
      expect(screen.getByText('The Rusty Anchor')).toBeInTheDocument();
    });
  });

  describe('status bar', () => {
    const known = makeLocation('loc-1', 'Silverkeep', { status: 'known' });
    const explored = makeLocation('loc-2', 'Ironhold', { status: 'explored' });
    const visited = makeLocation('loc-3', 'Deephaven', { status: 'visited' });

    test('shows the total charted so far', () => {
      render(<LocationDirectory locations={[known, explored, visited]} />);
      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('3');
      expect(screen.getByText('charted so far')).toBeInTheDocument();
    });

    test('breaks the total down by status, each labelled with a word', () => {
      render(<LocationDirectory locations={[known, explored, visited]} />);
      expect(screen.getByRole('button', { name: '1 known' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 explored' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 visited' })).toBeInTheDocument();
    });

    test('keeps zero-value statuses visible rather than hiding them', () => {
      render(<LocationDirectory locations={[known]} />);
      expect(screen.getByRole('button', { name: '0 explored' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '0 visited' })).toBeInTheDocument();
    });

    test('clicking the active band clears the filter', () => {
      render(<LocationDirectory locations={[known, explored]} />);
      const knownBand = () => screen.getByRole('button', { name: '1 known' });

      fireEvent.click(knownBand());
      expect(knownBand()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText('Ironhold')).not.toBeInTheDocument();

      fireEvent.click(knownBand());
      expect(knownBand()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Ironhold')).toBeInTheDocument();
    });

    test('applies search and status together', () => {
      render(
        <LocationDirectory
          locations={[
            makeLocation('loc-1', 'Ironhold', { status: 'known' }),
            makeLocation('loc-2', 'Silverkeep', { status: 'explored' }),
          ]}
        />
      );
      fireEvent.change(searchInput(), { target: { value: 'Iron' } });
      fireEvent.click(screen.getByRole('button', { name: '1 known' }));

      expect(screen.getByText('Ironhold')).toBeInTheDocument();
      expect(screen.queryByText('Silverkeep')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Dangling parents
  // -------------------------------------------------------------------------
  describe('a parentId that names nothing loaded (#303)', () => {
    test('renders under "Unplaced" rather than vanishing', () => {
      render(
        <LocationDirectory
          locations={[makeLocation('orphan-1', 'Lost Outpost', { parentId: 'nonexistent' })]}
        />
      );
      expect(screen.getByRole('heading', { name: 'Unplaced' })).toBeInTheDocument();
      expect(screen.getByText('Lost Outpost')).toBeInTheDocument();
    });

    test('says what an unplaced place is, and how to put it back', () => {
      render(
        <LocationDirectory
          locations={[makeLocation('orphan-1', 'Lost Outpost', { parentId: 'nonexistent' })]}
        />
      );
      const group = screen.getByRole('heading', { name: 'Unplaced' }).closest('section') as HTMLElement;
      expect(within(group).getByText(/no longer in this campaign/)).toBeInTheDocument();
      expect(within(group).getByText(/Move elsewhere/)).toBeInTheDocument();
    });

    test("an orphan's own children still nest under it", () => {
      render(
        <LocationDirectory
          locations={[
            makeLocation('orphan-1', 'Lost Outpost', { parentId: 'nonexistent' }),
            makeLocation('child-1', 'Cellar', { parentId: 'orphan-1' }),
          ]}
        />
      );
      expect(screen.queryByText('Cellar')).not.toBeInTheDocument();
      openTwisty('Lost Outpost');
      expect(screen.getByText('Cellar')).toBeInTheDocument();
    });

    test('root rows and unplaced rows together account for every location', () => {
      render(
        <LocationDirectory
          locations={[
            makeLocation('root-1', 'Silverkeep'),
            makeLocation('orphan-1', 'Lost Outpost', { parentId: 'nonexistent' }),
          ]}
        />
      );
      const group = (name: string) =>
        screen.getByRole('heading', { name }).closest('section') as HTMLElement;

      expect(within(group('Locations')).getByText('1')).toBeInTheDocument();
      expect(within(group('Unplaced')).getByText('1')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('2');
    });

    test('a location whose id is "root" does not adopt the top level', () => {
      // The hierarchy map this replaces keyed its buckets by parentId with
      // 'root' as the sentinel for "no parent".
      render(
        <LocationDirectory
          locations={[makeLocation('root', 'Root Cellar'), makeLocation('other', 'Elsewhere')]}
        />
      );
      expect(
        screen.queryByRole('button', { name: /what is inside Root Cellar/ })
      ).not.toBeInTheDocument();
      expect(screen.getByText('Elsewhere')).toBeInTheDocument();
    });

    test('the empty state still appears when there are genuinely no locations', () => {
      render(<LocationDirectory locations={[]} />);
      expect(screen.getByText(/muninn hasn't been anywhere yet/i)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Unplaced' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Locations' })).not.toBeInTheDocument();
    });
  });

  describe('prop updates', () => {
    test('should update location list when locations prop changes', () => {
      const { rerender } = render(
        <LocationDirectory locations={[makeLocation('loc-1', 'Silverkeep')]} />
      );
      expect(screen.getByText('Silverkeep')).toBeInTheDocument();

      rerender(<LocationDirectory locations={[makeLocation('loc-2', 'Ironhold')]} />);
      expect(screen.queryByText('Silverkeep')).not.toBeInTheDocument();
      expect(screen.getByText('Ironhold')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// The knowledge ladder, the highlight contract, and the cycle guard
// ---------------------------------------------------------------------------

describe('LocationDirectory — the knowledge ladder and ?highlight=', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  const withChild = (id: string, name: string, overrides: Partial<Location> = {}) => [
    makeLocation(id, name, overrides),
    makeLocation(`${id}-in`, 'Something inside', { parentId: id }),
  ];

  describe('the knowledge ladder', () => {
    it('changes the knowledge step from the row, in one click', async () => {
      render(<LocationDirectory locations={withChild('l1', 'Rivendell')} />);
      openTwisty('Rivendell');

      const ladder = screen.getByRole('group', { name: 'Knowledge of Rivendell' });
      fireEvent.click(within(ladder).getByRole('button', { name: 'Visited' }));

      await waitFor(() =>
        expect(mockUpdateLocationStatus).toHaveBeenCalledWith('l1', 'visited')
      );
    });

    it('offers buttons rather than a dropdown, each a word', () => {
      render(<LocationDirectory locations={withChild('l1', 'Rivendell')} />);
      openTwisty('Rivendell');

      const ladder = screen.getByRole('group', { name: 'Knowledge of Rivendell' });
      ['Known', 'Explored', 'Visited'].forEach((label) => {
        expect(within(ladder).getByRole('button', { name: label })).toBeInTheDocument();
      });
      expect(within(ladder).queryByRole('combobox')).toBeNull();
    });
  });

  describe('?highlight= (T014)', () => {
    it('matches by id', () => {
      setupMocks({ highlight: 'l2' });
      const { container } = render(
        <LocationDirectory
          locations={[makeLocation('l1', 'Rivendell'), makeLocation('l2', 'Gondolin')]}
        />
      );
      expect(container.querySelector('#location-l2')?.className).toContain('highlighted-item');
    });

    it('no longer matches by name, because a name does not survive a rename', () => {
      setupMocks({ highlight: 'Gondolin' });
      const { container } = render(
        <LocationDirectory locations={[makeLocation('l2', 'Gondolin')]} />
      );
      expect(container.querySelector('#location-l2')?.className).not.toContain('highlighted-item');
    });

    it('reveals the ancestors needed to see the target', () => {
      setupMocks({ highlight: 'kings-square' });
      render(
        <LocationDirectory
          locations={[
            makeLocation('beleriand', 'Beleriand'),
            makeLocation('gondolin', 'Gondolin', { parentId: 'beleriand' }),
            makeLocation('kings-square', "King's Square", { parentId: 'gondolin' }),
          ]}
        />
      );
      expect(screen.getByText("King's Square")).toBeInTheDocument();
    });
  });

  describe('cycle safety (PERF-11 / T033)', () => {
    // Every assertion here is really an assertion that the render *returned*.
    // Remove a visited set and the suite hangs rather than failing.
    const cycle = [
      makeLocation('a', 'Alpha', { parentId: 'b' }),
      makeLocation('b', 'Beta', { parentId: 'a' }),
    ];

    it('terminates when the highlight target sits inside a parent cycle', () => {
      setupMocks({ highlight: 'a' });
      render(<LocationDirectory locations={cycle} />);
      expect(searchInput()).toBeInTheDocument();
    });

    it('survives a cycle while filtering, which walks the tree a second way', () => {
      render(<LocationDirectory locations={cycle} />);
      fireEvent.change(searchInput(), { target: { value: 'Alpha' } });
      expect(searchInput()).toHaveValue('Alpha');
    });

    it('terminates while rendering a cycle reached from a real root', () => {
      // The tree render itself is the third walk, and the one `Move elsewhere`
      // can now feed: a root whose subtree contains a pair pointing at each
      // other.
      render(
        <LocationDirectory
          locations={[
            makeLocation('root-1', 'Beleriand'),
            makeLocation('x', 'Ex', { parentId: 'root-1' }),
            makeLocation('y', 'Why', { parentId: 'x' }),
            makeLocation('z', 'Zed', { parentId: 'y' }),
          ]}
        />
      );
      openTwisty('Beleriand');
      expect(screen.getByText('Ex')).toBeInTheDocument();
    });
  });
});

// PERF2-001: every match rebuilt an index of the whole collection to walk its
// own ancestors -- twice per search hit -- so a broad filter over 2,000 places
// spent a quarter of a second on ancestry alone. One index serves every walk.
describe('LocationDirectory -- ancestry on a broad filter', () => {
  const realm = () => [
    makeLocation('beleriand', 'Beleriand'),
    ...Array.from({ length: 40 }, (_, n) =>
      makeLocation(`hall-${n}`, `Hall ${n}`, { parentId: 'beleriand' })
    ),
  ];

  beforeEach(() => setupMocks());

  it('labels every search hit with its path without re-indexing per hit', () => {
    const walk = jest.spyOn(highlightTarget, 'ancestorIdsOf');
    try {
      render(<LocationDirectory locations={realm()} />);
      fireEvent.change(searchInput(), { target: { value: 'Hall' } });

      expect(screen.getAllByText(/in Beleriand/)).toHaveLength(40);
      expect(walk).not.toHaveBeenCalled();
    } finally {
      walk.mockRestore();
    }
  });
});
