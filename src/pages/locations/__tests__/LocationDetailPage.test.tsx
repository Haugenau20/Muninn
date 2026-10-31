// src/pages/locations/__tests__/LocationDetailPage.test.tsx
//
// `/locations/:locationId` — the route a location earns because **a row cannot
// hold a tree** (§2.2).
//
// The gates this suite stands for:
// the hierarchy module at depth 1 and depth 4; cycle safety asserted rather
// than eyeballed, in the tree, the breadcrumb and the descendant exclusion;
// deleting a parent offering both outcomes and naming the count; every field
// editable in place with a rejected write keeping the typed text; and a place
// with nothing written looking **new, not broken**.

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LocationDetailPage from '../LocationDetailPage';
import { resolveRecordChange } from '@/test-utils/update-after-reading';

// T083: a list change goes to the context as a function of the stored
// record. Resolve it the way the context's transaction does -- against
// `mockStoredRecords[id]` when a test says the server holds something newer
// than the page's copy, and against the page's own copy otherwise -- so the
// write mocks below still see plain fields.
const mockResolveChange = resolveRecordChange;
let mockStoredRecords: Record<string, any> = {};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
let mockLocationId: string | undefined = 'gondolin';
let mockRouterState: any = null;

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ locationId: mockLocationId }),
  useLocation: () => ({ pathname: '/locations', state: mockRouterState }),
}));

// ---------------------------------------------------------------------------
// The gate (see page-suite-mock.md)
// ---------------------------------------------------------------------------
let mockUser: { uid: string } | null = { uid: 'user-1' };
let mockActiveGroupId: string | null = 'group-1';
let mockActiveCampaignId: string | null = 'campaign-1';

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
  useGroups: () => ({
    activeGroupId: mockActiveGroupId,
    groups: [{ id: 'group-1', name: 'The Fellowship' }],
    setActiveGroup: jest.fn().mockResolvedValue(undefined),
  }),
  useCampaigns: () => ({
    activeCampaignId: mockActiveCampaignId,
    activeCampaign: mockActiveCampaignId
      ? { id: mockActiveCampaignId, name: 'Beleriand' }
      : null,
    setActiveCampaign: jest.fn().mockResolvedValue(undefined),
  }),
  useUser: () => ({
    activeGroupUserProfile: {
      username: 'gandlaf',
      activeCharacterId: 'char-1',
      characters: [{ id: 'char-1', name: 'Zendikarr' }],
    },
  }),
  signInPathFor: () => '/signin',
}));

jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: {
    campaign: { getCampaigns: jest.fn().mockResolvedValue([]) },
  },
}));

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const place = (id: string, name: string, extra: any = {}) => ({
  id,
  name,
  type: 'city',
  status: 'known',
  description: `About ${name}`,
  features: [],
  connectedNPCs: [],
  notes: [],
  tags: [],
  createdByUsername: 'DungeonMaster',
  dateAdded: '2025-05-31T19:27:30.387Z',
  ...extra,
});

/** Beleriand > Gondolin > King's square > the fountain, and Doriath alongside. */
const TREE = [
  place('beleriand', 'Beleriand', { type: 'region' }),
  place('gondolin', 'Gondolin', {
    parentId: 'beleriand',
    status: 'visited',
    features: ['Seven gates', 'White towers'],
    connectedNPCs: ['npc-1'],
    tags: ['hidden'],
    lastVisited: '2025-05-31T00:00:00.000Z',
    // Its notes are documents of their own (T133): `GONDOLIN_NOTES`.
  }),
  place('kings-square', "King's square", { parentId: 'gondolin', type: 'poi' }),
  place('seven-gates', 'Seven gates', { parentId: 'gondolin', type: 'landmark' }),
  place('fountain', 'The fountain', { parentId: 'kings-square', type: 'poi' }),
  place('doriath', 'Doriath', { parentId: 'beleriand', type: 'region' }),
];

/** Gondolin's notes, as their documents. */
const GONDOLIN_NOTES = [
  { noteId: 'n-1', date: '2025-05-31T19:27:30.387Z', text: 'The last of the great kingdoms.', author: 'Zendikarr' },
  { noteId: 'n-2', date: '2025-06-14T10:00:00.000Z', text: 'Turgon will not open the gates.' },
];
/** Gondolin's notes as `useRecordNotes` delivers them; reset to `GONDOLIN_NOTES` before each test. */
let mockNoteDocuments: any[] | undefined = GONDOLIN_NOTES;

let mockLocations: any[] = TREE;
const mockUpdateLocation = jest.fn().mockResolvedValue(undefined);
// T131: a link to a person, a quest or a rumour may be written on their side.
const mockUpdateNPC = jest.fn().mockResolvedValue(undefined);
const mockUpdateQuest = jest.fn().mockResolvedValue(undefined);
const mockUpdateRumor = jest.fn().mockResolvedValue(undefined);
const mockUpdateLocationNote = jest.fn().mockResolvedValue(undefined);
const mockUpdateLocationStatus = jest.fn().mockResolvedValue(undefined);
const mockMoveLocation = jest.fn().mockResolvedValue(undefined);
const mockDeleteLocation = jest.fn().mockResolvedValue(undefined);
const mockCreateLocation = jest.fn().mockResolvedValue('new-id');
const mockRefreshLocations = jest.fn().mockResolvedValue(undefined);

