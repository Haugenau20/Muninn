// src/setupTests.ts
import '@testing-library/jest-dom';
import 'jest-extended';

// Set environment to use emulators for tests
process.env.REACT_APP_USE_EMULATORS = 'true';
process.env.NODE_ENV = 'test';

// Polyfill crypto.randomUUID, which JSDOM does not implement.
// Production code uses it to generate ids (rumor notes, quest conversion,
// quest objectives). `QuestFormSections` was the third caller until `15-8`
// deleted it. Without this, those code paths throw
// "crypto.randomUUID is not a function" and the test aborts before reaching
// any assertion — so the behaviour under test was never actually exercised.
// See bug #300. Uses a counter rather than randomness so ids are deterministic
// and assertable; the shape matches a v4 UUID.
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {};
}
// Web Crypto's digest, which Node has and JSDOM does not expose: invitation
// tokens are looked up by their SHA-256 (T145).
if (!globalThis.crypto.subtle) {
  (globalThis.crypto as any).subtle = require('crypto').webcrypto.subtle;
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  let uuidCounter = 0;
  (globalThis.crypto as any).randomUUID = () => {
    uuidCounter += 1;
    const suffix = uuidCounter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  };
}

// Polyfill TextEncoder/TextDecoder, which Node has and jest's JSDOM
// environment does not expose. React Router 7 builds one when its module
// loads, so without this every suite that imports the router fails to run
// before any test does ("TextEncoder is not defined"). Browsers have both.
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// Mock Firebase for unit tests (will be bypassed when using emulator integration tests)
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  getApp: jest.fn()
}));

jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  getFirestore: jest.fn(),
  initializeFirestore: jest.fn(),
  memoryLocalCache: jest.fn(),
  clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(),
  writeBatch: jest.fn(),
  connectFirestoreEmulator: jest.fn()
}));

// getStorage answers with an object, as the real one always does: the service
// registry refuses an undefined entry, so a bare jest.fn() would break every
// service constructed in a suite that doesn't mock Storage itself.
jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(() => ({})),
  connectStorageEmulator: jest.fn(),
  ref: jest.fn(),
  uploadBytesResumable: jest.fn(),
  getDownloadURL: jest.fn(),
  deleteObject: jest.fn()
}));

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
  connectAuthEmulator: jest.fn()
}));

// Mock console.warn for cleaner test output
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = (...args) => {
    // Suppress Firebase warnings in tests
    if (args[0]?.includes('Firebase') || 
        args[0]?.includes('emulator')) {
      return;
    }
    originalWarn(...args);
  };
});

afterAll(() => {
  console.warn = originalWarn;
});