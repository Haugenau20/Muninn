// src/pages/quests/__tests__/QuestDetailPage.test.tsx
//
// `/quests/:questId` — the address a quest never had.
//
// The gates this suite stands for: the page
// renders and is linkable; **no id is rendered as a label**; **no NPC appears
// twice**; objectives are tickable *and* authorable with one contract, and a
// rejected write reverts visibly; **completing the last objective does not
// silently complete the quest**; every field editable in place; a quest with a
// title and description only looks **new, not broken**; and delete lives here,
// naming what else loses a link.

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuestDetailPage from '../QuestDetailPage';
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
let mockQuestId: string | undefined = 'reclaim-erebor';
let mockRouterState: any = null;

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ questId: mockQuestId }),
  useLocation: () => ({ pathname: '/quests', state: mockRouterState }),
}));

// ---------------------------------------------------------------------------
// The gate (see the location page's suite for the same shape)
// ---------------------------------------------------------------------------
let mockUser: { uid: string } | null = { uid: 'user-1' };
let mockActiveGroupId: string | null = 'group-1';
let mockActiveCampaignId: string | null = 'campaign-1';

jest.mock('features/user-management', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
  useGroups: () => ({
    activeGroupId: mockActiveGroupId,
    groups: [{ id: 'group-1', name: 'The Company' }],
    setActiveGroup: jest.fn().mockResolvedValue(undefined),
  }),
  useCampaigns: () => ({
    activeCampaignId: mockActiveCampaignId,
    activeCampaign: mockActiveCampaignId
      ? { id: mockActiveCampaignId, name: 'Wilderland' }
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
const QUEST = {
  id: 'reclaim-erebor',
  title: 'Reclaim Erebor',
  description: 'Find the secret door into the Lonely Mountain and reclaim the dwarven kingdom.',
  status: 'active' as const,
  background: 'The company has reached the Lonely Mountain.',
  objectives: [
    { id: 'obj-1', description: 'Find the secret door', completed: true },
    { id: 'obj-2', description: 'Enter the mountain undetected', completed: false },
    { id: 'obj-3', description: "Scout the dragon's hoard", completed: false },
  ],
  leads: ['The door can only be opened on Durin’s Day'],
  complications: ["Thorin's growing obsession with the Arkenstone"],
  rewards: ['Access to Erebor'],
  keyLocations: [{ name: 'Secret door', description: 'Hidden entrance on the western side' }],
  // The reference draws both Thorin and Smaug here, and drew them twice: once
  // from this list and once from `importantNPCs`, which `15-5` deletes.
  relatedNPCIds: ['thorin', 'smaug'],
  locationId: 'erebor',
  levelRange: '7-9',
  createdByUsername: 'DungeonMaster',
  dateAdded: '2025-05-31T19:27:30.387Z',
};

/**
 * The quest's notes, as their documents (T163). Not in date order, so a page
 * that shows them as stored would put them the wrong way round.
 */
const QUEST_NOTES = [
  { noteId: 'n-may', date: '2025-05-31', text: 'Found the keyhole at last.', author: 'Zendikarr' },
  { noteId: 'n-april', date: '2025-04-02', text: 'Thorin will not wait for Durin’s Day.' },
];
let mockQuestNotes: any[] | undefined = QUEST_NOTES;

/** A quest made through quick add: a title, a line, and nothing else. */
const NEW_QUEST = {
  id: 'new-quest',
  title: 'A new errand',
  description: 'Somebody asked for something.',
  status: 'active' as const,
  objectives: [],
  createdByUsername: 'DungeonMaster',
  dateAdded: '2025-06-01T00:00:00.000Z',
};

let mockQuests: any[] = [QUEST];
let mockNPCs: any[] = [
  { id: 'thorin', name: 'Thorin Oakenshield', occupation: 'King under the Mountain' },
  { id: 'smaug', name: 'Smaug', occupation: 'The Terrible' },
];
// The place lists its people (T131).
let mockLocations: any[] = [
  { id: 'erebor', name: 'Erebor', type: 'landmark', status: 'known', connectedNPCs: ['thorin', 'smaug'] },
];
let mockRumors: any[] = [
  { id: 'r-1', title: "Signs of Smaug's activity", status: 'confirmed', convertedToQuestId: 'reclaim-erebor' },
];
let mockNotes: any[] = [
  {
    id: 'note-14',
    title: 'Session 14 notes',
    extractedEntities: [
      { id: 'e-1', type: 'quest', convertedToId: 'reclaim-erebor', text: 'Reclaim Erebor' },
    ],
  },
];

const mockUpdateQuest = jest.fn().mockResolvedValue(undefined);
// T131: unlinking a person also clears the old half on their record, and a
// place's or rumour's side of a link is written through these.
const mockUpdateNPC = jest.fn().mockResolvedValue(undefined);
const mockUpdateLocation = jest.fn().mockResolvedValue(undefined);
const mockUpdateRumor = jest.fn().mockResolvedValue(undefined);
const mockUpdateQuestStatus = jest.fn().mockResolvedValue(undefined);
const mockUpdateQuestObjective = jest.fn().mockResolvedValue(undefined);
const mockAddQuestObjective = jest.fn().mockResolvedValue(undefined);
const mockEditQuestObjective = jest.fn().mockResolvedValue(undefined);
const mockMoveQuestObjective = jest.fn().mockResolvedValue(undefined);
const mockMarkQuestCompleted = jest.fn().mockResolvedValue(undefined);
const mockAddQuestNote = jest.fn().mockResolvedValue(undefined);
const mockDeleteQuest = jest.fn().mockResolvedValue(undefined);
const mockRefreshQuests = jest.fn().mockResolvedValue(undefined);
const mockCreateLocation = jest.fn().mockResolvedValue('secret-door');

jest.mock('features/campaign-entities', () => {
  const actualPresentation = jest.requireActual(
    'features/campaign-entities/quests/utils/quest-presentation'
  );
  const actualDisplay = jest.requireActual(
    'features/campaign-entities/locations/utils/location-display'
  );
  return {
    useQuests: () => ({
      quests: mockQuests,
      isLoading: false,
      error: null,
      refreshQuests: mockRefreshQuests,
      updateQuest: (id: string, change: any) =>
        mockUpdateQuest(
          id,
          mockResolveChange(change, mockStoredRecords[id] ?? mockQuests.find((q) => q.id === id))
        ),
      updateQuestStatus: mockUpdateQuestStatus,
      updateQuestObjective: mockUpdateQuestObjective,
      addQuestObjective: mockAddQuestObjective,
      editQuestObjective: mockEditQuestObjective,
      moveQuestObjective: mockMoveQuestObjective,
      markQuestCompleted: mockMarkQuestCompleted,
      addQuestNote: mockAddQuestNote,
      deleteQuest: mockDeleteQuest,
    }),
    useNPCs: () => ({
      npcs: mockNPCs,
      updateNPC: (id: string, change: any) =>
        mockUpdateNPC(id, mockResolveChange(change, mockStoredRecords[id] ?? mockNPCs.find((n: any) => n.id === id))),
    }),
    useLocations: () => ({
      locations: mockLocations,
      createLocation: mockCreateLocation,
      updateLocation: (id: string, change: any) =>
        mockUpdateLocation(id, mockResolveChange(change, mockStoredRecords[id] ?? mockLocations.find((l: any) => l.id === id))),
    }),
    useRumors: () => ({ rumors: mockRumors, updateRumor: mockUpdateRumor }),
    // The real link modules (T131): which field owns each link is the contract.
    ...jest.requireActual('features/campaign-entities/shared/links'),
    createLinkActions: jest.requireActual('features/campaign-entities/shared/linkActions').createLinkActions,

    // The real helper: a rumour is named the way its own list names it.
    rumorTitleText: jest.requireActual('shared/utils/rumor-name').rumorTitleText,
    // The real modules, not stubs: the page's contract is that the row and the
    // page say the same things about a quest.
    ...actualPresentation,
    ...actualDisplay,
    QuestObjectives: jest.requireActual(
      'features/campaign-entities/quests/components/QuestObjectives'
    ).default,
    DeleteQuestDialog: jest.requireActual(
      'features/campaign-entities/quests/components/DeleteQuestDialog'
    ).default,
    // A quest's notes are documents of their own (T163); see the mock.
    ...require('@/test-utils/record-notes-mock').recordNotesMock(),
    useRecordNotes: jest.fn((_path: string, id?: string) =>
      id === 'reclaim-erebor' ? mockQuestNotes : undefined
    ),
  };
});

jest.mock('features/collaboration', () => ({
  useNotes: () => ({ notes: mockNotes }),
  displayTitle: jest.requireActual('features/collaboration/notes/utils/note-title').displayTitle,
}));

const mockNavigateToPage = jest.fn();
jest.mock('shared/context/NavigationContext', () => ({
  useNavigation: () => ({ navigateToPage: mockNavigateToPage }),
}));

jest.mock('shared/context/QuickAddContext', () => ({
  useQuickAdd: () => ({ openQuickAdd: jest.fn(), closeQuickAdd: jest.fn(), openEntity: null }),
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
        get: (target: any, prop: string) => (prop in target ? target[prop] : () => null),
      }
    )
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const renderPage = () =>
  render(
    <MemoryRouter>
      <QuestDetailPage />
    </MemoryRouter>
  );

/** The card with this heading. */
const section = (title: string) =>
  screen.getByText(title).closest('section') as HTMLElement;

beforeEach(() => {
  mockStoredRecords = {};
  jest.clearAllMocks();
  mockQuestId = 'reclaim-erebor';
  mockRouterState = null;
  mockQuests = [QUEST];
  mockQuestNotes = QUEST_NOTES;
  mockUser = { uid: 'user-1' };
  mockActiveGroupId = 'group-1';
  mockActiveCampaignId = 'campaign-1';
  mockUpdateQuest.mockResolvedValue(undefined);
  mockUpdateQuestObjective.mockResolvedValue(undefined);
  mockAddQuestObjective.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// The record, named
// ---------------------------------------------------------------------------
// T063: the dark band became the NPC page's light identity card. What the
// band's one meta line said is now the card's line and its facts.
describe('the identity card', () => {
  it('names the quest as the page’s only h1', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Reclaim Erebor' })
    ).toBeInTheDocument();
  });

  it('leads back to the directory', () => {
    renderPage();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('Quests')).toHaveAttribute('href', '/quests');
  });

  it('states place, progress and level, with no id in it', () => {
    // Item 10: the quest card printed `bag-end` and `erebor` as though they
    // were labels. `erebor` resolves to "Erebor" or it is left out.
    renderPage();
    const card = screen
      .getByRole('heading', { level: 1, name: 'Reclaim Erebor' })
      .closest('section') as HTMLElement;
    expect(within(card).getByText('At Erebor')).toBeInTheDocument();
    expect(within(card).getByRole('group', { name: 'Objectives' })).toHaveTextContent('1 of 3 done');
    expect(within(card).getByRole('button', { name: 'Edit level range' })).toHaveTextContent('7-9');
    expect(within(card).queryByText(/reclaim-erebor/)).not.toBeInTheDocument();
  });

  it('shows an unresolvable reference as broken rather than as a place name', () => {
    // #1412 says a dangling reference stays visible as itself; this PR's gate
    // says no id is rendered as a label. Both: it is shown, and it is marked.
    mockQuests = [{ ...QUEST, locationId: 'nowhere', location: '' }];
    renderPage();
    expect(screen.getByText('At nowhere — no such place')).toBeInTheDocument();
  });

  it('changes the status from its fact, on a ladder of buttons', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Edit status' })).toHaveTextContent('Active');
    fireEvent.click(screen.getByRole('button', { name: 'Edit status' }));
    const ladder = screen.getByRole('group', { name: 'Status of Reclaim Erebor' });
    fireEvent.click(within(ladder).getByRole('button', { name: 'Failed' }));
    await waitFor(() =>
      expect(mockUpdateQuestStatus).toHaveBeenCalledWith('reclaim-erebor', 'failed')
    );
  });

  it('offers Mark completed while the quest is open, and not once it is settled', () => {
    const { unmount } = renderPage();
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
    unmount();

    mockQuests = [{ ...QUEST, status: 'completed' }];
    renderPage();
    expect(screen.queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Objectives — the spine
// ---------------------------------------------------------------------------
describe('objectives', () => {
  it('ticks an objective through the same write the row uses', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enter the mountain undetected' }));
    await waitFor(() =>
      expect(mockUpdateQuestObjective).toHaveBeenCalledWith('reclaim-erebor', 'obj-2', true)
    );
  });

  it('reverts visibly and says why when the tick is refused', async () => {
    mockUpdateQuestObjective.mockRejectedValueOnce(new Error('Permission denied'));
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enter the mountain undetected' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Permission denied')
    );
    expect(
      screen.getByRole('checkbox', { name: 'Enter the mountain undetected' })
    ).not.toBeChecked();
  });

  it('keeps a ticked objective struck through and in its place', () => {
    renderPage();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toBeChecked();
    expect(boxes[0]).toHaveAccessibleName('Find the secret door');
  });

  it('adds an objective to the end of the list', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add objective' }));
    fireEvent.change(screen.getByLabelText('Add an objective'), {
      target: { value: 'Recover the Arkenstone' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add objective', hidden: false }));

    await waitFor(() =>
      expect(mockAddQuestObjective).toHaveBeenCalledWith('reclaim-erebor', 'Recover the Arkenstone')
    );
  });

  it('rewords an objective in place', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Reword Find the secret door' }));
    fireEvent.change(screen.getByLabelText('Objective'), {
      target: { value: 'Find the secret door mentioned in the map' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save objective' }));

    await waitFor(() =>
      expect(mockEditQuestObjective).toHaveBeenCalledWith(
        'reclaim-erebor',
        'obj-1',
        'Find the secret door mentioned in the map',
        // The wording the editor opened with, for the conflict check (T083).
        'Find the secret door'
      )
    );
  });

  it('moves one objective up or down, naming which', async () => {
    renderPage();
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Enter the mountain undetected up' })
    );
    await waitFor(() =>
      expect(mockMoveQuestObjective).toHaveBeenCalledWith('reclaim-erebor', 'obj-2', 'up')
    );
  });

  it('cannot move the first objective up or the last one down', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Move Find the secret door up' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: "Move Scout the dragon's hoard down" })
    ).toBeDisabled();
  });

  it('offers completion when every objective is ticked, and does not take it', () => {
    // The gate: completing the last objective does not silently complete the
    // quest. The question appears; the status has not moved.
    mockQuests = [
      { ...QUEST, objectives: QUEST.objectives.map((o) => ({ ...o, completed: true })) },
    ];
    renderPage();

    expect(screen.getByText('Every objective is ticked. Is the quest finished?')).toBeInTheDocument();
    expect(mockUpdateQuestStatus).not.toHaveBeenCalled();
    expect(mockMarkQuestCompleted).not.toHaveBeenCalled();
  });

  it('completes the quest only when the offer is accepted', async () => {
    mockQuests = [
      { ...QUEST, objectives: QUEST.objectives.map((o) => ({ ...o, completed: true })) },
    ];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Mark the quest completed' }));
    await waitFor(() => expect(mockMarkQuestCompleted).toHaveBeenCalledWith('reclaim-erebor'));
  });

  it('does not keep asking once the quest has concluded', () => {
    mockQuests = [
      {
        ...QUEST,
        status: 'completed',
        objectives: QUEST.objectives.map((o) => ({ ...o, completed: true })),
      },
    ];
    renderPage();
    expect(
      screen.queryByText('Every objective is ticked. Is the quest finished?')
    ).not.toBeInTheDocument();
  });

  it('does not offer completion for a quest that has no objectives at all', () => {
    mockQuests = [NEW_QUEST];
    mockQuestId = 'new-quest';
    renderPage();
    expect(
      screen.queryByText('Every objective is ticked. Is the quest finished?')
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// One relation list (D15.7)
// ---------------------------------------------------------------------------
describe('who is in it', () => {
  it('names each person once, with the line that tells two of them apart', () => {
    renderPage();
    const who = section('Who is in it');
    expect(within(who).getAllByText('Thorin Oakenshield')).toHaveLength(1);
    expect(within(who).getByText('King under the Mountain · Erebor')).toBeInTheDocument();
    expect(within(who).getAllByText('Smaug')).toHaveLength(1);
  });

  it('opens a person’s own page', () => {
    renderPage();
    fireEvent.click(within(section('Who is in it')).getByText('Thorin Oakenshield'));
    expect(mockNavigateToPage).toHaveBeenCalledWith('/npcs/thorin');
  });

  it('says so when a reference no longer resolves, instead of printing the id', () => {
    mockQuests = [{ ...QUEST, relatedNPCIds: ['thorin', 'gone'] }];
    renderPage();
    const who = section('Who is in it');
    expect(within(who).getByText('Someone no longer in the directory')).toBeInTheDocument();
    expect(within(who).queryByText('gone')).not.toBeInTheDocument();
  });

  it('detaches a person from the quest', async () => {
    renderPage();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Smaug from Reclaim Erebor' })
    );
    await waitFor(() =>
      expect(mockUpdateQuest).toHaveBeenCalledWith(
        'reclaim-erebor',
        expect.objectContaining({ relatedNPCIds: ['thorin'] })
      )
    );
  });
});

// ---------------------------------------------------------------------------
// What points here — derived, read-only
// ---------------------------------------------------------------------------
describe('what points here', () => {
  it('lists the rumour it came from and the note that mentions it', () => {
    renderPage();
    const points = section('What points here');
    expect(within(points).getByText("Signs of Smaug's activity")).toBeInTheDocument();
    expect(within(points).getByText('Session 14 notes')).toBeInTheDocument();
  });

  // T131: a place's old quest list is read by nothing; the quest names its
  // places itself.
  it("does not list a place whose old quest list names it", () => {
    const saved = mockLocations;
    mockLocations = [{ ...saved[0], relatedQuests: ['reclaim-erebor'] }];
    try {
      renderPage();
      expect(within(section('What points here')).queryByText('Erebor')).not.toBeInTheDocument();
    } finally {
      mockLocations = saved;
    }
  });

  it('says "false" for a false rumour, not "disproved" (maintainer, 2026-10-03)', () => {
    mockRumors = [{ ...mockRumors[0], status: 'false' }];
    renderPage();
    expect(
      within(section('What points here')).getByText(/rumour, false/)
    ).toBeInTheDocument();
    mockRumors = [
      { id: 'r-1', title: "Signs of Smaug's activity", status: 'confirmed', convertedToQuestId: 'reclaim-erebor' },
    ];
  });

  it('names an untitled rumour and note by their content, as their own lists do (DUP-001)', () => {
    const savedRumors = mockRumors;
    const savedNotes = mockNotes;
    mockRumors = [
      { ...savedRumors[0], title: '', content: 'Ravens gather at the Mountain' },
    ];
    mockNotes = [
      { ...savedNotes[0], title: 'New Note', content: 'The thrush knocked at the grey stone' },
    ];
    try {
      renderPage();
      const points = section('What points here');
      expect(within(points).getByText('Ravens gather at the Mountain')).toBeInTheDocument();
      expect(within(points).getByText('The thrush knocked at the grey stone')).toBeInTheDocument();
    } finally {
      mockRumors = savedRumors;
      mockNotes = savedNotes;
    }
  });

  it('offers nothing editable — these belong to the records that wrote them', () => {
    renderPage();
    const points = section('What points here');
    expect(within(points).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(points).getByText(/Derived, not authored/)).toBeInTheDocument();
  });

  it('never claims a note points here just because the title appears in it', () => {
    mockNotes = [
      { id: 'note-99', title: 'Reclaim Erebor thoughts', extractedEntities: [] },
    ];
    renderPage();
    expect(
      within(section('What points here')).queryByText('Reclaim Erebor thoughts')
    ).not.toBeInTheDocument();
    mockNotes = [
      {
        id: 'note-14',
        title: 'Session 14 notes',
        extractedEntities: [
          { id: 'e-1', type: 'quest', convertedToId: 'reclaim-erebor', text: 'Reclaim Erebor' },
        ],
      },
    ];
  });
});

// ---------------------------------------------------------------------------
// Prep, in full and not behind a reveal
// ---------------------------------------------------------------------------
describe('the prep material', () => {
  it('shows background, leads, complications, rewards and the level range on the page', () => {
    renderPage();
    expect(screen.getByText('The company has reached the Lonely Mountain.')).toBeInTheDocument();
    expect(screen.getByText('The door can only be opened on Durin’s Day')).toBeInTheDocument();
    expect(screen.getByText("Thorin's growing obsession with the Arkenstone")).toBeInTheDocument();
    expect(screen.getByText('Access to Erebor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit level range' })).toHaveTextContent('7-9');
  });

  it('hides none of it behind a disclosure', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /^Prep/ })).not.toBeInTheDocument();
  });

  it('adds a lead in place', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Add another lead/ }));
    fireEvent.change(screen.getByLabelText('Leads'), { target: { value: 'Ask Balin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to leads' }));

    await waitFor(() =>
      expect(mockUpdateQuest).toHaveBeenCalledWith(
        'reclaim-erebor',
        expect.objectContaining({
          leads: ['The door can only be opened on Durin’s Day', 'Ask Balin'],
        })
      )
    );
  });

  // T083: the page's copy can be behind the server. A list is worked out from
  // the quest as stored, so a lead another player added stays.
  it('adds a lead to the leads the quest has now, not to the page\'s copy', async () => {
    mockStoredRecords['reclaim-erebor'] = {
      ...QUEST,
      leads: ['The door can only be opened on Durin’s Day', 'Find the key'],
    };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Add another lead/ }));
    fireEvent.change(screen.getByLabelText('Leads'), { target: { value: 'Ask Balin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to leads' }));

    await waitFor(() =>
      expect(mockUpdateQuest).toHaveBeenCalledWith('reclaim-erebor', {
        leads: ['The door can only be opened on Durin’s Day', 'Find the key', 'Ask Balin'],
      })
    );
  });

  it('keeps the typed text when a write is refused, and says why', async () => {
    mockUpdateQuest.mockRejectedValueOnce(new Error('Permission denied'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Add another lead/ }));
    fireEvent.change(screen.getByLabelText('Leads'), { target: { value: 'Ask Balin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to leads' }));

    await waitFor(() => expect(screen.getByText(/Permission denied/)).toBeInTheDocument());
    expect(screen.getByLabelText('Leads')).toHaveValue('Ask Balin');
  });
});

