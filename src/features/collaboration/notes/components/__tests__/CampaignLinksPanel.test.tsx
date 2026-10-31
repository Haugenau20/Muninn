// src/features/collaboration/notes/components/__tests__/CampaignLinksPanel.test.tsx

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignLinksPanel from '../CampaignLinksPanel';
import { Note } from '../../types';
import { PotentialReference } from '../NoteReferences';
import { sigilIndexFor } from 'core/utils/entity-sigil';

const mockNavigateToPage = jest.fn();
const mockGetNoteById = jest.fn();
const mockUpdateNote = jest.fn();
const mockConvertEntity = jest.fn();
const mockExtractWithOpenAI = jest.fn();
const mockUseNoteReferences = jest.fn();

jest.mock('../NoteReferences', () => ({
  __esModule: true,
  default: () => null,
  useNoteReferences: (...args: any[]) => mockUseNoteReferences(...args),
  normalizeTextForComparison: (text: string) =>
    text.toLowerCase().replace(/[.,!?;:\s]+/g, '-').replace(/^-+|-+$/g, ''),
}));

jest.mock('../../context/NoteContext', () => ({ useNotes: jest.fn() }));
jest.mock('shared/hooks/useNavigation', () => ({ useNavigation: jest.fn() }));
// No default implementation here: defaults are set in `beforeEach` below so
// individual tests can override one collection with `.mockReturnValue(...)`
// (e.g. to seed an existing campaign NPC) without leaking into later tests.
jest.mock('@/features/campaign-entities', () => ({
  useNPCs: jest.fn(),
  useLocations: jest.fn(),
  useQuests: jest.fn(),
  useRumors: jest.fn(),
  // "Already exists" (T163): the real check and merge plan.
  ...jest.requireActual('features/campaign-entities/shared/sameName'),
  ...jest.requireActual('features/campaign-entities/shared/mergeRecords'),
  usePrivateRecords: jest.requireActual('features/campaign-entities/shared/private/PrivateRecordsContext')
    .usePrivateRecords,
}));
jest.mock('@/features/collaboration/entity-extraction/hooks/useEntityExtractor', () => ({
  useEntityExtractor: jest.fn(),
}));

const { useNotes } = require('../../context/NoteContext');
const { useNavigation } = require('shared/hooks/useNavigation');
const { useNPCs, useLocations, useQuests, useRumors } = require('@/features/campaign-entities');
const {
  useEntityExtractor,
} = require('@/features/collaboration/entity-extraction/hooks/useEntityExtractor');

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Session',
    content: 'x'.repeat(80),
    extractedEntities: [],
    status: 'active',
    tags: [],
    updatedAt: '2024-01-15T10:00:00.000Z',
    campaignId: 'campaign-1',
    createdBy: 'user-1',
    createdByUsername: 'TestUser',
    dateAdded: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function setupMocks({
  references = [] as PotentialReference[],
  referencesLoading = false,
  note = makeNote(),
  isUsageLimitExceeded = false,
  isExtractionAvailable = true,
  hookError = null as string | null,
} = {}) {
  mockUseNoteReferences.mockReturnValue({ references, isLoading: referencesLoading });
  mockGetNoteById.mockReturnValue(note);
  (useNotes as jest.Mock).mockReturnValue({
    getNoteById: mockGetNoteById,
    updateNote: mockUpdateNote,
    convertEntity: mockConvertEntity,
  });
  (useNavigation as jest.Mock).mockReturnValue({
    navigateToPage: mockNavigateToPage,
    currentPath: '/notes/note-1',
  });
  (useEntityExtractor as jest.Mock).mockReturnValue({
    extractWithOpenAI: mockExtractWithOpenAI,
    isExtracting: false,
    error: hookError,
    isUsageLimitExceeded,
    contactInfo: isUsageLimitExceeded
      ? { message: 'Limit reached', contactUrl: '/contact', prefilledSubject: 'More scans' }
      : null,
    isExtractionAvailable: () => isExtractionAvailable,
    refreshUsageStatus: jest.fn(),
  });
  mockUpdateNote.mockResolvedValue(undefined);
  mockConvertEntity.mockResolvedValue('created-id-1');
}

