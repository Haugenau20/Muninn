// src/core/services/firebase/group/__tests__/InvitationService.test.ts

/**
 * Tests for InvitationService
 *
 * All Firebase SDK calls are mocked, and so is UserService, which
 * InvitationService depends on. Joining a group is a Cloud Function call
 * (`redeemInvitation`, T052), so these tests pin what is sent to it; what it
 * does with that is pinned by `firebase/functions/test/redeemInvitation.test.ts`.
 */

import { hashInvitationToken } from '@/core/utils/registration-token';

// ─── Shared mock fns ─────────────────────────────────────────────────────────

const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockCallable = jest.fn();
const mockCollection = jest.fn((_db: any, ...segs: string[]) => ({ path: segs.join('/') }));
const mockDoc = jest.fn((_db_or_ref: any, ...segs: string[]) => ({
  path: segs.join('/'),
  id: segs[segs.length - 1] || 'gen-id',
}));

// UserService mock
const mockIsUserAdmin = jest.fn();
const mockIsUsernameAvailableInGroup = jest.fn();
const mockUserServiceInstance = {
  isUserAdmin: mockIsUserAdmin,
  isUsernameAvailableInGroup: mockIsUsernameAvailableInGroup,
  getGroupUserProfile: jest.fn(),
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
  deleteDoc: function() { return (mockDeleteDoc as Function).apply(null, arguments); },
}));

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: { uid: 'admin-user', email: 'admin@test.com' } })),
  connectAuthEmulator: jest.fn(),
}));

jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
jest.mock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => mockCallable(name, data),
}));

jest.mock('@/core/services/firebase/config/firebaseConfig', () => ({
  firebaseConfig: { apiKey: 'test', projectId: 'test' },
  useEmulators: false,
  emulatorHost: 'localhost',
  emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
}));