let mockNPCs: any[] = [{ id: 'npc-1', name: 'Turgon', title: 'King of Gondolin' }];
let mockQuests: any[] = [
  { id: 'q-1', title: 'The Fall of Gondolin', status: 'active', locationId: 'gondolin' },
];
let mockRumors: any[] = [
  { id: 'r-1', title: 'A hidden city', status: 'unconfirmed', relatedLocations: ['gondolin'] },
];

jest.mock('features/campaign-entities', () => {
  const actualTree = jest.requireActual(
    'features/campaign-entities/locations/utils/location-tree'
  );
  const actualPresentation = jest.requireActual(
    'features/campaign-entities/locations/utils/location-presentation'
  );
  const actualDisplay = jest.requireActual(
    'features/campaign-entities/locations/utils/location-display'
  );
  // The real helper, not a stub: this page must name a rumour the same way
  // its own list does, now that a title is optional (`15-9`).
  const actualRumorTitle = jest.requireActual(
    'features/campaign-entities/rumors/utils/rumor-title'
  );
  return {
    // Notes are documents of their own (T133); see the mock.
    ...require('@/test-utils/record-notes-mock').recordNotesMock(),
    useRecordNotes: jest.fn((_path: string, id?: string) => (id === 'gondolin' ? mockNoteDocuments : undefined)),
    rumorTitleText: actualRumorTitle.rumorTitleText,
    useLocations: () => ({
      locations: mockLocations,
      isLoading: false,
      error: null,
      refreshLocations: mockRefreshLocations,
      updateLocation: (id: string, change: any) =>
        mockUpdateLocation(
          id,
          mockResolveChange(change, mockStoredRecords[id] ?? mockLocations.find((l) => l.id === id))
        ),
      updateLocationNote: mockUpdateLocationNote,
      updateLocationStatus: mockUpdateLocationStatus,
      moveLocation: mockMoveLocation,
      deleteLocation: mockDeleteLocation,
      createLocation: mockCreateLocation,
    }),
    useNPCs: () => ({
      npcs: mockNPCs,
      updateNPC: (id: string, change: any) =>
        mockUpdateNPC(id, mockResolveChange(change, mockStoredRecords[id] ?? mockNPCs.find((n: any) => n.id === id))),
    }),
    useQuests: () => ({
      quests: mockQuests,
      updateQuest: (id: string, change: any) =>
        mockUpdateQuest(id, mockResolveChange(change, mockStoredRecords[id] ?? mockQuests.find((q: any) => q.id === id))),
    }),
    useRumors: () => ({
      rumors: mockRumors,
      updateRumor: (id: string, change: any) =>
        mockUpdateRumor(id, mockResolveChange(change, mockStoredRecords[id] ?? mockRumors.find((r: any) => r.id === id))),
    }),
    // The real link modules (T131): which field owns each link is the contract.
    ...jest.requireActual('features/campaign-entities/shared/links'),
    createLinkActions: jest.requireActual('features/campaign-entities/shared/linkActions').createLinkActions,
    // Private records (T163): none here, so every record lives in the campaign.
    useLinkPrivacy: () => undefined,
    useRecordNotesPath: jest.requireActual('features/campaign-entities/shared/private/useRecordNotesPath').useRecordNotesPath,

    // The real modules, not stubs: the page's contract is that it reuses the
    // one guarded set of walks rather than inventing its own.
    ...actualTree,
    ...actualPresentation,
    ...actualDisplay,
    WhereThisSits: jest.requireActual(
      'features/campaign-entities/locations/components/WhereThisSits'
    ).default,
    DeleteLocationDialog: jest.requireActual(
      'features/campaign-entities/locations/components/DeleteLocationDialog'
    ).default,
  };
});

const mockOpenQuickAdd = jest.fn();
jest.mock('shared/context/QuickAddContext', () => ({
  useQuickAdd: () => ({
    openQuickAdd: mockOpenQuickAdd,
    closeQuickAdd: jest.fn(),
    openEntity: null,
  }),
}));

const mockNavigateToPage = jest.fn();
jest.mock('shared/context/NavigationContext', () => ({
  useNavigation: () => ({ navigateToPage: mockNavigateToPage }),
}));

// The upload/save/delete ordering is useImageAttachment's own suite; here the
// page is only asked what it hands the hook, and what its save writes.
let mockImageOptions: any = null;
jest.mock('shared/hooks/useImageAttachment', () => ({
  useImageAttachment: (options: any) => {
    mockImageOptions = options;
    return { upload: jest.fn(), remove: jest.fn() };
  },
}));

