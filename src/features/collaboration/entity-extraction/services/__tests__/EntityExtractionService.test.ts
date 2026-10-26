// src/features/collaboration/entity-extraction/services/__tests__/EntityExtractionService.test.ts

/**
 * Tests for EntityExtractionService
 *
 * Firebase Functions are mocked.  We verify:
 * - UsageLimitExceededError constructor/properties
 * - getInstance singleton
 * - getCurrentUsage / clearUsageCache
 * - extractEntities: success path, unauthenticated, usage-limit error, other errors
 * - fetchUsageStatus: success, unauthenticated, usage-limit error, other errors
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockHttpsCallable = jest.fn();

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
}));

jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: { uid: 'user-ai' } })),
  connectAuthEmulator: jest.fn(),
}));
jest.mock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
jest.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  getFirestore: jest.fn(() => ({})),
  initializeFirestore: jest.fn(() => ({})),
  memoryLocalCache: jest.fn(),
  clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
  connectFirestoreEmulator: jest.fn(),
}));

jest.mock('core/services/firebase/config/firebaseConfig', () => ({
  firebaseConfig: { apiKey: 'test', projectId: 'test' },
  useEmulators: false,
  emulatorHost: 'localhost',
  emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
}));

jest.mock('core/services/firebase/core/ServiceRegistry', () => {
  const registry = new Map<string, any>();
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

function makeUsageStatus() {
  return {
    usage: {
      daily: { count: 5, lastReset: new Date().toISOString(), limit: 10 },
      weekly: { count: 10, lastReset: new Date().toISOString(), limit: 30 },
      monthly: { count: 20, lastReset: new Date().toISOString(), limit: 100 },
    },
    limitExceeded: false,
    nextReset: {
      daily: new Date().toISOString(),
      weekly: new Date().toISOString(),
      monthly: new Date().toISOString(),
    },
  };
}

function makeOpenAIEntity(type: 'npc' | 'location' | 'quest' | 'rumor' = 'npc') {
  return {
    text: 'Test entity',
    type,
    confidence: 0.9,
    details: {
      name: 'Test',
      relationship: 'friendly',
      context: 'test context',
    },
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('EntityExtractionService', () => {
  let EntityExtractionService: typeof import('../EntityExtractionService').default;
  let UsageLimitExceededError: typeof import('../EntityExtractionService').UsageLimitExceededError;

  const authWithUser = { currentUser: { uid: 'user-ai' } };
  const authWithoutUser = { currentUser: null };

  beforeEach(() => {
    jest.resetModules();
    mockHttpsCallable.mockReset();

    const registry = new Map<string, any>();
    jest.doMock('core/services/firebase/core/ServiceRegistry', () => ({
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
    jest.doMock('firebase/functions', () => ({
      getFunctions: jest.fn(() => ({})),
      connectFunctionsEmulator: jest.fn(),
      httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
    }));
    jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
    jest.doMock('firebase/auth', () => ({
      getAuth: jest.fn(() => authWithUser),
      connectAuthEmulator: jest.fn(),
    }));
    jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
    jest.doMock('firebase/firestore', () => ({
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      getFirestore: jest.fn(() => ({})),
      initializeFirestore: jest.fn(() => ({})),
      memoryLocalCache: jest.fn(),
      clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
      persistentLocalCache: jest.fn(),
      persistentMultipleTabManager: jest.fn(),
      connectFirestoreEmulator: jest.fn(),
    }));
    jest.doMock('core/services/firebase/config/firebaseConfig', () => ({
      firebaseConfig: { apiKey: 'test', projectId: 'test' },
      useEmulators: false,
      emulatorHost: 'localhost',
      emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
    }));

    const m = require('../EntityExtractionService');
    EntityExtractionService = m.default;
    UsageLimitExceededError = m.UsageLimitExceededError;
  });

  // ─── UsageLimitExceededError ────────────────────────────────────────────────

  describe('UsageLimitExceededError', () => {
    test('should be an instance of Error', () => {
      const err = new UsageLimitExceededError({
        error: 'limit exceeded',
        code: 'USAGE_LIMIT_EXCEEDED',
        usage: makeUsageStatus(),
        contactInfo: {
          message: 'Contact us',
          contactUrl: '/contact',
          prefilledSubject: 'Limit Request',
        },
      });
      expect(err).toBeInstanceOf(Error);
    });

    test('should set the name to UsageLimitExceededError', () => {
      const err = new UsageLimitExceededError({
        error: 'limit exceeded',
        code: 'USAGE_LIMIT_EXCEEDED',
        usage: makeUsageStatus(),
        contactInfo: { message: '', contactUrl: '', prefilledSubject: '' },
      });
      expect(err.name).toBe('UsageLimitExceededError');
    });

    test('should expose usage property', () => {
      const usage = makeUsageStatus();
      const err = new UsageLimitExceededError({
        error: 'limit exceeded',
        code: 'USAGE_LIMIT_EXCEEDED',
        usage,
        contactInfo: { message: '', contactUrl: '', prefilledSubject: '' },
      });
      expect(err.usage).toBe(usage);
    });

    test('should expose contactInfo property', () => {
      const contactInfo = {
        message: 'Please contact support',
        contactUrl: '/contact',
        prefilledSubject: 'Limit Request',
      };
      const err = new UsageLimitExceededError({
        error: 'limit',
        code: 'USAGE_LIMIT_EXCEEDED',
        usage: makeUsageStatus(),
        contactInfo,
      });
      expect(err.contactInfo).toEqual(contactInfo);
    });
  });

  // ─── getInstance ────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    test('should return an EntityExtractionService instance', () => {
      expect(EntityExtractionService.getInstance()).toBeDefined();
    });

    test('should be a singleton', () => {
      expect(EntityExtractionService.getInstance()).toBe(EntityExtractionService.getInstance());
    });
  });

  // ─── getCurrentUsage / clearUsageCache ──────────────────────────────────────

  describe('getCurrentUsage', () => {
    test('should return null initially', () => {
      const svc = EntityExtractionService.getInstance();
      expect(svc.getCurrentUsage()).toBeNull();
    });
  });

  describe('clearUsageCache', () => {
    test('should set current usage to null', async () => {
      // Populate usage via fetchUsageStatus
      const usage = makeUsageStatus();
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: true, usage },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      await svc.fetchUsageStatus();
      expect(svc.getCurrentUsage()).not.toBeNull();

      svc.clearUsageCache();
      expect(svc.getCurrentUsage()).toBeNull();
    });
  });

  // ─── extractEntities ────────────────────────────────────────────────────────

  describe('extractEntities', () => {
    test('should throw "User not authenticated" when no current user', async () => {
      jest.resetModules();
      const reg = new Map<string, any>();
      jest.doMock('core/services/firebase/core/ServiceRegistry', () => ({
        __esModule: true,
        default: {
          getInstance: jest.fn(() => ({
            get: (n: string) => { if (!reg.has(n)) throw new Error(`Service '${n}' not found`); return reg.get(n); },
            register: (n: string, s: any) => reg.set(n, s),
            has: (n: string) => reg.has(n),
          })),
        },
      }));
      jest.doMock('firebase/auth', () => ({
        getAuth: jest.fn(() => authWithoutUser),
        connectAuthEmulator: jest.fn(),
      }));
      jest.doMock('firebase/functions', () => ({
        getFunctions: jest.fn(() => ({})),
        connectFunctionsEmulator: jest.fn(),
        httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
      }));
      jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
      jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
      jest.doMock('firebase/firestore', () => ({
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        getFirestore: jest.fn(() => ({})),
        initializeFirestore: jest.fn(() => ({})),
        memoryLocalCache: jest.fn(),
        clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
        persistentLocalCache: jest.fn(),
        persistentMultipleTabManager: jest.fn(),
        connectFirestoreEmulator: jest.fn(),
      }));
      jest.doMock('core/services/firebase/config/firebaseConfig', () => ({
        firebaseConfig: { apiKey: 'test', projectId: 'test' },
        useEmulators: false, emulatorHost: 'localhost',
        emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
      }));
      const EES = require('../EntityExtractionService').default;
      await expect(EES.getInstance().extractEntities('Some content')).rejects.toThrow(
        'User not authenticated'
      );
    });

    test('should return mapped ExtractedEntity array on success', async () => {
      const entities = [makeOpenAIEntity('npc'), makeOpenAIEntity('location')];
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: true, entities, usage: makeUsageStatus() },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      const result = await svc.extractEntities('Some note content');
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('npc');
      expect(result[1].type).toBe('location');
    });

    test('should store usage after successful extraction', async () => {
      const usage = makeUsageStatus();
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: true, entities: [makeOpenAIEntity()], usage },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      await svc.extractEntities('Content');
      expect(svc.getCurrentUsage()).toBe(usage);
    });

    test('should throw "No entities returned" when success=false or entities missing', async () => {
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: false },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      await expect(svc.extractEntities('Content')).rejects.toThrow('No entities returned');
    });

    test('should throw UsageLimitExceededError on resource-exhausted Firebase error', async () => {
      const usage = makeUsageStatus();
      const firebaseError = {
        code: 'functions/resource-exhausted',
        message: 'USAGE_LIMIT_EXCEEDED: limit hit',
        details: {
          usage,
          contactInfo: {
            message: 'Contact us',
            contactUrl: '/contact',
            prefilledSubject: 'Limit',
          },
        },
      };
      const mockFn = jest.fn().mockRejectedValueOnce(firebaseError);
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      await expect(svc.extractEntities('Content')).rejects.toThrow(UsageLimitExceededError);
    });

    test('should throw generic Error for other Firebase function errors', async () => {
      const firebaseError = {
        code: 'functions/internal',
        message: 'Internal server error',
        details: null,
      };
      const mockFn = jest.fn().mockRejectedValueOnce(firebaseError);
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      await expect(svc.extractEntities('Content')).rejects.toThrow('Internal server error');
    });

    // T129: the OpenAI account ran dry, so the function says extraction is paused.
    test('says smart detection is paused, and that nothing was counted, when the function does', async () => {
      const firebaseError = {
        code: 'functions/unavailable',
        message: 'AI_EXTRACTION_PAUSED',
        details: undefined,
      };
      const mockFn = jest.fn().mockRejectedValueOnce(firebaseError);
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      const message = await svc.extractEntities('Content').then(
        () => 'resolved',
        (e: Error) => e.message
      );
      expect(message).toMatch(/smart detection is paused/i);
      expect(message).toMatch(/not counted against your limit/i);
      expect(message).not.toMatch(/AI_EXTRACTION_PAUSED/);
    });

    test('should re-throw non-Firebase errors as-is', async () => {
      const mockFn = jest.fn().mockRejectedValueOnce(new Error('network failure'));
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      await expect(svc.extractEntities('Content')).rejects.toThrow('network failure');
    });

    /*
      These two replace a pair that pinned the opposite contract -- that the
      service defaults to `gpt-3.5-turbo` and forwards any model it is handed.
      That was an accurate description of the code and a description of the
      defect: the callable passed the value to OpenAI unchecked, so a modified
      client could bill this project's key for any model on the price list.
      The model is now pinned in the function, so what needs pinning here is
      that the request carries nothing else.
    */
    test('sends only the content -- the model is pinned in the function', async () => {
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: true, entities: [makeOpenAIEntity()] },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      await svc.extractEntities('Content');

      // Exact, not `objectContaining`: an extra key is the whole failure mode.
      expect(mockFn).toHaveBeenCalledWith({ content: 'Content' });
      expect(Object.keys(mockFn.mock.calls[0][0])).toEqual(['content']);
    });

    test('a caller passing a model cannot get it into the request', async () => {
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: true, entities: [makeOpenAIEntity()] },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      // The signature no longer accepts one; this is the JS caller TypeScript
      // cannot stop, and the reason the parameter was deleted rather than
      // defaulted. `gpt-5.2-pro` is the expensive end of the price list.
      await (svc.extractEntities as unknown as (
        c: string, m?: string
      ) => Promise<unknown>)('Content', 'gpt-5.2-pro');

      expect(mockFn).toHaveBeenCalledWith({ content: 'Content' });
      expect(JSON.stringify(mockFn.mock.calls[0][0])).not.toContain('gpt-5.2-pro');
    });

    // T155: the function may run for 90 s. The SDK gives up after 70 s by
    // default, which would drop a call that is still being served and counted.
    test('waits longer for the extraction than the function may take', async () => {
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: true, entities: [makeOpenAIEntity()] },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      await svc.extractEntities('Content');

      const [, name, options] = mockHttpsCallable.mock.calls[0];
      expect(name).toBe('extractEntities');
      expect(options?.timeout).toBeGreaterThan(90_000);
    });

    // T019: the function reads the group's characters to keep the party out
    // of the NPC suggestions, so it needs to know which group. Only the id
    // travels -- the roster is read on the server.
    test('sends the active group with the content, and still no model', async () => {
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: true, entities: [makeOpenAIEntity()] },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      svc.setActiveGroup('group-1');
      try {
        await svc.extractEntities('Content');
      } finally {
        svc.setActiveGroup(null);
      }

      expect(mockFn).toHaveBeenCalledWith({ content: 'Content', groupId: 'group-1' });
    });
  });

  // ─── fetchUsageStatus ───────────────────────────────────────────────────────

  describe('fetchUsageStatus', () => {
    test('should return null when no user is authenticated', async () => {
      jest.resetModules();
      const reg = new Map<string, any>();
      jest.doMock('core/services/firebase/core/ServiceRegistry', () => ({
        __esModule: true,
        default: {
          getInstance: jest.fn(() => ({
            get: (n: string) => { if (!reg.has(n)) throw new Error(`Service '${n}' not found`); return reg.get(n); },
            register: (n: string, s: any) => reg.set(n, s),
            has: (n: string) => reg.has(n),
          })),
        },
      }));
      jest.doMock('firebase/auth', () => ({
        getAuth: jest.fn(() => authWithoutUser),
        connectAuthEmulator: jest.fn(),
      }));
      jest.doMock('firebase/functions', () => ({
        getFunctions: jest.fn(() => ({})),
        connectFunctionsEmulator: jest.fn(),
        httpsCallable: function() { return (mockHttpsCallable as Function).apply(null, arguments); },
      }));
      jest.doMock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
      jest.doMock('firebase/analytics', () => ({ getAnalytics: jest.fn(() => ({})) }));
      jest.doMock('firebase/firestore', () => ({
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        getFirestore: jest.fn(() => ({})),
        initializeFirestore: jest.fn(() => ({})),
        memoryLocalCache: jest.fn(),
        clearIndexedDbPersistence: jest.fn(() => Promise.resolve()),
        persistentLocalCache: jest.fn(),
        persistentMultipleTabManager: jest.fn(),
        connectFirestoreEmulator: jest.fn(),
      }));
      jest.doMock('core/services/firebase/config/firebaseConfig', () => ({
        firebaseConfig: { apiKey: 'test', projectId: 'test' },
        useEmulators: false, emulatorHost: 'localhost',
        emulatorPorts: { auth: '9099', firestore: '8080', functions: '5001' },
      }));
      const EES = require('../EntityExtractionService').default;
      const result = await EES.getInstance().fetchUsageStatus();
      expect(result).toBeNull();
    });

    test('should return usage on success', async () => {
      const usage = makeUsageStatus();
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: true, usage },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      const result = await svc.fetchUsageStatus();
      expect(result).toBe(usage);
    });

    test('should return null when success=false or no usage in response', async () => {
      const mockFn = jest.fn().mockResolvedValueOnce({
        data: { success: false },
      });
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      const result = await svc.fetchUsageStatus();
      expect(result).toBeNull();
    });

    test('should extract usage from resource-exhausted error details', async () => {
      const usage = makeUsageStatus();
      const firebaseError = {
        code: 'functions/resource-exhausted',
        message: 'limit exceeded',
        details: { usage },
      };
      const mockFn = jest.fn().mockRejectedValueOnce(firebaseError);
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      const result = await svc.fetchUsageStatus();
      expect(result).toBe(usage);
    });

    test('should return null and not throw on unknown errors', async () => {
      const mockFn = jest.fn().mockRejectedValueOnce(new Error('network error'));
      mockHttpsCallable.mockReturnValueOnce(mockFn);

      const svc = EntityExtractionService.getInstance();
      const result = await svc.fetchUsageStatus();
      expect(result).toBeNull();
    });
  });
});

export {};