// ---------------------------------------------------------------------------
// Places inside this quest stay free text (§6.4)
// ---------------------------------------------------------------------------
describe('places inside this quest', () => {
  it('lists them as prep notes, not as records', () => {
    renderPage();
    const places = section('Places inside this quest');
    expect(within(places).getByText('Secret door')).toBeInTheDocument();
    expect(within(places).getByText('Hidden entrance on the western side')).toBeInTheDocument();
  });

  it('promotes one into a real location, inside the quest’s own location', async () => {
    renderPage();
    fireEvent.click(
      within(section('Places inside this quest')).getByRole('button', {
        name: 'Make it a location',
      })
    );

    await waitFor(() =>
      expect(mockCreateLocation).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Secret door',
          parentId: 'erebor',
        }),
        expect.anything()
      )
    );
    // T131: the quest owns the link, through the place it keeps.
    expect(mockCreateLocation.mock.calls[0][0]).not.toHaveProperty('relatedQuests');
    await waitFor(() => expect(mockNavigateToPage).toHaveBeenCalledWith('/locations/secret-door'));
  });

  // T088 (DATA-005): the place changes in the same commit as the location is
  // created, so a failed second write cannot leave the location behind with
  // the place still offering to be promoted again. T131: it stays on the
  // quest, now pointing at the location it became -- the quest owns the link,
  // so both pages show it.
  it('points the place at the new location in the same write as the location', async () => {
    renderPage();
    fireEvent.click(
      within(section('Places inside this quest')).getByRole('button', {
        name: 'Make it a location',
      })
    );

    await waitFor(() => expect(mockCreateLocation).toHaveBeenCalled());
    const [, alongside] = mockCreateLocation.mock.calls[0];
    expect(alongside).toMatchObject({
      collection: 'groups/group-1/campaigns/campaign-1/quests',
      id: 'reclaim-erebor',
    });
    expect(alongside.change(
      {
        id: 'reclaim-erebor',
        keyLocations: [{ name: 'Secret door' }, { name: 'Added meanwhile' }],
      },
      'secret-door'
    )).toEqual({
      keyLocations: [{ name: 'Secret door', locationId: 'secret-door' }, { name: 'Added meanwhile' }],
    });
    expect(mockUpdateQuest).not.toHaveBeenCalled();
  });

  // #1421: a quest written before places were prep notes can list a whole
  // location as a place. Promoting it would make a second Erebor.
  describe('a place that is already a location', () => {
    const withPlaces = (keyLocations: any[]) => {
      mockQuests = [{ ...QUEST, keyLocations }];
    };

    it('links to that location instead of offering to make one', () => {
      withPlaces([
        { name: 'erebor', description: 'The Lonely Mountain' },
        { name: 'Secret door', description: '' },
      ]);
      renderPage();
      const places = section('Places inside this quest');

      fireEvent.click(within(places).getByRole('button', { name: /^Erebor/ }));
      expect(mockNavigateToPage).toHaveBeenCalledWith('/locations/erebor');
      expect(within(places).getByText('The Lonely Mountain')).toBeInTheDocument();
      // Only the secret door can still be promoted.
      expect(within(places).getAllByRole('button', { name: 'Make it a location' })).toHaveLength(1);
    });

    it('shows the location under its current name when the place holds its id', () => {
      withPlaces([{ name: 'The Lonely Mountain', description: '', locationId: 'erebor' }]);
      renderPage();
      const places = section('Places inside this quest');

      expect(within(places).getByRole('button', { name: /^Erebor/ })).toBeInTheDocument();
      expect(within(places).queryByText('The Lonely Mountain')).not.toBeInTheDocument();
    });

    it('can still be taken off the quest', async () => {
      withPlaces([{ name: 'Erebor', description: '', locationId: 'erebor' }]);
      renderPage();
      fireEvent.click(
        within(section('Places inside this quest')).getByRole('button', { name: 'Remove Erebor' })
      );

      await waitFor(() =>
        expect(mockUpdateQuest).toHaveBeenCalledWith('reclaim-erebor', { keyLocations: [] })
      );
    });

    it('stores the location’s id when a place added names one', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Add another place' }));
      fireEvent.change(screen.getByLabelText('Add a place'), { target: { value: 'erebor' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add place' }));

      await waitFor(() =>
        expect(mockUpdateQuest).toHaveBeenCalledWith('reclaim-erebor', {
          keyLocations: [
            { name: 'Secret door', description: 'Hidden entrance on the western side' },
            { name: 'erebor', description: '', locationId: 'erebor' },
          ],
        })
      );
    });

    it('stores no id for a place that names no location', async () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Add another place' }));
      fireEvent.change(screen.getByLabelText('Add a place'), { target: { value: 'Hidden lake' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add place' }));

      await waitFor(() =>
        expect(mockUpdateQuest).toHaveBeenCalledWith('reclaim-erebor', {
          keyLocations: [
            { name: 'Secret door', description: 'Hidden entrance on the western side' },
            { name: 'Hidden lake', description: '' },
          ],
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// The field `15-8` would otherwise have stranded
// ---------------------------------------------------------------------------
describe('where the quest happens', () => {
  it('attaches the quest to a place, which only the deleted form could do', () => {
    // `QuestFormSections` carried the single-location tray that wrote
    // `locationId`. Deleting the form in `15-8` left the field readable -- it
    // is in the line under the title -- and unwritable.
    mockQuests = [{ ...QUEST, locationId: '', location: '' }];
    renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: /Attach to where Reclaim Erebor happens/ })
    );
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Erebor'));

    return waitFor(() =>
      expect(mockUpdateQuest).toHaveBeenCalledWith(
        'reclaim-erebor',
        expect.objectContaining({ locationId: 'erebor', location: 'Erebor' })
      )
    );
  });

  it('replaces the place rather than collecting several', async () => {
    renderPage();
    const tray = screen.getByRole('button', { name: /Attach to where Reclaim Erebor happens/ });
    expect(tray).toBeInTheDocument();
    // One relation: the tray is single-valued, so the attached place is
    // already marked rather than offered again.
    fireEvent.click(tray);
    const attached = within(screen.getByRole('listbox'))
      .getByText('Erebor')
      .closest('[role="option"]');
    expect(attached).toHaveAttribute('aria-selected', 'true');
  });
});

// ---------------------------------------------------------------------------
// Editing in place (§7)
// ---------------------------------------------------------------------------
describe('editing in place', () => {
  it('renames the quest', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the title Reclaim Erebor' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Retake Erebor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));

    await waitFor(() =>
      expect(mockUpdateQuest).toHaveBeenCalledWith(
        'reclaim-erebor',
        expect.objectContaining({ title: 'Retake Erebor' })
      )
    );
  });

  // A11Y-007: closing an editor left focus on <body>.
  it('hands focus back to the title when its editor is cancelled', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the title Reclaim Erebor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit the title Reclaim Erebor' })).toHaveFocus();
  });

  it('hands focus back to the description when its editor is cancelled', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit what the party was asked to do' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Edit what the party was asked to do' })
    ).toHaveFocus();
  });

  it('edits the description where it is read', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit what the party was asked to do' }));
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Take back the mountain.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

    await waitFor(() =>
      expect(mockUpdateQuest).toHaveBeenCalledWith(
        'reclaim-erebor',
        expect.objectContaining({ description: 'Take back the mountain.' })
      )
    );
  });

  it('retracts a background that proved wrong (T094)', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit background' }));
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save background' }));

    await waitFor(() =>
      expect(mockUpdateQuest).toHaveBeenCalledWith(
        'reclaim-erebor',
        expect.objectContaining({ background: '' })
      )
    );
  });

  it('retracts a level range (T094)', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit level range' }));
    fireEvent.change(screen.getByLabelText('Level range'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save level range' }));

    await waitFor(() =>
      expect(mockUpdateQuest).toHaveBeenCalledWith(
        'reclaim-erebor',
        expect.objectContaining({ levelRange: '' })
      )
    );
  });

  it('still refuses an empty title', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the title Reclaim Erebor' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save title' })).toBeDisabled();
  });

  it('offers no link to the edit form', () => {
    // §7: this is where a quest is changed. `/quests/edit/:id` is `15-8`'s to
    // retire; nothing here sends anyone to it.
    renderPage();
    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument();
    expect(mockNavigateToPage).not.toHaveBeenCalledWith('/quests/edit/reclaim-erebor');
  });
});