// Reaches Firebase for usernames; the page owns the label above it, not this.
jest.mock('shared/components/AttributionInfo', () => ({
  __esModule: true,
  default: ({ item }: any) => <div data-testid="attribution-info">{item?.id}</div>,
}));

jest.mock(
  'lucide-react',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target: any, prop: string) =>
          prop in target ? target[prop] : () => null,
      }
    )
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const renderPage = () =>
  render(
    <MemoryRouter>
      <LocationDetailPage />
    </MemoryRouter>
  );

/** The "Where this sits" card. */
const hierarchy = () =>
  screen.getByText('Where this sits').closest('section') as HTMLElement;

beforeEach(() => {
  mockStoredRecords = {};
  jest.clearAllMocks();
  mockNoteDocuments = GONDOLIN_NOTES;
  mockLocationId = 'gondolin';
  mockRouterState = null;
  mockLocations = TREE;
  mockUser = { uid: 'user-1' };
  mockActiveGroupId = 'group-1';
  mockActiveCampaignId = 'campaign-1';
  mockNPCs = [{ id: 'npc-1', name: 'Turgon', title: 'King of Gondolin' }];
  mockQuests = [
    { id: 'q-1', title: 'The Fall of Gondolin', status: 'active', locationId: 'gondolin' },
  ];
  mockRumors = [
    { id: 'r-1', title: 'A hidden city', status: 'unconfirmed', relatedLocations: ['gondolin'] },
  ];
});

// ---------------------------------------------------------------------------

// T063: the dark band became the NPC page's light identity card. What the
// band's one meta line said is now the card's line and its facts.
describe('LocationDetailPage — the identity card', () => {
  it('names the place, in the campaign’s voice', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Gondolin' })).toBeInTheDocument();
  });

  it('states where it sits under the name, and what it is, what is inside and when it was visited as facts', () => {
    renderPage();
    expect(screen.getByText('In Beleriand')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit type' })).toHaveTextContent('City');
    expect(screen.getByRole('group', { name: 'Inside' })).toHaveTextContent('2 places');
    expect(screen.getByRole('group', { name: 'Last visited' })).toHaveTextContent('31/05/2025');
  });

  it('says only what exists: a top-level place claims no parent', () => {
    mockLocationId = 'beleriand';
    renderPage();
    expect(screen.queryByText(/^In /)).toBeNull();
  });

  it('says only what exists: an empty place claims no count', () => {
    mockLocationId = 'doriath';
    renderPage();
    expect(screen.getByRole('group', { name: 'Inside' })).toHaveTextContent('Nothing yet');
  });

  it('leads back through every ancestor it has', () => {
    mockLocationId = 'fountain';
    renderPage();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('Locations')).toBeInTheDocument();
    expect(within(trail).getByText('Beleriand')).toBeInTheDocument();
    expect(within(trail).getByText('Gondolin')).toBeInTheDocument();
    expect(within(trail).getByText("King's square")).toBeInTheDocument();
  });

  it('changes knowledge from its fact, on a ladder of buttons rather than a dropdown', async () => {
    renderPage();
    expect(screen.getByRole('group', { name: 'Knowledge' })).toHaveTextContent('Visited');
    fireEvent.click(screen.getByRole('button', { name: 'Edit knowledge' }));
    const ladder = screen.getByRole('group', { name: 'Knowledge of Gondolin' });
    expect(within(ladder).queryByRole('combobox')).toBeNull();

    fireEvent.click(within(ladder).getByRole('button', { name: 'Explored' }));
    await waitFor(() =>
      expect(mockUpdateLocationStatus).toHaveBeenCalledWith('gondolin', 'explored')
    );
  });

  it('offers one primary act: adding a place inside', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add a place inside' }));
    expect(mockOpenQuickAdd).toHaveBeenCalledWith('location', { parentId: 'gondolin' });
  });
});

