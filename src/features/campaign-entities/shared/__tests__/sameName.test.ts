// src/features/campaign-entities/shared/__tests__/sameName.test.ts
import {
  SameNameError,
  assertNoSameNamed,
  findSameNamed,
  isSameName,
  stopOnSameNamed,
} from '../sameName';

/**
 * T163: what counts as "the same name" for the "already exists" check, and
 * the check after a refused id.
 */

const mockGetDocument = jest.fn();
jest.mock('core/services/firebase', () => ({
  __esModule: true,
  default: { document: { getDocument: (...args: unknown[]) => mockGetDocument(...args) } },
}));

beforeEach(() => jest.clearAllMocks());

describe('isSameName', () => {
  it.each([
    ['Grog', 'grog'],
    ['Grog', 'Grog.'],
    ['The Grog', 'Grog'],
    ['Odile  Marrow', 'odile marrow'],
    ['Greywater Ford', 'greywater ford!'],
  ])('reads %p and %p as one name', (a, b) => {
    expect(isSameName(a, b)).toBe(true);
  });

  it.each([
    ['Grog', 'Grog the Bold'],
    ['Neverwinter', 'Neverwinther'],
    ['Grog', 'Grig'],
  ])('reads %p and %p as two', (a, b) => {
    expect(isSameName(a, b)).toBe(false);
  });

  it('matches nothing to an empty name: a rumour from the list has no title', () => {
    expect(isSameName('', '')).toBe(false);
    expect(isSameName('  ', '')).toBe(false);
    expect(isSameName(undefined, '')).toBe(false);
  });
});

describe('findSameNamed', () => {
  const npcs = [
    { id: 'grog', name: 'Grog' },
    { id: 'odile-marrow', name: 'Odile Marrow' },
  ];

  it('finds the record carrying the name, by its kind’s field', () => {
    expect(findSameNamed('npc', 'grog', npcs)).toBe(npcs[0]);
    expect(findSameNamed('quest', 'The ring', [{ id: 'q1', title: 'Ring' }])).toEqual({ id: 'q1', title: 'Ring' });
  });

  it('finds nothing for a name nobody carries, or for a record left out', () => {
    expect(findSameNamed('npc', 'Vesk', npcs)).toBeUndefined();
    expect(findSameNamed('npc', 'Grog', npcs, ['grog'])).toBeUndefined();
  });
});

describe('assertNoSameNamed', () => {
  it('refuses with the record that carries the name', () => {
    const caught = (() => {
      try {
        assertNoSameNamed('location', 'greywater ford', [{ id: 'ford', name: 'Greywater Ford' }]);
        return null;
      } catch (err) {
        return err;
      }
    })();
    expect(caught).toBeInstanceOf(SameNameError);
    expect(caught).toMatchObject({ kind: 'location', existingId: 'ford', existingName: 'Greywater Ford' });
  });

  it('lets a new name through', () => {
    expect(() => assertNoSameNamed('npc', 'Vesk', [{ id: 'grog', name: 'Grog' }])).not.toThrow();
  });
});

describe('stopOnSameNamed, after a refused id', () => {
  const PATH = 'groups/g1/campaigns/c1/npcs';

  it('stops when the record that took the id carries the same name', async () => {
    mockGetDocument.mockResolvedValue({ id: 'grog', name: 'Grog' });

    await expect(stopOnSameNamed('npc', PATH, 'grog')('grog')).rejects.toMatchObject({
      name: 'SameNameError',
      existingId: 'grog',
      existingName: 'Grog',
    });
    expect(mockGetDocument).toHaveBeenCalledWith(PATH, 'grog');
  });

  it('lets the next id be tried when the record only shares the slug', async () => {
    // Renamed since it was created: the id stays `grog`.
    mockGetDocument.mockResolvedValue({ id: 'grog', name: 'Grog the Bold' });

    await expect(stopOnSameNamed('npc', PATH, 'Grog')('grog')).resolves.toBeUndefined();
  });

  it('lets the next id be tried when nothing can be read there', async () => {
    mockGetDocument.mockResolvedValue(null);

    await expect(stopOnSameNamed('npc', PATH, 'Grog')('grog')).resolves.toBeUndefined();
  });
});
