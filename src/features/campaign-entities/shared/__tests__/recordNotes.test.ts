// src/features/campaign-entities/shared/__tests__/recordNotes.test.ts
//
// T133: a record's notes are documents of their own, `{record}/{id}/notes`.
// Each is written alone, through the document service (which caps and
// attributes it like any document). The record's old array was moved into
// them in production and is read by nothing.
import { act, renderHook } from '@testing-library/react';
import {
  addRecordNote,
  deleteRecordNote,
  deleteRecordNotes,
  editRecordNote,
  notesPathOf,
  useCampaignRecordNotes,
  useRecordNotes,
} from '../recordNotes';
import { EditConflictError } from 'shared/utils/edit-conflict';

type Doc = Record<string, unknown> & { id: string };

/** Note documents, by collection path. */
let mockStore: Record<string, Doc[]>;
const mockListeners: Array<{ path: string; onNext: (docs: Doc[]) => void; closed: boolean }> = [];

jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: {
    document: {
      createDocument: jest.fn(async (path: string, data: Record<string, unknown>, id: string) => {
        (mockStore[path] ??= []).push({ ...data, id });
        return id;
      }),
      updateDocumentAfterReading: jest.fn(
        async (
          path: string,
          id: string,
          decide: (read: (otherId: string) => Promise<Doc | undefined>) => Promise<Record<string, unknown>>
        ) => {
          const documents = mockStore[path] ?? [];
          const fields = await decide(async (otherId) => documents.find((doc) => doc.id === otherId));
          Object.assign(documents.find((doc) => doc.id === id)!, fields);
        }
      ),
      deleteDocument: jest.fn(async (path: string, id: string) => {
        mockStore[path] = (mockStore[path] ?? []).filter((doc) => doc.id !== id);
      }),
      getCollectionFromServer: jest.fn(async (path: string) => [...(mockStore[path] ?? [])]),
      batchOperations: jest.fn(async (ops: Array<{ type: 'delete'; collection: string; id: string }>) => {
        ops.forEach((op) => {
          mockStore[op.collection] = (mockStore[op.collection] ?? []).filter((doc) => doc.id !== op.id);
        });
      }),
      subscribeToCollection: jest.fn((path: string, onNext: (docs: Doc[]) => void) => {
        const listener = { path, onNext, closed: false };
        mockListeners.push(listener);
        return () => {
          listener.closed = true;
        };
      }),
    },
  },
}));

jest.mock('shared/hooks/useCampaignCollectionPath', () => ({
  useCampaignCollectionPath: (collection: string) => `groups/g/campaigns/c/${collection}`,
}));

const { document: mockDocument } = jest.requireMock('core/services/firebase').default;

const NPCS = 'groups/g/campaigns/c/npcs';
const ALDRIC_NOTES = `${NPCS}/aldric/notes`;

beforeEach(() => {
  mockStore = {};
  mockListeners.length = 0;
  jest.clearAllMocks();
});

describe('notesPathOf', () => {
  it("is the record's own notes collection", () => {
    expect(notesPathOf(NPCS, 'aldric')).toBe(ALDRIC_NOTES);
  });
});

describe('addRecordNote', () => {
  it('creates one document under the record, through the service that attributes and caps it', async () => {
    const noteId = await addRecordNote(NPCS, 'aldric', { date: '2026-10-09', text: 'Owes us a sword' });

    expect(mockDocument.createDocument).toHaveBeenCalledWith(
      ALDRIC_NOTES,
      { date: '2026-10-09', text: 'Owes us a sword' },
      noteId
    );
    expect(mockStore[ALDRIC_NOTES]).toEqual([{ id: noteId, date: '2026-10-09', text: 'Owes us a sword' }]);
  });

  it('gives each note an id of its own', async () => {
    const first = await addRecordNote(NPCS, 'aldric', { text: 'One' });
    const second = await addRecordNote(NPCS, 'aldric', { text: 'Two' });
    expect(first).not.toBe(second);
  });
});

