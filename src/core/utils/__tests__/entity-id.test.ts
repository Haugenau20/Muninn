// src/core/utils/__tests__/entity-id.test.ts

import { slugifyEntityName, generateUniqueEntityId, createWithUniqueEntityId } from '../entity-id';
import { DocumentAlreadyExistsError } from '../../services/firebase/data/DocumentAlreadyExistsError';

describe('entity-id', () => {
  describe('slugifyEntityName', () => {
    test('lowercases and hyphenates a simple name', () => {
      expect(slugifyEntityName('Thorin Oakenshield')).toBe('thorin-oakenshield');
    });

    test('collapses whitespace variants onto the same slug', () => {
      expect(slugifyEntityName('Rescue the Princess')).toBe('rescue-the-princess');
      expect(slugifyEntityName('  Rescue   the   Princess  ')).toBe('rescue-the-princess');
    });

    test('collapses case variants onto the same slug', () => {
      expect(slugifyEntityName('Test Location')).toBe('test-location');
      expect(slugifyEntityName('TEST LOCATION')).toBe('test-location');
    });

    test('strips punctuation, including differing amounts of trailing punctuation', () => {
      expect(slugifyEntityName('Save the Village!')).toBe('save-the-village');
      expect(slugifyEntityName('Save the Village!!!')).toBe('save-the-village');
    });

    test('returns an empty string for a name with no alphanumeric characters', () => {
      expect(slugifyEntityName('!!!')).toBe('');
      expect(slugifyEntityName('   ')).toBe('');
    });
  });

  describe('generateUniqueEntityId', () => {
    test('returns the clean slug when it is free', () => {
      const isTaken = jest.fn().mockReturnValue(false);
      expect(generateUniqueEntityId('Test Location', isTaken)).toBe('test-location');
      expect(isTaken).toHaveBeenCalledWith('test-location');
    });

    test('does not rename an entity whose slug has no collision', () => {
      // Guards against a scheme that suffixes every id regardless of
      // collision -- several marker tests assert the *first* id created is
      // still the clean slug (e.g. 'test-location', 'dragon-sighting').
      const isTaken = () => false;
      expect(generateUniqueEntityId('Dragon Sighting', isTaken)).toBe('dragon-sighting');
    });

    test('appends -2 on the first collision', () => {
      const taken = new Set(['thorin-oakenshield']);
      const isTaken = (id: string) => taken.has(id);
      expect(generateUniqueEntityId('THORIN OAKENSHIELD', isTaken)).toBe('thorin-oakenshield-2');
    });

    test('appends -3 when -2 is also taken', () => {
      const taken = new Set(['thorin-oakenshield', 'thorin-oakenshield-2']);
      const isTaken = (id: string) => taken.has(id);
      expect(generateUniqueEntityId('Thorin Oakenshield', isTaken)).toBe('thorin-oakenshield-3');
    });

    test('keeps searching past several taken suffixes', () => {
      const taken = new Set([
        'save-the-village',
        'save-the-village-2',
        'save-the-village-3',
        'save-the-village-4',
      ]);
      const isTaken = (id: string) => taken.has(id);
      expect(generateUniqueEntityId('Save the Village', isTaken)).toBe('save-the-village-5');
    });

    test('case, whitespace and punctuation variants all collide onto the same base and disambiguate in sequence', () => {
      const issued = new Set<string>();
      const isTaken = (id: string) => issued.has(id);

      const names = [
        'Save the Village',
        'SAVE THE VILLAGE',
        '  Save   the   Village  ',
        'Save the Village!!!',
      ];

      const ids = names.map(name => {
        const id = generateUniqueEntityId(name, isTaken);
        issued.add(id);
        return id;
      });

      expect(ids).toEqual([
        'save-the-village',
        'save-the-village-2',
        'save-the-village-3',
        'save-the-village-4',
      ]);
      // All unique
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('falls back to a random id when the name has no alphanumeric characters', () => {
      const isTaken = jest.fn().mockReturnValue(false);
      const id = generateUniqueEntityId('!!!', isTaken);

      // A UUID, not a slug -- and isTaken should never be consulted for an
      // empty base, since there's nothing meaningful to disambiguate.
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(isTaken).not.toHaveBeenCalled();
    });

    test('falls back to a random id when whitespace-only name slugifies to empty', () => {
      const isTaken = jest.fn().mockReturnValue(false);
      const id = generateUniqueEntityId('   ', isTaken);
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    test('gives up and returns a random id if the numbered search is exhausted', () => {
      // Pathological isTaken that always reports a collision -- proves the
      // loop is bounded rather than spinning forever.
      const isTaken = () => true;
      const id = generateUniqueEntityId('Always Taken', isTaken);
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });

  // Bug #1402: `isTaken` only knows this client's state, so an id another
  // session already wrote slips through. The write layer refuses it; the
  // creator must then take the next free id rather than surface the refusal.
  describe('createWithUniqueEntityId', () => {
    /** A fake server: refuses ids it already holds, like createDocument's guard. */
    const makeServer = (initial: string[] = []) => {
      const held = new Set(initial);
      const write = jest.fn(async (id: string) => {
        // Yield first, as a real network write would.
        await Promise.resolve();
        if (held.has(id)) throw new DocumentAlreadyExistsError('npcs', id);
        held.add(id);
      });
      return { held, write };
    };

    const create = (
      name: string,
      server: ReturnType<typeof makeServer>,
      issuedIds = new Set<string>(),
      isLoaded: (id: string) => boolean = () => false
    ) => createWithUniqueEntityId({ name, issuedIds, isLoaded, write: server.write });

    test('writes the clean slug once when nothing else holds it', async () => {
      const server = makeServer();
      await expect(create('Gandalf', server)).resolves.toBe('gandalf');
      expect(server.write).toHaveBeenCalledTimes(1);
    });

    test('takes the next free id when another session already holds the slug', async () => {
      const server = makeServer(['gandalf']);
      await expect(create('Gandalf', server)).resolves.toBe('gandalf-2');
      expect(server.write.mock.calls.map(c => c[0])).toEqual(['gandalf', 'gandalf-2']);
    });

    test('keeps going past several ids another session holds', async () => {
      const server = makeServer(['gandalf', 'gandalf-2', 'gandalf-3']);
      await expect(create('gandalf', server)).resolves.toBe('gandalf-4');
    });

    test('remembers a refused id, so the next create skips it without another round trip', async () => {
      const server = makeServer(['gandalf']);
      const issued = new Set<string>();
      await create('Gandalf', server, issued);
      server.write.mockClear();
      await expect(create('Gandalf', server, issued)).resolves.toBe('gandalf-3');
      expect(server.write.mock.calls.map(c => c[0])).toEqual(['gandalf-3']);
    });

    test('claims the id before writing, so two overlapping creates cannot pick the same one', async () => {
      const server = makeServer();
      const issued = new Set<string>();
      const [a, b] = await Promise.all([
        create('Gandalf', server, issued),
        create('Gandalf', server, issued),
      ]);
      expect([a, b].sort()).toEqual(['gandalf', 'gandalf-2']);
    });

    test('still honours locally loaded entities', async () => {
      const server = makeServer();
      await expect(
        create('Gandalf', server, new Set(), id => id === 'gandalf')
      ).resolves.toBe('gandalf-2');
    });

    test('does not retry a failure that is not a taken id', async () => {
      const write = jest.fn().mockRejectedValue(new Error('permission-denied'));
      await expect(
        createWithUniqueEntityId({ name: 'Gandalf', issuedIds: new Set(), isLoaded: () => false, write })
      ).rejects.toThrow('permission-denied');
      expect(write).toHaveBeenCalledTimes(1);
    });

    test('is bounded, and its final failure names no internal service method', async () => {
      const write = jest.fn(async (id: string) => {
        throw new DocumentAlreadyExistsError('npcs', id);
      });
      const caught = await createWithUniqueEntityId({
        name: 'Gandalf',
        issuedIds: new Set(),
        isLoaded: () => false,
        write,
        maxAttempts: 4,
      }).then(() => null, (e: unknown) => e as Error);

      expect(write).toHaveBeenCalledTimes(4);
      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).not.toMatch(/updateDocumentWithAttribution|setDocument|createDocument/);
      expect(caught!.message.length).toBeGreaterThan(0);
    });

    // T163: a refusal can carry the answer "already exists" needs.
    describe('onRefused', () => {
      it('hears each refused id before the next is tried', async () => {
        const refused: string[] = [];
        const id = await createWithUniqueEntityId({
          name: 'Grog',
          issuedIds: new Set(),
          isLoaded: () => false,
          write: async (candidate) => {
            if (candidate === 'grog') throw new DocumentAlreadyExistsError('npcs', candidate);
          },
          onRefused: async (candidate) => {
            refused.push(candidate);
          },
        });
        expect(refused).toEqual(['grog']);
        expect(id).toBe('grog-2');
      });

      it('stops there when it throws, and tries no other id', async () => {
        const write = jest.fn(async (candidate: string) => {
          throw new DocumentAlreadyExistsError('npcs', candidate);
        });
        await expect(
          createWithUniqueEntityId({
            name: 'Grog',
            issuedIds: new Set(),
            isLoaded: () => false,
            write,
            onRefused: async () => {
              throw new Error('A Grog already exists');
            },
          })
        ).rejects.toThrow('A Grog already exists');
        expect(write).toHaveBeenCalledTimes(1);
      });

      it('is not told of a failure that is not a taken id', async () => {
        const onRefused = jest.fn();
        await expect(
          createWithUniqueEntityId({
            name: 'Grog',
            issuedIds: new Set(),
            isLoaded: () => false,
            write: async () => {
              throw new Error('offline');
            },
            onRefused,
          })
        ).rejects.toThrow('offline');
        expect(onRefused).not.toHaveBeenCalled();
      });
    });
  });
});
