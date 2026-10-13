// src/features/campaign-entities/npcs/components/__tests__/NPCDirectory.test.tsx

import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import NPCDirectory from '../NPCDirectory';
import { NPC, NPCStatus, NPCRelationship } from 'features/campaign-entities/npcs/types';

// ---------------------------------------------------------------------------
// Mock all context dependencies used by NPCDirectory and the roster rows it renders
// ---------------------------------------------------------------------------

// Notes are documents of their own (T133); see the mock.
jest.mock('features/campaign-entities/shared/recordNotes', () => require('@/test-utils/record-notes-mock').recordNotesMock());

jest.mock('shared/context/NavigationContext', () => ({
  useNavigation: jest.fn(),
}));

jest.mock('../../../quests/context/QuestContext', () => ({
  useQuests: jest.fn(),
}));

jest.mock('features/campaign-entities/npcs/context/NPCContext', () => ({
  useNPCs: jest.fn(),
}));

// Group headings resolve `npc.location` (an id) against the locations
// collection — see #1412. Most tests here set locations to names directly and
// supply no location records, which resolveLocationName passes through verbatim.
let mockLocations: any[] = [];

jest.mock('../../../locations/context/LocationContext', () => ({
  useLocations: () => ({ locations: mockLocations }),
}));

jest.mock('@/features/user-management', () => ({
  useAuth: jest.fn(),
  useFirebase: jest.fn(() => ({ activeGroupId: 'group-1' })),
}));

// AttributionInfo dependencies
// The row credits its author through the real resolver (T124); only the
// profile lookup, which reads Firestore, is stubbed.
jest.mock('shared/utils/attribution-utils', () => ({
  determineAttributionActor: jest.requireActual('shared/utils/attribution-utils').determineAttributionActor,
  fetchAttributionUsernames: jest.fn().mockResolvedValue({}),
}));
jest.mock('core/services/firebase', () => ({ default: {} }));
// T132: authors are credited by the names they have now, from the group's
// members; with no directory (undefined), the stored names apply.
let mockDirectory: Map<string, { username?: string; characters?: Array<{ id: string; name: string }> }> | undefined;
jest.mock('shared/hooks/useMemberDirectory', () => ({
  __esModule: true,
  useMemberDirectory: () => mockDirectory,
  default: () => mockDirectory,
}));

// ---------------------------------------------------------------------------
// Hook setup helpers
// ---------------------------------------------------------------------------

const mockNavigateToPage = jest.fn();
const mockCreatePath = jest.fn(
  (path: string, _p: unknown, query?: Record<string, string>) =>
    query ? `${path}?${new URLSearchParams(query).toString()}` : path
);
const mockGetCurrentQueryParams = jest.fn(() => ({}));

const { useNavigation } = require('shared/context/NavigationContext');
const { useQuests } = require('../../../quests/context/QuestContext');
const { useNPCs } = require('features/campaign-entities/npcs/context/NPCContext');

// `15-3` puts stance on the row, using the mutation the context already had.
const mockUpdateNPCRelationship = jest.fn().mockResolvedValue(undefined);
const mockDeleteNPC = jest.fn().mockResolvedValue(undefined);
const { useAuth } = require('@/features/user-management');