// ---------------------------------------------------------------------------
// A quest with nothing written looks new, not broken
// ---------------------------------------------------------------------------
describe('a quest that is only a title and a line', () => {
  beforeEach(() => {
    mockQuests = [NEW_QUEST];
    mockQuestId = 'new-quest';
  });

  it('asks questions rather than showing empty boxes', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /What did the party agree to do\?/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /How did this come about\?/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Where does the party start looking\?/ })
    ).toBeInTheDocument();
  });

  it('opens the objective composer when quick add says that is the first unwritten field', () => {
    mockRouterState = { quickAddFocus: 'objectives' };
    renderPage();
    expect(screen.getByLabelText('Add an objective')).toBeInTheDocument();
  });

  it('does not hijack the page when the record already has objectives', () => {
    mockQuests = [QUEST];
    mockQuestId = 'reclaim-erebor';
    mockRouterState = { quickAddFocus: 'objectives' };
    renderPage();
    expect(screen.queryByLabelText('Add an objective')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The record, and deleting it
// ---------------------------------------------------------------------------
describe('the record card', () => {
  it('states created-by and last-modified-by, and no per-objective history', () => {
    renderPage();
    const record = section('Record');
    expect(within(record).getByTestId('attribution-info')).toBeInTheDocument();
    // `S3` draws "gandlaf ticked 'Find the secret door' · last session" under
    // the two attribution lines. There is no such data (§8), so the
    // record card holds the two facts and nothing else.
    expect(within(record).queryByText(/ticked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/last session/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gandlaf ticked/)).not.toBeInTheDocument();
  });

  it('names what else loses a link before deleting', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const losses = within(screen.getByRole('dialog')).getByRole('list');
    expect(within(losses).getByText(/Signs of Smaug's activity/)).toBeInTheDocument();
    expect(within(losses).getByText(/2 people are attached to it/)).toBeInTheDocument();
    expect(mockDeleteQuest).not.toHaveBeenCalled();
  });

  it('deletes and returns to the directory once confirmed', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Reclaim Erebor' }));

    await waitFor(() => expect(mockDeleteQuest).toHaveBeenCalledWith('reclaim-erebor'));
    await waitFor(() => expect(mockNavigateToPage).toHaveBeenCalledWith('/quests'));
  });

  it('stays open and says why when the delete is refused', async () => {
    mockDeleteQuest.mockRejectedValueOnce(new Error('Permission denied'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Reclaim Erebor' })
    );

    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
        'Permission denied'
      )
    );
    expect(mockNavigateToPage).not.toHaveBeenCalledWith('/quests');
  });
});

// ---------------------------------------------------------------------------
// A bad id, and a reader who cannot write
// ---------------------------------------------------------------------------
describe('states other than ready', () => {
  it('says so, and offers a way onward, when the id names nothing', () => {
    mockQuestId = 'no-such-quest';
    renderPage();
    expect(screen.getByText('No quest with that id')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Quests' }));
    expect(mockNavigateToPage).toHaveBeenCalledWith('/quests');
  });

  it('shows a signed-out reader the gate rather than the record', () => {
    mockUser = null;
    renderPage();
    expect(screen.queryByRole('heading', { level: 1, name: 'Reclaim Erebor' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// One read per write (PERF-06)
// ---------------------------------------------------------------------------
describe('refreshing after a write', () => {
  // `updateQuest` is the provider's, and the provider awaits its own refresh
  // before resolving. Refreshing again from the page read the whole quests
  // collection twice for one edit.
  it('leaves the refresh after a save to the provider', async () => {
    renderPage();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Smaug from Reclaim Erebor' })
    );
    await waitFor(() => expect(mockUpdateQuest).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockRefreshQuests).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Notes (T163): a quest keeps them as a person and a place do
// ---------------------------------------------------------------------------
describe('notes', () => {
  const notesModule = jest.requireMock('features/campaign-entities');
  const QUESTS_PATH = 'groups/group-1/campaigns/campaign-1/quests';
  const composer = () => screen.getByLabelText('Add a note');

  it('reads the notes under this quest', () => {
    renderPage();
    expect(notesModule.useRecordNotes).toHaveBeenCalledWith(QUESTS_PATH, 'reclaim-erebor');
  });

  it('shows each note’s date, text and author, oldest first', () => {
    renderPage();
    expect(screen.getByText('Found the keyhole at last.')).toBeInTheDocument();
    expect(screen.getByText('Zendikarr')).toBeInTheDocument();
    const dates = screen.getAllByText(/^\d{2}\/\d{2}\/\d{4}$/).map((n) => n.textContent);
    expect(dates).toEqual(['02/04/2025', '31/05/2025']);
    expect(screen.getByText(/oldest first/)).toBeInTheDocument();
  });

  it('offers somewhere to write the first one on a quest with none', () => {
    mockQuestNotes = [];
    renderPage();
    expect(composer()).toBeInTheDocument();
  });

  it('adds one, dated today and credited to the acting character', async () => {
    renderPage();
    fireEvent.change(composer(), { target: { value: 'The thrush knocked.' } });
    fireEvent.click(screen.getByText('Add note'));

    await waitFor(() => expect(mockAddQuestNote).toHaveBeenCalled());
    const [questId, note] = mockAddQuestNote.mock.calls[0];
    expect(questId).toBe('reclaim-erebor');
    expect(note).toEqual({
      date: new Date().toISOString().split('T')[0],
      text: 'The thrush knocked.',
      author: 'Zendikarr',
    });
    // The quest itself is not rewritten, and the listener carries the note.
    expect(mockUpdateQuest).not.toHaveBeenCalled();
    expect(mockRefreshQuests).not.toHaveBeenCalled();
  });

  it('keeps the note and says why when the write is refused', async () => {
    mockAddQuestNote.mockRejectedValueOnce(new Error('Write refused'));
    renderPage();
    fireEvent.change(composer(), { target: { value: 'The thrush knocked.' } });
    fireEvent.click(screen.getByText('Add note'));

    expect(await screen.findByText('Write refused')).toBeInTheDocument();
    expect(composer()).toHaveValue('The thrush knocked.');
  });

  it('edits a note in its own document, from the text it was opened with', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the note from 31/05/2025' }));
    fireEvent.change(screen.getByLabelText('Note from 31/05/2025'), {
      target: { value: 'Found the keyhole on Durin’s Day.' },
    });
    fireEvent.click(screen.getByText('Save note'));

    await waitFor(() => expect(notesModule.editRecordNote).toHaveBeenCalled());
    expect(notesModule.editRecordNote).toHaveBeenCalledWith(
      QUESTS_PATH,
      'reclaim-erebor',
      'n-may',
      'text',
      'Found the keyhole at last.',
      'Found the keyhole on Durin’s Day.'
    );
    expect(mockUpdateQuest).not.toHaveBeenCalled();
  });

  it('deletes a note only once the delete is confirmed', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete the note from 02/04/2025' }));
    expect(notesModule.deleteRecordNote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await waitFor(() => expect(notesModule.deleteRecordNote).toHaveBeenCalled());
    expect(notesModule.deleteRecordNote).toHaveBeenCalledWith(QUESTS_PATH, 'reclaim-erebor', 'n-april');
    expect(mockDeleteQuest).not.toHaveBeenCalled();
  });
});