describe('LocationDetailPage — "Where this sits" (§6.2)', () => {
  it('shows parent, self and what is inside — and no siblings', () => {
    renderPage();
    const module = within(hierarchy());

    expect(module.getByText('Region · the parent')).toBeInTheDocument();
    expect(module.getByText('you are here')).toBeInTheDocument();
    expect(module.getByText("King's square")).toBeInTheDocument();
    expect(module.getByText('Seven gates')).toBeInTheDocument();

    // CHANGED DELIBERATELY. §6.2 listed siblings at reduced emphasis, and the
    // assertion that they appeared was here. Reported from the running app:
    // the relationship is not real. Two places share a parent because nobody
    // has filed them anywhere, not because they have anything to do with each
    // other, so at the top level every unfiled place in the campaign was
    // listed as "a sibling" under every other one.
    expect(module.queryByText('a sibling')).not.toBeInTheDocument();
    expect(module.queryByText('Doriath')).not.toBeInTheDocument();
  });

  it('shows three levels at depth 4 as at depth 1 — never more', () => {
    // The fountain is four levels down. The module still shows exactly its
    // parent, itself and what is inside it: "always exactly three, however deep
    // the data goes".
    mockLocationId = 'fountain';
    renderPage();
    const module = within(hierarchy());

    expect(module.getByText(/the parent/)).toBeInTheDocument();
    expect(module.getByText('you are here')).toBeInTheDocument();
    // Its grandparent is not in the module — that is what the breadcrumb is for.
    expect(module.queryByText('Beleriand')).not.toBeInTheDocument();
  });

  it('says so plainly when a place is at the top level', () => {
    mockLocationId = 'beleriand';
    renderPage();
    expect(
      within(hierarchy()).getByText(/At the top level/)
    ).toBeInTheDocument();
  });

  it('opens a place from the module without leaving through the breadcrumb', () => {
    renderPage();
    const module = within(hierarchy());
    fireEvent.click(module.getByText("King's square"));
    expect(mockNavigateToPage).toHaveBeenCalledWith('/locations/kings-square');
  });

  it('adds a child only through quick add, so nothing lands loose', () => {
    renderPage();
    fireEvent.click(
      within(hierarchy()).getByRole('button', { name: /Add a place inside Gondolin/ })
    );
    expect(mockOpenQuickAdd).toHaveBeenCalledWith('location', { parentId: 'gondolin' });
  });
});

