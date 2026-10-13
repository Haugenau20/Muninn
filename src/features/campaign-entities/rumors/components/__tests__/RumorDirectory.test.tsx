// src/features/campaign-entities/rumors/components/__tests__/RumorDirectory.test.tsx

import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import RumorDirectory from '../RumorDirectory';
import { Rumor, RumorStatus, SourceType } from '../../types';
import { resolveRecordChange } from '@/test-utils/update-after-reading';

// ---------------------------------------------------------------------------
// Mock Dialog to render inline — RumorBatchActions mounts CombineRumorsDialog
// and ConvertToQuestDialog unconditionally (gated on `open`), and the real
// Dialog uses a portal that jsdom doesn't need to exercise for these tests.
// ---------------------------------------------------------------------------
// Notes are documents of their own (T133); see the mock.
jest.mock('features/campaign-entities/shared/recordNotes', () => require('@/test-utils/record-notes-mock').recordNotesMock());

jest.mock('../../../../../core/components/Dialog', () => {
  const MockDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    title?: string;
    children?: React.ReactNode;
  }> = ({ open, onClose, title, children }) => {
    if (!open) return null;
    return (
      <div data-testid="mock-dialog">
        {title && <h3>{title}</h3>}
        <button onClick={onClose} aria-label="Close dialog">X</button>
        {children}
      </div>
    );
  };
  return MockDialog;
});