describe('CampaignLinksPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Fresh, empty campaign collections by default; individual tests
    // override one via `.mockReturnValue(...)` where they need to seed an
    // existing element (e.g. the campaign-filtering test below).
    (useNPCs as jest.Mock).mockReturnValue({ npcs: [], isLoading: false });
    (useLocations as jest.Mock).mockReturnValue({ locations: [], isLoading: false });
    (useQuests as jest.Mock).mockReturnValue({ quests: [], isLoading: false });
    (useRumors as jest.Mock).mockReturnValue({ rumors: [], isLoading: false });
  });

  describe('empty', () => {
    test('should render only the header when there is nothing to show', () => {
      setupMocks();
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByText('Campaign links')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /scan note/i })).toBeInTheDocument();

      // The two empty-state essays this merge exists to delete.
      expect(screen.queryByText(/no campaign elements found/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/click the search button/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/no new content found/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Smart Detection')).not.toBeInTheDocument();
      expect(screen.queryByText('Campaign References Found')).not.toBeInTheDocument();
    });

    test('should not render either group label when both groups are empty', () => {
      setupMocks();
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.queryByText(/in your campaign/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/detected, not in your campaign/i)).not.toBeInTheDocument();
    });
  });

  describe('extraction disclosure', () => {
    // A privacy page nobody opens is not a disclosure. The line belongs where
    // the decision is made -- under the button that sends the text.
    test('should say where the note text goes, beside the button that sends it', () => {
      setupMocks();
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(
        screen.getByText(/Sends this note's text to OpenAI/i)
      ).toBeInTheDocument();
    });

    test('should link the disclosure to the privacy page section that explains it', () => {
      setupMocks();
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByRole('link', { name: /how this works/i })).toHaveAttribute(
        'href',
        '/privacy#entity-extraction'
      );
    });

    test('should disclose even when the button is disabled', () => {
      // The text still leaves the app the moment the button becomes usable,
      // so the disclosure must not be conditional on the button's state.
      setupMocks({ isExtractionAvailable: false });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(
        screen.getByText(/Sends this note's text to OpenAI/i)
      ).toBeInTheDocument();
    });
  });

  describe('not scanned yet', () => {
    test('should say so for a note that has never been scanned', () => {
      setupMocks();
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByText('Not scanned yet.')).toBeInTheDocument();
      // Distinct from the post-scan message.
      expect(screen.queryByText(/no new names found/i)).not.toBeInTheDocument();
    });

    test('should not say so once the note carries stored entities', () => {
      setupMocks({
        note: makeNote({
          extractedEntities: [
            {
              id: 'ent-1',
              text: 'Black Spider',
              type: 'npc',
              confidence: 0.91,
              isConverted: false,
              createdAt: '2024-01-15T10:00:00.000Z',
            },
          ],
        }),
      });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.queryByText('Not scanned yet.')).not.toBeInTheDocument();
    });

    test('should not say so when the note already links to campaign entities', () => {
      setupMocks({
        references: [
          { id: 'npc-1', type: 'npc', title: 'Gundren', matchingText: ['Gundren'] },
        ],
      });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.queryByText('Not scanned yet.')).not.toBeInTheDocument();
    });

    test('should give way to the post-scan message once a scan completes empty', async () => {
      setupMocks();
      mockExtractWithOpenAI.mockResolvedValue([]);
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByText('Not scanned yet.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(screen.getByText('No new names found in this note.')).toBeInTheDocument();
      });
      expect(screen.queryByText('Not scanned yet.')).not.toBeInTheDocument();
    });
  });

  describe('matched entities', () => {
    const references: PotentialReference[] = [
      { id: 'npc-1', type: 'npc', title: 'Gundren Rockseeker', matchingText: ['Gundren Rockseeker'] },
      { id: 'loc-1', type: 'location', title: 'Phandalin', matchingText: ['Phandalin'] },
    ];

    test('should list them under a counted group label', () => {
      setupMocks({ references });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByText('IN YOUR CAMPAIGN · 2')).toBeInTheDocument();
      expect(screen.getByText('Gundren Rockseeker')).toBeInTheDocument();
      expect(screen.getByText('Phandalin')).toBeInTheDocument();
    });

    test('should show each entity type name', () => {
      setupMocks({ references });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByText('NPC')).toBeInTheDocument();
      expect(screen.getByText('Location')).toBeInTheDocument();
    });

    // The row names the entity with its own sigil -- the mark it wears on its
    // page -- and keeps the type as a word, because this list mixes kinds.
    test('should mark each entity with its own sigil beside the type name', () => {
      setupMocks({ references });
      render(<CampaignLinksPanel noteId="note-1" />);

      const row = screen.getByText('Gundren Rockseeker').closest('button') as HTMLElement;
      const sigil = row.querySelector('[data-testid="entity-sigil"]');
      expect(sigil).toHaveTextContent('G');
      expect(sigil).toHaveAttribute('data-sigil-index', String(sigilIndexFor('npc-1')));
      expect(row).toHaveTextContent('NPC');
    });

    // T014: an NPC and a location have their own pages, so a link to one
    // opens the record rather than a directory with its row lit up.
    test('should open an NPC on its own page when its row is clicked', () => {
      setupMocks({ references });
      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByText('Gundren Rockseeker'));

      expect(mockNavigateToPage).toHaveBeenCalledWith('/npcs/npc-1');
    });

    test('should open a location on its own page when its row is clicked', () => {
      setupMocks({ references });
      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByText('Phandalin'));

      expect(mockNavigateToPage).toHaveBeenCalledWith('/locations/loc-1');
    });

    test('should highlight a rumour in its directory, since it has no page', () => {
      setupMocks({
        references: [
          { id: 'r-1', type: 'rumor', title: 'A dragon on the hill', matchingText: ['A dragon on the hill'] },
        ],
      });
      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByText('A dragon on the hill'));

      expect(mockNavigateToPage).toHaveBeenCalledWith('/rumors?highlight=r-1');
    });
  });

  describe('detections', () => {
    const detected = makeNote({
      extractedEntities: [
        {
          id: 'ent-1',
          text: 'Black Spider',
          type: 'npc',
          confidence: 0.91,
          isConverted: false,
          createdAt: '2024-01-15T10:00:00.000Z',
        },
      ],
    });

    test('should list them under a counted warning group with confidence', () => {
      setupMocks({ note: detected });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByText('DETECTED, NOT IN YOUR CAMPAIGN · 1')).toBeInTheDocument();
      expect(screen.getByText('Black Spider')).toBeInTheDocument();
      expect(screen.getByText('looks like an NPC · 91% confidence')).toBeInTheDocument();
    });

    test('should not list a detection that matches an existing reference', () => {
      setupMocks({
        note: detected,
        references: [
          { id: 'npc-9', type: 'npc', title: 'Black Spider', matchingText: ['Black Spider'] },
        ],
      });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.queryByText(/detected, not in your campaign/i)).not.toBeInTheDocument();
    });

    test('should offer an Add action', () => {
      setupMocks({ note: detected });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    });
  });

  describe('scanning', () => {
    test('should save the editor before extracting', async () => {
      setupMocks();
      const saveCurrentEditorContent = jest.fn().mockResolvedValue(undefined);
      const getCurrentEditorContent = jest
        .fn()
        .mockReturnValue({ title: '', content: 'y'.repeat(80) });
      mockExtractWithOpenAI.mockResolvedValue([]);

      render(
        <CampaignLinksPanel
          noteId="note-1"
          getCurrentEditorContent={getCurrentEditorContent}
          saveCurrentEditorContent={saveCurrentEditorContent}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(saveCurrentEditorContent).toHaveBeenCalled();
      });
      expect(mockExtractWithOpenAI).toHaveBeenCalledWith('y'.repeat(80));
    });

    test('should abort the scan when the pre-save fails (bug #1051)', async () => {
      setupMocks();
      const saveCurrentEditorContent = jest.fn().mockRejectedValue(new Error('offline'));
      mockExtractWithOpenAI.mockResolvedValue([]);

      render(
        <CampaignLinksPanel noteId="note-1" saveCurrentEditorContent={saveCurrentEditorContent} />
      );

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(screen.getByText(/failed to save your work before analysis/i)).toBeInTheDocument();
      });
      expect(mockExtractWithOpenAI).not.toHaveBeenCalled();
    });

    test('should refuse to scan content that is too short', async () => {
      setupMocks({ note: makeNote({ content: 'too short' }) });

      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(screen.getByText(/too short for analysis/i)).toBeInTheDocument();
      });
      expect(mockExtractWithOpenAI).not.toHaveBeenCalled();
    });

    test('should show an error message when extraction itself throws', async () => {
      setupMocks();
      mockExtractWithOpenAI.mockRejectedValue(new Error('Network error'));

      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    // FUNC-002 / TEST-004: a failed rescan used to clear the saved detections
    // before the extraction ran, then report "no new names" as well.
    describe('a rescan that fails', () => {
      const pending = {
        id: 'ent-1',
        text: 'Black Spider',
        type: 'npc' as const,
        confidence: 0.91,
        isConverted: false,
        createdAt: '2024-01-15T10:00:00.000Z',
      };

      test('keeps the previous detections and writes nothing when extraction fails', async () => {
        setupMocks({ note: makeNote({ extractedEntities: [pending] }) });
        mockExtractWithOpenAI.mockRejectedValue(
          new Error('Content is too long (maximum 10,000 characters)')
        );

        render(<CampaignLinksPanel noteId="note-1" />);
        expect(screen.getByText('Black Spider')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

        await waitFor(() => {
          expect(screen.getByText(/content is too long/i)).toBeInTheDocument();
        });
        expect(mockUpdateNote).not.toHaveBeenCalled();
        expect(screen.getByText('Black Spider')).toBeInTheDocument();
        expect(screen.queryByText(/no new names/i)).not.toBeInTheDocument();
      });

      test('keeps the previous detections when saving the result fails', async () => {
        setupMocks({ note: makeNote({ extractedEntities: [pending] }) });
        mockExtractWithOpenAI.mockResolvedValue([
          { ...pending, id: 'ent-2', text: 'Grey Wolf' },
        ]);
        mockUpdateNote.mockRejectedValue(new Error('Write refused'));

        render(<CampaignLinksPanel noteId="note-1" />);
        fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

        await waitFor(() => {
          expect(screen.getByText('Write refused')).toBeInTheDocument();
        });
        expect(screen.getByText('Black Spider')).toBeInTheDocument();
        expect(screen.queryByText('Grey Wolf')).not.toBeInTheDocument();
      });

      test('replaces the detections in a single write once a scan succeeds', async () => {
        setupMocks({ note: makeNote({ extractedEntities: [pending] }) });
        const found = { ...pending, id: 'ent-2', text: 'Grey Wolf' };
        mockExtractWithOpenAI.mockResolvedValue([found]);

        render(<CampaignLinksPanel noteId="note-1" />);
        fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

        await waitFor(() => {
          expect(screen.getByText('Grey Wolf')).toBeInTheDocument();
        });
        expect(mockUpdateNote).toHaveBeenCalledTimes(1);
        expect(mockUpdateNote).toHaveBeenCalledWith('note-1', { extractedEntities: [found] });
        expect(screen.queryByText('Black Spider')).not.toBeInTheDocument();
      });
    });

    test('should disable the scan button and show a spinner while extracting', async () => {
      setupMocks();
      mockExtractWithOpenAI.mockReturnValue(new Promise(() => {})); // never resolves

      const { container } = render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /scan note/i })).toBeDisabled();
      });
      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    test('should deduplicate detections with the same text and type', async () => {
      setupMocks();
      const entity1 = {
        id: 'ent-1',
        text: 'Merlin',
        type: 'npc' as const,
        confidence: 0.7,
        isConverted: false,
        createdAt: '2024-01-15T10:00:00.000Z',
      };
      const entity2 = {
        id: 'ent-2',
        text: 'Merlin',
        type: 'npc' as const,
        confidence: 0.9,
        isConverted: false,
        createdAt: '2024-01-15T10:00:00.000Z',
      };
      mockExtractWithOpenAI.mockResolvedValue([entity1, entity2]);

      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(screen.getByText('DETECTED, NOT IN YOUR CAMPAIGN · 1')).toBeInTheDocument();
      });
      expect(screen.getAllByText('Merlin')).toHaveLength(1);
    });

    test('should filter out a detection that already exists in the campaign', async () => {
      setupMocks();
      // Seed an existing campaign NPC with the same name the scan will "detect".
      (useNPCs as jest.Mock).mockReturnValue({
        npcs: [{ id: 'npc-existing', name: 'Smaug' }],
        isLoading: false,
      });
      const detectedButExisting = {
        id: 'ent-1',
        text: 'Smaug',
        type: 'npc' as const,
        confidence: 0.9,
        isConverted: false,
        createdAt: '2024-01-15T10:00:00.000Z',
      };
      mockExtractWithOpenAI.mockResolvedValue([detectedButExisting]);

      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(mockExtractWithOpenAI).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.queryByText(/detected, not in your campaign/i)).not.toBeInTheDocument();
      });
      expect(screen.queryByText('Smaug')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // I2 (IMPORTANT): a scan that finds nothing new used to leave the panel
  // rendering byte-for-byte what it rendered before the click -- no feedback
  // at all for a multi-second OpenAI call. Spec §7's "no explanatory card"
  // governs the IDLE panel; a user-initiated scan still needs a result.
  // ---------------------------------------------------------------------------
  describe('no-results feedback (I2)', () => {
    test('should not show a no-results line before any scan has run', () => {
      setupMocks();
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.queryByText(/no new names found/i)).not.toBeInTheDocument();
    });

    test('should show a one-line no-results message after a completed scan finds nothing new', async () => {
      setupMocks();
      mockExtractWithOpenAI.mockResolvedValue([]);

      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(screen.getByText(/no new names found in this note/i)).toBeInTheDocument();
      });
    });

    test('should not show the no-results line when a scan finds detections', async () => {
      setupMocks();
      mockExtractWithOpenAI.mockResolvedValue([
        {
          id: 'ent-1',
          text: 'Merlin',
          type: 'npc' as const,
          confidence: 0.9,
          isConverted: false,
          createdAt: '2024-01-15T10:00:00.000Z',
        },
      ]);

      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));

      await waitFor(() => {
        expect(screen.getByText('Merlin')).toBeInTheDocument();
      });
      expect(screen.queryByText(/no new names found/i)).not.toBeInTheDocument();
    });

    test('should clear a prior no-results message once a later scan finds something', async () => {
      setupMocks();
      mockExtractWithOpenAI.mockResolvedValueOnce([]);

      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));
      await waitFor(() => {
        expect(screen.getByText(/no new names found in this note/i)).toBeInTheDocument();
      });

      mockExtractWithOpenAI.mockResolvedValueOnce([
        {
          id: 'ent-2',
          text: 'Elminster',
          type: 'npc' as const,
          confidence: 0.9,
          isConverted: false,
          createdAt: '2024-01-15T10:00:00.000Z',
        },
      ]);

      fireEvent.click(screen.getByRole('button', { name: /scan note/i }));
      await waitFor(() => {
        expect(screen.getByText('Elminster')).toBeInTheDocument();
      });
      expect(screen.queryByText(/no new names found/i)).not.toBeInTheDocument();
    });
  });

  describe('entity conversion', () => {
    test('should convert a detection via Add and notify the parent', async () => {
      const onEntityConverted = jest.fn();
      const detected = makeNote({
        extractedEntities: [
          {
            id: 'ent-1',
            text: 'Black Spider',
            type: 'npc',
            confidence: 0.91,
            isConverted: false,
            createdAt: '2024-01-15T10:00:00.000Z',
          },
        ],
      });
      setupMocks({ note: detected });
      mockConvertEntity.mockResolvedValue('created-npc-1');

      render(<CampaignLinksPanel noteId="note-1" onEntityConverted={onEntityConverted} />);

      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      await waitFor(() => {
        expect(mockConvertEntity).toHaveBeenCalledWith('note-1', 'ent-1', 'npc');
      });
      await waitFor(() => {
        expect(onEntityConverted).toHaveBeenCalledWith('ent-1', 'created-npc-1');
      });
    });
  });

  // T163: a rumour is written straight from its detection, so a title one
  // already carries stops here, at the dialog, and is converted again with
  // the answer.
  describe('a rumour whose title one already carries', () => {
    const { SameNameError } = jest.requireActual('features/campaign-entities/shared/sameName');
    const detected = () =>
      makeNote({
        extractedEntities: [
          {
            id: 'ent-1',
            text: 'Smoke over the hill',
            type: 'rumor',
            confidence: 0.9,
            isConverted: false,
            createdAt: '2024-01-15T10:00:00.000Z',
            extraData: { content: 'Ash on the wind' },
          },
        ],
      });

    beforeEach(() => {
      setupMocks({ note: detected() });
      (useRumors as jest.Mock).mockReturnValue({
        rumors: [{ id: 'smoke', title: 'Smoke', content: 'Smoke over the hill', relatedNPCs: [], relatedLocations: [] }],
      });
      mockConvertEntity.mockRejectedValueOnce(new SameNameError('rumor', 'smoke', 'Smoke'));
    });

    test('asks, then adds the detection to that rumour', async () => {
      const onEntityConverted = jest.fn();
      mockConvertEntity.mockResolvedValueOnce('smoke');
      render(<CampaignLinksPanel noteId="note-1" onEntityConverted={onEntityConverted} />);
      fireEvent.click(screen.getByRole('button', { name: /add/i }));

      const dialog = await screen.findByRole('dialog', { name: 'A Smoke already exists' });
      expect(dialog).toHaveTextContent('A note with what it says differently: what was said');
      fireEvent.click(screen.getByRole('button', { name: 'Add to Smoke' }));

      await waitFor(() =>
        expect(mockConvertEntity).toHaveBeenLastCalledWith('note-1', 'ent-1', 'rumor', { merge: 'smoke' })
      );
      await waitFor(() => expect(onEntityConverted).toHaveBeenCalledWith('ent-1', 'smoke'));
    });

    test('marks nothing converted when cancelled', async () => {
      const onEntityConverted = jest.fn();
      render(<CampaignLinksPanel noteId="note-1" onEntityConverted={onEntityConverted} />);
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mockConvertEntity).toHaveBeenCalledTimes(1);
      expect(onEntityConverted).not.toHaveBeenCalled();
    });

    test('creates it anyway under the same title when kept on purpose', async () => {
      mockConvertEntity.mockResolvedValueOnce('smoke-over-the-hill');
      render(<CampaignLinksPanel noteId="note-1" />);
      fireEvent.click(screen.getByRole('button', { name: /add/i }));
      fireEvent.click(await screen.findByRole('button', { name: 'Choose a name' }));
      fireEvent.click(screen.getByRole('button', { name: 'Create Smoke over the hill' }));

      await waitFor(() =>
        expect(mockConvertEntity).toHaveBeenLastCalledWith('note-1', 'ent-1', 'rumor', {
          createAs: 'Smoke over the hill',
          anyway: true,
        })
      );
    });
  });

  describe('usage limits', () => {
    test('should surface the limit and a way to ask for more', () => {
      setupMocks({ isUsageLimitExceeded: true });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByText(/usage limit reached/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /request limit increase/i })).toBeInTheDocument();
    });

    test('should disable scanning when extraction is unavailable', () => {
      setupMocks({ isExtractionAvailable: false });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByRole('button', { name: /scan note/i })).toBeDisabled();
    });

    test('should navigate to the contact page with the prefilled subject', () => {
      setupMocks({ isUsageLimitExceeded: true });
      render(<CampaignLinksPanel noteId="note-1" />);

      fireEvent.click(screen.getByRole('button', { name: /request limit increase/i }));

      expect(mockNavigateToPage).toHaveBeenCalledWith('/contact?subject=More+scans');
    });

    test('should suppress the inline error when only the usage limit is exceeded', () => {
      setupMocks({ isUsageLimitExceeded: true, hookError: 'Some hook error' });
      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByText(/usage limit reached/i)).toBeInTheDocument();
      expect(screen.queryByText('Some hook error')).not.toBeInTheDocument();
    });
  });

  describe('loading references', () => {
    const detected = makeNote({
      extractedEntities: [
        {
          id: 'ent-1',
          text: 'Black Spider',
          type: 'npc',
          confidence: 0.91,
          isConverted: false,
          createdAt: '2024-01-15T10:00:00.000Z',
        },
      ],
    });

    test('should not classify detections until references have finished loading', () => {
      setupMocks({ note: detected, referencesLoading: true });

      render(<CampaignLinksPanel noteId="note-1" />);

      // With references still loading, the reference set is incomplete --
      // an entity that IS in the campaign could be misclassified as a
      // detection if this ran now. Nothing should be classified yet.
      expect(screen.queryByText(/detected, not in your campaign/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Black Spider')).not.toBeInTheDocument();
    });

    test('should disable scanning until references have loaded', () => {
      setupMocks({ referencesLoading: true });

      render(<CampaignLinksPanel noteId="note-1" />);

      expect(screen.getByRole('button', { name: /scan note/i })).toBeDisabled();
    });
  });
});
