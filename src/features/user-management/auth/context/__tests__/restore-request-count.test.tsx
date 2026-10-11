// src/features/user-management/auth/context/__tests__/restore-request-count.test.tsx

/**
 * What a sign-in or reload costs before the first page can render (T032,
 * PERF-02).
 *
 * Restore runs the real `FirebaseProvider` over the real services; only the
 * Firestore SDK underneath is replaced, by an in-memory database that counts
 * every request. The budget is one request per document or collection restore
 * actually needs:
 *
 *   users/{uid}                  the account: its active group
 *   users, every group, by uid   the user's group profiles: which groups (T136)
 *   groups/{g}                   the group's metadata, for the switcher
 *   groups/{g}/users/{uid}       membership, username, active campaign
 *   groups/{g}/campaigns         the campaigns to choose from
 *
 * The group profile is asked for twice -- once by the provider and once by
 * `CampaignService.getCampaigns`' membership check, concurrently -- and the
 * services share one request for identical reads in flight (phase 2). This
 * suite is what holds that, and it is why a "single restore orchestrator"
 * rewrite of `FirebaseContext` is not needed: there is no duplicate left to
 * fold.
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';

const UID = 'uid-1';

/** The fake database, by document path. */
const mockDatabase: Record<string, Record<string, unknown>> = {
  [`users/${UID}`]: { email: 'frodo@example.com', activeGroupId: 'g1' },
  'groups/g1': { name: 'The Fellowship' },
  [`groups/g1/users/${UID}`]: { userId: UID, username: 'Frodo', activeCampaignId: 'c2', characters: [] },
  'groups/g1/campaigns/c1': { name: 'There' },
  'groups/g1/campaigns/c2': { name: 'Back Again' },
};

/** Every request that reached the fake Firestore, as `get <path>` or `list <path>`. */
const mockRequests: string[] = [];

const mockSnapshotOf = (path: string) => ({
  id: path.split('/').pop(),
  ref: { path, parent: { parent: { id: path.split('/').slice(-3)[0] } } },
  exists: () => path in mockDatabase,
  data: () => mockDatabase[path],
});

type MockQuery = { path?: string; collectionGroup?: string; constraints?: Array<{ field: string; value: unknown }> };

const mockPathOf = (parent: { path?: string } | undefined, segments: string[]) =>
  parent && parent.path ? [parent.path, ...segments].join('/') : segments.join('/');

jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  initializeFirestore: jest.fn(() => ({})),
  memoryLocalCache: jest.fn(),
  clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
  connectFirestoreEmulator: jest.fn(),
  collection: (parent: { path?: string }, ...segments: string[]) => ({ path: mockPathOf(parent, segments) }),
  doc: (parent: { path?: string }, ...segments: string[]) => ({ path: mockPathOf(parent, segments) }),
  getDoc: async (ref: { path: string }) => {
    mockRequests.push(`get ${ref.path}`);
    return mockSnapshotOf(ref.path);
  },
  getDocs: async (ref: MockQuery) => {
    if (ref.collectionGroup) {
      // Every collection of that name, filtered by the query's equalities.
      const filters = ref.constraints ?? [];
      mockRequests.push(`list */${ref.collectionGroup} where ${filters.map((f) => `${f.field} == ${f.value}`).join(', ')}`);
      const docs = Object.keys(mockDatabase)
        .filter((path) => path.split('/').length % 2 === 0 && path.split('/').slice(-2)[0] === ref.collectionGroup)
        .filter((path) => filters.every((f) => mockDatabase[path][f.field] === f.value))
        .map(mockSnapshotOf);
      return { docs, empty: docs.length === 0, size: docs.length };
    }
    mockRequests.push(`list ${ref.path}`);
    const prefix = `${ref.path}/`;
    const docs = Object.keys(mockDatabase)
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(mockSnapshotOf);
    return { docs, empty: docs.length === 0, size: docs.length };
  },
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  collectionGroup: (_db: unknown, collectionGroup: string) => ({ collectionGroup }),
  query: (ref: MockQuery, ...constraints: Array<{ field: string; value: unknown }>) =>
    ({ ...ref, constraints: [...(ref.constraints ?? []), ...constraints] }),
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  writeBatch: jest.fn(),
  onSnapshot: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: jest.fn(),
}));
jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: { uid: 'uid-1' } })),
  connectAuthEmulator: jest.fn(),
  // Signed in, as a reload finds the user.
  onAuthStateChanged: (_auth: unknown, onChange: (user: unknown) => void) => {
    Promise.resolve().then(() => onChange({ uid: 'uid-1', email: 'frodo@example.com' }));
    return () => undefined;
  },
  GoogleAuthProvider: jest.fn(),
  browserLocalPersistence: {},
  browserSessionPersistence: {},
  setPersistence: jest.fn(),
}));
jest.mock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: jest.fn(),
}));
jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(() => ({})),
  connectStorageEmulator: jest.fn(),
}));
jest.mock('core/services/firebase/config/firebaseConfig', () => ({
  firebaseConfig: { apiKey: 'test', projectId: 'test' },
  useEmulators: false,
  emulatorHost: 'localhost',
  emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001', storage: '9199' },
  SESSION_DURATION: 0,
  REMEMBER_ME_DURATION: 0,
  INACTIVITY_TIMEOUT: 0,
}));

// eslint-disable-next-line import/first
import { FirebaseProvider, useFirebaseContext } from '../FirebaseContext';

/** Renders the provider and reports what it restored. */
const restore = () => {
  const restored: { current: ReturnType<typeof useFirebaseContext> | null } = { current: null };
  const Probe = () => {
    restored.current = useFirebaseContext();
    return null;
  };
  render(
    <FirebaseProvider>
      <Probe />
    </FirebaseProvider>
  );
  return restored;
};

test('restore makes one request per document or collection it needs, and no more', async () => {
  const restored = restore();

  await waitFor(() => expect(restored.current?.loading).toBe(false));
  expect(restored.current?.activeGroupId).toBe('g1');
  expect(restored.current?.activeCampaignId).toBe('c2');
  expect(restored.current?.activeGroupUserProfile?.username).toBe('Frodo');

  expect([...mockRequests].sort()).toEqual([
    'get groups/g1',
    `get groups/g1/users/${UID}`,
    `get users/${UID}`,
    `list */users where userId == ${UID}`,
    'list groups/g1/campaigns',
  ]);
});

test('a profile edit is applied to state without reading anything back (PERF-13)', async () => {
  const restored = restore();
  await waitFor(() => expect(restored.current?.loading).toBe(false));
  const before = mockRequests.length;

  act(() => {
    restored.current?.applyGroupUserProfileChanges({ username: 'Mr Underhill' });
    restored.current?.applyUserProfileChanges({ preferences: { theme: 'parchment' } } as never);
  });

  expect(restored.current?.activeGroupUserProfile?.username).toBe('Mr Underhill');
  expect(restored.current?.userProfile?.preferences).toEqual({ theme: 'parchment' });
  expect(mockRequests.length).toBe(before);
});