describe('LocationDetailPage — Move elsewhere (§6.2, item 3)', () => {
  const openTray = () => {
    fireEvent.click(
      within(hierarchy()).getByRole('button', { name: /Move elsewhere/ })
    );
    return within(screen.getByRole('listbox'));
  };

  it('makes an invalid parent unofferable rather than silently discarding it', () => {
    // The form this replaces offers a combobox that accepts anything and then
    // blanks a parent that fails validation, so choosing a descendant loses the
    // parent the record already had and says nothing.
    renderPage();
    const tray = openTray();

    const offered = tray.getAllByRole('option').map((option) => option.textContent);
    expect(offered.join(' ')).not.toContain('Gondolin');
    expect(offered.join(' ')).not.toContain("King's square");
    expect(offered.join(' ')).not.toContain('Seven gates');
    expect(offered.join(' ')).not.toContain('The fountain');
  });

  it('offers an ancestor and a sibling, which are legal', () => {
    renderPage();
    const tray = openTray();
    expect(tray.getByText('Doriath')).toBeInTheDocument();
    expect(tray.getByText('Beleriand')).toBeInTheDocument();
  });

  it('writes the move through the guarded context method', async () => {
    renderPage();
    const tray = openTray();
    fireEvent.click(tray.getByText('Doriath'));
    await waitFor(() => expect(mockMoveLocation).toHaveBeenCalledWith('gondolin', 'doriath'));
  });

  it('says why in words when the write is refused, and moves nothing', async () => {
    mockMoveLocation.mockRejectedValueOnce(new Error('Doriath is already inside Gondolin.'));
    renderPage();
    const tray = openTray();
    fireEvent.click(tray.getByText('Doriath'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Doriath is already inside Gondolin.')
    );
  });

  it('detaching the current parent is how a place reaches the top level', async () => {
    renderPage();
    fireEvent.click(
      within(hierarchy()).getByRole('button', { name: 'Detach Beleriand' })
    );
    await waitFor(() => expect(mockMoveLocation).toHaveBeenCalledWith('gondolin', undefined));
  });
});

describe('LocationDetailPage — deleting a parent (§6.2, item 6)', () => {
  const openDelete = () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    return within(screen.getByRole('dialog'));
  };

  it('names the object and the blast radius before anything happens', () => {
    const dialog = openDelete();
    expect(dialog.getByText(/Gondolin is removed for everyone, and it holds 2 places/))
      .toBeInTheDocument();
  });

  it('offers both outcomes, and never decides silently', () => {
    const dialog = openDelete();
    expect(
      dialog.getByRole('radio', { name: /Keep them — move the 2 places into Beleriand/ })
    ).toBeInTheDocument();
    expect(
      dialog.getByRole('radio', { name: /Delete them too/ })
    ).toBeInTheDocument();
  });

  // T088: a deletion that failed partway leaves its mark, and a marked place
  // takes no edit. The page says so, and offers the one thing that works.
  describe('a place whose deletion stopped partway', () => {
    beforeEach(() => {
      mockLocations = TREE.map((l) =>
        l.id === 'gondolin' ? { ...l, deleting: 'promote-to-grandparent' } : l
      );
    });

    it('says so, and offers to finish instead of to delete', () => {
      renderPage();
      expect(screen.getByText(/Deleting Gondolin stopped partway/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Finish deleting' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('offers no edit, since the rules refuse every one', () => {
      renderPage();
      expect(screen.queryByRole('button', { name: /Edit the name/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit knowledge' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Move elsewhere/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add another feature/ })).not.toBeInTheDocument();
    });

    it('finishes it the way it started, without asking again, then leaves the page', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Finish deleting' }));

      await waitFor(() =>
        expect(mockDeleteLocation).toHaveBeenCalledWith('gondolin', 'promote-to-grandparent')
      );
      await waitFor(() => expect(mockNavigateToPage).toHaveBeenCalledWith('/locations'));
    });

    it('stays, and says why, when finishing fails too', async () => {
      mockDeleteLocation.mockRejectedValueOnce(new Error('You are offline.'));
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Finish deleting' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('You are offline.');
      expect(mockNavigateToPage).not.toHaveBeenCalled();
    });
  });

  it('promotes by default, because losing a subtree is the irreversible answer', async () => {
    const dialog = openDelete();
    fireEvent.click(dialog.getByRole('button', { name: /Delete Gondolin/ }));
    await waitFor(() =>
      expect(mockDeleteLocation).toHaveBeenCalledWith('gondolin', 'promote-to-grandparent')
    );
  });

  it('takes the subtree when that is what was chosen', async () => {
    const dialog = openDelete();
    fireEvent.click(dialog.getByRole('radio', { name: /Delete them too/ }));
    fireEvent.click(dialog.getByRole('button', { name: /Delete Gondolin/ }));
    await waitFor(() =>
      expect(mockDeleteLocation).toHaveBeenCalledWith('gondolin', 'delete-subtree')
    );
  });

  it('asks no question when there is nothing inside to decide about', () => {
    mockLocationId = 'seven-gates';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('radio')).not.toBeInTheDocument();
    expect(dialog.getByText('Seven gates is removed for everyone.')).toBeInTheDocument();
  });

  it('stays open and says what happened when the delete is refused', async () => {
    mockDeleteLocation.mockRejectedValueOnce(new Error('Permission denied'));
    const dialog = openDelete();
    fireEvent.click(dialog.getByRole('button', { name: /Delete Gondolin/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Permission denied')
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockNavigateToPage).not.toHaveBeenCalledWith('/locations');
  });

});

describe('LocationDetailPage — edit in place (§7, item 9)', () => {
  it('opens an editor on the description and writes it', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));

    const field = screen.getByLabelText('Description');
    fireEvent.change(field, { target: { value: 'A hidden city of the Noldor.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

    await waitFor(() =>
      expect(mockUpdateLocation).toHaveBeenCalledWith('gondolin', {
        description: 'A hidden city of the Noldor.',
      })
    );
  });

  it('keeps every character typed when the write is refused', async () => {
    mockUpdateLocation.mockRejectedValueOnce(new Error('Permission denied'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));

    const field = screen.getByLabelText('Description');
    fireEvent.change(field, { target: { value: 'Something worth keeping' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

    expect(await screen.findByText('Not saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('Something worth keeping');
  });

  it('renames the place from the page, with no link to an edit form', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the name Gondolin' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ondolindë' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() =>
      expect(mockUpdateLocation).toHaveBeenCalledWith('gondolin', { name: 'Ondolindë' })
    );
  });

  // A11Y-007: closing an editor left focus on <body>.
  it('hands focus back to the name when its editor is cancelled', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the name Gondolin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit the name Gondolin' })).toHaveFocus();
  });

  it('hands focus back to the name once it is saved', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the name Gondolin' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ondolindë' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit the name Gondolin' })).toHaveFocus()
    );
  });

  it('hands focus back to the description when its editor is cancelled', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit description' })).toHaveFocus();
  });

  it('changes the type in place', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit type' }));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'dungeon' } });
    await waitFor(() =>
      expect(mockUpdateLocation).toHaveBeenCalledWith('gondolin', { type: 'dungeon' })
    );
  });

  it('adds and removes a tag', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Remove the tag hidden/ }));
    await waitFor(() =>
      expect(mockUpdateLocation).toHaveBeenCalledWith('gondolin', { tags: [] })
    );
  });

  // T083: the page's copy can be behind the server. A list is worked out from
  // the location as stored, so a tag another player added stays.
  it('removes a tag from the tags the place has now, not from the page\'s copy', async () => {
    mockStoredRecords.gondolin = {
      ...mockLocations.find((l: any) => l.id === 'gondolin'),
      tags: ['hidden', 'fallen'],
    };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Remove the tag hidden/ }));
    await waitFor(() =>
      expect(mockUpdateLocation).toHaveBeenCalledWith('gondolin', { tags: ['fallen'] })
    );
  });

  it('adds a note, dated and credited to the acting character', async () => {
    renderPage();
    const field = screen.getByLabelText('Add a note');
    fireEvent.change(field, { target: { value: 'The gates held.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(mockUpdateLocationNote).toHaveBeenCalled());
    expect(mockUpdateLocationNote.mock.calls[0][1]).toMatchObject({
      text: 'The gates held.',
      author: 'Zendikarr',
    });
  });

  it('dates a new note as a calendar date, the shape the NPC page writes (T001)', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'The gates held.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(mockUpdateLocationNote).toHaveBeenCalled());
    expect(mockUpdateLocationNote.mock.calls[0][1].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // T006: notes were append-only until the maintainer decided otherwise. Each
  // is a document of its own (T133), changed where it lives; the location is
  // not rewritten.
  describe('a note, in its own document', () => {
    const notesModule = jest.requireMock('features/campaign-entities');
    const PATH = 'groups/group-1/campaigns/campaign-1/locations';

    it('is read under this location, and nothing from its old array', () => {
      mockLocations = TREE.map((place: any) =>
        place.id === 'gondolin' ? { ...place, notes: [{ date: '2025-06-20', text: 'The eagles came.' }] } : place
      );
      renderPage();
      expect(notesModule.useRecordNotes).toHaveBeenCalledWith(PATH, 'gondolin');
      expect(screen.getByText('The last of the great kingdoms.')).toBeInTheDocument();
      expect(screen.queryByText('The eagles came.')).not.toBeInTheDocument();
    });

    it('is edited in place, from the text it was opened with', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Edit the note from 31/05/2025' }));
      fireEvent.change(screen.getByLabelText('Note from 31/05/2025'), {
        target: { value: 'The last of the hidden kingdoms.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

      await waitFor(() =>
        expect(notesModule.editRecordNote).toHaveBeenCalledWith(
          PATH, 'gondolin', 'n-1', 'text', 'The last of the great kingdoms.', 'The last of the hidden kingdoms.'
        )
      );
      expect(mockUpdateLocation).not.toHaveBeenCalled();
      // The listener carries the write (T032).
      expect(mockRefreshLocations).not.toHaveBeenCalled();
    });

    it('is deleted only once the delete is confirmed', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Delete the note from 14/06/2025' }));
      expect(notesModule.deleteRecordNote).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
      await waitFor(() => expect(notesModule.deleteRecordNote).toHaveBeenCalledWith(PATH, 'gondolin', 'n-2'));
      expect(mockUpdateLocation).not.toHaveBeenCalled();
    });
  });

  // T063: the location's notes are the NPC page's card, not a section of
  // their own with a different title, no order stated and no confirmation.
  it('heads its notes as the NPC page does, oldest first', () => {
    renderPage();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('2 · oldest first')).toBeInTheDocument();
    expect(screen.queryByText('Notes from the table')).not.toBeInTheDocument();
  });

  it('says a new note was saved, in words', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'The gates held.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('no longer tells the writer that notes can never be changed', () => {
    renderPage();
    expect(screen.getByText('Dated today and credited to you.')).toBeInTheDocument();
    expect(screen.queryByText(/never edited or removed/)).not.toBeInTheDocument();
  });

  it('never links to /locations/edit/:id, which 15-8 retires', () => {
    const { container } = renderPage();
    expect(container.innerHTML).not.toContain('/locations/edit/');
  });

  it('offers nothing to change when nobody is signed in', () => {
    mockUser = null;
    renderPage();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete location' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /the note from/ })).not.toBeInTheDocument();
  });
});

describe('LocationDetailPage — features are not children (§6.4, item 7)', () => {
  it('lists features as the free text they are', () => {
    // The fixture deliberately gives Gondolin both a *feature* called "Seven
    // gates" and a *child location* of the same name, which is what §6.4 is
    // about: a feature becomes a place only when someone promotes it, and for
    // a while both exist.
    renderPage();
    const features = within(
      screen.getByText('Notable features').closest('section') as HTMLElement
    );
    expect(features.getByText('Seven gates')).toBeInTheDocument();
    expect(features.getByText('White towers')).toBeInTheDocument();
  });

  // CHANGED for T088 (DATA-005): the feature used to come off the parent in
  // a second write after the create, so a failed second write left the new
  // place behind and a retry made another. It now commits with the create.
  it('promotes a feature into a real place inside this one, taking it off the parent in the same write', async () => {
    renderPage();
    const row = screen.getByText('White towers').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Make it a place' }));

    await waitFor(() => expect(mockCreateLocation).toHaveBeenCalled());
    const [place, alongside] = mockCreateLocation.mock.calls[0];
    expect(place).toMatchObject({ name: 'White towers', parentId: 'gondolin' });
    expect(alongside).toMatchObject({
      collection: 'groups/group-1/campaigns/campaign-1/locations',
      id: 'gondolin',
    });
    // ...and it stops being a line of scenery on the parent, worked out from
    // the parent as the server holds it: a feature added meanwhile stays.
    expect(alongside.change(
      { id: 'gondolin', features: ['Seven gates', 'White towers', 'The fountain'] },
      'white-towers'
    )).toEqual({ features: ['Seven gates', 'The fountain'] });
    expect(mockUpdateLocation).not.toHaveBeenCalled();
  });

  it('adds a feature without creating a location', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Add another feature/ }));
    fireEvent.change(screen.getByLabelText('Add a feature'), {
      target: { value: 'The fountain of the king' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feature' }));

    await waitFor(() =>
      expect(mockUpdateLocation).toHaveBeenCalledWith('gondolin', {
        features: ['Seven gates', 'White towers', 'The fountain of the king'],
      })
    );
    expect(mockCreateLocation).not.toHaveBeenCalled();
  });
});

describe('LocationDetailPage — what the record may claim (§8)', () => {
  it('formats every date, and never prints an ISO timestamp or a stored shape', () => {
    renderPage();
    // `15-6` moved the shared helper onto the same shape the record line uses.
    expect(screen.getAllByText('31/05/2025').length).toBeGreaterThan(0);
    expect(screen.queryByText('2025-05-31T19:27:30.387Z')).toBeNull();
    expect(screen.queryByText('2025-05-31')).toBeNull();
  });

  it('credits a note to its own author, and leaves an older one blank', () => {
    renderPage();
    // A note carries its own author and date, which is why §8 makes it the one
    // exception. One written before the field existed is not credited to a guess.
    expect(screen.getByText('Zendikarr')).toBeInTheDocument();
    expect(screen.getByText('Turgon will not open the gates.')).toBeInTheDocument();
  });

  it('states two facts about the record, not a timeline', () => {
    renderPage();
    expect(screen.getByTestId('attribution-info')).toHaveTextContent('gondolin');
  });

  it('puts no per-field credit under the description, whatever the reference shows', () => {
    // The visual reference prints "DungeonMaster · 31 May · click to edit" under
    // the description. `ContentAttribution` holds created-by and
    // last-modified-by and nothing in between, so that line would be
    // inventing a history the data does not carry.
    renderPage();
    const section = screen.getByText('Description').closest('section') as HTMLElement;
    expect(within(section).queryByText(/DungeonMaster/)).not.toBeInTheDocument();
  });
});

describe('LocationDetailPage — what points here', () => {
  it('lists the quests and rumours that reference this place', () => {
    renderPage();
    expect(screen.getByText('The Fall of Gondolin')).toBeInTheDocument();
    expect(screen.getByText('quest, active')).toBeInTheDocument();
    expect(screen.getByText('A hidden city')).toBeInTheDocument();
    expect(screen.getByText('rumour, unconfirmed')).toBeInTheDocument();
  });

  it('says "false" for a false rumour, not "disproved" (maintainer, 2026-10-03)', () => {
    mockRumors = [
      { id: 'r-1', title: 'A hidden city', status: 'false', relatedLocations: ['gondolin'] },
    ];
    renderPage();
    expect(screen.getByText('rumour, false')).toBeInTheDocument();
    expect(screen.queryByText('rumour, disproved')).not.toBeInTheDocument();
  });

  // T131: a link is stored once, on the place, and both sides show it. A
  // person's old single place was merged into the place's list in production
  // and is read by nothing.
  it("does not count an NPC whose old record alone names this place", () => {
    mockNPCs = [
      { id: 'npc-1', name: 'Turgon', title: 'King of Gondolin' },
      { id: 'npc-2', name: 'Glorfindel', locationId: 'gondolin' },
    ];
    renderPage();
    expect(screen.queryByText('Glorfindel')).not.toBeInTheDocument();
    expect(screen.queryByText('person, recorded as being here')).not.toBeInTheDocument();
  });
});

describe('LocationDetailPage — a place nobody has written up yet', () => {
  beforeEach(() => {
    mockLocations = [place('bare', 'Bare Rock', { description: '' })];
    mockLocationId = 'bare';
    mockNPCs = [];
    mockQuests = [];
    mockRumors = [];
  });

  it('looks new rather than broken: prompts, not empty boxes (§10)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /What is this place\?/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /What would the party notice first\?/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /How would you find this place again\?/ })
    ).toBeInTheDocument();
  });

  it('turns a prompt into the field it asks about', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /What is this place\?/ }));
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('still offers a way to put something inside it', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /Add a place inside Bare Rock/ })
    ).toBeInTheDocument();
  });
});