jest.mock('@/core/services/firebase/core/ServiceRegistry', () => {
  const registry = new Map<string, any>([
    ['userService', mockUserServiceInstance],
  ]);
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

jest.mock('@/core/services/firebase/user/UserService', () => ({
  __esModule: true,
  default: { getInstance: jest.fn(() => mockUserServiceInstance) },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDocSnapshot(exists: boolean, data: Record<string, any> = {}) {
  return { exists: () => exists, data: () => data, id: 'doc-id' };
}

/** Serve `docs`, by path, to every `getDoc`; any other document does not exist. */
function serveDocs(docs: Record<string, Record<string, any>>) {
  mockGetDoc.mockImplementation(async (ref: { path: string }) =>
    ref.path in docs ? makeDocSnapshot(true, docs[ref.path]) : makeDocSnapshot(false)
  );
}

/** Store an invitation in group g1 the way `createInvitation` does: under its token's hash (T145). */
async function serveInvitation(token: string, data: Record<string, any>) {
  serveDocs({ [`groups/g1/registrationTokens/${await hashInvitationToken(token)}`]: data });
}

function makeQuerySnapshot(docs: ReturnType<typeof makeDocSnapshot>[]) {
  return { docs };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('InvitationService', () => {
  let InvitationService: typeof import('../InvitationService').default;
  const ADMIN_UID = 'admin-user';

  beforeEach(() => {
    jest.resetModules();

    const registry = new Map<string, any>([
      ['userService', mockUserServiceInstance],
    ]);
    jest.doMock('@/core/services/firebase/core/ServiceRegistry', () => ({
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
      deleteDoc: function() { return (mockDeleteDoc as Function).apply(null, arguments); },
    }));
    jest.doMock('firebase/auth', () => ({
      getAuth: jest.fn(() => ({ currentUser: { uid: ADMIN_UID, email: 'admin@test.com' } })),
      connectAuthEmulator: jest.fn(),
    }));
    jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
    jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
    jest.doMock('firebase/functions', () => ({
      getFunctions: jest.fn(() => ({})),
      connectFunctionsEmulator: jest.fn(),
      httpsCallable: (_functions: unknown, name: string) => (data: unknown) => mockCallable(name, data),
    }));
    jest.doMock('@/core/services/firebase/config/firebaseConfig', () => ({
      firebaseConfig: { apiKey: 'test', projectId: 'test' },
      useEmulators: false,
      emulatorHost: 'localhost',
      emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
    }));

    [mockGetDoc, mockSetDoc, mockUpdateDoc, mockDeleteDoc, mockGetDocs,
     mockCallable,
     mockIsUserAdmin, mockIsUsernameAvailableInGroup
    ].forEach(m => m.mockReset());

    InvitationService = require('../InvitationService').default;
  });

  // ─── getInstance ────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    test('should return an InvitationService instance', () => {
      expect(InvitationService.getInstance()).toBeDefined();
    });

    test('should be a singleton', () => {
      expect(InvitationService.getInstance()).toBe(InvitationService.getInstance());
    });
  });

  // ─── generateGroupRegistrationToken ──────────────────────────────────────

  describe('generateGroupRegistrationToken', () => {
    // T145: the invitation is made by `createInvitation`, which checks the
    // caller is an admin and stores it under its token's hash; the browser
    // writes nothing. What the function stores is pinned by
    // `firebase/functions/test/invitations.test.ts`.
    test('should make the invitation through the Cloud Function and return its token, writing nothing itself', async () => {
      mockCallable.mockResolvedValueOnce({ data: { token: 'fresh-token', invitationId: 'abc', expiresAt: 0 } });
      const svc = InvitationService.getInstance();

      const token = await svc.generateGroupRegistrationToken('g1', 'for Sam');

      expect(token).toBe('fresh-token');
      expect(mockCallable).toHaveBeenCalledWith('createInvitation', { groupId: 'g1', notes: 'for Sam' });
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    test("should surface the function's refusal", async () => {
      mockCallable.mockRejectedValueOnce(new Error("Only the group's admins can invite someone."));
      const svc = InvitationService.getInstance();
      await expect(svc.generateGroupRegistrationToken('g1')).rejects.toThrow("Only the group's admins");
    });
  });

  // ─── revealGroupRegistrationToken ─────────────────────────────────────────

  describe('revealGroupRegistrationToken', () => {
    test("should ask the Cloud Function for an invitation's token by its id", async () => {
      mockCallable.mockResolvedValueOnce({ data: { token: 'the-token' } });
      const svc = InvitationService.getInstance();

      expect(await svc.revealGroupRegistrationToken('g1', 'hash-id')).toBe('the-token');
      expect(mockCallable).toHaveBeenCalledWith('revealInvitation', { groupId: 'g1', invitationId: 'hash-id' });
    });

    test("should surface the function's refusal", async () => {
      mockCallable.mockRejectedValueOnce(new Error('This invitation has been used.'));
      const svc = InvitationService.getInstance();
      await expect(svc.revealGroupRegistrationToken('g1', 'hash-id')).rejects.toThrow('has been used');
    });
  });

  // ─── validateRegistrationToken ────────────────────────────────────────────

  describe('validateRegistrationToken', () => {
    test('should return isValid=false when no groupId in URL', async () => {
      // window.location.search has no groupId
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '' },
      });
      const svc = InvitationService.getInstance();
      const result = await svc.validateRegistrationToken('some-token');
      expect(result.isValid).toBe(false);
    });

    test('should return isValid=true when token exists and is unused', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('valid-token', { scheme: 'sha256', used: false });
      const svc = InvitationService.getInstance();
      const result = await svc.validateRegistrationToken('valid-token');
      expect(result.isValid).toBe(true);
      expect(result.groupId).toBe('g1');
    });

    test('should return isValid=false when token is marked as used', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('used-token', { scheme: 'sha256', used: true });
      const svc = InvitationService.getInstance();
      const result = await svc.validateRegistrationToken('used-token');
      expect(result.isValid).toBe(false);
    });

    test('should return isValid=false when token has expired', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('expired-token', { scheme: 'sha256', used: false, expiresAt: new Date(Date.now() - 1000) });
      const svc = InvitationService.getInstance();
      const result = await svc.validateRegistrationToken('expired-token');
      expect(result.isValid).toBe(false);
    });

    test('should read a Timestamp-shaped expiry as Firestore returns it', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      const expired = { toDate: () => new Date(Date.now() - 1000) };
      await serveInvitation('expired-token', { scheme: 'sha256', used: false, expiresAt: expired });
      const svc = InvitationService.getInstance();
      expect((await svc.validateRegistrationToken('expired-token')).isValid).toBe(false);
    });

    test('should return isValid=true for an unexpired token', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('live-token', { scheme: 'sha256', used: false, expiresAt: new Date(Date.now() + 60_000) });
      const svc = InvitationService.getInstance();
      expect((await svc.validateRegistrationToken('live-token')).isValid).toBe(true);
    });

    test('should refuse an invitation made before T145, stored under its token with no scheme', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      serveDocs({ 'groups/g1/registrationTokens/old-token': { token: 'old-token', used: false } });
      const svc = InvitationService.getInstance();
      expect((await svc.validateRegistrationToken('old-token')).isValid).toBe(false);
    });

    test('should refuse a document under the hash that carries no scheme', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('the-token', { used: false });
      const svc = InvitationService.getInstance();
      expect((await svc.validateRegistrationToken('the-token')).isValid).toBe(false);
    });

    test("should refuse an invitation's id presented as its token (T145)", async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('the-token', { scheme: 'sha256', used: false });
      const id = (await hashInvitationToken('the-token')) as string;
      const svc = InvitationService.getInstance();
      expect((await svc.validateRegistrationToken(id)).isValid).toBe(false);
    });

    test('should return isValid=false when token document does not exist', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      serveDocs({});
      const svc = InvitationService.getInstance();
      const result = await svc.validateRegistrationToken('nonexistent-token');
      expect(result.isValid).toBe(false);
    });

    test('should return isValid=false when Firestore throws', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      mockGetDoc.mockRejectedValueOnce(new Error('network error'));
      const svc = InvitationService.getInstance();
      const result = await svc.validateRegistrationToken('bad-token');
      expect(result.isValid).toBe(false);
    });
  });

  // ─── getGroupRegistrationTokens ────────────────────────────────────────────

  describe('getGroupRegistrationTokens', () => {
    test('should throw when user is not admin', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(false);
      const svc = InvitationService.getInstance();
      await expect(svc.getGroupRegistrationTokens('g1')).rejects.toThrow(
        'Only group admins can view registration tokens'
      );
    });

    test('should return tokens list when user is admin', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(true);
      mockGetDocs.mockResolvedValueOnce(
        makeQuerySnapshot([
          { exists: () => true, data: () => ({ token: 't1', used: false, createdAt: null, usedAt: null }), id: 't1' },
        ])
      );
      const svc = InvitationService.getInstance();
      const tokens = await svc.getGroupRegistrationTokens('g1');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].id).toBe('t1');
    });

    test('should convert a stored expiry Timestamp to a Date', async () => {
      const expiry = new Date('2026-10-07T12:00:00.000Z');
      mockIsUserAdmin.mockResolvedValueOnce(true);
      mockGetDocs.mockResolvedValueOnce(
        makeQuerySnapshot([
          { exists: () => true, data: () => ({ used: false, expiresAt: { toDate: () => expiry } }), id: 't1' },
        ] as any)
      );
      const svc = InvitationService.getInstance();
      const tokens = await svc.getGroupRegistrationTokens('g1');
      expect(tokens[0].expiresAt).toBe(expiry);
    });

    // The document id is the invitation's identity (since T145, its token's
    // hash). Neither a stored `token` field, from before T145, nor the sealed
    // copy is handed on: a link is built only from what the server reveals.
    test('should name each invitation by its document id, and pass on no token or sealed copy', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(true);
      mockGetDocs.mockResolvedValueOnce(
        makeQuerySnapshot([
          {
            exists: () => true,
            data: () => ({ token: 'stale-value', sealed: 'v1.x.y.z', used: false, createdAt: null, usedAt: null }),
            id: 'the-real-doc-id',
          },
        ])
      );
      const svc = InvitationService.getInstance();
      const tokens = await svc.getGroupRegistrationTokens('g1');
      expect(tokens[0].id).toBe('the-real-doc-id');
      expect(tokens[0]).not.toHaveProperty('token');
      expect(tokens[0]).not.toHaveProperty('sealed');
    });
  });

  // ─── updateGroupRegistrationTokenNotes ────────────────────────────────────

  describe('updateGroupRegistrationTokenNotes', () => {
    test('should throw when user is not admin', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(false);
      const svc = InvitationService.getInstance();
      await expect(
        svc.updateGroupRegistrationTokenNotes('g1', 'tok', 'For Boromir')
      ).rejects.toThrow('Only group admins can update registration tokens');
    });

    test('should write the note when user is admin', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(true);
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = InvitationService.getInstance();
      await svc.updateGroupRegistrationTokenNotes('g1', 'tok', 'For Boromir');
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
        notes: 'For Boromir',
      });
    });

    // An admin edit must never be able to resurrect a spent invitation, so the
    // payload carries one field and nothing else.
    test('should write only the note, never the used flags', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(true);
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = InvitationService.getInstance();
      await svc.updateGroupRegistrationTokenNotes('g1', 'tok', 'x');
      const payload = mockUpdateDoc.mock.calls[0][1];
      expect(Object.keys(payload)).toEqual(['notes']);
    });

    test('should allow clearing the note', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(true);
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = InvitationService.getInstance();
      await svc.updateGroupRegistrationTokenNotes('g1', 'tok', '');
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), { notes: '' });
    });
  });

  // ─── deleteGroupRegistrationToken ─────────────────────────────────────────

  describe('deleteGroupRegistrationToken', () => {
    test('should throw when user is not admin', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(false);
      const svc = InvitationService.getInstance();
      await expect(svc.deleteGroupRegistrationToken('g1', 'token-to-del')).rejects.toThrow(
        'Only group admins can delete registration tokens'
      );
    });

    test('should call deleteDoc when user is admin', async () => {
      mockIsUserAdmin.mockResolvedValueOnce(true);
      mockDeleteDoc.mockResolvedValueOnce(undefined);
      const svc = InvitationService.getInstance();
      await svc.deleteGroupRegistrationToken('g1', 'token-abc');
      expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    });
  });

  // ─── joinGroupWithToken ────────────────────────────────────────────────────

  describe('joinGroupWithToken', () => {
    test('should throw when token is invalid', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '' }, // no groupId → invalid
      });
      const svc = InvitationService.getInstance();
      await expect(svc.joinGroupWithToken('bad-token', 'User')).rejects.toThrow(
        'Invalid or expired invitation token'
      );
    });

    test('should redeem the token through the Cloud Function, writing nothing itself (T052)', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      // validateRegistrationToken → valid
      await serveInvitation('valid-token', { scheme: 'sha256', used: false });
      mockCallable.mockResolvedValueOnce({ data: { success: true, groupId: 'g1' } });

      const svc = InvitationService.getInstance();
      await svc.joinGroupWithToken('valid-token', 'NewUser');
      expect(mockCallable).toHaveBeenCalledWith('redeemInvitation', {
        groupId: 'g1',
        token: 'valid-token',
        username: 'NewUser',
      });
      // Membership and the spent token are the function's to write; a client
      // write to either is exactly what the rules now refuse.
      expect(mockUpdateDoc).not.toHaveBeenCalled();
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    test("should surface the function's refusal", async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('valid-token', { scheme: 'sha256', used: false });
      mockCallable.mockRejectedValueOnce(new Error('This invitation has already been used. Ask for a new link.'));

      const svc = InvitationService.getInstance();
      await expect(svc.joinGroupWithToken('valid-token', 'NewUser')).rejects.toThrow(
        'This invitation has already been used'
      );
    });
  });

  describe('joinGroupWithToken — expiry (T013)', () => {
    test('should refuse an expired token and join nothing', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('expired-token', { scheme: 'sha256', used: false, expiresAt: new Date(Date.now() - 1000) });
      const svc = InvitationService.getInstance();
      await expect(svc.joinGroupWithToken('expired-token', 'User')).rejects.toThrow(
        'Invalid or expired invitation token'
      );
      expect(mockCallable).not.toHaveBeenCalled();
    });
  });

  // ─── signUpWithToken ───────────────────────────────────────────────────────

  // Replaces the `signUpWithToken` suite. Creating an account with a password
  // from the client was removed on purpose (T022): accounts are now created by
  // a magic link or Google, and only for an address an invitation reserved.
  describe('reserveSignUp', () => {
    test('should refuse an invalid token without calling the function', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '' },
      });
      const svc = InvitationService.getInstance();
      await expect(svc.reserveSignUp('bad-token', 'a@b.com')).rejects.toThrow(
        'Invalid or expired invitation token'
      );
      expect(mockCallable).not.toHaveBeenCalled();
    });

    test('should reserve the address through the Cloud Function, writing nothing itself', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('valid-token', { scheme: 'sha256', used: false });
      mockCallable.mockResolvedValueOnce({ data: { success: true } });

      const svc = InvitationService.getInstance();
      await svc.reserveSignUp('valid-token', 'frodo@shire.dev');

      expect(mockCallable).toHaveBeenCalledWith('reserveSignUp', {
        groupId: 'g1',
        token: 'valid-token',
        email: 'frodo@shire.dev',
      });
      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    test("should surface the function's refusal", async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { search: '?groupId=g1' },
      });
      await serveInvitation('valid-token', { scheme: 'sha256', used: false });
      mockCallable.mockRejectedValueOnce(new Error('ACCOUNTS_FULL: This site is not taking new accounts right now.'));

      const svc = InvitationService.getInstance();
      await expect(svc.reserveSignUp('valid-token', 'frodo@shire.dev')).rejects.toThrow('ACCOUNTS_FULL');
    });
  });

  // T127: a founder link is server-only, so the function checks it; the
  // client reads nothing first and sends no group.
  describe('reserveFounderSignUp', () => {
    test('reserves the address against the founder link through the Cloud Function alone', async () => {
      mockCallable.mockResolvedValueOnce({ data: { success: true } });

      const svc = InvitationService.getInstance();
      await svc.reserveFounderSignUp('f-tok', 'aragorn@gondor.test');

      expect(mockCallable).toHaveBeenCalledWith('reserveSignUp', {
        founderToken: 'f-tok',
        email: 'aragorn@gondor.test',
      });
      expect(mockGetDoc).not.toHaveBeenCalled();
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    test("surfaces the function's refusal", async () => {
      mockCallable.mockRejectedValueOnce(
        new Error('This link to start a group has already been used. Ask for a new one.')
      );
      const svc = InvitationService.getInstance();
      await expect(svc.reserveFounderSignUp('f-tok', 'a@b.test')).rejects.toThrow(/already been used/);
    });
  });
});

export {};