function setupMocks(
  user: { uid: string } | null = { uid: 'user-1' },
  queryParams: Record<string, string> = {}
) {
  (useAuth as jest.Mock).mockReturnValue({ user });
  (useNavigation as jest.Mock).mockReturnValue({
    navigateToPage: mockNavigateToPage,
    createPath: mockCreatePath,
    getCurrentQueryParams: jest.fn(() => queryParams),
  });
  (useQuests as jest.Mock).mockReturnValue({
    getQuestById: jest.fn(() => undefined),
  });
  (useNPCs as jest.Mock).mockReturnValue({
    updateNPCNote: jest.fn().mockResolvedValue(undefined),
    deleteNPC: mockDeleteNPC,
    updateNPCRelationship: mockUpdateNPCRelationship,
  });
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeNPC(overrides: Partial<NPC> = {}): NPC {
  return {
    id: `npc-${Math.random().toString(36).slice(2)}`,
    name: 'Test NPC',
    title: undefined,
    status: 'alive' as NPCStatus,
    relationship: 'neutral' as NPCRelationship,
    description: 'A test NPC',
    appearance: undefined,
    personality: undefined,
    background: undefined,
    occupation: undefined,
    location: 'Silverkeep',
    race: 'Human',
    connections: {
      relatedNPCs: [],
      affiliations: [],
      relatedQuests: [],
    },
    notes: [],
    createdBy: 'user-1',
    createdByUsername: 'TestUser',
    dateAdded: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/** The roster's search box. */
const searchInput = () =>
  screen.getByPlaceholderText(/search name, title or description/i);

const aldric = makeNPC({ id: 'npc-1', name: 'Aldric', location: 'Silverkeep', status: 'alive', relationship: 'friendly' });
const mira = makeNPC({ id: 'npc-2', name: 'Mira', location: 'Ironhold', status: 'deceased', relationship: 'hostile' });
const rolf = makeNPC({ id: 'npc-3', name: 'Rolf', location: 'Silverkeep', status: 'missing', relationship: 'neutral' });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NPCDirectory', () => {
  beforeEach(() => {
    mockDirectory = undefined;
    jest.clearAllMocks();
    mockLocations = [];
    setupMocks();
  });

  // -------------------------------------------------------------------------
  // #1412 — headings used to print the raw `npc.location`, which is an id, so
  // users saw "mines-of-moria" where the Locations page says "Mines of Moria".
  // -------------------------------------------------------------------------
  describe('location headings', () => {
    // A place lists its people (T131).
    const moriaNpc = makeNPC({ id: 'npc-m', name: 'Balin', location: 'mines-of-moria' });

    beforeEach(() => {
      mockLocations = [
        { id: 'mines-of-moria', name: 'Mines of Moria', connectedNPCs: ['npc-m'] },
        { id: 'rivendell', name: 'Rivendell', connectedNPCs: ['npc-r1', 'npc-r2'] },
      ];
    });

    test('shows the location\'s display name, not its id', () => {
      render(<NPCDirectory npcs={[moriaNpc]} />);
      expect(
        screen.getByRole('heading', { name: 'Mines of Moria' })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'mines-of-moria' })
      ).not.toBeInTheDocument();
    });

    // The free text is the name when each was written; the group is the place.
    test('groups NPCs at one place together, whatever name each was written with', () => {
      const byName = makeNPC({ id: 'npc-r1', name: 'Arwen', location: 'Rivendell' });
      const byOldName = makeNPC({ id: 'npc-r2', name: 'Elrond', location: 'Imladris' });
      render(<NPCDirectory npcs={[byName, byOldName]} />);

      expect(screen.getAllByRole('heading', { name: 'Rivendell' })).toHaveLength(1);
      expect(screen.queryByRole('heading', { name: 'Imladris' })).not.toBeInTheDocument();
      expect(screen.getByText('Arwen')).toBeInTheDocument();
      expect(screen.getByText('Elrond')).toBeInTheDocument();
    });

    test('puts a person in several places under the first', () => {
      mockLocations = [
        { id: 'bree', name: 'Bree', connectedNPCs: ['npc-s'] },
        { id: 'rivendell', name: 'Rivendell', connectedNPCs: ['npc-s'] },
      ];
      render(<NPCDirectory npcs={[makeNPC({ id: 'npc-s', name: 'Strider' })]} />);

      expect(screen.getByRole('heading', { name: 'Bree' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Rivendell' })).not.toBeInTheDocument();
    });

    test('leaves an unresolvable location visible as itself rather than prettified', () => {
      // The sample data's `lothlorien` matches no location record. Title-casing
      // it would invent a real-looking heading for a place that doesn't exist.
      const lost = makeNPC({ id: 'npc-l', name: 'Haldir', location: 'lothlorien' });
      render(<NPCDirectory npcs={[lost]} />);

      expect(screen.getByRole('heading', { name: 'lothlorien' })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Lothlorien' })
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // A reader who may not write (the signed-out example): the page as members
  // see it, without the controls that change anything.
  // -------------------------------------------------------------------------
  describe('when the reader may not edit', () => {
    it('offers no selection, and no Delete in an open row', () => {
      render(<NPCDirectory npcs={[aldric, mira]} canEdit={false} />);
      expect(screen.queryByRole('button', { name: 'Select NPCs' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Expand Aldric' }));
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('keeps the way into a record, and the stance ladder, as members see them', () => {
      render(<NPCDirectory npcs={[aldric]} canEdit={false} />);
      fireEvent.click(screen.getByRole('button', { name: 'Expand Aldric' }));
      expect(screen.getByRole('button', { name: 'More info' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Stance of Aldric' })).toBeInTheDocument();
    });

    it('offers no way to add the first NPC to an empty list', () => {
      render(<NPCDirectory npcs={[]} canEdit={false} />);
      expect(screen.queryByRole('button', { name: /Add the first NPC/ })).not.toBeInTheDocument();
    });

    it('still lets members select by default', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      expect(screen.getByRole('button', { name: 'Select NPCs' })).toBeInTheDocument();
    });
  });

  describe('a row open from the start', () => {
    it('opens the row it is given', () => {
      render(<NPCDirectory npcs={[aldric, mira]} initialExpandedId="npc-2" />);
      expect(screen.getByRole('button', { name: 'Collapse Mira' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Expand Aldric' })).toHaveAttribute('aria-expanded', 'false');
    });
  });

  // An example credits no one, so it has no one to name: no empty
  // "Recorded by: Unknown" either.
  describe('a record nobody recorded', () => {
    it('draws no Recorded by at all', () => {
      render(
        <NPCDirectory
          npcs={[makeNPC({ id: 'npc-x', name: 'Nobody', createdBy: '', createdByUsername: '' })]}
          initialExpandedId="npc-x"
        />
      );
      expect(screen.queryByText('Recorded by')).not.toBeInTheDocument();
    });

    it('still credits a record somebody did', () => {
      render(<NPCDirectory npcs={[aldric]} initialExpandedId="npc-1" />);
      expect(screen.getByText('Recorded by')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    test('shows the rhythm of the rows that are coming, not a spinner', () => {
      // A spinner says "something is happening". A skeleton says "a list of
      // rows is happening, and it will be about this tall", so the page does
      // not jump when it arrives.
      const { container } = render(<NPCDirectory npcs={[]} isLoading={true} />);
      expect(screen.getByRole('status', { name: /loading npcs/i })).toBeInTheDocument();
      expect(container.querySelectorAll('.section-loading').length).toBeGreaterThan(3);
      expect(container.querySelector('.animate-spin')).toBeNull();
    });

    test('should not render filters when isLoading is true', () => {
      render(<NPCDirectory npcs={[]} isLoading={true} />);
      expect(
        screen.queryByPlaceholderText(/search name, title or description/i)
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------
  describe('empty state', () => {
    test('says what the collection is for, and offers the action that fills it', () => {
      render(<NPCDirectory npcs={[]} />);
      expect(screen.getByText(/muninn hasn't met anyone yet/i)).toBeInTheDocument();
      expect(screen.getByText("ᛗ")).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText(/every person the party meets/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /add the first npc/i })
      ).toBeInTheDocument();
    });

    test('an empty campaign shows its own empty state and no example: the example is for signed-out visitors', () => {
      render(<NPCDirectory npcs={[]} />);
      expect(screen.queryByRole('region', { name: 'Example campaign' })).not.toBeInTheDocument();
    });

    test('the empty state is not blank', () => {
      // This is where a returning user is most likely to read the product as
      // unfinished, so it is designed rather than left empty.
      const { container } = render(<NPCDirectory npcs={[]} />);
      expect(container.textContent?.trim().length).toBeGreaterThan(40);
    });
  });

  // -------------------------------------------------------------------------
  // NPC rendering
  // -------------------------------------------------------------------------
  describe('NPC rendering', () => {
    test('should render NPC names', () => {
      render(<NPCDirectory npcs={[aldric, mira]} />);
      expect(screen.getByText('Aldric')).toBeInTheDocument();
      expect(screen.getByText('Mira')).toBeInTheDocument();
    });

    test('should group NPCs by location', () => {
      render(<NPCDirectory npcs={[aldric, mira, rolf]} />);
      expect(screen.getAllByText('Silverkeep').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Ironhold').length).toBeGreaterThanOrEqual(1);
    });

    test('should group NPCs with no location under "Location unknown"', () => {
      const unlocated = makeNPC({ id: 'npc-u', name: 'Wanderer', location: undefined });
      render(<NPCDirectory npcs={[unlocated]} />);
      expect(screen.getByText('Location unknown')).toBeInTheDocument();
    });

    test('renders the group name as a heading, not a control', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      // The heading used to be a <Typography h3> wrapped in a ghost <Button>, which
      // handed screen readers a control where a landmark belongs.
      expect(
        screen.getByRole('heading', { name: 'Silverkeep' })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Silverkeep' })
      ).not.toBeInTheDocument();
    });

    test('offers a separate, labelled link to the location', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      expect(
        screen.getByRole('button', { name: 'Open location' })
      ).toBeInTheDocument();
    });

    test('should call navigateToPage when the location link is clicked', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open location' }));
      expect(mockNavigateToPage).toHaveBeenCalled();
    });

    test('opens a location that resolves to a record on its own page (T014)', () => {
      mockLocations = [{ id: 'loc-silverkeep', name: 'Silverkeep' }];
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open location' }));
      expect(mockNavigateToPage).toHaveBeenCalledWith('/locations/loc-silverkeep');
    });

    test('falls back to the directory for free text that names no location record', () => {
      mockLocations = [];
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open location' }));
      expect(mockNavigateToPage).not.toHaveBeenCalledWith(expect.stringMatching(/^\/locations\//));
      expect(mockCreatePath).toHaveBeenCalledWith('/locations', {}, { highlight: 'Silverkeep' });
    });

    test('does not offer a location link for the unknown-location group', () => {
      const unlocated = makeNPC({ id: 'npc-u', name: 'Wanderer', location: undefined });
      render(<NPCDirectory npcs={[unlocated]} />);
      // There is no location record to open.
      expect(
        screen.queryByRole('button', { name: 'Open location' })
      ).not.toBeInTheDocument();
    });

    test('shows each row as one dense row carrying status, standing and occupation', () => {
      const npc = makeNPC({
        id: 'npc-dense',
        name: 'Acar',
        title: 'Elixir brewer',
        status: 'alive',
        relationship: 'neutral',
        occupation: 'Druid Merchant',
      });
      render(<NPCDirectory npcs={[npc]} />);

      // Scoped to the row, since the relationship words also label the filter pills.
      const row = within(screen.getByRole('button', { name: /Expand Acar/ }));
      expect(row.getByText('Acar')).toBeInTheDocument();
      expect(row.getByText('Elixir brewer')).toBeInTheDocument();
      expect(row.getByText('Alive')).toBeInTheDocument();
      expect(row.getByText('Neutral')).toBeInTheDocument();
      expect(row.getByText('Druid Merchant')).toBeInTheDocument();
    });

    test('labels relationship with a word, not only a colour', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      // The old left-border colour coding had no legend anywhere on the page.
      const row = within(screen.getByRole('button', { name: /Expand Aldric/ }));
      expect(row.getByText('Friendly')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Row expansion
  // -------------------------------------------------------------------------
  describe('row expansion', () => {
    test('rows start collapsed and expose an expand control', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      const toggle = screen.getByRole('button', { name: /Expand Aldric/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    test('expands in place when the row is activated', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));

      expect(
        screen.getByRole('button', { name: /Collapse Aldric/ })
      ).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Description')).toBeInTheDocument();
      expect(screen.getByText('Recorded by')).toBeInTheDocument();
    });

    // T124: the row named the author by `createdByUsername` alone, so it said
    // "Unknown" where the NPC's page named someone, and the username where the
    // page named the character.
    test('credits the character who recorded the NPC, as the NPC page does', () => {
      const npc = makeNPC({ id: 'npc-c', name: 'Tobiah', createdByCharacterName: 'Ilse Varn' });
      render(<NPCDirectory npcs={[npc]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Tobiah/ }));

      expect(screen.getByText('Ilse Varn')).toBeInTheDocument();
      expect(screen.queryByText('TestUser')).not.toBeInTheDocument();
    });

    test('credits the username when no character was active', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));
      expect(screen.getByText('TestUser')).toBeInTheDocument();
    });

    test('looks the author up when the NPC stores no name for them', async () => {
      mockDirectory = new Map([['user-1', { username: 'Wren' }]]);
      const npc = makeNPC({ id: 'npc-l', name: 'Old Tam', createdByUsername: undefined });
      render(<NPCDirectory npcs={[npc]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Old Tam/ }));

      expect(await screen.findByText('Wren')).toBeInTheDocument();
    });

    // T132: a renamed character is renamed on everything they recorded.
    test("credits the character by the name it has now", () => {
      mockDirectory = new Map([['user-1', { username: 'Wren', characters: [{ id: 'c-1', name: 'Ilse the Bold' }] }]]);
      const npc = makeNPC({
        id: 'npc-r', name: 'Tobiah', createdByCharacterId: 'c-1', createdByCharacterName: 'Ilse Varn',
      });
      render(<NPCDirectory npcs={[npc]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Tobiah/ }));

      expect(screen.getByText('Ilse the Bold')).toBeInTheDocument();
      expect(screen.queryByText('Ilse Varn')).not.toBeInTheDocument();
    });

    test('collapses again on a second activation', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));
      fireEvent.click(screen.getByRole('button', { name: /Collapse Aldric/ }));
      expect(screen.queryByText('Description')).not.toBeInTheDocument();
    });

    test('states empty fields honestly instead of hiding them', () => {
      const bare = makeNPC({ id: 'bare', name: 'Bare', description: '', notes: [] });
      render(<NPCDirectory npcs={[bare]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Bare/ }));

      expect(screen.getByText('Nothing written yet')).toBeInTheDocument();
      expect(screen.getByText('No notes yet')).toBeInTheDocument();
    });

    test('only one row is expanded at a time', () => {
      render(<NPCDirectory npcs={[aldric, mira]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));
      fireEvent.click(screen.getByRole('button', { name: /Expand Mira/ }));

      expect(
        screen.getByRole('button', { name: /Expand Aldric/ })
      ).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.getByRole('button', { name: /Collapse Mira/ })
      ).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // -------------------------------------------------------------------------
  // Search filtering
  // -------------------------------------------------------------------------
  describe('search filtering', () => {
    test('should filter NPCs by name search', () => {
      render(<NPCDirectory npcs={[aldric, mira]} />);
      fireEvent.change(searchInput(), { target: { value: 'Aldric' } });
      expect(screen.getByText('Aldric')).toBeInTheDocument();
      expect(screen.queryByText('Mira')).not.toBeInTheDocument();
    });

    test('should filter NPCs by description search', () => {
      const npc1 = makeNPC({ id: 'a', name: 'Alpha', description: 'A mighty warrior' });
      const npc2 = makeNPC({ id: 'b', name: 'Beta', description: 'A cunning rogue' });
      render(<NPCDirectory npcs={[npc1, npc2]} />);
      fireEvent.change(searchInput(), { target: { value: 'mighty warrior' } });
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    });

    test('should filter NPCs by title search', () => {
      const npc1 = makeNPC({ id: 'a', name: 'Alpha', title: 'Court Wizard' });
      const npc2 = makeNPC({ id: 'b', name: 'Beta', title: 'Town Guard' });
      render(<NPCDirectory npcs={[npc1, npc2]} />);
      fireEvent.change(searchInput(), { target: { value: 'Court Wizard' } });
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    });

    test('should be case-insensitive', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.change(searchInput(), { target: { value: 'aldric' } });
      expect(screen.getByText('Aldric')).toBeInTheDocument();
    });

    test('a collection emptied by a filter offers no create action', () => {
      // The fix here is to change the filter. Offering "Add the first NPC" to
      // someone who has sixteen of them answers a question nobody asked.
      render(<NPCDirectory npcs={[aldric, mira]} />);
      fireEvent.change(searchInput(), { target: { value: 'zzznomatch' } });
      expect(screen.getByText(/no npcs match these filters/i)).toBeInTheDocument();
      expect(screen.queryByText("ᛗ")).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /add the first npc/i })
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Status bar — one bar that also filters, replacing four stat cards
  // -------------------------------------------------------------------------
  describe('status bar', () => {
    test('shows the total met so far', () => {
      render(<NPCDirectory npcs={[aldric, mira, rolf]} />);
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('met so far')).toBeInTheDocument();
    });

    test('breaks the total down by status, each labelled with a word', () => {
      render(<NPCDirectory npcs={[aldric, mira, rolf]} />);
      expect(screen.getByRole('button', { name: '1 alive' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 deceased' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 missing' })).toBeInTheDocument();
    });

    test('keeps zero-value statuses visible rather than hiding them', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      expect(screen.getByRole('button', { name: '0 deceased' })).toBeInTheDocument();
    });

    test('should filter by alive status', () => {
      render(<NPCDirectory npcs={[aldric, mira]} />);
      fireEvent.click(screen.getByRole('button', { name: '1 alive' }));
      expect(screen.getByText('Aldric')).toBeInTheDocument();
      expect(screen.queryByText('Mira')).not.toBeInTheDocument();
    });

    test('should filter by deceased status', () => {
      render(<NPCDirectory npcs={[aldric, mira]} />);
      fireEvent.click(screen.getByRole('button', { name: '1 deceased' }));
      expect(screen.getByText('Mira')).toBeInTheDocument();
      expect(screen.queryByText('Aldric')).not.toBeInTheDocument();
    });

    test('should filter by missing status', () => {
      render(<NPCDirectory npcs={[aldric, mira, rolf]} />);
      fireEvent.click(screen.getByRole('button', { name: '1 missing' }));
      expect(screen.getByText('Rolf')).toBeInTheDocument();
      expect(screen.queryByText('Aldric')).not.toBeInTheDocument();
    });

    test('clicking the active band clears the filter', () => {
      render(<NPCDirectory npcs={[aldric, mira]} />);
      const aliveBand = () => screen.getByRole('button', { name: '1 alive' });

      fireEvent.click(aliveBand());
      expect(aliveBand()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText('Mira')).not.toBeInTheDocument();

      fireEvent.click(aliveBand());
      expect(aliveBand()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Mira')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Relationship filter
  // -------------------------------------------------------------------------
  describe('relationship filter', () => {
    test('renders every option as a visible pill rather than a select', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      for (const label of ['All', 'Friendly', 'Neutral', 'Hostile', 'Unknown']) {
        expect(
          screen.getByRole('button', { name: label })
        ).toBeInTheDocument();
      }
    });

    test('should filter by friendly relationship', () => {
      render(<NPCDirectory npcs={[aldric, mira, rolf]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Friendly' }));
      expect(screen.getByText('Aldric')).toBeInTheDocument();
      expect(screen.queryByText('Mira')).not.toBeInTheDocument();
      expect(screen.queryByText('Rolf')).not.toBeInTheDocument();
    });

    test('should filter by hostile relationship', () => {
      render(<NPCDirectory npcs={[aldric, mira, rolf]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Hostile' }));
      expect(screen.getByText('Mira')).toBeInTheDocument();
      expect(screen.queryByText('Aldric')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Location filter — driven by the ?highlight= deep link
  // -------------------------------------------------------------------------
  // Location is the grouping here, not a filter. Arriving from a deep link used
  // to set a location filter to the target's location, silently hiding every
  // other group behind a small "Clear location:" ghost button. RumorDirectory,
  // which groups by location the same way, deliberately has no location filter
  // at all; NPCDirectory now matches it.
  describe('deep link by ?highlight=', () => {
    test('leaves every other location group visible', () => {
      setupMocks({ uid: 'user-1' }, { highlight: 'npc-2' });
      render(<NPCDirectory npcs={[aldric, mira, rolf]} />);

      // Mira is the target, in Ironhold; Aldric and Rolf are in Silverkeep and
      // must not vanish just because a link pointed at someone else.
      expect(screen.getByText('Mira')).toBeInTheDocument();
      expect(screen.getByText('Aldric')).toBeInTheDocument();
      expect(screen.getByText('Rolf')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Ironhold' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Silverkeep' })).toBeInTheDocument();
    });

    test('expands the highlighted NPC so a deep link lands on its detail', () => {
      setupMocks({ uid: 'user-1' }, { highlight: 'npc-2' });
      render(<NPCDirectory npcs={[mira]} />);

      expect(
        screen.getByRole('button', { name: /Collapse Mira/ })
      ).toHaveAttribute('aria-expanded', 'true');
    });

    test('offers no location-clearing control, because nothing is ever scoped away', () => {
      setupMocks({ uid: 'user-1' }, { highlight: 'npc-2' });
      render(<NPCDirectory npcs={[aldric, mira, rolf]} />);

      expect(
        screen.queryByRole('button', { name: /Clear location:/ })
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Combined filters
  // -------------------------------------------------------------------------
  describe('combined filters', () => {
    test('should apply search and status filter simultaneously', () => {
      const aliveMira = makeNPC({ id: 'am', name: 'Mira', status: 'alive', relationship: 'neutral' });
      const deadAldric = makeNPC({ id: 'da', name: 'Aldric', status: 'deceased', relationship: 'neutral' });
      render(<NPCDirectory npcs={[aliveMira, deadAldric]} />);

      fireEvent.change(searchInput(), { target: { value: 'Mira' } });
      fireEvent.click(screen.getByRole('button', { name: '1 alive' }));

      expect(screen.getByText('Mira')).toBeInTheDocument();
      expect(screen.queryByText('Aldric')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('parent callbacks', () => {
    test('tells the parent about a stance change, so the list stops disagreeing with the record', async () => {
      // CHANGED DELIBERATELY. This test used to render the directory with the
      // prop and assert that a name appeared -- it never called the callback
      // and could not have failed if the callback were never called either,
      // which is what was happening: `onNPCUpdate` was declared, destructured
      // and dead. `updateNPCRelationship` refreshes the provider's copy of
      // the collection, `NPCsPage` renders from a loader of its own, and
      // nothing connected the two, so a stance picked in the row showed the
      // old word until a reload. Found in Chrome on `/npcs`.
      const onNPCUpdate = jest.fn();
      render(<NPCDirectory npcs={[aldric]} onNPCUpdate={onNPCUpdate} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));

      const ladder = screen.getByRole('group', { name: 'Stance of Aldric' });
      fireEvent.click(within(ladder).getByRole('button', { name: 'Hostile' }));

      await waitFor(() =>
        expect(onNPCUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'npc-1', relationship: 'hostile' })
        )
      );
    });

    test('does not tell the parent until the write has resolved (§7)', async () => {
      let resolve!: () => void;
      mockUpdateNPCRelationship.mockImplementationOnce(
        () => new Promise<void>((r) => { resolve = r; })
      );
      const onNPCUpdate = jest.fn();
      render(<NPCDirectory npcs={[aldric]} onNPCUpdate={onNPCUpdate} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));

      const ladder = screen.getByRole('group', { name: 'Stance of Aldric' });
      fireEvent.click(within(ladder).getByRole('button', { name: 'Hostile' }));

      expect(onNPCUpdate).not.toHaveBeenCalled();
      resolve();
      await waitFor(() => expect(onNPCUpdate).toHaveBeenCalled());
    });

    // T078: Delete used to hide the row and write nothing, so the NPC came
    // back on the next change. It now deletes, after the shared confirmation.
    const pressDelete = () => {
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    };

    test('Delete asks before deleting anything', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      pressDelete();

      expect(screen.getByRole('heading', { name: /Delete “Aldric”\?/ })).toBeInTheDocument();
      expect(mockDeleteNPC).not.toHaveBeenCalled();
    });

    test('confirming deletes the NPC through the provider, then tells the parent', async () => {
      const onNPCDelete = jest.fn();
      render(<NPCDirectory npcs={[aldric]} onNPCDelete={onNPCDelete} />);
      pressDelete();
      fireEvent.click(screen.getByRole('button', { name: 'Delete NPC' }));

      await waitFor(() => expect(mockDeleteNPC).toHaveBeenCalledWith(aldric.id));
      await waitFor(() => expect(onNPCDelete).toHaveBeenCalledWith(aldric.id));
      expect(screen.queryByRole('heading', { name: /Delete “Aldric”\?/ })).not.toBeInTheDocument();
    });

    test('cancelling deletes nothing and keeps the row', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      pressDelete();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockDeleteNPC).not.toHaveBeenCalled();
      expect(screen.getByText('Aldric')).toBeInTheDocument();
    });

    test('a failed delete stays in the dialog, and the row stays', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockDeleteNPC.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<NPCDirectory npcs={[aldric]} />);
      pressDelete();
      fireEvent.click(screen.getByRole('button', { name: 'Delete NPC' }));

      expect(await screen.findByText('Missing or insufficient permissions.')).toBeInTheDocument();
      expect(screen.getAllByText('Aldric').length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Props updates (useEffect sync)
  // -------------------------------------------------------------------------
  describe('prop updates', () => {
    test('should update NPC list when npcs prop changes', () => {
      const { rerender } = render(<NPCDirectory npcs={[aldric]} />);
      expect(screen.getByText('Aldric')).toBeInTheDocument();
      rerender(<NPCDirectory npcs={[mira]} />);
      expect(screen.queryByText('Aldric')).not.toBeInTheDocument();
      expect(screen.getByText('Mira')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Row anatomy — one encoding per fact
  // -------------------------------------------------------------------------
  describe('row anatomy', () => {
    test('carries exactly one identity mark, derived from the id', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      const row = within(screen.getByRole('button', { name: /Expand Aldric/ }));
      const marks = row.getAllByTestId('entity-sigil');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveAttribute('data-sigil-index');
      expect(marks[0]).toHaveTextContent('A');
    });

    test('states status as a word and nothing else', () => {
      // The coloured dot beside the word encoded the same fact a second time,
      // in the one form nobody can read.
      render(<NPCDirectory npcs={[aldric]} />);
      const row = screen.getByRole('button', { name: /Expand Aldric/ });
      expect(within(row).getByText('Alive')).toBeInTheDocument();
      expect(row.querySelectorAll('.bg-status-completed')).toHaveLength(0);
      expect(row.querySelectorAll('.bg-status-failed')).toHaveLength(0);
      expect(row.querySelectorAll('.bg-status-unknown')).toHaveLength(0);
    });

    test('states disposition plainly, without borrowing the status hue', () => {
      // "Friendly" was a filled chip in the same green as "Alive", so one row
      // showed one hue for two unrelated facts.
      render(<NPCDirectory npcs={[aldric]} />);
      const row = screen.getByRole('button', { name: /Expand Aldric/ });
      expect(within(row).getByText('Friendly')).toBeInTheDocument();
      expect(row.querySelector('.npc-relationship-friendly')).toBeNull();
    });
  });

  describe('the way into an NPC page', () => {
    test('offers More info only once the row is expanded', () => {
      // The collapsed row is the highest-frequency surface in the product and
      // does not get a second control (D41). A row that is already open has
      // said it wants more.
      render(<NPCDirectory npcs={[aldric]} />);
      expect(screen.queryByText('More info')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));
      expect(screen.getByText('More info')).toBeInTheDocument();
    });

    test('navigates to the NPC own page', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));
      fireEvent.click(screen.getByText('More info'));
      expect(mockNavigateToPage).toHaveBeenCalledWith(`/npcs/${aldric.id}`);
    });

    test('adds no accent to the row', () => {
      // Edit is an outline and Delete a ghost; More info joins them at Edit's
      // weight rather than introducing the row's first accent.
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));
      const moreInfo = screen.getByText('More info').closest('button');
      expect(moreInfo?.className).not.toMatch(/button-primary/);
    });
  });

});


// ---------------------------------------------------------------------------
// PR 15.3 -- stance from the row, the highlight contract and note dates
// ---------------------------------------------------------------------------

describe('NPCDirectory — 15.3', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  describe('the stance ladder', () => {
    it('changes a stance from the row, in one click', async () => {
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));

      const ladder = screen.getByRole('group', { name: 'Stance of Aldric' });
      fireEvent.click(within(ladder).getByRole('button', { name: 'Hostile' }));

      await waitFor(() =>
        expect(mockUpdateNPCRelationship).toHaveBeenCalledWith('npc-1', 'hostile')
      );
    });

    it('offers four steps, each a word, and marks the current one', () => {
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));

      const ladder = screen.getByRole('group', { name: 'Stance of Aldric' });
      ['Friendly', 'Neutral', 'Hostile', 'Unknown'].forEach((label) => {
        expect(within(ladder).getByRole('button', { name: label })).toBeInTheDocument();
      });
      expect(within(ladder).getByRole('button', { name: 'Friendly' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('does not claim the change before the write resolves', async () => {
      let resolve!: () => void;
      mockUpdateNPCRelationship.mockImplementationOnce(
        () => new Promise<void>((r) => { resolve = r; })
      );
      render(<NPCDirectory npcs={[aldric]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Aldric/ }));

      const ladder = screen.getByRole('group', { name: 'Stance of Aldric' });
      fireEvent.click(within(ladder).getByRole('button', { name: 'Hostile' }));

      expect(within(ladder).getByRole('button', { name: 'Friendly' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByText('Saving…')).toBeInTheDocument();
      resolve();
      await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    });
  });

  describe('?highlight= (T014)', () => {
    it('opens the target row, so a link lands on something readable', () => {
      setupMocks({ uid: 'user-1' }, { highlight: 'npc-1' });
      render(<NPCDirectory npcs={[aldric, mira]} />);
      expect(screen.getByRole('button', { name: /Collapse Aldric/ })).toBeInTheDocument();
    });

    it('no longer matches by name', () => {
      setupMocks({ uid: 'user-1' }, { highlight: 'Aldric' });
      const { container } = render(<NPCDirectory npcs={[aldric]} />);
      expect(container.querySelector('#npc-npc-1')?.className).not.toContain('highlighted-item');
    });
  });

  describe('note dates (T001)', () => {
    it('renders a stored ISO timestamp as a date', () => {
      const withNote = makeNPC({ id: 'npc-9', name: 'Dated' });
      // The note's own document (T133).
      const { useCampaignRecordNotes } = jest.requireMock('features/campaign-entities/shared/recordNotes');
      useCampaignRecordNotes.mockReturnValue([
        { noteId: 'n1', date: '2025-05-31T19:27:30.387Z', text: 'Spoke at the council.' },
      ]);
      try {
        render(<NPCDirectory npcs={[withNote]} />);
        fireEvent.click(screen.getByRole('button', { name: /Expand Dated/ }));

        expect(screen.getByText('31/05/2025')).toBeInTheDocument();
        expect(screen.queryByText('2025-05-31T19:27:30.387Z')).toBeNull();
      } finally {
        useCampaignRecordNotes.mockReturnValue([]);
      }
    });
  });
});

// T101: the roster mounted every NPC it held. 1,200 rows were ~19,000 DOM
// elements and half a second to redraw when a filter was cleared.
describe('NPCDirectory -- a long roster', () => {
  /** `count` people, in one place, named in display order. */
  const crowd = (count: number) =>
    Array.from({ length: count }, (_, n) =>
      makeNPC({ id: `p-${n}`, name: `Person ${String(n).padStart(3, '0')}`, location: 'Bree' })
    );
  const rows = () => screen.getAllByRole('button', { name: /^Expand Person/ });

  test('mounts the first hundred rows and says how many there are', () => {
    setupMocks();
    render(<NPCDirectory npcs={crowd(250)} />);

    expect(rows()).toHaveLength(100);
    expect(screen.getByText(/Showing 100 of 250/)).toBeInTheDocument();
    // The group heading still counts everyone in it, as the status bar does.
    expect(screen.getAllByText('250')).toHaveLength(2);
  });

  test('shows a hundred more at a time, until all are shown', () => {
    setupMocks();
    render(<NPCDirectory npcs={crowd(250)} />);

    fireEvent.click(screen.getByRole('button', { name: /show 100 more/i }));
    expect(rows()).toHaveLength(200);

    fireEvent.click(screen.getByRole('button', { name: /show 50 more/i }));
    expect(rows()).toHaveLength(250);
    expect(screen.queryByRole('button', { name: /show .* more/i })).not.toBeInTheDocument();
  });

  test('offers nothing more for a roster that fits', () => {
    setupMocks();
    render(<NPCDirectory npcs={crowd(30)} />);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  test('a link to someone far down the roster still finds them', () => {
    setupMocks({ uid: 'user-1' }, { highlight: 'p-230' });
    render(<NPCDirectory npcs={crowd(250)} />);

    expect(screen.getByRole('button', { name: /Collapse Person 230/ })).toBeInTheDocument();
  });
});