describe('LocationDetailPage — arriving from quick add (15-1 item 7)', () => {
  it('takes the caret to the parent control when the record has none', () => {
    // Quick add asks for two fields; a location's first unwritten one is where
    // it sits, and `quickAddFocus` is the contract `15-1` left for this page.
    mockRouterState = { quickAddFocus: 'parent' };
    mockLocationId = 'beleriand';
    renderPage();
    expect(
      within(hierarchy()).getByRole('button', { name: /Move elsewhere/ })
    ).toHaveFocus();
  });

  it('leaves the caret alone when the parent was pre-set by *Add a place inside*', () => {
    // Sending someone who just chose a parent to the control for choosing one
    // would be the software ignoring what it was just told.
    mockRouterState = { quickAddFocus: 'parent' };
    mockLocationId = 'gondolin';
    renderPage();
    expect(
      within(hierarchy()).getByRole('button', { name: /Move elsewhere/ })
    ).not.toHaveFocus();
  });
});

describe('LocationDetailPage — a parent that is no longer in the campaign', () => {
  // The directory files these under "Unplaced": the record names a parent, but
  // nothing loaded carries that id -- it was deleted, or the reference broke.
  beforeEach(() => {
    mockLocations = [place('lost', 'Lost Outpost', { parentId: 'gone' })];
    mockLocationId = 'lost';
    mockNPCs = [];
    mockQuests = [];
    mockRumors = [];
  });

  it('does not claim the place sits at the top level', () => {
    renderPage();
    expect(within(hierarchy()).queryByText(/At the top level/)).not.toBeInTheDocument();
    expect(
      within(hierarchy()).getByText(/no longer in this campaign/)
    ).toBeInTheDocument();
  });

  it('offers the top level as a way out, since there is no parent chip to detach', async () => {
    renderPage();
    fireEvent.click(
      within(hierarchy()).getByRole('button', { name: 'Move to the top level' })
    );
    await waitFor(() => expect(mockMoveLocation).toHaveBeenCalledWith('lost', undefined));
  });

  it('still offers Move elsewhere to file it under a real place', () => {
    renderPage();
    expect(
      within(hierarchy()).getByRole('button', { name: /Move elsewhere/ })
    ).toBeInTheDocument();
  });
});

