// src/core/services/firebase/user/__tests__/UserService.test.ts

/**
 * Tests for UserService
 *
 * All Firebase SDK calls are mocked.  We verify that UserService routes
 * to the correct Firestore paths and returns/transforms data correctly.
 */

// ─── Firestore mock ──────────────────────────────────────────────────────────

const mockGetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockRunTransaction = jest.fn();
const mockDoc = jest.fn((db: any, ...segments: string[]) => ({ path: segments.join('/') }));
const mockHttpsCallable = jest.fn();

// Distinguishes BaseFirebaseService's regioned getFunctions(app, 'europe-west1')
// call (made once, at construction) from a bare getFunctions() call made from
// inside a method -- the defect this suite guards against.
const REGIONED_FUNCTIONS_INSTANCE = { __label: 'regioned-functions' };
const mockGetFunctions = jest.fn((...args: any[]) =>
  args[1] === 'europe-west1' ? REGIONED_FUNCTIONS_INSTANCE : { __label: 'bare-functions' }
);

jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  getFirestore: jest.fn(() => ({})),
  initializeFirestore: jest.fn(() => ({})),
  memoryLocalCache: jest.fn(),
  clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
  connectFirestoreEmulator: jest.fn(),
  getDoc: (a: any) => mockGetDoc(a),
  updateDoc: (a: any, b: any) => mockUpdateDoc(a, b),
  setDoc: (a: any, b: any) => mockSetDoc(a, b),
  runTransaction: (a: any, b: any) => mockRunTransaction(a, b),
  doc: (a: any, ...rest: string[]) => mockDoc(a, ...rest),
}));

jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: { uid: 'user-123' } })),
  connectAuthEmulator: jest.fn(),
}));
jest.mock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
jest.mock('firebase/functions', () => ({
  getFunctions: function() { return (mockGetFunctions as Function).apply(null, arguments); },
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
}));
jest.mock('@/core/services/firebase/config/firebaseConfig', () => ({
  firebaseConfig: { apiKey: 'test', projectId: 'test' },
  useEmulators: false,
  emulatorHost: 'localhost',
  emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeDocSnapshot(exists: boolean, data: Record<string, any> = {}) {
  return { exists: () => exists, data: () => data, id: 'doc-id' };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('UserService', () => {
  let UserService: typeof import('../UserService').default;

  beforeEach(() => {
    jest.resetModules();

    // Re-apply mocks after resetModules
    jest.doMock('firebase/firestore', () => ({
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      getFirestore: jest.fn(() => ({})),
      initializeFirestore: jest.fn(() => ({})),
      memoryLocalCache: jest.fn(),
      clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
      persistentLocalCache: jest.fn(),
      persistentMultipleTabManager: jest.fn(),
      connectFirestoreEmulator: jest.fn(),
      getDoc: (a: any) => mockGetDoc(a),
      updateDoc: (a: any, b: any) => mockUpdateDoc(a, b),
      setDoc: (a: any, b: any) => mockSetDoc(a, b),
      runTransaction: (a: any, b: any) => mockRunTransaction(a, b),
      doc: (a: any, ...rest: string[]) => mockDoc(a, ...rest),
    }));
    jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
    jest.doMock('firebase/auth', () => ({
      getAuth: jest.fn(() => ({ currentUser: { uid: 'user-123' } })),
      connectAuthEmulator: jest.fn(),
    }));
    jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
    jest.doMock('firebase/functions', () => ({
      getFunctions: function() { return (mockGetFunctions as Function).apply(null, arguments); },
      connectFunctionsEmulator: jest.fn(),
      httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
    }));
    jest.doMock('@/core/services/firebase/config/firebaseConfig', () => ({
      firebaseConfig: { apiKey: 'test', projectId: 'test' },
      useEmulators: false,
      emulatorHost: 'localhost',
      emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
    }));

    mockGetDoc.mockReset();
    mockUpdateDoc.mockReset();
    mockSetDoc.mockReset();
    mockRunTransaction.mockReset();
    mockHttpsCallable.mockReset();
    mockGetFunctions.mockClear();
    mockDoc.mockImplementation((_db: any, ...segments: string[]) => ({
      path: segments.join('/'),
    }));

    UserService = require('../UserService').default;
  });

  // ─── getInstance ────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    test('should return a UserService instance', () => {
      const svc = UserService.getInstance();
      expect(svc).toBeDefined();
    });

    test('should return the same instance every time (singleton)', () => {
      const a = UserService.getInstance();
      const b = UserService.getInstance();
      expect(a).toBe(b);
    });
  });

  // ─── getUserProfile ─────────────────────────────────────────────────────────

  describe('getUserProfile', () => {
    test('should return null when user document does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      const result = await svc.getUserProfile('uid-1');
      expect(result).toBeNull();
    });

    // The mapping is field-by-field, so a field nobody names here is dropped
    // on the way out of Firestore. That is how the account theme came to be
    // written correctly and never read back: every load looked like an account
    // with no theme, and re-migrated the stale group value over it.
    test('returns account preferences, so a stored theme survives the round trip', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, {
          email: 'test@example.com',
          groups: ['g1'],
          activeGroupId: 'g1',
          lastLogin: new Date(),
          createdAt: new Date(),
          preferences: { theme: 'dark' },
        })
      );
      const svc = UserService.getInstance();
      const profile = await svc.getUserProfile('uid-1');
      expect(profile?.preferences?.theme).toBe('dark');
    });

    test('should return a UserProfile when the document exists', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, {
          email: 'test@example.com',
          groups: ['g1', 'g2'],
          activeGroupId: 'g1',
          lastLogin: new Date(),
          createdAt: new Date(),
        })
      );
      const svc = UserService.getInstance();
      const profile = await svc.getUserProfile('uid-1');
      expect(profile).not.toBeNull();
      expect(profile?.id).toBe('uid-1');
      expect(profile?.email).toBe('test@example.com');
    });

    // T136: membership is the group profiles; an array still stored on the
    // account from before is not handed on as if it meant something.
    test('does not carry the old groups array', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(true, { email: 'a@b.com', groups: ['g1'] }));
      const svc = UserService.getInstance();
      const profile = await svc.getUserProfile('uid-1');
      expect(profile).not.toHaveProperty('groups');
    });
  });

  // ─── updateUserProfile ──────────────────────────────────────────────────────

  describe('updateUserProfile', () => {
    test('should call Firestore updateDoc for the correct user document', async () => {
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = UserService.getInstance();
      await svc.updateUserProfile('uid-1', { email: 'new@example.com' });
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getGroupUserProfile ────────────────────────────────────────────────────

  describe('getGroupUserProfile', () => {
    test('should return null when the group user document does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      const result = await svc.getGroupUserProfile('group-1', 'uid-1');
      expect(result).toBeNull();
    });

    test('should return a GroupUserProfile when the document exists', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, {
          username: 'Bilbo',
          role: 'member',
          joinedAt: '2025-01-01',
        })
      );
      const svc = UserService.getInstance();
      const profile = await svc.getGroupUserProfile('group-1', 'uid-1');
      expect(profile).not.toBeNull();
      expect(profile?.userId).toBe('uid-1');
      expect(profile?.username).toBe('Bilbo');
    });
  });

  // ─── updateGroupUserProfile ─────────────────────────────────────────────────

  describe('updateGroupUserProfile', () => {
    test('should call updateDoc with the provided updates', async () => {
      mockUpdateDoc.mockResolvedValueOnce(undefined);
      const svc = UserService.getInstance();
      await svc.updateGroupUserProfile('group-1', 'uid-1', { username: 'Frodo' });
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    });
  });

  // ─── isUsernameAvailableInGroup ─────────────────────────────────────────────

  describe('isUsernameAvailableInGroup', () => {
    test('should return true when the username document does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      const available = await svc.isUsernameAvailableInGroup('group-1', 'Frodo');
      expect(available).toBe(true);
    });

    test('should return false when the username document exists', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(true, { userId: 'uid-99' }));
      const svc = UserService.getInstance();
      const available = await svc.isUsernameAvailableInGroup('group-1', 'Frodo');
      expect(available).toBe(false);
    });

    test('should check the lowercase username in Firestore', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      await svc.isUsernameAvailableInGroup('group-1', 'FRODO');
      // The doc path should use lowercase
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'groups', 'group-1', 'usernames', 'frodo'
      );
    });
  });

  // ─── validateGroupUsername ──────────────────────────────────────────────────

  describe('validateGroupUsername', () => {
    test('should return isValid=false for username with invalid characters', async () => {
      const svc = UserService.getInstance();
      const result = await svc.validateGroupUsername('group-1', 'bad username!');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should return isValid=false for username shorter than 3 characters', async () => {
      const svc = UserService.getInstance();
      const result = await svc.validateGroupUsername('group-1', 'ab');
      expect(result.isValid).toBe(false);
    });

    test('should return isValid=false for username longer than 20 characters', async () => {
      const svc = UserService.getInstance();
      const result = await svc.validateGroupUsername('group-1', 'a'.repeat(21));
      expect(result.isValid).toBe(false);
    });

    test('should return isValid=true and isAvailable=true for a valid, unused username', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false)); // username not taken
      const svc = UserService.getInstance();
      const result = await svc.validateGroupUsername('group-1', 'Frodo');
      expect(result.isValid).toBe(true);
      expect(result.isAvailable).toBe(true);
    });

    test('should return isValid=true and isAvailable=false when username is already taken', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(true, { userId: 'other-user' }));
      const svc = UserService.getInstance();
      const result = await svc.validateGroupUsername('group-1', 'Frodo');
      expect(result.isValid).toBe(true);
      expect(result.isAvailable).toBe(false);
      expect(result.error).toBe('Username already taken');
    });

    test('should return isValid=false when Firestore throws', async () => {
      mockGetDoc.mockRejectedValueOnce(new Error('network error'));
      const svc = UserService.getInstance();
      const result = await svc.validateGroupUsername('group-1', 'Frodo');
      expect(result.isValid).toBe(false);
    });

    test('should accept usernames with allowed special characters (æøå _ -)', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      const result = await svc.validateGroupUsername('group-1', 'Frø_do-123');
      expect(result.isValid).toBe(true);
    });
  });

  // ─── findUserByUsername ─────────────────────────────────────────────────────

  describe('findUserByUsername', () => {
    test('should return null when username document does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      const uid = await svc.findUserByUsername('group-1', 'Bilbo');
      expect(uid).toBeNull();
    });

    test('should return userId when username document exists', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(true, { userId: 'uid-42' }));
      const svc = UserService.getInstance();
      const uid = await svc.findUserByUsername('group-1', 'Bilbo');
      expect(uid).toBe('uid-42');
    });

    test('should look up lowercase username in Firestore', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      await svc.findUserByUsername('group-1', 'BILBO');
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'groups', 'group-1', 'usernames', 'bilbo'
      );
    });
  });

  // ─── isUserAdmin ────────────────────────────────────────────────────────────

  describe('isUserAdmin', () => {
    test('should return true when user has admin role', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { userId: 'uid-1', username: 'Admin', role: 'admin', joinedAt: '' })
      );
      const svc = UserService.getInstance();
      const result = await svc.isUserAdmin('group-1', 'uid-1');
      expect(result).toBe(true);
    });

    test('should return false when user has member role', async () => {
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { userId: 'uid-1', username: 'Bob', role: 'member', joinedAt: '' })
      );
      const svc = UserService.getInstance();
      const result = await svc.isUserAdmin('group-1', 'uid-1');
      expect(result).toBe(false);
    });

    test('should return false when user profile does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      const result = await svc.isUserAdmin('group-1', 'uid-nobody');
      expect(result).toBe(false);
    });
  });

  // ─── changeGroupUsername ────────────────────────────────────────────────────

  describe('changeGroupUsername', () => {
    test('should throw when the new username is already taken', async () => {
      // First getDoc → check availability (exists = taken)
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(true, { userId: 'other' }));
      const svc = UserService.getInstance();
      await expect(svc.changeGroupUsername('group-1', 'uid-1', 'Bilbo')).rejects.toThrow(
        'Username is already taken in this group'
      );
    });

    test('should throw when user profile is not found in the group', async () => {
      // isUsernameAvailableInGroup → available
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      // getDoc for user profile → not found
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      const svc = UserService.getInstance();
      await expect(svc.changeGroupUsername('group-1', 'uid-1', 'NewName')).rejects.toThrow(
        'User profile not found in this group'
      );
    });

    test('should do nothing when new username equals current (case-insensitive)', async () => {
      // isUsernameAvailableInGroup → available (username not in index)
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      // user profile → username 'Frodo'
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { username: 'Frodo', role: 'member', joinedAt: '' })
      );
      // No transaction should be run
      const svc = UserService.getInstance();
      await svc.changeGroupUsername('group-1', 'uid-1', 'frodo');
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    test('should run a transaction when the username changes', async () => {
      // isUsernameAvailableInGroup → available
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      // user profile → current username 'Frodo'
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { username: 'Frodo', role: 'member', joinedAt: '' })
      );
      mockRunTransaction.mockResolvedValueOnce(undefined);
      const svc = UserService.getInstance();
      await svc.changeGroupUsername('group-1', 'uid-1', 'Sam');
      expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    });

    /**
     * Runs the rename against a fake transaction whose reads answer from
     * `reservations` (path → stored data, absent = no document), and returns
     * the transaction so its writes can be inspected.
     */
    async function renameWith(reservations: Record<string, Record<string, any>>) {
      // isUsernameAvailableInGroup → available
      mockGetDoc.mockResolvedValueOnce(makeDocSnapshot(false));
      // user profile → current username 'Frodo'
      mockGetDoc.mockResolvedValueOnce(
        makeDocSnapshot(true, { username: 'Frodo', role: 'member', joinedAt: '' })
      );
      const transaction = {
        get: jest.fn(async (ref: { path: string }) =>
          makeDocSnapshot(ref.path in reservations, reservations[ref.path])
        ),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      };
      mockRunTransaction.mockImplementationOnce((_db: any, fn: any) => fn(transaction));
      await UserService.getInstance().changeGroupUsername('group-1', 'uid-1', 'Sam');
      return transaction;
    }

    test('releases the old name when it is reserved to the user', async () => {
      const transaction = await renameWith({ 'groups/group-1/usernames/frodo': { userId: 'uid-1' } });
      expect(transaction.set).toHaveBeenCalledWith(
        { path: 'groups/group-1/usernames/sam' },
        expect.objectContaining({ userId: 'uid-1', originalUsername: 'Sam' })
      );
      expect(transaction.delete).toHaveBeenCalledWith({ path: 'groups/group-1/usernames/frodo' });
    });

    // A rename made by the profile editor before T080 wrote the name without
    // reserving it. Deleting the missing reservation is refused by the rules,
    // which would fail every later rename of that user.
    test('still renames when the old name was never reserved', async () => {
      const transaction = await renameWith({});
      expect(transaction.update).toHaveBeenCalledWith(
        { path: 'groups/group-1/users/uid-1' },
        { username: 'Sam' }
      );
      expect(transaction.delete).not.toHaveBeenCalled();
    });

    test("never releases a reservation that belongs to someone else", async () => {
      const transaction = await renameWith({ 'groups/group-1/usernames/frodo': { userId: 'uid-2' } });
      expect(transaction.update).toHaveBeenCalled();
      expect(transaction.delete).not.toHaveBeenCalled();
    });
  });

  // ─── deleteAccount ──────────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    test('invokes the deleteUser callable with the user id', async () => {
      const mockCallable = jest.fn().mockResolvedValueOnce({ data: { success: true } });
      mockHttpsCallable.mockReturnValueOnce(mockCallable);

      const svc = UserService.getInstance();
      await svc.deleteAccount('uid-1');

      expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'deleteUser');
      expect(mockCallable).toHaveBeenCalledWith({ userId: 'uid-1' });
    });

    test("uses the service's regioned Functions instance", async () => {
      const mockCallable = jest.fn().mockResolvedValueOnce({ data: { success: true } });
      mockHttpsCallable.mockReturnValueOnce(mockCallable);

      // Construct the singleton first -- this is the ONE legitimate call to
      // getFunctions(app, 'europe-west1'), made by BaseFirebaseService itself.
      const svc = UserService.getInstance();
      mockGetFunctions.mockClear();
      mockHttpsCallable.mockClear();
      mockHttpsCallable.mockReturnValueOnce(mockCallable);

      await svc.deleteAccount('uid-1');

      // The method itself must not call getFunctions() again -- that is
      // exactly the bare, wrongly-regioned call this fix removes.
      expect(mockGetFunctions).not.toHaveBeenCalled();
      expect(mockHttpsCallable).toHaveBeenCalledWith(REGIONED_FUNCTIONS_INSTANCE, 'deleteUser');
    });

    test("propagates the callable's error", async () => {
      const mockCallable = jest.fn().mockRejectedValueOnce(new Error('permission-denied'));
      mockHttpsCallable.mockReturnValueOnce(mockCallable);

      const svc = UserService.getInstance();
      await expect(svc.deleteAccount('uid-1')).rejects.toThrow('permission-denied');
    });
  });
});

export {};