// ---------------------------------------------------------------------------
// Polyfill crypto.randomUUID for JSDOM (used by ConvertToQuestDialog's
// initial state, which runs even while the dialog is closed)
// ---------------------------------------------------------------------------
if (!crypto.randomUUID) {
  Object.defineProperty(crypto, 'randomUUID', {
    value: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
}

// ---------------------------------------------------------------------------
// Mock all context dependencies used by RumorDirectory
// ---------------------------------------------------------------------------

jest.mock('shared/hooks/useNavigation', () => ({
  useNavigation: jest.fn(),
}));

jest.mock('@/features/user-management', () => ({
  useAuth: jest.fn(() => ({ user: { uid: 'user-1' } })),
  useFirebase: jest.fn(() => ({ activeGroupId: 'group-1' })),
  // `15-10`: drafts are kept per campaign, so the list needs to know which.
  useCampaigns: jest.fn(() => ({ activeCampaignId: 'campaign-1' })),
}));

jest.mock('../../context/RumorContext', () => ({
  useRumors: jest.fn(),
}));

jest.mock('../../../npcs/context/NPCContext', () => ({
  useNPCs: jest.fn(() => ({
    npcs: [{ id: 'npc-1', name: 'Gandalf the Grey', occupation: 'Wizard' }],
    getNPCById: jest.fn(() => undefined),
  })),
}));

// `locations` feeds the attach tray. It no longer feeds a group heading:
// `15-9` replaced location grouping with grouping by status, because a rumour
// can point at several places and being filed under exactly one of them gave
// confident false negatives.
jest.mock('../../../locations/context/LocationContext', () => ({
  useLocations: jest.fn(() => ({
    locations: [{ id: 'high-pass', name: 'The High Pass', type: 'landmark', status: 'known' }],
    getLocationById: jest.fn(() => undefined),
  })),
}));

// The row credits its author through the real resolver (T124); only the
// profile lookup, which reads Firestore, is stubbed.
jest.mock('shared/utils/attribution-utils', () => ({
  determineAttributionActor: jest.requireActual('shared/utils/attribution-utils').determineAttributionActor,
  fetchAttributionUsernames: jest.fn().mockResolvedValue({}),
}));

jest.mock('core/services/firebase', () => ({ default: {} }));
// T132: authors are credited from the group's members; with no directory,
// the names stored with each rumour apply.
jest.mock('shared/hooks/useMemberDirectory', () => ({
  __esModule: true,
  useMemberDirectory: () => undefined,
  default: () => undefined,
}));

const mockNavigateToPage = jest.fn();
const mockCreatePath = jest.fn(
  (path: string, _p: unknown, query?: Record<string, string>) =>
    query ? `${path}?${new URLSearchParams(query).toString()}` : path
);
const mockDeleteRumor = jest.fn().mockResolvedValue(undefined);
const mockAddRumor = jest.fn().mockResolvedValue('new-rumor');
const mockUpdateRumor = jest.fn().mockResolvedValue(undefined);
const mockUpdateRumorStatus = jest.fn().mockResolvedValue(undefined);
const mockUpdateRumorsStatus = jest.fn().mockResolvedValue(undefined);
const mockCombineRumors = jest.fn().mockResolvedValue('new-rumor-id');
const mockConvertToQuest = jest.fn().mockResolvedValue('quest-id');

const { useNavigation } = require('shared/hooks/useNavigation');
const { useRumors } = require('../../context/RumorContext');
const { useAuth } = require('@/features/user-management');

function setupMocks(
  user: { uid: string } | null = { uid: 'user-1' },
  queryParams: Record<string, string> = {},
  rumorList: Rumor[] = []
) {
  (useAuth as jest.Mock).mockReturnValue({ user });
  (useNavigation as jest.Mock).mockReturnValue({
    navigateToPage: mockNavigateToPage,
    createPath: mockCreatePath,
    getCurrentQueryParams: jest.fn(() => queryParams),
  });
  (useRumors as jest.Mock).mockReturnValue({
    rumors: rumorList,
    addRumor: mockAddRumor,
    updateRumor: mockUpdateRumor,
    deleteRumor: mockDeleteRumor,
    updateRumorStatus: mockUpdateRumorStatus,
    // The batch bar writes the whole selection at once (T032, PERF-06).
    updateRumorsStatus: mockUpdateRumorsStatus,
    combineRumors: mockCombineRumors,
    convertToQuest: mockConvertToQuest,
  });
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRumor(overrides: Partial<Rumor> = {}): Rumor {
  return {
    id: `rumor-${Math.random().toString(36).slice(2)}`,
    title: 'Test Rumour',
    content: 'A test rumour about something.',
    status: 'unconfirmed' as RumorStatus,
    sourceType: 'tavern' as SourceType,
    sourceName: 'The Rusty Flagon',
    location: 'Silverkeep',
    relatedNPCs: [],
    relatedLocations: [],
    notes: [],
    createdBy: 'user-1',
    createdByUsername: 'TestUser',
    dateAdded: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * The generic rumour these tests reach for when the subject is the row rather
 * than its status.
 *
 * **Unconfirmed on purpose since `15-9`.** It used to be `confirmed`, which
 * stopped being a neutral choice the moment the list started grouping by
 * status. Unconfirmed is also what a rumour actually is when it is written
 * down, which is what a generic fixture should be.
 */
const r1 = makeRumor({ id: 'r1', title: 'Dragon spotted', status: 'unconfirmed', sourceType: 'npc', sourceName: 'Aldric', location: 'Silverkeep' });
const r2 = makeRumor({ id: 'r2', title: 'Missing merchant', status: 'unconfirmed', sourceType: 'tavern', sourceName: 'The Flagon', location: 'Ironhold' });
const r3 = makeRumor({ id: 'r3', title: 'Treasure map', status: 'false', sourceType: 'notice', sourceName: 'Town board', location: 'Silverkeep' });
/** For the tests that are actually about a confirmed rumour. */
const rc = makeRumor({ id: 'rc', title: 'Dragon spotted', status: 'confirmed', sourceType: 'npc', sourceName: 'Aldric', location: 'Silverkeep' });

/**
 * Open the False group.
 *
 * It is the only one that starts folded (`15-9`), so a test about a false
 * rumour's row says so out loud rather than relying on it being on screen.
 */
const revealFalse = () =>
  fireEvent.click(screen.getByRole('button', { name: /^False/ }));

/** The roster's search box. */
const searchInput = () => screen.getByPlaceholderText(/search rumours/i);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RumorDirectory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  // The signed-out example: the list as members see it, without anything that
  // writes -- and an open row shows the rumour, not a form to edit it.
  describe('when the reader may not edit', () => {
    beforeEach(() => setupMocks(null, {}, [r1, rc]));

    test('offers no composer and no selection', () => {
      render(<RumorDirectory rumors={[r1, rc]} canEdit={false} />);
      expect(screen.queryByLabelText('Heard something? Write it down here')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Select Rumours' })).not.toBeInTheDocument();
      expect(searchInput()).toBeInTheDocument();
    });

    test('opens a row onto what was heard, as text, with nothing to type into', () => {
      render(<RumorDirectory rumors={[r1]} canEdit={false} />);
      fireEvent.click(screen.getByRole('button', { name: 'Expand Dragon spotted' }));
      expect(screen.getByText('A test rumour about something.')).toBeInTheDocument();
      // The search box is the only thing to type into.
      expect(screen.getAllByRole('textbox')).toEqual([searchInput()]);
      expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    });

    test('keeps the way to the quest a rumour became', () => {
      render(
        <RumorDirectory rumors={[makeRumor({ id: 'rq', title: 'Became one', convertedToQuestId: 'q-1' })]} canEdit={false} />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Expand Became one' }));
      fireEvent.click(screen.getByRole('button', { name: 'Open the quest' }));
      expect(mockNavigateToPage).toHaveBeenCalledWith('/quests/q-1');
    });
  });

  describe('a row open from the start', () => {
    test('opens the row it is given', () => {
      setupMocks(undefined, {}, [r1, r2]);
      render(<RumorDirectory rumors={[r1, r2]} initialExpandedId="r2" />);
      expect(screen.getByRole('button', { name: 'Collapse Missing merchant' })).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('loading state', () => {
    test('shows the rhythm of the rows that are coming, not a spinner', () => {
      const { container } = render(<RumorDirectory rumors={[]} isLoading={true} />);
      expect(screen.getByRole('status', { name: /loading rumours/i })).toBeInTheDocument();
      expect(container.querySelectorAll('.section-loading').length).toBeGreaterThan(3);
      expect(container.querySelector('.animate-spin')).toBeNull();
    });

    test('should not render search box when isLoading is true', () => {
      render(<RumorDirectory rumors={[]} isLoading={true} />);
      expect(screen.queryByPlaceholderText(/search rumours/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------
  describe('empty state', () => {
    test('an empty campaign shows its own empty state and no example: the example is for signed-out visitors', () => {
      render(<RumorDirectory rumors={[]} />);
      expect(screen.queryByRole('region', { name: 'Example campaign' })).not.toBeInTheDocument();
    });

    test('says what the collection is for, and leaves the composer to fill it', () => {
      render(<RumorDirectory rumors={[]} />);
      expect(screen.getByText(/muninn hasn't heard any rumours yet/i)).toBeInTheDocument();
      expect(screen.getByText("ᛗ")).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText(/overheard in a tavern/i)).toBeInTheDocument();
      // CHANGED DELIBERATELY in `15-7`: the empty state's action used to
      // navigate to `/rumors/create`. The composer is already on screen above
      // it, so the button would have sent someone away from the control they
      // were looking at.
      expect(
        screen.queryByRole('button', { name: /add the first rumour/i })
      ).not.toBeInTheDocument();
      expect(
        screen.getByLabelText('Heard something? Write it down here')
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Rumor rendering / grouping
  // -------------------------------------------------------------------------
  describe('rumor rendering', () => {
    test('should render rumor titles', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      expect(screen.getByText('Dragon spotted')).toBeInTheDocument();
      expect(screen.getByText('Missing merchant')).toBeInTheDocument();
    });

    test('should render all provided rumors', () => {
      render(<RumorDirectory rumors={[r1, r2, r3]} />);
      expect(screen.getByText('Dragon spotted')).toBeInTheDocument();
      expect(screen.getByText('Missing merchant')).toBeInTheDocument();
      expect(screen.getByText('Treasure map')).toBeInTheDocument();
    });

    /**
     * CHANGED DELIBERATELY in `15-9`. This list grouped by location, and the
     * data could not support it: a rumour carries `locationId` (where it was
     * heard) *and* `relatedLocations` (what it is about), so one touching
     * three places was filed under exactly one of them and a reader scanning
     * a place got confident false negatives. Status has exactly three members
     * and nothing lands anywhere it does not belong.
     */
    test('groups by status, in a fixed order, and never by location', () => {
      render(<RumorDirectory rumors={[rc, r2, r3]} />);

      expect(screen.getByRole('heading', { name: 'Unconfirmed' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Confirmed' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'False' })).toBeInTheDocument();

      // The place names the fixtures carry are not headings any more.
      expect(screen.queryByRole('heading', { name: 'Silverkeep' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Ironhold' })).not.toBeInTheDocument();
      expect(screen.queryByText('Location unknown')).not.toBeInTheDocument();
    });

    test('a rumour with no location is grouped like any other', () => {
      const unlocated = makeRumor({ id: 'r-nowhere', title: 'Odd noises', location: undefined });
      render(<RumorDirectory rumors={[unlocated]} />);
      expect(screen.getByRole('heading', { name: 'Unconfirmed' })).toBeInTheDocument();
      expect(screen.getByText('Odd noises')).toBeInTheDocument();
    });

    test('skips a status nothing is in', () => {
      render(<RumorDirectory rumors={[r2]} />);
      expect(screen.getByRole('heading', { name: 'Unconfirmed' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Confirmed' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'False' })).not.toBeInTheDocument();
    });

    /**
     * **Only false starts folded.** Confirmed was folded too at first, by
     * analogy with a finished quest, and the analogy does not hold: a
     * confirmed rumour is the thing the party acts on, so folding it hid the
     * best-earned half of the list. False is still knowledge, still
     * counted, and one click away -- but nobody is going back to it.
     */
    test('only false opens collapsed', () => {
      render(<RumorDirectory rumors={[rc, r2, r3]} />);

      expect(screen.getByRole('button', { name: /^False/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      );

      // The other two are plain headings, with no disclosure at all.
      expect(screen.queryByRole('button', { name: /^Unconfirmed/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Confirmed/ })).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Expand Dragon spotted/ })
      ).toBeInTheDocument();

      revealFalse();
      expect(screen.getByRole('button', { name: /^False/ })).toHaveAttribute(
        'aria-expanded',
        'true'
      );
    });

    test('shows each row as one dense row carrying status and source', () => {
      render(<RumorDirectory rumors={[rc]} />);
      // Scoped to the row, since "Confirmed" also labels a status-bar segment
      // and a group heading.
      const row = within(screen.getByRole('button', { name: /Expand Dragon spotted/ }));
      expect(row.getByText('Dragon spotted')).toBeInTheDocument();
      expect(row.getByText('Confirmed')).toBeInTheDocument();
      expect(row.getByText('NPC')).toBeInTheDocument();
      expect(row.getByText('Aldric')).toBeInTheDocument();
    });

    test('labels status with a word, not only a colour', () => {
      render(<RumorDirectory rumors={[r2]} />);
      const row = within(screen.getByRole('button', { name: /Expand Missing merchant/ }));
      expect(row.getByText('Unconfirmed')).toBeInTheDocument();
    });

    test('surfaces convertedToQuestId as a quest indicator on the row', () => {
      const converted = makeRumor({ id: 'r-quest', title: 'Bandit trouble', convertedToQuestId: 'quest-1' });
      render(<RumorDirectory rumors={[converted]} />);
      const row = within(screen.getByRole('button', { name: /Expand Bandit trouble/ }));
      expect(row.getByText('Converted to quest')).toBeInTheDocument();
    });

    test('shows a plain dash on the row when a rumor was not converted', () => {
      render(<RumorDirectory rumors={[r1]} />);
      const row = within(screen.getByRole('button', { name: /Expand Dragon spotted/ }));
      expect(row.getByText('—')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Row expansion
  // -------------------------------------------------------------------------
  describe('row expansion', () => {
    test('rows start collapsed and expose an expand control', () => {
      render(<RumorDirectory rumors={[r1]} />);
      const toggle = screen.getByRole('button', { name: /Expand Dragon spotted/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    test('expands in place, and holds the whole record rather than a summary', () => {
      // CHANGED DELIBERATELY in `15-7` item 2. The expansion used to be a
      // read-only summary with an Edit button that left for
      // `/rumors/edit/:id`. A rumour is the one entity with no page, so
      // §1.3's four-fact bound does not apply to it: the row holds all of it.
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Dragon spotted/ }));

      expect(
        screen.getByRole('button', { name: /Collapse Dragon spotted/ })
      ).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByLabelText('What was heard')).toBeInTheDocument();
      expect(screen.getByLabelText('Call it')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Heard from' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: /Status of Dragon spotted/ })).toBeInTheDocument();
      expect(screen.getByText('Recorded by')).toBeInTheDocument();
    });

    // T124: the row named the author by `createdByUsername` alone, and hid the
    // line without it, where everywhere else names the character.
    test('credits the character who recorded the rumour', () => {
      const rumor = makeRumor({ id: 'rch', title: 'Bells at low tide', createdByCharacterName: 'Ilse Varn' });
      render(<RumorDirectory rumors={[rumor]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Bells at low tide/ }));

      expect(screen.getByText('Recorded by')).toBeInTheDocument();
      expect(screen.getByText('Ilse Varn')).toBeInTheDocument();
    });

    test('collapses again on a second activation', () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Dragon spotted/ }));
      fireEvent.click(screen.getByRole('button', { name: /Collapse Dragon spotted/ }));
      expect(screen.queryByLabelText('What was heard')).not.toBeInTheDocument();
    });

    test('only one row is expanded at a time', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Dragon spotted/ }));
      fireEvent.click(screen.getByRole('button', { name: /Expand Missing merchant/ }));

      expect(
        screen.getByRole('button', { name: /Expand Dragon spotted/ })
      ).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.getByRole('button', { name: /Collapse Missing merchant/ })
      ).toHaveAttribute('aria-expanded', 'true');
    });

    test('offers an empty rumour somewhere to write rather than a list of absences', () => {
      // CHANGED DELIBERATELY in `15-7`. The old expansion answered every
      // unwritten field with a sentence saying it was unwritten -- five of
      // them, stacked. The fields are editable now, so an empty one is an
      // empty control with its own label, which says the same thing and can be
      // acted on.
      const bare = makeRumor({
        id: 'bare',
        title: 'Bare rumour',
        content: '',
        // CHANGED DELIBERATELY in `15-9`: this was `'other'`, which now means
        // "heard from none of the other four" -- a real answer somebody
        // chose. "Nobody has said" is the field being absent.
        sourceType: undefined,
        sourceName: '',
        notes: [],
        relatedNPCs: [],
        relatedLocations: [],
      });
      render(<RumorDirectory rumors={[bare]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Bare rumour/ }));

      expect(screen.getByLabelText('What was heard')).toHaveValue('');
      expect(screen.queryByText('No details recorded')).not.toBeInTheDocument();
      // "Who exactly" waits for a source kind (item 3).
      expect(screen.queryByLabelText('Who exactly')).not.toBeInTheDocument();
    });

    test('asks who exactly only once a source kind is chosen', () => {
      const bare = makeRumor({
        id: 'bare',
        title: 'Bare rumour',
        sourceType: 'other',
        sourceName: '',
      });
      render(<RumorDirectory rumors={[bare]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Bare rumour/ }));

      fireEvent.click(screen.getByRole('button', { name: 'A traveller' }));
      expect(screen.getByLabelText('Who exactly')).toBeInTheDocument();
    });

    test('turns who exactly into an NPC picker when the kind is an NPC', () => {
      const bare = makeRumor({ id: 'bare', title: 'Bare rumour', sourceType: 'other', sourceName: '' });
      render(<RumorDirectory rumors={[bare]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Bare rumour/ }));

      fireEvent.click(screen.getByRole('button', { name: 'An NPC' }));
      // A browse-first tray, not a text field: you attach the NPC you can see.
      expect(screen.queryByLabelText('Who exactly')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Attach to the source of Bare rumour/ })
      ).toBeInTheDocument();
    });

    test('shows a live link to the quest when a rumor was converted', () => {
      const converted = makeRumor({ id: 'r-quest', title: 'Bandit trouble', convertedToQuestId: 'quest-1' });
      render(<RumorDirectory rumors={[converted]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Bandit trouble/ }));

      fireEvent.click(screen.getByRole('button', { name: /open the quest/i }));
      expect(mockNavigateToPage).toHaveBeenCalledWith('/quests/quest-1');
    });
  });

  // -------------------------------------------------------------------------
  // Search filtering
  // -------------------------------------------------------------------------
  describe('search filtering', () => {
    test('should filter rumors by title search', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.change(searchInput(), { target: { value: 'Dragon' } });
      expect(screen.getByText('Dragon spotted')).toBeInTheDocument();
      expect(screen.queryByText('Missing merchant')).not.toBeInTheDocument();
    });

    test('should filter rumors by content search', () => {
      const r = makeRumor({ id: 'r-content', title: 'Alpha Rumour', content: 'A wizard appeared.' });
      const r2b = makeRumor({ id: 'r-other', title: 'Beta Rumour', content: 'A knight left town.' });
      render(<RumorDirectory rumors={[r, r2b]} />);
      fireEvent.change(searchInput(), { target: { value: 'wizard appeared' } });
      expect(screen.getByText('Alpha Rumour')).toBeInTheDocument();
      expect(screen.queryByText('Beta Rumour')).not.toBeInTheDocument();
    });

    test('should filter by source name', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.change(searchInput(), { target: { value: 'Aldric' } });
      expect(screen.getByText('Dragon spotted')).toBeInTheDocument();
      expect(screen.queryByText('Missing merchant')).not.toBeInTheDocument();
    });

    test('should be case-insensitive', () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.change(searchInput(), { target: { value: 'dragon spotted' } });
      expect(screen.getByText('Dragon spotted')).toBeInTheDocument();
    });

    test('a collection emptied by a filter offers no create action', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.change(searchInput(), { target: { value: 'zzznomatch' } });
      expect(screen.getByText(/no rumours match these filters/i)).toBeInTheDocument();
      expect(screen.queryByText("ᛗ")).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /add the first rumour/i })
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Status bar — one bar that also filters, replacing the "All Status" dropdown
  // -------------------------------------------------------------------------
  describe('status bar', () => {
    test('shows the total rumors gathered', () => {
      render(<RumorDirectory rumors={[rc, r2, r3]} />);
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('rumours gathered')).toBeInTheDocument();
    });

    test('breaks the total down by status, each labelled with a word', () => {
      render(<RumorDirectory rumors={[rc, r2, r3]} />);
      expect(screen.getByRole('button', { name: '1 confirmed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 unconfirmed' })).toBeInTheDocument();
      // "False", not "disproved" (maintainer, 2026-10-03).
      expect(screen.getByRole('button', { name: '1 false' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '1 disproved' })).not.toBeInTheDocument();
    });

    test('keeps zero-value statuses visible rather than hiding them', () => {
      render(<RumorDirectory rumors={[r1]} />);
      expect(screen.getByRole('button', { name: '0 false' })).toBeInTheDocument();
    });

    test('should filter by confirmed status', () => {
      render(<RumorDirectory rumors={[rc, r2, r3]} />);
      fireEvent.click(screen.getByRole('button', { name: '1 confirmed' }));
      expect(screen.getByText('Dragon spotted')).toBeInTheDocument();
      expect(screen.queryByText('Missing merchant')).not.toBeInTheDocument();
    });

    test('should filter by unconfirmed status', () => {
      render(<RumorDirectory rumors={[rc, r2, r3]} />);
      fireEvent.click(screen.getByRole('button', { name: '1 unconfirmed' }));
      expect(screen.getByText('Missing merchant')).toBeInTheDocument();
      expect(screen.queryByText('Dragon spotted')).not.toBeInTheDocument();
    });

    test('should filter by false status', () => {
      render(<RumorDirectory rumors={[rc, r2, r3]} />);
      fireEvent.click(screen.getByRole('button', { name: '1 false' }));
      expect(screen.getByText('Treasure map')).toBeInTheDocument();
      expect(screen.queryByText('Dragon spotted')).not.toBeInTheDocument();
    });

    test('clicking the active band clears the filter', () => {
      render(<RumorDirectory rumors={[rc, r2, r3]} />);
      const confirmedBand = () => screen.getByRole('button', { name: '1 confirmed' });

      fireEvent.click(confirmedBand());
      expect(confirmedBand()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText('Missing merchant')).not.toBeInTheDocument();

      fireEvent.click(confirmedBand());
      expect(confirmedBand()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Dragon spotted')).toBeInTheDocument();
      expect(screen.getByText('Missing merchant')).toBeInTheDocument();
      expect(screen.getByText('Treasure map')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Source filter — small fixed set as visible pills, not a <select>
  // -------------------------------------------------------------------------
  describe('source filter', () => {
    test('renders every option as a visible pill rather than a select', () => {
      render(<RumorDirectory rumors={[r1]} />);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      for (const label of ['All', 'NPC', 'Tavern', 'Notice', 'Traveler', 'Other']) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      }
    });

    test('should filter by NPC source type', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.click(screen.getByRole('button', { name: 'NPC' }));
      expect(screen.getByText('Dragon spotted')).toBeInTheDocument();
      expect(screen.queryByText('Missing merchant')).not.toBeInTheDocument();
    });

    test('should filter by tavern source type', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Tavern' }));
      expect(screen.getByText('Missing merchant')).toBeInTheDocument();
      expect(screen.queryByText('Dragon spotted')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Combined filters
  // -------------------------------------------------------------------------
  describe('combined filters', () => {
    test('should apply search and status filter simultaneously', () => {
      const confirmed1 = makeRumor({ id: 'c1', title: 'Alpha', status: 'confirmed' });
      const unconfirmed1 = makeRumor({ id: 'u1', title: 'Alpha', status: 'unconfirmed' });
      render(<RumorDirectory rumors={[confirmed1, unconfirmed1]} />);

      fireEvent.change(searchInput(), { target: { value: 'Alpha' } });
      fireEvent.click(screen.getByRole('button', { name: '1 confirmed' }));

      expect(screen.getAllByText('Alpha').length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Delete / edit actions in the expanded row
  // -------------------------------------------------------------------------
  describe('row actions', () => {
    test('offers no way out to the edit form', () => {
      // CHANGED DELIBERATELY in `15-7`. The round trip to `/rumors/edit/:id`
      // to change "unconfirmed" to "confirmed" is the thing this PR deletes.
      // The route survives until `15-8` redirects it; nothing here points at
      // it any more.
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Dragon spotted/ }));

      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(mockNavigateToPage).not.toHaveBeenCalledWith('/rumors/edit/r1');
    });

    test('asks once before deleting, and deletes only when asked twice', async () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Dragon spotted/ }));

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(mockDeleteRumor).not.toHaveBeenCalled();
      expect(screen.getByText('Delete this rumour for everyone?')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Delete Dragon spotted' }));
      await waitFor(() => expect(mockDeleteRumor).toHaveBeenCalledWith('r1'));
    });

    test('keeps the rumour when the question is answered the other way', () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Dragon spotted/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

      expect(mockDeleteRumor).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });
  });


  // -------------------------------------------------------------------------
  // The composer (`15-7` item 1)
  // -------------------------------------------------------------------------
  describe('the composer row', () => {
    test('sits at the top of the list, always, with no dialog and no route', async () => {
      render(<RumorDirectory rumors={[r1]} />);
      const field = screen.getByLabelText('Heard something? Write it down here');
      fireEvent.change(field, { target: { value: 'Orcs massing in the High Pass' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add rumour' }));

      // CHANGED DELIBERATELY in `15-9`. What the composer captures is the
      // **content** -- a title long enough to say something never fitted the
      // row that had to render it, so the field that was always going to hold
      // a sentence now holds one, and the name is derived until somebody
      // shortens it on purpose. `sourceType` is absent rather than `'other'`:
      // nobody has been asked yet.
      await waitFor(() =>
        expect(mockAddRumor).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '',
            content: 'Orcs massing in the High Pass',
            status: 'unconfirmed',
          })
        )
      );
      expect(mockAddRumor.mock.calls[0][0]).not.toHaveProperty('sourceType');
      expect(mockNavigateToPage).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('adds on Enter, because a rumour is written down mid-sentence', async () => {
      render(<RumorDirectory rumors={[r1]} />);
      const field = screen.getByLabelText('Heard something? Write it down here');
      fireEvent.change(field, { target: { value: 'A wizard is coming' } });
      fireEvent.keyDown(field, { key: 'Enter' });

      await waitFor(() => expect(mockAddRumor).toHaveBeenCalled());
    });

    test('refuses to add nothing, and says why rather than looking broken', () => {
      // A disabled button that says nothing is indistinguishable from one that
      // is not wired up -- which is exactly how this one was first read.
      render(<RumorDirectory rumors={[r1]} />);
      const add = screen.getByRole('button', { name: 'Add rumour' });
      expect(add).toBeDisabled();

      // Said twice on purpose: a tooltip on the wrapper, because a disabled
      // button receives no pointer events and never shows its own...
      expect(add.parentElement).toHaveAttribute(
        'title',
        'Write it down first — then this adds it.'
      );
      // ...and the same sentence bound to the button, for anyone not hovering.
      const hint = document.getElementById(add.getAttribute('aria-describedby')!);
      expect(hint).toHaveTextContent('Write it down first — then this adds it.');
    });

    test('stops explaining itself once there is something to add', () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.change(screen.getByLabelText('Heard something? Write it down here'), {
        target: { value: 'Orcs massing' },
      });

      const add = screen.getByRole('button', { name: 'Add rumour' });
      expect(add).toBeEnabled();
      expect(add.parentElement).not.toHaveAttribute('title');
      expect(add).not.toHaveAttribute('aria-describedby');
    });

    test('keeps the typed title when the write is refused, and says why', async () => {
      mockAddRumor.mockRejectedValueOnce(new Error('Permission denied'));
      render(<RumorDirectory rumors={[r1]} />);
      const field = screen.getByLabelText('Heard something? Write it down here');
      fireEvent.change(field, { target: { value: 'Orcs massing' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add rumour' }));

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Permission denied')
      );
      expect(field).toHaveValue('Orcs massing');
    });

    test('stands down in selection mode, where the rows are checkboxes', () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));
      expect(
        screen.queryByLabelText('Heard something? Write it down here')
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Editing in place (`15-7` items 8 and 9) — the failure most likely to bite
  // -------------------------------------------------------------------------
  describe('editing a rumour in its row', () => {
    const openRow = (title: string) =>
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Expand ${title}`) }));

    test('writes the typed fields through the context, on Save', async () => {
      render(<RumorDirectory rumors={[r1]} />);
      openRow('Dragon spotted');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'A red one, over the Lonely Mountain.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(mockUpdateRumor).toHaveBeenCalledWith(
          'r1',
          expect.objectContaining({
            content: 'A red one, over the Lonely Mountain.',
          })
        )
      );
    });

    test('keeps typed text through a filter change and back again', () => {
      // Item 8, and the gate. The list re-renders underneath the editor, and
      // a row that stops matching unmounts with whatever was in it. The draft
      // lives in the directory for exactly this.
      render(<RumorDirectory rumors={[rc, r2, r3]} />);
      openRow('Dragon spotted');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Half a sentence, mid-' },
      });

      // Filter the open row out of the list entirely...
      fireEvent.click(screen.getByRole('button', { name: '1 unconfirmed' }));
      expect(screen.queryByLabelText('What was heard')).not.toBeInTheDocument();

      // ...and back.
      fireEvent.click(screen.getByRole('button', { name: '1 unconfirmed' }));
      expect(screen.getByLabelText('What was heard')).toHaveValue('Half a sentence, mid-');
    });

    test('keeps typed text when another row changes status underneath it', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      openRow('Dragon spotted');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Still typing' },
      });

      // A search keystroke re-renders the whole list, the same way another
      // player's write would.
      fireEvent.change(searchInput(), { target: { value: 'Dragon' } });
      expect(screen.getByLabelText('What was heard')).toHaveValue('Still typing');
    });

    test('keeps the typed text and says why when the save is refused', async () => {
      mockUpdateRumor.mockRejectedValueOnce(new Error('Permission denied'));
      render(<RumorDirectory rumors={[r1]} />);
      openRow('Dragon spotted');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Hard-won sentence.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Permission denied')
      );
      expect(screen.getByLabelText('What was heard')).toHaveValue('Hard-won sentence.');
    });

    test('discards the draft on Collapse, rather than saving it quietly', () => {
      render(<RumorDirectory rumors={[r1]} />);
      openRow('Dragon spotted');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Never mind.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));

      expect(mockUpdateRumor).not.toHaveBeenCalled();
      openRow('Dragon spotted');
      expect(screen.getByLabelText('What was heard')).toHaveValue(r1.content);
    });

    test('offers Save only once something has changed', () => {
      render(<RumorDirectory rumors={[r1]} />);
      openRow('Dragon spotted');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

      fireEvent.change(screen.getByLabelText('Call it'), {
        target: { value: 'Dragon spotted twice' },
      });
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    test('confirms a rumour in one click, without waiting for Save', async () => {
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      const ladder = screen.getByRole('group', { name: /Status of Missing merchant/ });
      fireEvent.click(within(ladder).getByRole('button', { name: 'Confirmed' }));

      await waitFor(() =>
        expect(mockUpdateRumorStatus).toHaveBeenCalledWith('r2', 'confirmed')
      );
    });

    test('says "False" on the ladder, not "Disproved"', () => {
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      const ladder = screen.getByRole('group', { name: /Status of Missing merchant/ });
      expect(within(ladder).getByRole('button', { name: 'False' })).toBeInTheDocument();
      expect(within(ladder).queryByRole('button', { name: 'Disproved' })).not.toBeInTheDocument();
    });

    test('attaches what a rumour points at, in place, without typing', async () => {
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      fireEvent.click(
        screen.getByRole('button', { name: /Attach to what Missing merchant points at/ })
      );
      fireEvent.click(within(screen.getByRole('listbox')).getByText('Gandalf the Grey'));

      await waitFor(() => expect(mockUpdateRumor).toHaveBeenCalled());
      const [id, change] = mockUpdateRumor.mock.calls[0];
      expect(id).toBe('r2');
      expect(resolveRecordChange(change, r2)).toEqual({ relatedNPCs: ['npc-1'] });
      // Worked out from the rumour as stored (T083): a person another player
      // attached since this copy was taken stays attached.
      expect(resolveRecordChange(change, { ...r2, relatedNPCs: ['npc-9'] })).toEqual({
        relatedNPCs: ['npc-9', 'npc-1'],
      });
    });

    // DATA-008: a person and a place may share a slug, each in its own
    // collection. Detaching one must leave the other attached.
    describe('when a person and a place share an id', () => {
      const { useNPCs } = require('../../../npcs/context/NPCContext');
      const npcsMock = useNPCs as jest.Mock;
      let original: (() => unknown) | undefined;
      beforeEach(() => {
        original = npcsMock.getMockImplementation();
        npcsMock.mockImplementation(() => ({
          npcs: [{ id: 'high-pass', name: 'The Hermit', occupation: 'Recluse' }],
          getNPCById: jest.fn(() => undefined),
        }));
      });
      afterEach(() => {
        npcsMock.mockImplementation(original);
      });

      const both = makeRumor({
        id: 'r2',
        title: 'Missing merchant',
        locationId: 'high-pass',
        relatedNPCs: ['high-pass'],
      });
      const detach = (name: string) => {
        render(<RumorDirectory rumors={[both]} />);
        openRow('Missing merchant');
        fireEvent.click(
          screen.getByRole('button', { name: /Attach to what Missing merchant points at/ })
        );
        fireEvent.click(within(screen.getByRole('listbox')).getByText(name));
      };

      test('detaching the person keeps the place', async () => {
        detach('The Hermit');
        await waitFor(() => expect(mockUpdateRumor).toHaveBeenCalled());
        const [id, change] = mockUpdateRumor.mock.calls[0];
        expect(id).toBe('r2');
        // Exactly the list: a change that never names the place leaves it
        // attached (T083).
        expect(resolveRecordChange(change, both)).toEqual({ relatedNPCs: [] });
      });

      test('detaching the place keeps the person', async () => {
        detach('The High Pass');
        await waitFor(() =>
          // Exactly the place: a patch that never names the people leaves them
          // attached (T083).
          expect(mockUpdateRumor).toHaveBeenCalledWith('r2', { locationId: '', location: '' })
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // A false rumour wears the red of a failed quest (maintainer, 2026-10-03)
  // -------------------------------------------------------------------------
  describe('what a false rumour looks like', () => {
    test('reads "False" and never "Disproved" in the row', () => {
      render(<RumorDirectory rumors={[r3]} />);
      revealFalse();
      // Scoped to the row: "False" is also the group heading.
      const row = within(screen.getByRole('button', { name: /Expand Treasure map/ }));
      expect(row.getByText('False')).toBeInTheDocument();
      expect(screen.queryByText('Disproved')).not.toBeInTheDocument();
    });

    test('wears the red of a failed quest, apart from confirmed, and keeps the strike', () => {
      render(<RumorDirectory rumors={[rc, r3]} />);
      revealFalse();

      // Scoped to the rows: both words are also group headings.
      const confirmed = within(
        screen.getByRole('button', { name: /Expand Dragon spotted/ })
      ).getByText('Confirmed');
      const falseStatus = within(
        screen.getByRole('button', { name: /Expand Treasure map/ })
      ).getByText('False');
      const rung = (node: HTMLElement) =>
        (node.closest('[class*="valence-"]') ?? node).className.match(/valence-\d/)?.[0];

      expect(rung(falseStatus)).toBe('valence-3');
      expect(rung(confirmed)).toBe('valence-0');
      // The strike stays, so the two do not rest on hue alone.
      expect(
        (falseStatus.closest('[class*="cue-negated"]') ?? falseStatus).className
      ).toContain('cue-negated');
    });

    test('is red in the summary bar and its legend, apart from confirmed', () => {
      const { container } = render(<RumorDirectory rumors={[rc, r2, r3]} />);
      const swatch = (name: string) =>
        screen.getByRole('button', { name }).querySelector('[aria-hidden="true"]') as HTMLElement;
      // Bands appear in the legend's order: confirmed, unconfirmed, false.
      const [confirmedBand, , falseBand] = Array.from(container.querySelectorAll('.roster-band'));

      expect(falseBand.className).toContain('bg-valence-3');
      expect(swatch('1 false').className).toContain('bg-valence-3');
      expect(confirmedBand.className).toContain('bg-valence-0');
      expect(swatch('1 confirmed').className).toContain('bg-valence-0');
    });
  });

  // -------------------------------------------------------------------------
  // Selection mode — select-then-batch (confirm / unconfirm / mark false /
  // combine / convert to quest), restored via RosterRow's `leadingControl`.
  // -------------------------------------------------------------------------
  describe('selection mode', () => {
    test('shows a "Select Rumors" button, with no checkboxes until it is used', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      expect(screen.getByRole('button', { name: /select rumours/i })).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    test('entering selection mode reveals one accessible checkbox per rumor', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));

      expect(screen.getByRole('checkbox', { name: 'Select Dragon spotted' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Select Missing merchant' })).toBeInTheDocument();
    });

    test('toggles to "Exit Selection" once selection mode is active', () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));
      expect(screen.getByRole('button', { name: /exit selection/i })).toBeInTheDocument();
    });

    test('checking a row does not expand it — the checkbox is outside the toggle button', () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dragon spotted' }));

      expect(
        screen.getByRole('button', { name: /Expand Dragon spotted/ })
      ).toHaveAttribute('aria-expanded', 'false');
    });

    test('selecting rumors accumulates them and shows the batch actions bar', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dragon spotted' }));
      expect(screen.getByText(/1 rumours selected/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Missing merchant' }));
      expect(screen.getByText(/2 rumours selected/i)).toBeInTheDocument();
    });

    test('unchecking a rumor removes it from the batch', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));

      const dragonCheckbox = screen.getByRole('checkbox', { name: 'Select Dragon spotted' });
      fireEvent.click(dragonCheckbox);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Missing merchant' }));
      expect(screen.getByText(/2 rumours selected/i)).toBeInTheDocument();

      fireEvent.click(dragonCheckbox);
      expect(screen.getByText(/1 rumours selected/i)).toBeInTheDocument();
    });

    test('the batch actions bar only appears once selection mode is on and something is selected', () => {
      render(<RumorDirectory rumors={[r1]} />);
      expect(screen.queryByText(/rumours selected/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));
      // Selection mode is on but nothing is checked yet — no bar.
      expect(screen.queryByText(/rumours selected/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dragon spotted' }));
      expect(screen.getByText(/1 rumours selected/i)).toBeInTheDocument();
    });

    test('exposes the batch status actions once a rumor is selected', () => {
      render(<RumorDirectory rumors={[r1]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dragon spotted' }));

      expect(screen.getByRole('button', { name: /mark confirmed/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /mark unconfirmed/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /mark false/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /convert to quest/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^combine$/i })).toBeInTheDocument();
    });

    test('running a batch status update writes the selection once and clears the selection on completion', async () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dragon spotted' }));

      fireEvent.click(screen.getByRole('button', { name: /mark confirmed/i }));
      expect(mockUpdateRumorsStatus).toHaveBeenCalledWith(['r1'], 'confirmed');

      // onComplete exits selection mode and clears the selection, so the
      // checkboxes and the batch bar both disappear.
      await screen.findByRole('button', { name: /select rumours/i });
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByText(/rumours selected/i)).not.toBeInTheDocument();
    });

    test('leaving selection mode via "Exit Selection" hides checkboxes and the batch bar', () => {
      render(<RumorDirectory rumors={[r1, r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /select rumours/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dragon spotted' }));
      expect(screen.getByText(/1 rumours selected/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /exit selection/i }));

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByText(/rumours selected/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /select rumours/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Row anatomy — one encoding per fact
  // -------------------------------------------------------------------------
  describe('row anatomy', () => {
    test('carries exactly one identity mark, derived from the id', () => {
      render(<RumorDirectory rumors={[r1]} />);
      const row = within(screen.getByRole('button', { name: /Expand Dragon spotted/ }));
      const marks = row.getAllByTestId('entity-sigil');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('D');
    });

    test('states status as a word and nothing else', () => {
      render(<RumorDirectory rumors={[rc]} />);
      const row = screen.getByRole('button', { name: /Expand Dragon spotted/ });
      expect(within(row).getByText('Confirmed')).toBeInTheDocument();
      expect(row.querySelectorAll('.bg-status-completed')).toHaveLength(0);
      expect(row.querySelectorAll('.bg-status-unknown')).toHaveLength(0);
      expect(row.querySelectorAll('.bg-status-failed')).toHaveLength(0);
    });

    test('does not badge a converted rumour twice in one row', () => {
      // The last cell already reads "Converted to quest"; the pill beside the
      // title said it again, in a box.
      const converted = makeRumor({
        id: 'r-converted',
        title: 'Bandits on the road',
        convertedToQuestId: 'q-1',
      });
      render(<RumorDirectory rumors={[converted]} />);
      const row = within(screen.getByRole('button', { name: /Expand Bandits on the road/ }));
      expect(row.getByText('Converted to quest')).toBeInTheDocument();
      expect(row.queryByText('Quest')).not.toBeInTheDocument();
    });
  });


  // -------------------------------------------------------------------------
  // What a rumour is called (`15-9`)
  // -------------------------------------------------------------------------
  describe('naming an untitled rumour', () => {
    const openRow = (name: string) =>
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Expand ${name}`) }));

    test('names the row from what was heard when no title was typed', () => {
      const heard = makeRumor({
        id: 'heard',
        title: '',
        content: 'Traders say the goblin road is busy.',
      });
      render(<RumorDirectory rumors={[heard]} />);

      expect(
        screen.getByText('Traders say the goblin road is busy.')
      ).toBeInTheDocument();
      expect(screen.queryByText('Untitled rumour')).not.toBeInTheDocument();
    });

    test('caps a long first line so the row can actually render it', () => {
      // The complaint this whole change answers: a title worth typing is a
      // sentence, and a sentence never fitted the row that had to show it.
      const long = makeRumor({
        id: 'long',
        title: '',
        content:
          'Traders coming down from Rivendell say the goblin road is busy again after dark',
      });
      render(<RumorDirectory rumors={[long]} />);

      expect(
        screen.getByText('Traders coming down from Rivendell say the goblin')
      ).toBeInTheDocument();
    });

    test('an explicit title still wins over the content', () => {
      const named = makeRumor({
        id: 'named',
        title: 'The goblin road',
        content: 'Traders say it is busy again after dark.',
      });
      render(<RumorDirectory rumors={[named]} />);

      expect(screen.getByText('The goblin road')).toBeInTheDocument();
      expect(
        screen.queryByText('Traders say it is busy again after dark.')
      ).not.toBeInTheDocument();
    });

    test('a rumour with neither reads as untitled, and muted rather than named', () => {
      const empty = makeRumor({ id: 'empty', title: '', content: '' });
      render(<RumorDirectory rumors={[empty]} />);

      const label = screen.getByText('Untitled rumour');
      expect(label).toBeInTheDocument();
      // Muted, so it reads as unfinished rather than as a record somebody
      // decided to call "Untitled rumour".
      expect(label.className).toMatch(/muted|typography-secondary/);
    });

    test('the title field previews what the row will show if left blank', () => {
      const heard = makeRumor({
        id: 'heard2',
        title: '',
        content: 'Traders say the goblin road is busy.',
      });
      render(<RumorDirectory rumors={[heard]} />);
      openRow('Traders say the goblin road is busy.');

      expect(screen.getByLabelText('Call it')).toHaveAttribute(
        'placeholder',
        'Traders say the goblin road is busy.'
      );
    });

    test('saves without a title, but not with nothing at all', async () => {
      // CHANGED DELIBERATELY in `15-9`: this used to read "A rumour needs a
      // title." A title is optional now -- the list names an untitled rumour
      // from its content -- so the only unsaveable state left is one that
      // says nothing at all, which no row could be rendered from.
      const written = makeRumor({ id: 'w', title: 'Old news', content: 'Somebody said so' });
      render(<RumorDirectory rumors={[written]} />);
      openRow('Old news');

      fireEvent.change(screen.getByLabelText('Call it'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('What was heard'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'A rumour needs something written down.'
        )
      );
      expect(mockUpdateRumor).not.toHaveBeenCalled();

      // Content but no title is a perfectly good rumour.
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Somebody said something' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(mockUpdateRumor).toHaveBeenCalledWith(
          'w',
          expect.objectContaining({ title: '', content: 'Somebody said something' })
        )
      );
    });
  });

  // -------------------------------------------------------------------------
  // Where a rumour came from (`15-9`)
  // -------------------------------------------------------------------------
  describe('an unchosen source', () => {
    const unsourced = () =>
      makeRumor({ id: 'nosrc', title: 'Odd noises', sourceType: undefined, sourceName: '' });

    const heardFrom = () => within(screen.getByRole('group', { name: 'Heard from' }));

    test('reads as a dash on the row, not as "Other"', () => {
      // The bug this answers: the row printed "Other" for a rumour whose
      // source had never been discussed, while the editor below showed nothing
      // selected. The two said different things about one record.
      render(<RumorDirectory rumors={[unsourced()]} />);
      const row = within(screen.getByRole('button', { name: /Expand Odd noises/ }));

      expect(row.queryByText('Other')).not.toBeInTheDocument();
      expect(row.getAllByText('—').length).toBeGreaterThan(0);
    });

    test('offers "Something else" as a real choice, pressed like any other', () => {
      render(<RumorDirectory rumors={[unsourced()]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Odd noises/ }));

      expect(heardFrom().getByRole('button', { name: 'Something else' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );

      fireEvent.click(heardFrom().getByRole('button', { name: 'Something else' }));
      expect(heardFrom().getByRole('button', { name: 'Something else' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      // And it asks who, exactly, like any other chosen kind.
      expect(screen.getByLabelText('Who exactly')).toBeInTheDocument();
    });

    test('pressing the chosen kind again clears it', () => {
      // Every one of the five is a real answer now, so there has to be a way
      // back to "nobody has said" after a mis-tap.
      render(<RumorDirectory rumors={[unsourced()]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Odd noises/ }));

      fireEvent.click(heardFrom().getByRole('button', { name: 'A tavern' }));
      expect(heardFrom().getByRole('button', { name: 'A tavern' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      fireEvent.click(heardFrom().getByRole('button', { name: 'A tavern' }));
      expect(heardFrom().getByRole('button', { name: 'A tavern' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    test('writes null rather than undefined, which Firestore refuses', async () => {
      const sourced = makeRumor({
        id: 'srcd',
        title: 'Odd noises',
        sourceType: 'tavern',
        sourceName: '',
      });
      render(<RumorDirectory rumors={[sourced]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Odd noises/ }));

      // Un-press the chosen kind, then save the cleared value.
      fireEvent.click(heardFrom().getByRole('button', { name: 'A tavern' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(mockUpdateRumor).toHaveBeenCalledWith(
          'srcd',
          expect.objectContaining({ sourceType: null })
        )
      );
    });

    test('a record that already says "other" keeps saying so', () => {
      // No migration: rumours written under the retired create form all carry
      // `'other'` and cannot be told apart from a deliberate choice. They read
      // exactly as they did before.
      const legacy = makeRumor({ id: 'legacy', title: 'Old news', sourceType: 'other' });
      render(<RumorDirectory rumors={[legacy]} />);
      const row = within(screen.getByRole('button', { name: /Expand Old news/ }));
      expect(row.getByText('Other')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // A status the enum does not have (`15-9`)
  // -------------------------------------------------------------------------
  describe('a rumour whose status is not one of the three', () => {
    /**
     * Found in the emulator, written by note conversion: the extraction
     * function's JSON schema offers `"unknown"` as a rumour status
     * (`firebase/functions/src/entityExtraction.ts`), and `RumorStatus` has
     * no such member. `RumorForm`'s `<select>` used to sanitise it by
     * accident -- it only ever offered the three real ones -- so retiring the
     * form is what let the value reach storage.
     *
     * Grouping by status then made the row *disappear*: it matched none of
     * the three groups and was dropped, silently, from the list and from the
     * counts. Location grouping never did this, because every rumour has some
     * location or none. A list may show a record oddly; it may never fail to
     * show it at all.
     */
    const odd = () =>
      makeRumor({
        id: 'odd',
        title: 'Harry Potter at Jedi Academy',
        status: 'unknown' as RumorStatus,
      });

    test('is still in the list', () => {
      render(<RumorDirectory rumors={[odd()]} />);
      expect(screen.getByText('Harry Potter at Jedi Academy')).toBeInTheDocument();
    });

    test('is counted in a band, so the three still sum to the total', () => {
      render(<RumorDirectory rumors={[odd(), r2]} />);
      // Unconfirmed is what an unrecognised status *means*: nobody knows yet.
      expect(screen.getByRole('button', { name: '2 unconfirmed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '0 confirmed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '0 false' })).toBeInTheDocument();
      expect(screen.getByText('rumours gathered')).toBeInTheDocument();
    });

    test('reads as unconfirmed rather than as its stored value', () => {
      render(<RumorDirectory rumors={[odd()]} />);
      const row = within(
        screen.getByRole('button', { name: /Expand Harry Potter at Jedi Academy/ })
      );
      expect(row.getByText('Unconfirmed')).toBeInTheDocument();
      expect(row.queryByText(/unknown/i)).not.toBeInTheDocument();
    });

    test('is reachable by the unconfirmed filter', () => {
      render(<RumorDirectory rumors={[odd(), r3]} />);
      fireEvent.click(screen.getByRole('button', { name: '1 unconfirmed' }));
      expect(screen.getByText('Harry Potter at Jedi Academy')).toBeInTheDocument();
      expect(screen.queryByText('Treasure map')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // An open row holds its place (`15-10`)
  // -------------------------------------------------------------------------
  describe('resolving a rumour from its own row', () => {
    const openRow = (name: string) =>
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Expand ${name}`) }));

    const resolveAs = (name: string, label: string) =>
      fireEvent.click(
        within(screen.getByRole('group', { name: `Status of ${name}` })).getByRole('button', {
          name: label,
        })
      );

    /**
     * **The regression this fixes was introduced by grouping.** The ladder
     * writes on the click -- `15-7` made that a gate, because confirming a
     * rumour mid-session must be one click -- and that was harmless while the
     * list grouped by location, since a status change moved nothing. Grouping
     * by status made the thing you most often change from this list also the
     * thing that re-sorts it, so the row you were reading and editing was
     * thrown to another part of the page the instant you resolved it.
     *
     * Sorting by status rather than grouping would have moved it just as
     * surely, which is why this is fixed by pinning the open row rather than
     * by reconsidering the grouping.
     */
    test('stays where it is when its status changes', async () => {
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');

      resolveAs('Missing merchant', 'Confirmed');
      await waitFor(() =>
        expect(mockUpdateRumorStatus).toHaveBeenCalledWith('r2', 'confirmed')
      );

      // Still open, still under the heading it was opened from.
      expect(
        screen.getByRole('button', { name: /Collapse Missing merchant/ })
      ).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('heading', { name: 'Unconfirmed' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Confirmed' })).not.toBeInTheDocument();
    });

    test('the write still happens on the click, not on Save', async () => {
      // The one-click gate from `15-7`: only the row's *position* waits.
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      resolveAs('Missing merchant', 'Confirmed');

      await waitFor(() =>
        expect(mockUpdateRumorStatus).toHaveBeenCalledWith('r2', 'confirmed')
      );
      expect(screen.queryByRole('button', { name: 'Save' })).toBeDisabled();
    });

    /**
     * The write lands, the context refreshes, and the list re-renders with a
     * record whose status has really changed -- which is the moment the row
     * would have jumped. It holds, and says why.
     */
    test('says where it is going rather than quietly sitting in the wrong group', () => {
      const before = makeRumor({ id: 'moving', title: 'On the move', status: 'unconfirmed' });
      const { rerender } = render(<RumorDirectory rumors={[before]} />);
      openRow('On the move');
      expect(screen.queryByText(/Moves to/)).not.toBeInTheDocument();

      const after = { ...before, status: 'confirmed' as RumorStatus };
      rerender(<RumorDirectory rumors={[after]} />);

      expect(screen.getByText('Moves to Confirmed when you close this.')).toBeInTheDocument();
      // Still where it was opened, and still open.
      expect(screen.getByRole('heading', { name: 'Unconfirmed' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Collapse On the move/ })
      ).toHaveAttribute('aria-expanded', 'true');
    });

    test('settles into its real group once the row closes', () => {
      const before = makeRumor({ id: 'moving', title: 'On the move', status: 'unconfirmed' });
      const { rerender } = render(<RumorDirectory rumors={[before]} />);
      openRow('On the move');

      const after = { ...before, status: 'confirmed' as RumorStatus };
      rerender(<RumorDirectory rumors={[after]} />);
      expect(screen.getByRole('heading', { name: 'Unconfirmed' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Collapse On the move/ }));

      expect(screen.getByRole('heading', { name: 'Confirmed' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Unconfirmed' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Moves to/)).not.toBeInTheDocument();
    });

    /**
     * The heading counts what is under it, by decision: a heading describes
     * the list it introduces. The summary bar above follows the *data*, and
     * its ticking over is the confirmation that the write landed.
     */
    test('the heading counts the rows beneath it; the bar counts the data', () => {
      const before = makeRumor({ id: 'moving', title: 'On the move', status: 'unconfirmed' });
      const { rerender } = render(<RumorDirectory rumors={[before, r3]} />);
      openRow('On the move');

      const after = { ...before, status: 'confirmed' as RumorStatus };
      rerender(<RumorDirectory rumors={[after, r3]} />);

      const heading = screen.getByRole('heading', { name: 'Unconfirmed' });
      expect(heading.parentElement).toHaveTextContent('1');
      expect(screen.getByRole('button', { name: '1 confirmed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '0 unconfirmed' })).toBeInTheDocument();
    });

    /**
     * A filtered list must not do by the back door what pinning prevents:
     * filtering to Unconfirmed while an open row has just been confirmed has
     * to keep showing it, or the row vanishes exactly as before.
     */
    test('a status filter keeps an open row that no longer matches', async () => {
      render(<RumorDirectory rumors={[r2, r3]} />);
      fireEvent.click(screen.getByRole('button', { name: '1 unconfirmed' }));
      openRow('Missing merchant');
      resolveAs('Missing merchant', 'Confirmed');

      await waitFor(() =>
        expect(mockUpdateRumorStatus).toHaveBeenCalledWith('r2', 'confirmed')
      );
      expect(screen.getByText('Missing merchant')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Typed text outlives the page (`15-10`)
  // -------------------------------------------------------------------------
  describe('unsaved text', () => {
    const STORAGE_KEY = 'dnd:rumor-drafts:campaign-1';

    beforeEach(() => {
      window.sessionStorage.clear();
    });

    const openRow = (name: string) =>
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Expand ${name}`) }));

    test('survives leaving the list and coming back', () => {
      // `15-7` item 8 put drafts in the directory so they survive a filter or
      // another player's write. They still died on a *route* change, because
      // the directory unmounts with them.
      const { unmount } = render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Half a sentence, mid-' },
      });

      unmount();
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');

      expect(screen.getByLabelText('What was heard')).toHaveValue('Half a sentence, mid-');
    });

    test('is kept locally and never written to the database', () => {
      // A rumour is shared with the whole campaign, so a draft that reached
      // Firestore would broadcast half-written text to everyone at the table.
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Still typing' },
      });

      expect(mockUpdateRumor).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toContain('Still typing');
    });

    test('marks the row, so a kept draft cannot pass for saved work', () => {
      const { unmount } = render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Half a sentence' },
      });

      unmount();
      render(<RumorDirectory rumors={[r2]} />);

      const row = within(screen.getByRole('button', { name: /Expand Missing merchant/ }));
      expect(row.getByText('Unsaved')).toBeInTheDocument();
    });

    test('does not mark a row merely because it was opened', () => {
      // Opening a row seeds a draft identical to the record. Marking that
      // would cry wolf on every row anybody looked at.
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
    });

    test('stops marking the row once the text is saved', async () => {
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Saved text' },
      });
      expect(screen.getByText('Unsaved')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mockUpdateRumor).toHaveBeenCalled());
      expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    test('Collapse still discards, as it always did', () => {
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Never mind' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));

      expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    test('arms the browser guard only while something is unsaved', () => {
      const add = jest.spyOn(window, 'addEventListener');
      render(<RumorDirectory rumors={[r2]} />);
      openRow('Missing merchant');
      expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Unsaved text' },
      });
      expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
      add.mockRestore();
    });

    /**
     * **Under `StrictMode`, as the real app runs.**
     *
     * This is the test that would have caught the first attempt, and the
     * plain `render` above did not. `index.tsx` wraps the app in
     * `React.StrictMode`, which mounts, runs every effect, then runs them all
     * a second time. Hydrating in an effect and persisting in its partner
     * meant the restore was immediately overwritten by the still-empty state,
     * and the second pass then re-read the key it had just emptied -- so the
     * draft survived the whole round trip in storage and was destroyed on
     * arrival, in the browser only.
     */
    test('survives the round trip under StrictMode, as the app runs it', () => {
      const { unmount } = render(
        <React.StrictMode>
          <RumorDirectory rumors={[r2]} />
        </React.StrictMode>
      );
      openRow('Missing merchant');
      fireEvent.change(screen.getByLabelText('What was heard'), {
        target: { value: 'Survives the double mount' },
      });
      unmount();

      render(
        <React.StrictMode>
          <RumorDirectory rumors={[r2]} />
        </React.StrictMode>
      );

      expect(screen.getByText('Unsaved')).toBeInTheDocument();
      openRow('Missing merchant');
      expect(screen.getByLabelText('What was heard')).toHaveValue(
        'Survives the double mount'
      );
    });

    test('survives storage being unavailable', () => {
      // Private windows and blocked site data both throw on access. Losing a
      // draft is what happened before this existed; breaking the list is not.
      const getItem = jest
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('SecurityError');
        });
      const setItem = jest
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('SecurityError');
        });

      expect(() => render(<RumorDirectory rumors={[r2]} />)).not.toThrow();
      expect(screen.getByText('Missing merchant')).toBeInTheDocument();

      getItem.mockRestore();
      setItem.mockRestore();
    });
  });
});


// ---------------------------------------------------------------------------
// PR 15.3 -- the knowledge ladder and the highlight contract
// ---------------------------------------------------------------------------

describe('RumorDirectory — 15.3', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  describe('the knowledge ladder', () => {
    it('resolves a rumour from the row, in one click', async () => {
      render(<RumorDirectory rumors={[r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Missing merchant/ }));

      const ladder = screen.getByRole('group', { name: 'Status of Missing merchant' });
      fireEvent.click(within(ladder).getByRole('button', { name: 'Confirmed' }));

      await waitFor(() =>
        expect(mockUpdateRumorStatus).toHaveBeenCalledWith('r2', 'confirmed')
      );
    });

    it('says "False", not "Disproved"', () => {
      render(<RumorDirectory rumors={[r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Missing merchant/ }));

      const ladder = screen.getByRole('group', { name: 'Status of Missing merchant' });
      expect(within(ladder).getByRole('button', { name: 'False' })).toBeInTheDocument();
      expect(within(ladder).queryByRole('button', { name: 'Disproved' })).toBeNull();
    });

    it('writes the stored value behind the readable label', async () => {
      render(<RumorDirectory rumors={[r2]} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand Missing merchant/ }));

      const ladder = screen.getByRole('group', { name: 'Status of Missing merchant' });
      fireEvent.click(within(ladder).getByRole('button', { name: 'False' }));

      await waitFor(() => expect(mockUpdateRumorStatus).toHaveBeenCalledWith('r2', 'false'));
    });
  });

  describe('?highlight= (T014)', () => {
    it('opens the target row, which it never used to do', () => {
      setupMocks({ uid: 'user-1' }, { highlight: 'r2' }, [r1, r2]);
      render(<RumorDirectory rumors={[r1, r2]} />);
      expect(
        screen.getByRole('button', { name: /Collapse Missing merchant/ })
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // T101: each status group mounts a page at a time, folded or not.
  // -------------------------------------------------------------------------
  describe('large campaigns', () => {
    const many = (status: RumorStatus, count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) =>
        makeRumor({ id: `${prefix}-${i}`, title: `${prefix} rumour ${i}`, status })
      );
    /** Rows on the page, folded ones included, by their expand control. */
    const rowsOf = (prefix: string) =>
      screen.queryAllByRole('button', { name: new RegExp(`^(Expand|Collapse) ${prefix} rumour `), hidden: true }).length;

    it('mounts one page of each group, and "Show more" adds a page to that group', () => {
      setupMocks();
      render(
        <RumorDirectory rumors={[...many('unconfirmed', 230, 'heard'), ...many('false', 120, 'lie')]} />
      );
      expect(rowsOf('heard')).toBe(100);
      expect(rowsOf('lie')).toBe(100);

      fireEvent.click(screen.getByRole('button', { name: /show .*more/i }));
      expect(rowsOf('heard')).toBe(200);
      expect(rowsOf('lie')).toBe(100);
    });

    it('opens the folded False group for a deep link, and mounts the linked row', () => {
      setupMocks({ uid: 'user-1' }, { highlight: 'lie-110' });
      render(<RumorDirectory rumors={many('false', 120, 'lie')} />);
      const heading = screen
        .getAllByRole('button', { name: /^False/ })
        .find((button) => button.hasAttribute('aria-expanded'));
      expect(heading).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: /^(Expand|Collapse) lie rumour 110$/ })).toBeVisible();
    });
  });
});