describe('editRecordNote', () => {
  beforeEach(() => {
    mockStore[ALDRIC_NOTES] = [{ id: 'n1', date: '2026-10-01', text: 'Mends armour' }];
  });

  it('changes the text alone', async () => {
    await editRecordNote(NPCS, 'aldric', 'n1', 'text', 'Mends armour', 'Mends armour and blades');
    expect(mockStore[ALDRIC_NOTES]).toEqual([{ id: 'n1', date: '2026-10-01', text: 'Mends armour and blades' }]);
  });

  it("changes a rumour note's content", async () => {
    const path = 'groups/g/campaigns/c/rumors/smoke/notes';
    mockStore[path] = [{ id: 'n1', content: 'Seen twice' }];
    await editRecordNote('groups/g/campaigns/c/rumors', 'smoke', 'n1', 'content', 'Seen twice', 'Seen thrice');
    expect(mockStore[path]).toEqual([{ id: 'n1', content: 'Seen thrice' }]);
  });

  it('refuses, with their text, when someone else changed it since the editor opened', async () => {
    mockStore[ALDRIC_NOTES][0].text = 'Mends armour, badly';

    const edit = editRecordNote(NPCS, 'aldric', 'n1', 'text', 'Mends armour', 'Mends armour and blades');

    await expect(edit).rejects.toBeInstanceOf(EditConflictError);
    await expect(edit).rejects.toMatchObject({ theirs: 'Mends armour, badly' });
    expect(mockStore[ALDRIC_NOTES][0].text).toBe('Mends armour, badly');
  });

  it('is no conflict when they made the same change', async () => {
    mockStore[ALDRIC_NOTES][0].text = 'Mends armour and blades';
    await expect(
      editRecordNote(NPCS, 'aldric', 'n1', 'text', 'Mends armour', 'Mends armour and blades')
    ).resolves.toBeUndefined();
  });

  it('says so when the note was deleted meanwhile', async () => {
    mockStore[ALDRIC_NOTES] = [];
    await expect(editRecordNote(NPCS, 'aldric', 'n1', 'text', 'Mends armour', 'x')).rejects.toThrow(
      'This note was deleted by someone else.'
    );
  });
});

describe('deleteRecordNote', () => {
  it('deletes that note and no other', async () => {
    mockStore[ALDRIC_NOTES] = [{ id: 'n1' }, { id: 'n2' }];
    await deleteRecordNote(NPCS, 'aldric', 'n1');
    expect(mockStore[ALDRIC_NOTES]).toEqual([{ id: 'n2' }]);
  });
});

describe('deleteRecordNotes', () => {
  it("deletes every note of each record, as the server holds them, and nobody else's", async () => {
    mockStore[ALDRIC_NOTES] = [{ id: 'n1' }, { id: 'n2' }];
    mockStore[`${NPCS}/barliman/notes`] = [{ id: 'n3' }];
    mockStore[`${NPCS}/bilbo/notes`] = [{ id: 'n4' }];

    await deleteRecordNotes(NPCS, ['aldric', 'barliman']);

    expect(mockStore[ALDRIC_NOTES]).toEqual([]);
    expect(mockStore[`${NPCS}/barliman/notes`]).toEqual([]);
    expect(mockStore[`${NPCS}/bilbo/notes`]).toEqual([{ id: 'n4' }]);
    expect(mockDocument.getCollectionFromServer).toHaveBeenCalledWith(ALDRIC_NOTES);
  });

  it('deletes in batches a commit can hold', async () => {
    mockStore[ALDRIC_NOTES] = Array.from({ length: 401 }, (_, i) => ({ id: `n${i}` }));

    await deleteRecordNotes(NPCS, ['aldric']);

    expect(mockDocument.batchOperations.mock.calls.map(([ops]: [unknown[]]) => ops.length)).toEqual([400, 1]);
    expect(mockStore[ALDRIC_NOTES]).toEqual([]);
  });

  it('writes nothing for a record without notes', async () => {
    await deleteRecordNotes(NPCS, ['aldric']);
    expect(mockDocument.batchOperations).not.toHaveBeenCalled();
  });
});

