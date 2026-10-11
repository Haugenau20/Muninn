// src/core/services/firebase/data/__tests__/DocumentService.test.ts

/**
 * Tests for DocumentService
 *
 * DocumentService wraps Firestore with group/campaign context and
 * attribution metadata.  All Firebase SDK calls are mocked.
 */

// ─── Firestore SDK mocks ──────────────────────────────────────────────────────

import { createFakeFirestore, readBarrier } from '@/test-utils/fake-firestore-transactions';

// The transactional store behind `runTransaction`; fresh for every test.
let mockFirestoreStore = createFakeFirestore();

const mockSetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockGetCountFromServer = jest.fn();
const mockGetDocsFromServer = jest.fn();
const mockQuery = jest.fn((_ref: any, ...args: any[]) => ({ ref: _ref, constraints: args }));
const mockWhere = jest.fn((...args: any[]) => ({ type: 'where', args }));
const mockWriteBatch = jest.fn();
const mockCollection = jest.fn((_db: any, path: string, ...segs: string[]) => ({
  path: [path, ...segs].join('/'),
}));
const mockDoc = jest.fn((_db_or_ref: any, ...segs: string[]) => ({
  path: segs.join('/'),
  id: segs[segs.length - 1] || 'auto-id',
}));

// Batch mock
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn();
const mockBatchObj = {
  set: mockBatchSet,
  update: mockBatchUpdate,
  delete: mockBatchDelete,
  commit: mockBatchCommit,
};

jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  getFirestore: jest.fn(() => ({})),
  initializeFirestore: jest.fn(() => ({})),
  memoryLocalCache: jest.fn(),
  clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
  connectFirestoreEmulator: jest.fn(),
  // Using apply to avoid TS2556 strict-mode spread errors
  collection: function() { return (mockCollection as Function).apply(null, arguments); },
  doc: function() { return (mockDoc as Function).apply(null, arguments); },
  getDoc: function() { return (mockGetDoc as Function).apply(null, arguments); },
  getDocs: function() { return (mockGetDocs as Function).apply(null, arguments); },
  getCountFromServer: function() { return (mockGetCountFromServer as Function).apply(null, arguments); },
  getDocsFromServer: function() { return (mockGetDocsFromServer as Function).apply(null, arguments); },
  setDoc: function() { return (mockSetDoc as Function).apply(null, arguments); },
  updateDoc: function() { return (mockUpdateDoc as Function).apply(null, arguments); },
  deleteDoc: function() { return (mockDeleteDoc as Function).apply(null, arguments); },
  query: function() { return (mockQuery as Function).apply(null, arguments); },
  where: function() { return (mockWhere as Function).apply(null, arguments); },
  writeBatch: function() { return (mockWriteBatch as Function).apply(null, arguments); },
  runTransaction: function() { return (mockFirestoreStore.runTransaction as Function).apply(null, arguments); },
}));

jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: { uid: 'user-doc-test' } })),
  connectAuthEmulator: jest.fn(),
}));
jest.mock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  connectFunctionsEmulator: jest.fn(),
}));
jest.mock('../../config/firebaseConfig', () => ({
  firebaseConfig: { apiKey: 'test', projectId: 'test' },
  useEmulators: false,
  emulatorHost: 'localhost',
  emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
}));

