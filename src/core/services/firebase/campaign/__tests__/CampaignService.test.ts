// src/core/services/firebase/campaign/__tests__/CampaignService.test.ts

/**
 * Tests for CampaignService
 *
 * All Firebase SDK calls are mocked.  UserService is also mocked.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

import { createFakeFirestore } from '@/test-utils/fake-firestore-transactions';

// The transactional store behind `runTransaction`; fresh for every test.
let mockFirestoreStore = createFakeFirestore();

const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockSetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockGetCountFromServer = jest.fn();
const mockHttpsCallable = jest.fn();
const mockCollection = jest.fn((_db: any, ...segs: string[]) => ({ path: segs.join('/') }));
const mockDoc = jest.fn((_db_or_ref: any, ...segs: string[]) => ({
  path: segs.join('/'),
  id: segs[segs.length - 1] || 'gen-id',
}));

const mockGetGroupUserProfile = jest.fn();
const mockUpdateGroupUserProfile = jest.fn();
const mockUserServiceInstance = {
  getGroupUserProfile: mockGetGroupUserProfile,
  updateGroupUserProfile: mockUpdateGroupUserProfile,
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
  collection: function() { return (mockCollection as Function).apply(null, arguments); },
  doc: function() { return (mockDoc as Function).apply(null, arguments); },
  getDoc: function() { return (mockGetDoc as Function).apply(null, arguments); },
  getDocs: function() { return (mockGetDocs as Function).apply(null, arguments); },
  setDoc: function() { return (mockSetDoc as Function).apply(null, arguments); },
  updateDoc: function() { return (mockUpdateDoc as Function).apply(null, arguments); },
  getCountFromServer: function() { return (mockGetCountFromServer as Function).apply(null, arguments); },
  runTransaction: function() { return (mockFirestoreStore.runTransaction as Function).apply(null, arguments); },
}));

jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: { uid: 'campaign-user' } })),
  connectAuthEmulator: jest.fn(),
}));
jest.mock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
}));

jest.mock('../../config/firebaseConfig', () => ({
  firebaseConfig: { apiKey: 'test', projectId: 'test' },
  useEmulators: false,
  emulatorHost: 'localhost',
  emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
}));

jest.mock('../../core/ServiceRegistry', () => {
  const registry = new Map<string, any>([['userService', mockUserServiceInstance]]);
  return {
    __esModule: true,
    default: {
      getInstance: jest.fn(() => ({
        get: (name: string) => {
          if (!registry.has(name)) throw new Error(`Service '${name}' not found`);
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

describe('CampaignService', () => {
  let CampaignService: typeof import('../CampaignService').default;

  beforeEach(() => {
    jest.resetModules();

    const registry = new Map<string, any>([['userService', mockUserServiceInstance]]);
    jest.doMock('../../core/ServiceRegistry', () => ({
      __esModule: true,
      default: {
        getInstance: jest.fn(() => ({
          get: (name: string) => {
            if (!registry.has(name)) throw new Error(`Service '${name}' not found`);
            return registry.get(name);
          },
          register: (name: string, svc: any) => registry.set(name, svc),
          has: (name: string) => registry.has(name),
        })),
      },
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
      getCountFromServer: function() { return (mockGetCountFromServer as Function).apply(null, arguments); },
      runTransaction: function() { return (mockFirestoreStore.runTransaction as Function).apply(null, arguments); },
    }));
    jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
    jest.doMock('firebase/auth', () => ({
      getAuth: jest.fn(() => ({ currentUser: { uid: 'campaign-user' } })),
      connectAuthEmulator: jest.fn(),
    }));
    jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
    jest.doMock('firebase/functions', () => ({
      getFunctions: jest.fn(() => ({})),
      connectFunctionsEmulator: jest.fn(),
      httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
    }));
    jest.doMock('../../config/firebaseConfig', () => ({
      firebaseConfig: { apiKey: 'test', projectId: 'test' },
      useEmulators: false,
      emulatorHost: 'localhost',
      emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
    }));

    [mockGetDoc, mockGetDocs, mockSetDoc, mockUpdateDoc, mockGetCountFromServer, mockHttpsCallable,
     mockGetGroupUserProfile, mockUpdateGroupUserProfile].forEach(m => m.mockReset());
    mockFirestoreStore = createFakeFirestore();

    CampaignService = require('../CampaignService').default;
  });

  // ─── getInstance ────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    test('should return a CampaignService instance', () => {
      expect(CampaignService.getInstance()).toBeDefined();
    });

    test('should be a singleton', () => {
      expect(CampaignService.getInstance()).toBe(CampaignService.getInstance());
    });
  });

  // ─── createCampaign ─────────────────────────────────────────────────────────

  describe('createCampaign', () => {
    test('should throw when user is not authenticated', async () => {
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
      }));
      jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
      jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
      jest.doMock('firebase/functions', () => ({
        getFunctions: jest.fn(() => ({})),
        connectFunctionsEmulator: jest.fn(),
        httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
      }));
      jest.doMock('../../config/firebaseConfig', () => ({
        firebaseConfig: { apiKey: 'test', projectId: 'test' },
        useEmulators: false, emulatorHost: 'localhost',
        emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
      }));
      const reg = new Map<string, any>([['userService', mockUserServiceInstance]]);
      jest.doMock('../../core/ServiceRegistry', () => ({
        __esModule: true,
        default: { getInstance: jest.fn(() => ({
          get: (n: string) => { if (!reg.has(n)) throw new Error(`Service '${n}' not found`); return reg.get(n); },
          register: (n: string, s: any) => reg.set(n, s),
          has: (n: string) => reg.has(n),
        })) },
      }));
      const CS = require('../CampaignService').default;
      await expect(CS.getInstance().createCampaign('g1', 'My Campaign')).rejects.toThrow(
        'Not authenticated'
      );
    });

    // T128: the group's campaigns are counted by the `createCampaign`
    // function, which also checks membership, picks the id and races safely
    // (its suite: firebase/functions/test/createCampaign.test.ts). The
    // browser-side creation these tests used to describe is gone.
    test('creates the campaign through the Cloud Function, writing nothing itself', async () => {
      const mockCallable = jest.fn().mockResolvedValueOnce({ data: { success: true, campaignId: 'my-campaign' } });
      mockHttpsCallable.mockReturnValueOnce(mockCallable);

      const svc = CampaignService.getInstance();
      const id = await svc.createCampaign('g1', 'My Campaign', 'Smugglers');

      expect(id).toBe('my-campaign');
      expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'createCampaign');
      expect(mockCallable).toHaveBeenCalledWith({ groupId: 'g1', name: 'My Campaign', description: 'Smugglers' });
      expect(mockFirestoreStore.paths()).toEqual([]);
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    test('sends an empty description when there is none', async () => {
      const mockCallable = jest.fn().mockResolvedValueOnce({ data: { success: true, campaignId: 'c' } });
      mockHttpsCallable.mockReturnValueOnce(mockCallable);

      await CampaignService.getInstance().createCampaign('g1', 'C');
      expect(mockCallable).toHaveBeenCalledWith({ groupId: 'g1', name: 'C', description: '' });
    });

    test('should set the active campaign after creation', async () => {
      mockHttpsCallable.mockReturnValueOnce(
        jest.fn().mockResolvedValueOnce({ data: { success: true, campaignId: 'campaign-name' } })
      );

      const svc = CampaignService.getInstance();
      const id = await svc.createCampaign('g1', 'Campaign Name');
      expect(svc.getActiveCampaignId()).toBe(id);
    });

    test("surfaces the function's refusal, such as a group with five campaigns", async () => {
      mockHttpsCallable.mockReturnValueOnce(
        jest.fn().mockRejectedValueOnce(new Error('This group has 5 campaigns, the most a group may have.'))
      );

      const svc = CampaignService.getInstance();
      await expect(svc.createCampaign('g1', 'One too many')).rejects.toThrow(/5 campaigns/);
      expect(svc.getActiveCampaignId()).not.toBe('one-too-many');
    });

    test('refuses a name over 200 characters or a description over 10,000 before calling (T119)', async () => {
      const svc = CampaignService.getInstance();
      await expect(svc.createCampaign('g1', 'x'.repeat(201)))
        .rejects.toMatchObject({ name: 'TextTooLongError', field: 'name' });
      await expect(svc.createCampaign('g1', 'Rohan', 'x'.repeat(10_001)))
        .rejects.toMatchObject({ name: 'TextTooLongError', field: 'description' });
      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });
  });

  // ─── getCampaigns ───────────────────────────────────────────────────────────

  describe('getCampaigns', () => {
    test('should return empty array when user is not authenticated', async () => {
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
      }));
      jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
      jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
      jest.doMock('firebase/functions', () => ({
        getFunctions: jest.fn(() => ({})),
        connectFunctionsEmulator: jest.fn(),
        httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
      }));
      jest.doMock('../../config/firebaseConfig', () => ({
        firebaseConfig: { apiKey: 'test', projectId: 'test' },
        useEmulators: false, emulatorHost: 'localhost',
        emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
      }));
      const reg = new Map<string, any>([['userService', mockUserServiceInstance]]);
      jest.doMock('../../core/ServiceRegistry', () => ({
        __esModule: true,
        default: { getInstance: jest.fn(() => ({
          get: (n: string) => { if (!reg.has(n)) throw new Error(`Service '${n}' not found`); return reg.get(n); },
          register: (n: string, s: any) => reg.set(n, s),
          has: (n: string) => reg.has(n),
        })) },
      }));
      const CS = require('../CampaignService').default;
      const result = await CS.getInstance().getCampaigns('g1');
      expect(result).toEqual([]);
    });

    test('should return empty array when user is not a group member', async () => {
      mockGetGroupUserProfile.mockResolvedValueOnce(null);
      const svc = CampaignService.getInstance();
      const result = await svc.getCampaigns('g1');
      expect(result).toEqual([]);
    });

    test('should return campaigns list when user is a member', async () => {
      mockGetGroupUserProfile.mockResolvedValueOnce({ userId: 'campaign-user', role: 'member' });
      mockGetDocs.mockResolvedValueOnce(
        makeQuerySnapshot([
          makeDocSnapshot(true, { name: 'Campaign 1', isActive: true }, 'c1'),
          makeDocSnapshot(true, { name: 'Campaign 2', isActive: false }, 'c2'),
        ])
      );
      const svc = CampaignService.getInstance();
      const campaigns = await svc.getCampaigns('g1');
      expect(campaigns).toHaveLength(2);
      expect(campaigns[0].id).toBe('c1');
      expect(campaigns[0].groupId).toBe('g1');
    });

    test('should return empty array when Firestore throws', async () => {
      mockGetGroupUserProfile.mockResolvedValueOnce({ userId: 'campaign-user', role: 'member' });
      mockGetDocs.mockRejectedValueOnce(new Error('network error'));
      const svc = CampaignService.getInstance();
      const result = await svc.getCampaigns('g1');
      expect(result).toEqual([]);
    });

    // PERF-02: the membership check used to finish before the list was even
    // requested -- a whole extra round trip on every sign-in and reload.
    test('requests the campaign list without waiting for the membership check', async () => {
      let confirmMembership!: (profile: unknown) => void;
      mockGetGroupUserProfile.mockReturnValueOnce(
        new Promise(resolve => { confirmMembership = resolve; })
      );
      mockGetDocs.mockResolvedValueOnce(
        makeQuerySnapshot([makeDocSnapshot(true, { name: 'Campaign 1' }, 'c1')])
      );

      const result = CampaignService.getInstance().getCampaigns('g1');
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockGetDocs).toHaveBeenCalledTimes(1);
      confirmMembership({ userId: 'campaign-user', role: 'member' });
      expect((await result).map((c: any) => c.id)).toEqual(['c1']);
    });

    test('returns nothing to a non-member even though the list was already requested', async () => {
      mockGetGroupUserProfile.mockResolvedValueOnce(null);
      mockGetDocs.mockResolvedValueOnce(
        makeQuerySnapshot([makeDocSnapshot(true, { name: 'Secret' }, 'c1')])
      );

      await expect(CampaignService.getInstance().getCampaigns('g1')).resolves.toEqual([]);
    });

    test("a non-member's refused list neither rejects nor goes unhandled", async () => {
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        mockGetGroupUserProfile.mockResolvedValueOnce(null);
        mockGetDocs.mockRejectedValueOnce(new Error('permission-denied'));

        await expect(CampaignService.getInstance().getCampaigns('g1')).resolves.toEqual([]);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  // ─── updateCampaign ─────────────────────────────────────────────────────────

  describe('updateCampaign', () => {
    test('should throw when user is not a member', async () => {
      mockGetGroupUserProfile.mockResolvedValueOnce(null);
      const svc = CampaignService.getInstance();
      await expect(svc.updateCampaign('g1', 'c1', { name: 'New Name' })).rejects.toThrow(
        'You are not a member of this group'
      );
    });

    test('should call updateDoc with the provided fields plus metadata', async () => {
      mockGetGroupUserProfile.mockResolvedValueOnce({ userId: 'campaign-user', role: 'admin' });
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = CampaignService.getInstance();
      await svc.updateCampaign('g1', 'c1', { name: 'Updated Campaign' });
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
      const [, updateData] = mockUpdateDoc.mock.calls[0];
      expect(updateData.name).toBe('Updated Campaign');
      expect(updateData.modifiedBy).toBe('campaign-user');
      // The server's clock only (T132).
      expect(updateData.modifiedAt).toBeDefined();
      expect(updateData).not.toHaveProperty('dateModified');
    });

    test('should throw when updateDoc fails', async () => {
      mockGetGroupUserProfile.mockResolvedValueOnce({ userId: 'campaign-user', role: 'admin' });
      mockUpdateDoc.mockRejectedValueOnce(new Error('update failed'));
      const svc = CampaignService.getInstance();
      await expect(svc.updateCampaign('g1', 'c1', { name: 'x' })).rejects.toThrow('update failed');
    });

    // T119: the rules cap a campaign's name and description; the service
    // refuses first, saying which and by how much.
    test('refuses a name over 200 characters or a description over 10,000, writing nothing', async () => {
      mockGetGroupUserProfile.mockResolvedValue({ userId: 'campaign-user', role: 'admin' });
      const svc = CampaignService.getInstance();
      await expect(svc.updateCampaign('g1', 'c1', { name: 'x'.repeat(201) }))
        .rejects.toThrow('The name is too long to save: 201 characters, and it can hold 200.');
      await expect(svc.updateCampaign('g1', 'c1', { description: 'x'.repeat(10_001) }))
        .rejects.toMatchObject({ name: 'TextTooLongError', field: 'description' });
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    test('takes a name of exactly 200 characters', async () => {
      mockGetGroupUserProfile.mockResolvedValueOnce({ userId: 'campaign-user', role: 'admin' });
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      await CampaignService.getInstance().updateCampaign('g1', 'c1', { name: 'x'.repeat(200) });
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    });
  });

  // ─── deleteCampaign ─────────────────────────────────────────────────────────

  describe('deleteCampaign', () => {
    test('should throw when user is not authenticated', async () => {
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
      }));
      jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
      jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
      jest.doMock('firebase/functions', () => ({
        getFunctions: jest.fn(() => ({})),
        connectFunctionsEmulator: jest.fn(),
        httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
      }));
      jest.doMock('../../config/firebaseConfig', () => ({
        firebaseConfig: { apiKey: 'test', projectId: 'test' },
        useEmulators: false, emulatorHost: 'localhost',
        emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
      }));
      const reg = new Map<string, any>([['userService', mockUserServiceInstance]]);
      jest.doMock('../../core/ServiceRegistry', () => ({
        __esModule: true,
        default: { getInstance: jest.fn(() => ({
          get: (n: string) => { if (!reg.has(n)) throw new Error(`Service '${n}' not found`); return reg.get(n); },
          register: (n: string, s: any) => reg.set(n, s),
          has: (n: string) => reg.has(n),
        })) },
      }));
      const CS = require('../CampaignService').default;
      await expect(CS.getInstance().deleteCampaign('g1', 'c1')).rejects.toThrow(
        'Not authenticated'
      );
    });

    test('should call the Cloud Function httpsCallable with groupId and campaignId', async () => {
      const mockCallable = jest.fn().mockResolvedValueOnce({ data: { success: true } });
      mockHttpsCallable.mockReturnValueOnce(mockCallable);

      const svc = CampaignService.getInstance();
      await svc.deleteCampaign('g1', 'c1');

      expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'deleteCampaign');
      expect(mockCallable).toHaveBeenCalledWith({ groupId: 'g1', campaignId: 'c1' });
    });

    test('should throw when the cloud function throws', async () => {
      const mockCallable = jest.fn().mockRejectedValueOnce(new Error('permission-denied'));
      mockHttpsCallable.mockReturnValueOnce(mockCallable);

      const svc = CampaignService.getInstance();
      await expect(svc.deleteCampaign('g1', 'c1')).rejects.toThrow('permission-denied');
    });
  });

  // ─── getCampaignCounts ──────────────────────────────────────────────────────

  describe('getCampaignCounts', () => {
    /** Shape getCountFromServer returns: snapshot.data().count */
    const countSnapshot = (count: number) => ({ data: () => ({ count }) });

    beforeEach(() => {
      mockGetGroupUserProfile.mockResolvedValue({ userId: 'campaign-user' });
    });

    test('counts chapters and NPCs for the named campaign', async () => {
      mockGetCountFromServer
        .mockResolvedValueOnce(countSnapshot(39))
        .mockResolvedValueOnce(countSnapshot(16));

      const svc = CampaignService.getInstance();
      const counts = await svc.getCampaignCounts('g1', 'c1');

      expect(counts).toEqual({ chapters: 39, npcs: 16 });
    });

    test('counts under the named campaign, not the active one', async () => {
      mockGetCountFromServer.mockResolvedValue(countSnapshot(0));

      const svc = CampaignService.getInstance();
      await svc.getCampaignCounts('g1', 'c1');

      expect(mockCollection).toHaveBeenCalledWith(
        expect.anything(), 'groups', 'g1', 'campaigns', 'c1', 'chapters'
      );
      expect(mockCollection).toHaveBeenCalledWith(
        expect.anything(), 'groups', 'g1', 'campaigns', 'c1', 'npcs'
      );
    });

    test('refuses when the caller is not a member of the group', async () => {
      mockGetGroupUserProfile.mockResolvedValue(null);

      const svc = CampaignService.getInstance();
      await expect(svc.getCampaignCounts('g1', 'c1')).rejects.toThrow(
        'You are not a member of this group'
      );
      expect(mockGetCountFromServer).not.toHaveBeenCalled();
    });

    test('rejects when an aggregation fails', async () => {
      mockGetCountFromServer.mockRejectedValue(new Error('permission-denied'));

      // The caller decides what a missing count means. For the switcher it
      // means the row shows its name and no second line -- never an error.
      const svc = CampaignService.getInstance();
      await expect(svc.getCampaignCounts('g1', 'c1')).rejects.toThrow(
        'permission-denied'
      );
    });
  });
});

export {};