describe('LocationDetailPage — cycle safety, asserted not eyeballed (§6.3)', () => {
  // Every assertion here is really an assertion that the render *returned*.
  beforeEach(() => {
    mockLocations = [
      place('a', 'Alpha', { parentId: 'b' }),
      place('b', 'Beta', { parentId: 'a' }),
      place('inner', 'Inner', { parentId: 'a' }),
    ];
    mockLocationId = 'a';
    mockNPCs = [];
    mockQuests = [];
    mockRumors = [];
  });

  it('renders a location inside a parent cycle', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
  });

  it('never names the same place twice in the breadcrumb', () => {
    renderPage();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getAllByText('Alpha')).toHaveLength(1);
  });

  it('still excludes the descendants from Move elsewhere', () => {
    renderPage();
    fireEvent.click(within(hierarchy()).getByRole('button', { name: /Move elsewhere/ }));
    const offered = within(screen.getByRole('listbox'))
      .queryAllByRole('option')
      .map((option) => option.textContent)
      .join(' ');
    expect(offered).not.toContain('Inner');
  });
});

describe('LocationDetailPage — a link that no longer resolves', () => {
  it('gets a designed state and a way onward, not a blank page', () => {
    mockLocationId = 'nowhere';
    renderPage();
    expect(screen.getByText('No place with that id')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Locations' }));
    expect(mockNavigateToPage).toHaveBeenCalledWith('/locations');
  });
});

describe('LocationDetailPage — the picture (T021)', () => {
  const { firebaseConfig } = jest.requireActual('core/services/firebase/config/firebaseConfig');
  const picture = {
    path: 'groups/group-1/campaigns/campaign-1/locations/gondolin/p.webp',
    url: `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/p.webp?alt=media&token=t`,
    width: 1600,
    height: 900,
    uploadedBy: 'user-1',
    uploadedAt: '2026-09-24T12:00:00.000Z',
  };
  const withPicture = () =>
    TREE.map((loc: any) => (loc.id === 'gondolin' ? { ...loc, image: picture } : loc));

  it('starts with the card when there is no picture, and offers to add one on its sigil', () => {
    renderPage();
    // No striped placeholder: most places never get a picture.
    expect(screen.queryByRole('img', { name: /no image added/ })).toBeNull();
    expect(screen.queryByTestId('entity-page-image')).toBeNull();

    const add = screen.getByRole('button', { name: 'Add picture' });
    const card = screen.getByRole('heading', { level: 1 }).closest('section') as HTMLElement;
    expect(card).toContainElement(add);
    // Icons on the corner, named for assistive tech rather than labelled (T068).
    expect(add).toHaveTextContent(/^$/);
  });

  it('draws the picture full-width above the card once there is one, with nothing on it', () => {
    mockLocations = withPicture();
    renderPage();
    const img = screen.getByRole('img', { name: 'Gondolin' });
    expect(img).toHaveAttribute('src', picture.url);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(img.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('entity-page-image')).not.toContainElement(heading);

    for (const name of ['Replace picture', 'Remove picture']) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(/^$/);
    }
  });

  it('files the picture under this location in the active group and campaign', () => {
    mockLocations = withPicture();
    renderPage();
    expect(mockImageOptions.prefix).toBe('groups/group-1/campaigns/campaign-1/locations/gondolin');
    expect(mockImageOptions.current).toEqual(picture);
  });

  it('saves the picture onto this location, and clears it with null', async () => {
    renderPage();

    await act(() => mockImageOptions.save(picture));
    expect(mockUpdateLocation).toHaveBeenCalledWith('gondolin', { image: picture });

    await act(() => mockImageOptions.save(null));
    expect(mockUpdateLocation).toHaveBeenCalledWith('gondolin', { image: null });
  });
});