// Mock ServiceRegistry so DocumentService can be constructed directly
jest.mock('../../core/ServiceRegistry', () => {
  const registry = new Map<string, any>();
  return {
    __esModule: true,
    default: {
      getInstance: jest.fn(() => ({
        get: (name: string) => {
          if (!registry.has(name)) throw new Error(`Service '${name}' not found in registry`);
          return registry.get(name);
        },
        register: (name: string, svc: any) => registry.set(name, svc),
        has: (name: string) => registry.has(name),
      })),
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDocSnapshot(exists: boolean, data: Record<string, any> = {}, id = 'doc-id') {
  return { exists: () => exists, data: () => data, id };
}

function makeQuerySnapshot(docs: ReturnType<typeof makeDocSnapshot>[]) {
  return { docs };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('DocumentService', () => {
  let DocumentService: typeof import('../DocumentService').default;
  // Re-required with the service: the module registry is reset per test, so a
  // top-level import would be a different class from the one the service throws.
  type TakenError = import('../DocumentAlreadyExistsError').DocumentAlreadyExistsError;
  let DocumentAlreadyExistsError: typeof import('../DocumentAlreadyExistsError').DocumentAlreadyExistsError;
  const AUTH_MOCK = { currentUser: { uid: 'user-doc-test' } };

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('firebase/firestore', () => ({
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      getFirestore: jest.fn(() => ({})),
      initializeFirestore: jest.fn(() => ({})),
      memoryLocalCache: jest.fn(),
      clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
      persistentLocalCache: jest.fn(),
      persistentMultipleTabManager: jest.fn(),
      connectFirestoreEmulator: jest.fn(),
      collection: function() { return (mockCollection as Function).apply(null, arguments); },
      doc: function() { return (mockDoc as Function).apply(null, arguments); },
      getDoc: function() { return (mockGetDoc as Function).apply(null, arguments); },
      getDocs: function() { return (mockGetDocs as Function).apply(null, arguments); },
      getCountFromServer: function() { return (mockGetCountFromServer as Function).apply(null, arguments); },
      getDocsFromServer: function() { return (mockGetDocsFromServer as Function).apply(null, arguments); },
      setDoc: function() { return (mockSetDoc as Function).apply(null, arguments); },
      updateDoc: function() { return (mockUpdateDoc as Function).apply(null, arguments); },
      deleteDoc: function() { return (mockDeleteDoc as Function).apply(null, arguments); },
      query: function() { return (mockQuery as Function).apply(null, arguments); },
      where: function() { return (mockWhere as Function).apply(null, arguments); },
      writeBatch: function() { return (mockWriteBatch as Function).apply(null, arguments); },
      runTransaction: function() { return (mockFirestoreStore.runTransaction as Function).apply(null, arguments); },
    }));
    jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
    jest.doMock('firebase/auth', () => ({
      getAuth: jest.fn(() => AUTH_MOCK),
      connectAuthEmulator: jest.fn(),
    }));
    jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
    jest.doMock('firebase/functions', () => ({
      getFunctions: jest.fn(() => ({})),
      connectFunctionsEmulator: jest.fn(),
    }));
    jest.doMock('../../config/firebaseConfig', () => ({
      firebaseConfig: { apiKey: 'test', projectId: 'test' },
      useEmulators: false,
      emulatorHost: 'localhost',
      emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
    }));

    const registry = new Map<string, any>();
    jest.doMock('../../core/ServiceRegistry', () => ({
      __esModule: true,
      default: {
        getInstance: jest.fn(() => ({
          get: (name: string) => {
            if (!registry.has(name)) throw new Error(`Service '${name}' not found in registry`);
            return registry.get(name);
          },
          register: (name: string, svc: any) => registry.set(name, svc),
          has: (name: string) => registry.has(name),
        })),
      },
    }));

    [mockSetDoc, mockUpdateDoc, mockDeleteDoc, mockGetDoc, mockGetDocs, mockGetCountFromServer,
     mockBatchSet, mockBatchUpdate, mockBatchDelete, mockBatchCommit].forEach(m => m.mockReset());
    mockWriteBatch.mockReturnValue(mockBatchObj);
    mockBatchCommit.mockResolvedValue(undefined);
    mockFirestoreStore = createFakeFirestore();

    DocumentService = require('../DocumentService').default;
    DocumentAlreadyExistsError = require('../DocumentAlreadyExistsError').DocumentAlreadyExistsError;
  });

  // ─── getInstance ────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    test('should return a DocumentService instance', () => {
      expect(DocumentService.getInstance()).toBeDefined();
    });

    test('should be a singleton', () => {
      expect(DocumentService.getInstance()).toBe(DocumentService.getInstance());
    });
  });

  // ─── getDocument – global path (requireContext=false) ────────────────────────

  describe('getDocument', () => {
    test('should return null when document does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const result = await svc.getDocument('users', 'uid-1', false);
      expect(result).toBeNull();
    });

    test('should return document data with id when exists (requireContext=false)', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(true, { email: 'a@b.com' }, 'uid-1'));
      const svc = DocumentService.getInstance();
      const result = await svc.getDocument<{ email: string; id: string }>('users', 'uid-1', false);
      expect(result?.email).toBe('a@b.com');
      expect(result?.id).toBe('uid-1');
    });

    test('should return null and not throw on Firestore error', async () => {
      mockGetDoc.mockRejectedValueOnce(new Error('network error'));
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const result = await svc.getDocument('npcs', 'n1');
      expect(result).toBeNull();
    });
  });

  // ─── getCollection ─────────────────────────────────────────────────────────

  describe('getCollection', () => {
    test('should return empty array when no active group is set', async () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup(null);
      const result = await svc.getCollection('npcs');
      expect(result).toEqual([]);
    });

    test('should return mapped documents when query succeeds', async () => {
      mockGetDocs.mockResolvedValueOnce(
        makeQuerySnapshot([
          makeDocSnapshot(true, { name: 'Gandalf' }, 'n1'),
          makeDocSnapshot(true, { name: 'Frodo' }, 'n2'),
        ])
      );
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const docs = await svc.getCollection<{ id: string; name: string }>('npcs');
      expect(docs).toHaveLength(2);
      expect(docs[0].id).toBe('n1');
      expect(docs[0].name).toBe('Gandalf');
    });

    test('should return empty array and not throw on Firestore error', async () => {
      mockGetDocs.mockRejectedValueOnce(new Error('network error'));
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const result = await svc.getCollection('npcs');
      expect(result).toEqual([]);
    });
  });

  // ─── setDocument ──────────────────────────────────────────────────────────

  describe('setDocument', () => {
    test('should call Firestore setDoc', async () => {
      mockSetDoc.mockResolvedValueOnce(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.setDocument('npcs', 'n1', { name: 'Gandalf' });
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    test('should throw when no active group is set', async () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup(null);
      await expect(svc.setDocument('npcs', 'n1', { name: 'Gandalf' })).rejects.toThrow(
        'No active group selected'
      );
    });

    test('should overwrite an existing document without any existence check (the deliberate re-key path StoryContext relies on)', async () => {
      mockSetDoc.mockResolvedValue(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');

      await svc.setDocument('chapters', 'chapter-1', { title: 'First' });
      await svc.setDocument('chapters', 'chapter-1', { title: 'Second' });

      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      // The collision guard added to createDocument must not apply here.
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    test('merges into the document instead of replacing it when asked to', async () => {
      mockSetDoc.mockResolvedValue(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');

      await svc.setDocument('progress', 'p1', { a: 1 }, { merge: true });

      expect(mockSetDoc).toHaveBeenCalledWith(expect.anything(), { a: 1 }, { merge: true });
    });
  });

  // ─── updateDocument ─────────────────────────────────────────────────────────

  describe('updateDocument', () => {
    test('should call Firestore updateDoc', async () => {
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.updateDocument('npcs', 'n1', { name: 'Aragorn' });
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    });
  });

  // ─── deleteDocument ─────────────────────────────────────────────────────────

  describe('deleteDocument', () => {
    test('should call Firestore deleteDoc', async () => {
      mockDeleteDoc.mockResolvedValueOnce(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.deleteDocument('npcs', 'n1');
      expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    });

    test('should throw when no active group is set', async () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup(null);
      await expect(svc.deleteDocument('npcs', 'n1')).rejects.toThrow(
        'No active group selected'
      );
    });
  });

  // ─── queryDocuments ─────────────────────────────────────────────────────────

  describe('queryDocuments', () => {
    test('should return empty array when no active group', async () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup(null);
      const result = await svc.queryDocuments('npcs', 'name', '==', 'Gandalf');
      expect(result).toEqual([]);
    });

    test('should return mapped results on success', async () => {
      mockGetDocs.mockResolvedValueOnce(
        makeQuerySnapshot([makeDocSnapshot(true, { name: 'Gandalf' }, 'n1')])
      );
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const result = await svc.queryDocuments<{ id: string; name: string }>(
        'npcs', 'name', '==', 'Gandalf'
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Gandalf');
    });

    test('should return empty array on Firestore error', async () => {
      mockGetDocs.mockRejectedValueOnce(new Error('query error'));
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const result = await svc.queryDocuments('npcs', 'name', '==', 'x');
      expect(result).toEqual([]);
    });
  });

  // ─── batchOperations ────────────────────────────────────────────────────────

  describe('batchOperations', () => {
    test('should call batch.commit after applying operations', async () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.batchOperations([
        { type: 'set', collection: 'npcs', id: 'n1', data: { name: 'Gandalf' } },
        { type: 'update', collection: 'npcs', id: 'n2', data: { name: 'Frodo' } },
        { type: 'delete', collection: 'npcs', id: 'n3' },
      ]);
      expect(mockBatchSet).toHaveBeenCalledTimes(1);
      expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
      expect(mockBatchDelete).toHaveBeenCalledTimes(1);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });
  });

  // ─── createDocument (attribution) ───────────────────────────────────────────

  describe('createDocument', () => {
    test('should throw when user is not authenticated', async () => {
      // Simulate unauthenticated state
      jest.resetModules();
      jest.doMock('firebase/auth', () => ({
        getAuth: jest.fn(() => ({ currentUser: null })),
        connectAuthEmulator: jest.fn(),
      }));
      jest.doMock('firebase/firestore', () => ({
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        getFirestore: jest.fn(() => ({})),
        initializeFirestore: jest.fn(() => ({})),
        memoryLocalCache: jest.fn(),
        clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
        persistentLocalCache: jest.fn(),
        persistentMultipleTabManager: jest.fn(),
        connectFirestoreEmulator: jest.fn(),
        collection: function() { return (mockCollection as Function).apply(null, arguments); },
        doc: function() { return (mockDoc as Function).apply(null, arguments); },
        getDoc: function() { return (mockGetDoc as Function).apply(null, arguments); },
        getDocs: function() { return (mockGetDocs as Function).apply(null, arguments); },
        setDoc: function() { return (mockSetDoc as Function).apply(null, arguments); },
        updateDoc: function() { return (mockUpdateDoc as Function).apply(null, arguments); },
        deleteDoc: function() { return (mockDeleteDoc as Function).apply(null, arguments); },
        query: function() { return (mockQuery as Function).apply(null, arguments); },
        where: function() { return (mockWhere as Function).apply(null, arguments); },
        writeBatch: function() { return (mockWriteBatch as Function).apply(null, arguments); },
      }));
      jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
      jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
      jest.doMock('firebase/functions', () => ({
        getFunctions: jest.fn(() => ({})),
        connectFunctionsEmulator: jest.fn(),
      }));
      jest.doMock('../../config/firebaseConfig', () => ({
        firebaseConfig: { apiKey: 'test', projectId: 'test' },
        useEmulators: false,
        emulatorHost: 'localhost',
        emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
      }));
      const registry = new Map<string, any>();
      jest.doMock('../../core/ServiceRegistry', () => ({
        __esModule: true,
        default: {
          getInstance: jest.fn(() => ({
            get: (name: string) => { if (!registry.has(name)) throw new Error(`Service '${name}' not found`); return registry.get(name); },
            register: (name: string, svc: any) => registry.set(name, svc),
            has: (name: string) => registry.has(name),
          })),
        },
      }));
      const DS = require('../DocumentService').default;
      const svc = DS.getInstance();
      svc.setActiveGroup('g1');
      await expect(svc.createDocument('npcs', { name: 'Gandalf' })).rejects.toThrow(
        'Not authenticated'
      );
    });

    test('should store the document under an explicit id', async () => {
      // getDoc: attribution profile fetch
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { username: 'Bilbo', activeCharacterId: null, characters: [] })
      );

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const id = await svc.createDocument('npcs', { name: 'Gandalf' }, 'explicit-id');
      expect(id).toBe('explicit-id');
      expect(mockFirestoreStore.read('explicit-id')).toMatchObject({ name: 'Gandalf' });
    });

    test('should throw when user profile not found during createDocument', async () => {
      // getDoc for user profile → not found
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await expect(svc.createDocument('npcs', { name: 'Gandalf' })).rejects.toThrow(
        'User profile not found'
      );
    });

    // ─── attribution content ────────────────────────────────────────────────

    test('should write full creation attribution onto the document, preserving caller data', async () => {
      // getDoc: attribution profile fetch
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, {
          username: 'Bilbo',
          activeCharacterId: 'char-1',
          characters: [
            { id: 'char-1', name: 'Frodo' },
            { id: 'char-2', name: 'Sam' },
          ],
        })
      );

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.createDocument('npcs', { name: 'Gandalf', race: 'Maia' }, 'explicit-id');

      const data = mockFirestoreStore.read('explicit-id')!;

      // caller's own data fields survive
      expect(data.name).toBe('Gandalf');
      expect(data.race).toBe('Maia');

      // created* fields
      expect(data.createdBy).toBe('user-doc-test');
      expect(data.createdByUsername).toBe('Bilbo');
      expect(data.createdByCharacterId).toBe('char-1');
      expect(data.createdByCharacterName).toBe('Frodo');

      // creation also stamps modified* (creation and initial modification are
      // the same event)
      expect(data.modifiedBy).toBe('user-doc-test');
      expect(data.modifiedByUsername).toBe('Bilbo');
      expect(data.modifiedByCharacterId).toBe('char-1');
      expect(data.modifiedByCharacterName).toBe('Frodo');

      // T132: the server's clock, which the rules can check as request.time,
      // and no writer's clock beside it.
      expect(data.createdAt).toBe('SERVER_TIMESTAMP');
      expect(data.modifiedAt).toBe('SERVER_TIMESTAMP');
      expect(data).not.toHaveProperty('dateAdded');
      expect(data).not.toHaveProperty('dateModified');
    });

    test('should null both character-name fields when the profile has no activeCharacterId', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { username: 'Bilbo', characters: [] })
      );
      mockSetDoc.mockResolvedValueOnce(undefined);

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.createDocument('npcs', { name: 'Gandalf' });

      const [, data] = mockSetDoc.mock.calls[0];
      expect(data.createdByCharacterId).toBeNull();
      expect(data.createdByCharacterName).toBeNull();
      expect(data.modifiedByCharacterId).toBeNull();
      expect(data.modifiedByCharacterName).toBeNull();
    });

    test('should keep the character id but null the character name when activeCharacterId matches no entry in characters[]', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, {
          username: 'Bilbo',
          activeCharacterId: 'char-missing',
          characters: [{ id: 'char-1', name: 'Frodo' }],
        })
      );
      mockSetDoc.mockResolvedValueOnce(undefined);

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.createDocument('npcs', { name: 'Gandalf' });

      const [, data] = mockSetDoc.mock.calls[0];
      expect(data.createdByCharacterId).toBe('char-missing');
      expect(data.createdByCharacterName).toBeNull();
      expect(data.modifiedByCharacterId).toBe('char-missing');
      expect(data.modifiedByCharacterName).toBeNull();
    });

    test('should default the username to an empty string when the profile has no username', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { activeCharacterId: null, characters: [] })
      );
      mockSetDoc.mockResolvedValueOnce(undefined);

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.createDocument('npcs', { name: 'Gandalf' });

      const [, data] = mockSetDoc.mock.calls[0];
      expect(data.createdByUsername).toBe('');
      expect(data.modifiedByUsername).toBe('');
    });
  });

  // ─── createDocument collision guard ─────────────────────────────────────────
  // A create must never replace a document already at its id. When an explicit
  // id is supplied and it already names a document, createDocument must refuse
  // rather than silently destroy the existing document (the mechanism behind
  // bugs #002/#004/#009/#012) -- including when the other document is being
  // created at the same moment (T081).

  describe('createDocument collision guard', () => {
    const PROFILE = { username: 'Bilbo', activeCharacterId: null, characters: [] };

    /**
     * Serves every read and write from one store, plain `getDoc`/`setDoc`
     * included, and holds each first read of `gandalf` until two have
     * happened -- so the race runs the same against any implementation.
     */
    function useRacingStore() {
      mockFirestoreStore = createFakeFirestore({ afterRead: readBarrier(2, 'gandalf') });
      mockFirestoreStore.seed('groups/g1/users/user-doc-test', PROFILE);
      mockGetDoc.mockImplementation((ref: any) => mockFirestoreStore.getDoc(ref));
      mockSetDoc.mockImplementation((ref: any, data: any) => mockFirestoreStore.setDoc(ref, data));
    }

    test('should create successfully when the explicit id is free', async () => {
      // getDoc: attribution profile fetch
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(true, PROFILE));

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const id = await svc.createDocument('npcs', { name: 'Gandalf' }, 'free-id');

      expect(id).toBe('free-id');
      expect(mockFirestoreStore.read('free-id')).toMatchObject({ name: 'Gandalf', createdByUsername: 'Bilbo' });
    });

    test('should throw a clear, actionable error naming the collection and id, and leave the existing document alone, when the explicit id is already taken', async () => {
      mockFirestoreStore.seed('taken-id', { name: 'Existing NPC' });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');

      let caughtError: Error | null = null;
      try {
        await svc.createDocument('npcs', { name: 'Gandalf' }, 'taken-id');
      } catch (e) {
        caughtError = e as Error;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain('taken-id');
      expect(caughtError!.message).toContain('npcs');
      expect(mockFirestoreStore.read('taken-id')).toEqual({ name: 'Existing NPC' });
      // Refused before attribution is fetched: no profile is needed to fail.
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    test('should throw a typed DocumentAlreadyExistsError, so callers can tell a taken id from any other failure (#1402)', async () => {
      mockFirestoreStore.seed('taken-id', { name: 'Existing NPC' });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');

      const caught = await svc
        .createDocument('npcs', { name: 'Gandalf' }, 'taken-id')
        .then(() => null, (e: unknown) => e);

      expect(caught).toBeInstanceOf(DocumentAlreadyExistsError);
      expect((caught as TakenError).documentId).toBe('taken-id');
      expect((caught as TakenError).collectionName).toBe('npcs');
      // The player-facing text must not leak the developer guidance.
      expect((caught as TakenError).userMessage).not.toMatch(
        /updateDocumentWithAttribution|setDocument|createDocument/
      );
      expect(mockFirestoreStore.read('taken-id')).toEqual({ name: 'Existing NPC' });
    });

    // T081 (DATA-001, TEST-001). Two members create the same name at once:
    // both look for the id before either writes. Checked as a read and then a
    // write, both saw it free and the second write replaced the first record,
    // author and all. Each read is held until both have happened.
    test('two simultaneous creates of one id: one succeeds, the other is refused, nothing is overwritten', async () => {
      useRacingStore();

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const outcomes = await Promise.allSettled([
        svc.createDocument('npcs', { name: 'Gandalf', by: 'first' }, 'gandalf'),
        svc.createDocument('npcs', { name: 'Gandalf', by: 'second' }, 'gandalf'),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(DocumentAlreadyExistsError);
      // The stored record is the one whose create reported success.
      const winner = outcomes[0].status === 'fulfilled' ? 'first' : 'second';
      expect(mockFirestoreStore.read('gandalf')).toMatchObject({ by: winner });
    });

    test('two simultaneous creates of one name both survive, under distinct ids (#1402 retry)', async () => {
      const { createWithUniqueEntityId } = require('../../../../utils/entity-id');
      useRacingStore();

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      // Two sessions: each has only its own issued ids and nothing loaded.
      const create = (by: string) => createWithUniqueEntityId({
        name: 'Gandalf',
        issuedIds: new Set<string>(),
        isLoaded: () => false,
        write: (id: string) => svc.createDocument('npcs', { name: 'Gandalf', by }, id),
      });
      const ids: string[] = await Promise.all([create('first'), create('second')]);

      expect(ids.slice().sort()).toEqual(['gandalf', 'gandalf-2']);
      const authors = ids.map((id) => mockFirestoreStore.read(id)!.by).sort();
      expect(authors).toEqual(['first', 'second']);
    });

    test('should leave the auto-generated-id path unaffected: no existence check runs when id is omitted', async () => {
      // Only one getDoc call expected: the attribution profile fetch. If the
      // guard incorrectly ran for the auto-id path, this would be 2.
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { username: 'Bilbo', activeCharacterId: null, characters: [] })
      );
      mockSetDoc.mockResolvedValueOnce(undefined);

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const id = await svc.createDocument('npcs', { name: 'Gandalf' });

      expect(id).toBeDefined();
      expect(mockGetDoc).toHaveBeenCalledTimes(1);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });
  });

  // ─── updateDocumentWithAttribution ──────────────────────────────────────────

  describe('updateDocumentWithAttribution', () => {
    test('should call updateDoc after getting modification attribution', async () => {
      // Attribution getDoc
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { username: 'Frodo', activeCharacterId: null })
      );
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.updateDocumentWithAttribution('npcs', 'n1', { name: 'Frodo' });
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    });

    test('should include modifiedBy in the update call', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { username: 'Sam', activeCharacterId: null })
      );
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.updateDocumentWithAttribution('npcs', 'n1', { name: 'Sam' });
      const [, updateData] = mockUpdateDoc.mock.calls[0];
      expect(updateData).toHaveProperty('modifiedBy', 'user-doc-test');
    });

    // ─── attribution content ────────────────────────────────────────────────

    test('should write the full modification attribution, preserving caller data, and never write created* fields', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, {
          username: 'Sam',
          activeCharacterId: 'char-2',
          characters: [
            { id: 'char-1', name: 'Frodo' },
            { id: 'char-2', name: 'Samwise' },
          ],
        })
      );
      mockUpdateDoc.mockResolvedValueOnce(undefined);

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.updateDocumentWithAttribution('npcs', 'n1', {
        name: 'Samwise Gamgee',
        race: 'Hobbit',
      });

      const [, data] = mockUpdateDoc.mock.calls[0];

      // caller's own data fields survive
      expect(data.name).toBe('Samwise Gamgee');
      expect(data.race).toBe('Hobbit');

      // full modified* set
      expect(data.modifiedBy).toBe('user-doc-test');
      expect(data.modifiedByUsername).toBe('Sam');
      expect(data.modifiedByCharacterId).toBe('char-2');
      expect(data.modifiedByCharacterName).toBe('Samwise');
      // The server's clock only (T132).
      expect(data.modifiedAt).toBe('SERVER_TIMESTAMP');
      expect(data).not.toHaveProperty('dateModified');

      // updates must never overwrite creation attribution (bug #1203)
      expect(data).not.toHaveProperty('createdBy');
      expect(data).not.toHaveProperty('createdByUsername');
      expect(data).not.toHaveProperty('createdByCharacterId');
      expect(data).not.toHaveProperty('createdByCharacterName');
      expect(data).not.toHaveProperty('dateAdded');
    });
  });

  // ─── updateDocumentAfterReading ─────────────────────────────────────────────

  describe('updateDocumentAfterReading', () => {
    const PROFILE = { username: 'Elrond', activeCharacterId: null, characters: [] };

    beforeEach(() => {
      // Attribution is read outside the transaction, before it starts.
      mockGetDoc.mockResolvedValue(makeDocSnapshot(true, PROFILE));
    });

    test('writes what the decision returns, with modification attribution', async () => {
      mockFirestoreStore.seed('gondolin', { name: 'Gondolin', parentId: '' });
      mockFirestoreStore.seed('doriath', { name: 'Doriath', parentId: '' });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.updateDocumentAfterReading<any>('locations', 'gondolin', async (read) => {
        const parent = await read('doriath');
        return { parentId: parent!.id };
      });

      const written = mockFirestoreStore.read('gondolin')!;
      expect(written).toMatchObject({ name: 'Gondolin', parentId: 'doriath', modifiedByUsername: 'Elrond' });
      expect(written.modifiedAt).toBe('SERVER_TIMESTAMP');
      expect(written).not.toHaveProperty('dateModified');
      expect(written).not.toHaveProperty('createdBy');
    });

    test('hands the decision undefined for a document that is not there', async () => {
      mockFirestoreStore.seed('gondolin', { name: 'Gondolin' });
      const seen: unknown[] = [];

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.updateDocumentAfterReading<any>('locations', 'gondolin', async (read) => {
        seen.push(await read('nowhere'));
        return {};
      });

      expect(seen).toEqual([undefined]);
    });

    test('writes nothing when the decision refuses', async () => {
      mockFirestoreStore.seed('gondolin', { name: 'Gondolin', parentId: '' });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await expect(
        svc.updateDocumentAfterReading<any>('locations', 'gondolin', async () => {
          throw new Error('Refused');
        })
      ).rejects.toThrow('Refused');

      expect(mockFirestoreStore.read('gondolin')).toEqual({ name: 'Gondolin', parentId: '' });
    });

    // DATA-006: two members move A under B and B under A at once. Each move
    // reads the other's document, and both reads happen before either
    // writes. The decision is made again against what the winner committed,
    // so the loser sees the cycle it would close.
    test('decides again on what a rival committed, so two opposite moves cannot both land', async () => {
      let held = 0;
      let release!: () => void;
      const bothRead = new Promise<void>((resolve) => { release = resolve; });
      mockFirestoreStore = createFakeFirestore({
        afterRead: (_path, attempt) => {
          if (attempt !== 1) return;
          held += 1;
          if (held === 2) release();
          return bothRead;
        },
      });
      mockFirestoreStore.seed('a', { name: 'A', parentId: '' });
      mockFirestoreStore.seed('b', { name: 'B', parentId: '' });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const move = (id: string, under: string) =>
        svc.updateDocumentAfterReading<any>('locations', id, async (read) => {
          const parent = await read(under);
          if (parent?.parentId === id) throw new Error(`${under} is already inside ${id}`);
          return { parentId: under };
        });

      const results = await Promise.allSettled([move('a', 'b'), move('b', 'a')]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const parents = [mockFirestoreStore.read('a')!.parentId, mockFirestoreStore.read('b')!.parentId];
      expect(parents.filter(Boolean)).toHaveLength(1);
    });
  });

  // ─── createDocumentWithUpdates ──────────────────────────────────────────────
  // T088 (DATA-005): turning rumours into a quest created the quest, then
  // marked the rumours in a second commit. A failed mark left the quest
  // behind, and every retry made another. Now one transaction does both.

  describe('createDocumentWithUpdates', () => {
    const PROFILE = { username: 'Sam', activeCharacterId: null, characters: [] };
    const note = (id: string) => ({ id, content: id });

    beforeEach(() => {
      mockGetDoc.mockResolvedValue(makeDocSnapshot(true, PROFILE));
    });

    /** Marks every source as converted, appending to the notes it holds. */
    const convert = (sourceIds: string[]) => async (read: (id: string) => Promise<any>) => {
      const sources = await Promise.all(sourceIds.map((id) => read(id)));
      if (sources.some((source) => !source)) throw new Error('One or more rumors not found');
      return {
        create: { title: 'Find the fire' },
        updates: sources.map((source) => ({
          id: source.id,
          data: { convertedToQuestId: 'find-the-fire', notes: [...source.notes, note(`converted-${source.id}`)] },
        })),
      };
    };

    test('creates the document and updates the others in one commit, each with its attribution', async () => {
      mockFirestoreStore.seed('smoke', { title: 'Smoke', notes: [] });
      mockFirestoreStore.seed('ash', { title: 'Ash', notes: [] });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.createDocumentWithUpdates<any, any>('quests', 'find-the-fire', 'rumors', convert(['smoke', 'ash']));

      const quest = mockFirestoreStore.read('find-the-fire')!;
      expect(quest).toMatchObject({ title: 'Find the fire', createdByUsername: 'Sam' });
      expect(quest.createdAt).toBe('SERVER_TIMESTAMP');
      expect(quest).not.toHaveProperty('dateAdded');
      for (const id of ['smoke', 'ash']) {
        const rumor = mockFirestoreStore.read(id)!;
        expect(rumor).toMatchObject({ convertedToQuestId: 'find-the-fire', modifiedByUsername: 'Sam' });
        expect(rumor.notes).toEqual([note(`converted-${id}`)]);
        expect(rumor).not.toHaveProperty('createdBy');
      }
    });

    test('refuses a taken id with DocumentAlreadyExistsError and writes nothing', async () => {
      mockFirestoreStore.seed('find-the-fire', { title: 'Someone else\'s quest' });
      mockFirestoreStore.seed('smoke', { title: 'Smoke', notes: [] });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const caught = await svc
        .createDocumentWithUpdates<any, any>('quests', 'find-the-fire', 'rumors', convert(['smoke']))
        .then(() => null, (e: unknown) => e);

      expect(caught).toBeInstanceOf(DocumentAlreadyExistsError);
      expect((caught as TakenError).documentId).toBe('find-the-fire');
      expect(mockFirestoreStore.read('find-the-fire')).toEqual({ title: 'Someone else\'s quest' });
      expect(mockFirestoreStore.read('smoke')).toEqual({ title: 'Smoke', notes: [] });
    });

    test('creates nothing when the decision refuses, e.g. a source has gone', async () => {
      mockFirestoreStore.seed('smoke', { title: 'Smoke', notes: [] });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await expect(
        svc.createDocumentWithUpdates<any, any>('quests', 'find-the-fire', 'rumors', convert(['smoke', 'deleted']))
      ).rejects.toThrow('One or more rumors not found');

      expect(mockFirestoreStore.paths().sort()).toEqual(['smoke']);
      expect(mockFirestoreStore.read('smoke')).toEqual({ title: 'Smoke', notes: [] });
    });

    test('creates nothing when an update cannot be applied', async () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await expect(
        svc.createDocumentWithUpdates<any, any>('quests', 'find-the-fire', 'rumors', async () => ({
          create: { title: 'Find the fire' },
          updates: [{ id: 'nowhere', data: { convertedToQuestId: 'find-the-fire' } }],
        }))
      ).rejects.toThrow();

      expect(mockFirestoreStore.read('find-the-fire')).toBeUndefined();
    });

    // A player adds a note to the rumour while it is being converted. The
    // conversion read the rumour before the note landed, so Firestore runs it
    // again and the appended list keeps the other player's note.
    test('decides again on a source a rival changed, so the rival\'s note is kept', async () => {
      let rivalWrote = false;
      mockFirestoreStore = createFakeFirestore({
        afterRead: (path, attempt) => {
          if (path !== 'smoke' || attempt !== 1 || rivalWrote) return;
          rivalWrote = true;
          mockFirestoreStore.seed('smoke', { title: 'Smoke', notes: [note('rival')] });
        },
      });
      mockFirestoreStore.seed('smoke', { title: 'Smoke', notes: [] });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.createDocumentWithUpdates<any, any>('quests', 'find-the-fire', 'rumors', convert(['smoke']));

      expect(mockFirestoreStore.read('smoke')!.notes).toEqual([note('rival'), note('converted-smoke')]);
      expect(mockFirestoreStore.read('find-the-fire')).toMatchObject({ title: 'Find the fire' });
    });
  });

  // T133: the notes saying what a conversion did are documents of their own,
  // written in its commit. Here `doc` and `collection` build full paths, so a
  // note's place under its record shows.
  describe('createDocumentWithUpdates, with notes', () => {
    const PROFILE = { username: 'Sam', activeCharacterId: null, characters: [] };
    const RUMORS = 'groups/g1/campaigns/c1/rumors';
    const QUESTS = 'groups/g1/campaigns/c1/quests';
    const flatDoc = mockDoc.getMockImplementation()!;
    const flatCollection = mockCollection.getMockImplementation()!;

    beforeEach(() => {
      mockGetDoc.mockResolvedValue(makeDocSnapshot(true, PROFILE));
      mockDoc.mockImplementation((parent: any, ...segs: string[]) => {
        const path = [parent?.path, ...segs].filter(Boolean).join('/');
        return { path, id: path.split('/').pop()! };
      });
      mockCollection.mockImplementation((parent: any, ...segs: string[]) => ({
        path: [parent?.path, ...segs].filter(Boolean).join('/'),
      }));
    });
    afterEach(() => {
      mockDoc.mockImplementation(flatDoc);
      mockCollection.mockImplementation(flatCollection);
    });

    const inCampaign = () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      svc.setActiveCampaign('c1');
      return svc;
    };

    test('writes each note under its record, attributed as a created document, in the same commit', async () => {
      mockFirestoreStore.seed(`${RUMORS}/smoke`, { title: 'Smoke', notes: [] });

      await inCampaign().createDocumentWithUpdates<any, any>('quests', 'find-the-fire', 'rumors', async () => ({
        create: { title: 'Find the fire' },
        updates: [{ id: 'smoke', data: { convertedToQuestId: 'find-the-fire' } }],
        notes: [
          { under: { updated: 'smoke' }, id: 'n1', data: { content: 'Converted to quest: find-the-fire' } },
          { under: 'created', id: 'n2', data: { content: 'Made from: smoke' } },
        ],
      }));

      expect(mockFirestoreStore.read(`${RUMORS}/smoke/notes/n1`)).toMatchObject({
        content: 'Converted to quest: find-the-fire',
        createdByUsername: 'Sam',
        createdAt: 'SERVER_TIMESTAMP',
      });
      expect(mockFirestoreStore.read(`${QUESTS}/find-the-fire/notes/n2`)).toMatchObject({
        content: 'Made from: smoke',
        createdByUsername: 'Sam',
      });
      // The record's own notes are not touched.
      expect(mockFirestoreStore.read(`${RUMORS}/smoke`)!.notes).toEqual([]);
    });

    test('puts a note under a record whose id is "created" there, not under the new record', async () => {
      mockFirestoreStore.seed(`${RUMORS}/created`, { title: 'Created', notes: [] });

      await inCampaign().createDocumentWithUpdates<any, any>('rumors', 'combined', 'rumors', async () => ({
        create: { title: 'Combined' },
        updates: [{ id: 'created', data: { status: 'confirmed' } }],
        notes: [{ under: { updated: 'created' }, id: 'n1', data: { content: 'Combined into rumor: combined' } }],
      }));

      expect(mockFirestoreStore.read(`${RUMORS}/created/notes/n1`)).toMatchObject({ content: 'Combined into rumor: combined' });
      expect(mockFirestoreStore.read(`${RUMORS}/combined/notes/n1`)).toBeUndefined();
    });

    test('refuses the whole commit when a note is too long, writing nothing', async () => {
      mockFirestoreStore.seed(`${RUMORS}/smoke`, { title: 'Smoke', notes: [] });

      await expect(inCampaign().createDocumentWithUpdates<any, any>('quests', 'q1', 'rumors', async () => ({
        create: { title: 'Find the fire' },
        updates: [{ id: 'smoke', data: { convertedToQuestId: 'q1' } }],
        notes: [{ under: { updated: 'smoke' }, id: 'n1', data: { content: 'x'.repeat(10_001) } }],
      }))).rejects.toMatchObject({ name: 'TextTooLongError' });

      expect(mockFirestoreStore.paths().sort()).toEqual([`${RUMORS}/smoke`]);
      expect(mockFirestoreStore.read(`${RUMORS}/smoke`)).toEqual({ title: 'Smoke', notes: [] });
    });
  });

  // ─── collection path construction ───────────────────────────────────────────


  // ─── updateDocumentsAfterReading (T088) ─────────────────────────────────────

  // Several documents changed from a decision made on what the transaction
  // read: marking a location's children for deletion only if each is still
  // inside it.
  describe('updateDocumentsAfterReading', () => {
    const PROFILE = { username: 'Elrond', activeCharacterId: null, characters: [] };

    beforeEach(() => {
      mockGetDoc.mockResolvedValue(makeDocSnapshot(true, PROFILE));
    });

    test('writes every update the decision returns, each with modification attribution', async () => {
      mockFirestoreStore.seed('kings-square', { name: "King's square", parentId: 'gondolin' });
      mockFirestoreStore.seed('fountain', { name: 'Fountain', parentId: 'gondolin' });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.updateDocumentsAfterReading<any>('locations', async (read) => {
        const both = await Promise.all([read('kings-square'), read('fountain')]);
        return both.map((place) => ({ id: place!.id, data: { deleting: 'delete-subtree' } }));
      });

      for (const id of ['kings-square', 'fountain']) {
        expect(mockFirestoreStore.read(id)).toMatchObject({ deleting: 'delete-subtree', modifiedByUsername: 'Elrond' });
      }
    });

    test('writes nothing for an empty decision', async () => {
      mockFirestoreStore.seed('fountain', { name: 'Fountain' });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await svc.updateDocumentsAfterReading<any>('locations', async (read) => {
        await read('fountain');
        return [];
      });

      expect(mockFirestoreStore.read('fountain')).toEqual({ name: 'Fountain' });
    });

    test('writes nothing when the decision refuses', async () => {
      mockFirestoreStore.seed('fountain', { name: 'Fountain' });

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      await expect(svc.updateDocumentsAfterReading<any>('locations', async () => {
        throw new Error('Refused');
      })).rejects.toThrow('Refused');

      expect(mockFirestoreStore.read('fountain')).toEqual({ name: 'Fountain' });
    });
  });

  // ─── queryFromServer (T088) ──────────────────────────────────────────────────

  describe('queryFromServer', () => {
    test('asks the server, never the cache, for the documents whose field matches', async () => {
      mockGetDocsFromServer.mockResolvedValue(makeQuerySnapshot([
        makeDocSnapshot(true, { name: "King's square", parentId: 'gondolin' }, 'kings-square'),
      ]));

      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      const found = await svc.queryFromServer<any>('groups/g1/campaigns/c1/locations', 'parentId', 'gondolin');

      expect(found).toEqual([{ id: 'kings-square', name: "King's square", parentId: 'gondolin' }]);
      expect(mockWhere).toHaveBeenCalledWith('parentId', '==', 'gondolin');
      expect(mockGetDocs).not.toHaveBeenCalled();
    });
  });

  describe('collection path construction', () => {
    test('should use full path directly when collection name contains "/"', async () => {
      mockGetDocs.mockResolvedValueOnce(makeQuerySnapshot([]));
      const svc = DocumentService.getInstance();
      // Full path — should not require group context
      await svc.getCollection('groups/g1/campaigns');
      expect(mockCollection).toHaveBeenCalledWith(
        expect.anything(),
        'groups/g1/campaigns'
      );
    });

    test('should include campaignId in path when activeCampaignId is set', async () => {
      mockGetDocs.mockResolvedValueOnce(makeQuerySnapshot([]));
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      svc.setActiveCampaign('c1');
      await svc.getCollection('npcs');
      expect(mockCollection).toHaveBeenCalledWith(
        expect.anything(),
        'groups', 'g1', 'campaigns', 'c1', 'npcs'
      );
    });

    test('should use group-level path when no activeCampaignId', async () => {
      mockGetDocs.mockResolvedValueOnce(makeQuerySnapshot([]));
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      svc.setActiveCampaign(null);
      await svc.getCollection('npcs');
      expect(mockCollection).toHaveBeenCalledWith(
        expect.anything(),
        'groups', 'g1', 'npcs'
      );
    });
  });

  // ─── write scope (T082) ─────────────────────────────────────────────────────
  // A write belongs to the group and campaign that were active when it was
  // called. Attribution is read first, and a switch can land while that read
  // is out; the write must not follow the switch -- campaigns routinely hold
  // records with the same id (DATA-002).

  describe('write scope survives a switch while attribution is read', () => {
    const PROFILE = { username: 'Bilbo', activeCharacterId: null, characters: [] };

    /** Holds the next getDoc (the attribution profile read) until released. */
    function holdProfileRead() {
      let release!: () => void;
      mockGetDoc.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve(makeDocSnapshot(true, PROFILE));
        })
      );
      return () => release();
    }

    /** The collection paths a document reference was built under. */
    const docParents = () =>
      mockDoc.mock.calls
        .map(([parent]) => (parent as { path?: string })?.path)
        .filter((path): path is string => typeof path === 'string');

    test('an edit lands in the campaign it was made in', async () => {
      mockUpdateDoc.mockResolvedValue(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      svc.setActiveCampaign('campaign-a');
      const release = holdProfileRead();

      const edit = svc.updateDocumentWithAttribution('npcs', 'gandalf', { description: 'meant for A' });
      svc.setActiveCampaign('campaign-b');
      release();
      await edit;

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
      expect(docParents()).toContain('groups/g1/campaigns/campaign-a/npcs');
      expect(docParents()).not.toContain('groups/g1/campaigns/campaign-b/npcs');
    });

    test("an edit is credited from the profile in the edited record's group", async () => {
      mockUpdateDoc.mockResolvedValue(undefined);
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      svc.setActiveCampaign('campaign-a');
      const release = holdProfileRead();

      const edit = svc.updateDocumentWithAttribution('npcs', 'gandalf', { description: 'x' });
      svc.setActiveGroup('g2');
      release();
      await edit;

      expect(docParents()).toContain('groups/g1/campaigns/campaign-a/npcs');
      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'groups', 'g1', 'users', 'user-doc-test');
      expect(mockDoc).not.toHaveBeenCalledWith(expect.anything(), 'groups', 'g2', 'users', 'user-doc-test');
    });

    test("a create is credited from the profile in the created record's group", async () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      svc.setActiveCampaign('campaign-a');
      const release = holdProfileRead();

      const create = svc.createDocument('npcs', { name: 'Gandalf' }, 'gandalf');
      // Let the transaction read the id before the switch.
      await Promise.resolve();
      svc.setActiveGroup('g2');
      release();
      await create;

      expect(docParents()).toContain('groups/g1/campaigns/campaign-a/npcs');
      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'groups', 'g1', 'users', 'user-doc-test');
      expect(mockDoc).not.toHaveBeenCalledWith(expect.anything(), 'groups', 'g2', 'users', 'user-doc-test');
    });
  });

  // ─── text limits (T119) ─────────────────────────────────────────────────────

  // The production rules refuse a campaign record's field holding more text
  // than its limit. The app refuses it first, with a sentence saying which
  // field and by how much, rather than letting the write come back as
  // "permission denied".
  describe('text limits (T119)', () => {
    const PROFILE = { username: 'Sam', activeCharacterId: null, characters: [] };

    /** The service, writing into campaign c1 of group g1. */
    const inCampaign = () => {
      const svc = DocumentService.getInstance();
      svc.setActiveGroup('g1');
      svc.setActiveCampaign('c1');
      return svc;
    };

    beforeEach(() => {
      mockGetDoc.mockResolvedValue(makeDocSnapshot(true, PROFILE));
      mockSetDoc.mockResolvedValue(undefined);
      mockUpdateDoc.mockResolvedValue(undefined);
    });

    it.each([
      ['npcs', 'name', 200],
      ['npcs', 'title', 200],
      ['npcs', 'race', 200],
      ['npcs', 'occupation', 200],
      ['npcs', 'location', 200],
      ['npcs', 'description', 10_000],
      ['npcs', 'appearance', 10_000],
      ['npcs', 'personality', 10_000],
      ['npcs', 'background', 10_000],
      ['locations', 'name', 200],
      ['locations', 'description', 10_000],
      ['quests', 'title', 200],
      ['quests', 'location', 200],
      ['quests', 'levelRange', 200],
      ['quests', 'description', 10_000],
      ['quests', 'background', 10_000],
      ['rumors', 'title', 200],
      ['rumors', 'sourceName', 200],
      ['rumors', 'location', 200],
      ['rumors', 'content', 10_000],
      ['chapters', 'title', 200],
      ['chapters', 'summary', 10_000],
      ['chapters', 'content', 200_000],
      ['saga', 'title', 200],
      ['saga', 'content', 500_000],
    ])('%s.%s takes %d characters and refuses one more', async (collection, field, limit) => {
      const svc = inCampaign();

      await svc.updateDocument(collection, 'r1', { [field]: 'x'.repeat(limit) });
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);

      await expect(svc.updateDocument(collection, 'r1', { [field]: 'x'.repeat(limit + 1) }))
        .rejects.toMatchObject({ name: 'TextTooLongError', field, length: limit + 1, limit });
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    });

    it('says which field is too long, and by how much', async () => {
      await expect(inCampaign().updateDocument('quests', 'q1', { levelRange: 'x'.repeat(201) }))
        .rejects.toThrow('The level range is too long to save: 201 characters, and it can hold 200.');
      await expect(inCampaign().updateDocument('npcs', 'n1', { description: 'x'.repeat(10_001) }))
        .rejects.toThrow('The description is too long to save: 10,001 characters, and it can hold 10,000.');
    });

    it('refuses a create, writing nothing', async () => {
      await expect(inCampaign().createDocument('npcs', { name: 'x'.repeat(201) }))
        .rejects.toMatchObject({ name: 'TextTooLongError' });
      await expect(inCampaign().createDocument('npcs', { name: 'x'.repeat(201) }, 'long'))
        .rejects.toMatchObject({ name: 'TextTooLongError' });
      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(mockFirestoreStore.read('long')).toBeUndefined();
    });

    it('refuses a set and an attributed update', async () => {
      await expect(inCampaign().setDocument('saga', 'sagaData', { title: 'x'.repeat(201), content: '' }))
        .rejects.toMatchObject({ name: 'TextTooLongError' });
      await expect(inCampaign().updateDocumentWithAttribution('npcs', 'n1', { name: 'x'.repeat(201) }))
        .rejects.toMatchObject({ name: 'TextTooLongError' });
      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('refuses what a decision returns inside a transaction, writing nothing', async () => {
      mockFirestoreStore.seed('n1', { name: 'Bilbo' });
      const svc = inCampaign();

      await expect(svc.updateDocumentAfterReading<any>('npcs', 'n1', async () => ({ name: 'x'.repeat(201) })))
        .rejects.toMatchObject({ name: 'TextTooLongError' });
      await expect(svc.updateDocumentsAfterReading<any>('npcs', async () => [{ id: 'n1', data: { name: 'x'.repeat(201) } }]))
        .rejects.toMatchObject({ name: 'TextTooLongError' });
      expect(mockFirestoreStore.read('n1')).toEqual({ name: 'Bilbo' });
    });

    it('refuses a conversion whose new record or whose updates are too long, writing nothing', async () => {
      mockFirestoreStore.seed('smoke', { title: 'Smoke', notes: [] });
      const svc = inCampaign();

      await expect(svc.createDocumentWithUpdates<any, any>('quests', 'q1', 'rumors', async () => ({
        create: { title: 'x'.repeat(201) },
        updates: [],
      }))).rejects.toMatchObject({ name: 'TextTooLongError' });
      await expect(svc.createDocumentWithUpdates<any, any>('quests', 'q1', 'rumors', async () => ({
        create: { title: 'Find the fire' },
        updates: [{ id: 'smoke', data: { content: 'x'.repeat(10_001) } }],
      }))).rejects.toMatchObject({ name: 'TextTooLongError' });

      expect(mockFirestoreStore.read('q1')).toBeUndefined();
      expect(mockFirestoreStore.read('smoke')).toEqual({ title: 'Smoke', notes: [] });
    });

    it('refuses a whole batch when one write in it is too long', async () => {
      await expect(inCampaign().batchOperations([
        { type: 'update', collection: 'chapters', id: 'c1', data: { order: 2 } },
        { type: 'set', collection: 'chapters', id: 'c2', data: { title: 'x'.repeat(201), order: 1 } },
      ])).rejects.toMatchObject({ name: 'TextTooLongError' });
      expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    // T133: a record's notes are documents of their own, each capped alone.
    it.each([
      ['text', 10_000],
      ['content', 10_000],
      ['date', 200],
      ['author', 200],
    ])("a record's note's %s takes %d characters and refuses one more", async (field, limit) => {
      const svc = inCampaign();
      const notes = 'groups/g1/campaigns/c1/npcs/n1/notes';

      await svc.createDocument(notes, { [field]: 'x'.repeat(limit) }, 'ok');
      await expect(svc.createDocument(notes, { [field]: 'x'.repeat(limit + 1) }, 'long'))
        .rejects.toMatchObject({ name: 'TextTooLongError', field, limit });
      await expect(svc.updateDocument(notes, 'ok', { [field]: 'x'.repeat(limit + 1) }))
        .rejects.toMatchObject({ name: 'TextTooLongError' });
      expect(mockFirestoreStore.read('long')).toBeUndefined();
    });

    // T134: a chapter's text is a document of its own, capped as the chapter's was.
    it("a chapter's body takes 200000 characters and refuses one more", async () => {
      const svc = inCampaign();
      const body = 'groups/g1/campaigns/c1/chapters/ch-1/body';

      await svc.batchOperations([{ type: 'set', collection: body, id: 'text', data: { content: 'x'.repeat(200_000) } }]);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
      await expect(svc.batchOperations([
        { type: 'set', collection: body, id: 'text', data: { content: 'x'.repeat(200_001) } },
      ])).rejects.toMatchObject({ name: 'TextTooLongError', field: 'content', limit: 200_000 });
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    it('leaves lists, uncapped fields and everything outside campaign records alone', async () => {
      const svc = inCampaign();
      const long = 'x'.repeat(20_000);

      await svc.updateDocument('npcs', 'n1', { notes: [{ id: 'n', text: long }], tags: [long] });
      await svc.setDocument(`groups/g1/users/user-doc-test/notes`, 'note1', { content: long });
      await svc.setDocument(`groups/g1/users/user-doc-test/story-progress`, 'c1', { currentChapter: long });

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
    });
  });
});

export {};