describe('useRecordNotes', () => {
  it("reads the record's notes live, each with the id of its document", () => {
    const { result } = renderHook(() => useRecordNotes<{ text: string }>(NPCS, 'aldric'));
    expect(result.current).toBeUndefined();
    expect(mockListeners.map((l) => l.path)).toEqual([ALDRIC_NOTES]);

    act(() => mockListeners[0].onNext([{ id: 'n1', text: 'Mends armour' }]));
    expect(result.current).toEqual([{ text: 'Mends armour', noteId: 'n1' }]);
  });

  it('puts them oldest first, whatever order the listener delivers', () => {
    const at = (iso: string) => ({ toDate: () => new Date(iso) });
    const { result } = renderHook(() => useRecordNotes<{ text: string }>(NPCS, 'aldric'));

    act(() =>
      mockListeners[0].onNext([
        { id: 'z', text: 'third, still pending', createdAt: null, dateAdded: '2026-10-09T12:00:00.000Z' },
        { id: 'a', text: 'second', createdAt: at('2026-10-08T00:00:00.000Z') },
        { id: 'm', text: 'first, moved from the array', createdAt: at('2025-05-31T00:00:00.000Z') },
      ])
    );

    expect(result.current!.map((note) => note.text)).toEqual(['first, moved from the array', 'second', 'third, still pending']);
  });

  // T163: a note moved with its record is created again by the move, at one
  // moment; the time it was first written, kept in `recordedAt`, orders it.
  it('orders notes moved with their record by when they were first written', () => {
    const at = (iso: string) => ({ toDate: () => new Date(iso) });
    const moved = at('2026-10-31T12:00:00.000Z');
    const { result } = renderHook(() => useRecordNotes<{ text: string }>(NPCS, 'aldric'));

    act(() =>
      mockListeners[0].onNext([
        { id: 'z', text: 'last', createdAt: moved, recordedAt: at('2026-10-20T00:00:00.000Z') },
        { id: 'a', text: 'first', createdAt: moved, recordedAt: at('2026-10-01T00:00:00.000Z') },
        { id: 'k', text: 'written after the move', createdAt: at('2026-10-31T13:00:00.000Z') },
        { id: 'm', text: 'middle', createdAt: moved, recordedAt: at('2026-10-10T00:00:00.000Z') },
      ])
    );

    expect(result.current!.map((note) => note.text)).toEqual(['first', 'middle', 'last', 'written after the move']);
  });

  it('reads nothing without a campaign or a record', () => {
    renderHook(() => useRecordNotes(null, 'aldric'));
    renderHook(() => useRecordNotes(NPCS, undefined));
    expect(mockListeners).toEqual([]);
  });

  it('stops reading when unmounted, and reads the next record afresh', () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useRecordNotes<{ text: string }>(NPCS, id), {
      initialProps: { id: 'aldric' },
    });
    act(() => mockListeners[0].onNext([{ id: 'n1', text: 'Mends armour' }]));

    rerender({ id: 'barliman' });
    expect(mockListeners[0].closed).toBe(true);
    // Not Aldric's notes under Barliman while his load.
    expect(result.current).toBeUndefined();

    unmount();
    expect(mockListeners[1].closed).toBe(true);
  });
});

describe('useCampaignRecordNotes', () => {
  it("reads the active campaign's notes of the record, empty while they load", () => {
    const { result } = renderHook(() => useCampaignRecordNotes<{ text: string }>('npcs', 'aldric'));
    expect(mockListeners.map((l) => l.path)).toEqual([ALDRIC_NOTES]);
    expect(result.current).toEqual([]);

    act(() => mockListeners[0].onNext([{ id: 'n1', text: 'new' }]));
    expect(result.current).toEqual([{ text: 'new', noteId: 'n1' }]);
  });
});
