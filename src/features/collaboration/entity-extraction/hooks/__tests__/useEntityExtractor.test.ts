// src/features/collaboration/entity-extraction/hooks/__tests__/useEntityExtractor.test.ts
import { renderHook, act } from '@testing-library/react';
import { useEntityExtractor } from '../useEntityExtractor';
import { ExtractedEntity } from '../../../notes/types';
import { UsageLimitExceededError } from '../../services/EntityExtractionService';
import { UsageStatus } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockExtractEntities = jest.fn();
const mockGetCurrentUsage = jest.fn();

jest.mock('../../services/EntityExtractionService', () => {
  const mockUsageLimitExceededError = class UsageLimitExceededError extends Error {
    public usage: any;
    public contactInfo: any;
    constructor(errorData: any) {
      super(errorData.error);
      this.name = 'UsageLimitExceededError';
      this.usage = errorData.usage;
      this.contactInfo = errorData.contactInfo;
    }
  };

  return {
    __esModule: true,
    UsageLimitExceededError: mockUsageLimitExceededError,
    default: {
      getInstance: jest.fn(),
    },
  };
});

jest.mock('../../context/UsageContext', () => ({
  useUsageContext: jest.fn(),
}));

const EntityExtractionService = require('../../services/EntityExtractionService').default;
const { useUsageContext } = require('../../context/UsageContext');
const { UsageLimitExceededError: MockUsageLimitExceededError } = require('../../services/EntityExtractionService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockUpdateUsageStatus = jest.fn();
const mockSetUsageLimitExceededWithInfo = jest.fn();
const mockRefreshUsageStatus = jest.fn();
const mockClearUsageStatus = jest.fn();
const mockIsExtractionAvailable = jest.fn();

const makePeriodUsage = (count: number, limit: number) => ({
  count,
  limit,
  lastReset: '2025-06-01T00:00:00.000Z',
});

const makeUsageStatus = (overrides: Partial<UsageStatus> = {}): UsageStatus => ({
  limitExceeded: false,
  nextReset: {
    daily: '2025-06-02T00:00:00.000Z',
    weekly: '2025-06-07T00:00:00.000Z',
    monthly: '2025-07-01T00:00:00.000Z',
  },
  usage: {
    isUnlimited: false,
    daily: makePeriodUsage(5, 20),
    weekly: makePeriodUsage(15, 60),
    monthly: makePeriodUsage(30, 200),
  },
  ...overrides,
});

const setupUsageContextMock = (overrides: Record<string, unknown> = {}) => {
  (useUsageContext as jest.Mock).mockReturnValue({
    usageStatus: null,
    isLoadingUsage: false,
    isUsageLimitExceeded: false,
    contactInfo: null,
    refreshUsageStatus: mockRefreshUsageStatus,
    updateUsageStatus: mockUpdateUsageStatus,
    setUsageLimitExceededWithInfo: mockSetUsageLimitExceededWithInfo,
    clearUsageStatus: mockClearUsageStatus,
    isExtractionAvailable: mockIsExtractionAvailable,
    hasUsageData: false,
    isUnlimited: false,
    ...overrides,
  });
};

const setupServiceMock = () => {
  (EntityExtractionService.getInstance as jest.Mock).mockReturnValue({
    extractEntities: mockExtractEntities,
    getCurrentUsage: mockGetCurrentUsage,
  });
};

const makeExtractedEntity = (id: string, text: string): ExtractedEntity => ({
  id,
  text,
  type: 'npc',
  confidence: 0.9,
  isConverted: false,
  createdAt: '2025-06-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useEntityExtractor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupServiceMock();
    setupUsageContextMock();
    mockGetCurrentUsage.mockReturnValue(null);
    mockExtractEntities.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------
  describe('return shape', () => {
    test('should expose all required properties', () => {
      const { result } = renderHook(() => useEntityExtractor());

      // Extraction functions
      expect(typeof result.current.extractWithOpenAI).toBe('function');
      expect(typeof result.current.extractFromContent).toBe('function');

      // Local state
      expect(typeof result.current.isExtracting).toBe('boolean');
      expect(result.current).toHaveProperty('error');
      expect(typeof result.current.resetError).toBe('function');

      // Usage state from context
      expect(result.current).toHaveProperty('usageStatus');
      expect(result.current).toHaveProperty('isLoadingUsage');
      expect(result.current).toHaveProperty('isUsageLimitExceeded');
      expect(result.current).toHaveProperty('contactInfo');
      expect(typeof result.current.refreshUsageStatus).toBe('function');
      expect(typeof result.current.clearUsageCache).toBe('function');
      expect(typeof result.current.isExtractionAvailable).toBe('function');
      expect(typeof result.current.getUsagePercentage).toBe('function');
      expect(typeof result.current.getRemainingExtractions).toBe('function');
    });

    test('should start with isExtracting=false', () => {
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.isExtracting).toBe(false);
    });

    test('should start with error=null', () => {
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.error).toBeNull();
    });

    test('should expose isReady as hasUsageData && !isLoadingUsage', () => {
      setupUsageContextMock({ hasUsageData: true, isLoadingUsage: false });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.isReady).toBe(true);
    });

    test('should expose isReady as false when loading', () => {
      setupUsageContextMock({ hasUsageData: true, isLoadingUsage: true });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.isReady).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // extractWithOpenAI - validation
  // -------------------------------------------------------------------------
  describe('extractWithOpenAI - content validation', () => {
    test('should throw error for empty content', async () => {
      const { result } = renderHook(() => useEntityExtractor());

      let failure: unknown;
      await act(async () => {
        failure = await result.current.extractWithOpenAI('').catch((err: unknown) => err);
      });

      // A failure rejects; it is never an empty result (TEST-004).
      expect(failure).toBeInstanceOf(Error);
      expect(result.current.error).toBe('Content is required for entity extraction');
    });

    test('should throw error for whitespace-only content', async () => {
      const { result } = renderHook(() => useEntityExtractor());

      let failure: unknown;
      await act(async () => {
        failure = await result.current.extractWithOpenAI('   ').catch((err: unknown) => err);
      });

      // A failure rejects; it is never an empty result (TEST-004).
      expect(failure).toBeInstanceOf(Error);
      expect(result.current.error).toBe('Content is required for entity extraction');
    });

    test('should throw error for content exceeding 10000 characters', async () => {
      const { result } = renderHook(() => useEntityExtractor());
      const longContent = 'a'.repeat(10001);

      let failure: unknown;
      await act(async () => {
        failure = await result.current.extractWithOpenAI(longContent).catch((err: unknown) => err);
      });

      // A failure rejects; it is never an empty result (TEST-004).
      expect(failure).toBeInstanceOf(Error);
      expect(result.current.error).toBe('Content is too long (maximum 10,000 characters)');
    });

    test('should accept content at exactly 10000 characters', async () => {
      const content = 'a'.repeat(10000);
      const expectedEntities = [makeExtractedEntity('1', 'Gandalf')];
      mockExtractEntities.mockResolvedValue(expectedEntities);

      const { result } = renderHook(() => useEntityExtractor());

      let entities: ExtractedEntity[] = [];
      await act(async () => {
        entities = await result.current.extractWithOpenAI(content);
      });

      expect(entities).toEqual(expectedEntities);
    });
  });

  // -------------------------------------------------------------------------
  // extractWithOpenAI - success path
  // -------------------------------------------------------------------------
  describe('extractWithOpenAI - success path', () => {
    test('should return extracted entities on success', async () => {
      const entities = [makeExtractedEntity('1', 'Gandalf')];
      mockExtractEntities.mockResolvedValue(entities);

      const { result } = renderHook(() => useEntityExtractor());

      let extracted: ExtractedEntity[] = [];
      await act(async () => {
        extracted = await result.current.extractWithOpenAI('Gandalf visited the Shire');
      });

      expect(extracted).toEqual(entities);
    });

    test('should call service extractEntities with the content', async () => {
      mockExtractEntities.mockResolvedValue([]);

      const { result } = renderHook(() => useEntityExtractor());
      const content = 'Frodo found the One Ring';

      await act(async () => {
        await result.current.extractWithOpenAI(content);
      });

      expect(mockExtractEntities).toHaveBeenCalledWith(content);
    });

    test('should update usage status after successful extraction', async () => {
      const usageStatus = makeUsageStatus();
      mockExtractEntities.mockResolvedValue([]);
      mockGetCurrentUsage.mockReturnValue(usageStatus);

      const { result } = renderHook(() => useEntityExtractor());

      await act(async () => {
        await result.current.extractWithOpenAI('Some content');
      });

      expect(mockUpdateUsageStatus).toHaveBeenCalledWith(usageStatus);
    });

    test('should not call updateUsageStatus when getCurrentUsage returns null', async () => {
      mockExtractEntities.mockResolvedValue([]);
      mockGetCurrentUsage.mockReturnValue(null);

      const { result } = renderHook(() => useEntityExtractor());

      await act(async () => {
        await result.current.extractWithOpenAI('Some content');
      });

      expect(mockUpdateUsageStatus).not.toHaveBeenCalled();
    });

    test('should set isExtracting to false after completion', async () => {
      mockExtractEntities.mockResolvedValue([]);

      const { result } = renderHook(() => useEntityExtractor());

      await act(async () => {
        await result.current.extractWithOpenAI('content');
      });

      expect(result.current.isExtracting).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // extractWithOpenAI - a failed call may still have been counted (AI-001)
  // -------------------------------------------------------------------------
  describe('extractWithOpenAI - a failed scan', () => {
    test('asks for usage again, since the server counts a call before the model answers', async () => {
      mockExtractEntities.mockRejectedValue(new Error('Failed to extract entities'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const { result } = renderHook(() => useEntityExtractor());
      await act(async () => {
        await result.current.extractWithOpenAI('content').catch(() => undefined);
      });

      expect(mockRefreshUsageStatus).toHaveBeenCalledTimes(1);
    });

    test('does not ask when the content never left the browser', async () => {
      const { result } = renderHook(() => useEntityExtractor());
      await act(async () => {
        await result.current.extractWithOpenAI('').catch(() => undefined);
      });

      expect(mockRefreshUsageStatus).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // extractWithOpenAI - usage limit exceeded
  // -------------------------------------------------------------------------
  describe('extractWithOpenAI - usage limit exceeded', () => {
    test('should call setUsageLimitExceededWithInfo when UsageLimitExceededError is thrown', async () => {
      const usage = makeUsageStatus({ limitExceeded: true });
      const contactInfo = {
        message: 'Limit reached',
        contactUrl: 'https://example.com',
        prefilledSubject: 'Limit Issue',
      };
      const error = new MockUsageLimitExceededError({
        error: 'Usage limit exceeded',
        usage,
        contactInfo,
      });

      mockExtractEntities.mockRejectedValue(error);

      const { result } = renderHook(() => useEntityExtractor());

      await act(async () => {
        await result.current.extractWithOpenAI('content').catch(() => undefined);
      });

      expect(mockSetUsageLimitExceededWithInfo).toHaveBeenCalledWith(usage, contactInfo);
    });

    test('should reject on usage limit exceeded', async () => {
      const error = new MockUsageLimitExceededError({
        error: 'Limit exceeded',
        usage: makeUsageStatus(),
        contactInfo: { message: '', contactUrl: '', prefilledSubject: '' },
      });
      mockExtractEntities.mockRejectedValue(error);

      const { result } = renderHook(() => useEntityExtractor());

      let failure: unknown;
      await act(async () => {
        failure = await result.current.extractWithOpenAI('content').catch((err: unknown) => err);
      });

      // A failure rejects; it is never an empty result (TEST-004).
      expect(failure).toBeInstanceOf(Error);
    });

    test('should set error message on usage limit exceeded', async () => {
      const error = new MockUsageLimitExceededError({
        error: 'You have exceeded your daily limit',
        usage: makeUsageStatus(),
        contactInfo: { message: '', contactUrl: '', prefilledSubject: '' },
      });
      mockExtractEntities.mockRejectedValue(error);

      const { result } = renderHook(() => useEntityExtractor());

      await act(async () => {
        await result.current.extractWithOpenAI('content').catch(() => undefined);
      });

      expect(result.current.error).toBe('You have exceeded your daily limit');
    });
  });

  // -------------------------------------------------------------------------
  // extractFromContent (mirrors extractWithOpenAI behavior)
  // -------------------------------------------------------------------------
  describe('extractFromContent', () => {
    test('should validate content and throw for empty input', async () => {
      const { result } = renderHook(() => useEntityExtractor());

      let failure: unknown;
      await act(async () => {
        failure = await result.current.extractFromContent('').catch((err: unknown) => err);
      });

      // A failure rejects; it is never an empty result (TEST-004).
      expect(failure).toBeInstanceOf(Error);
      expect(result.current.error).toBe('Content is required for entity extraction');
    });

    test('should return extracted entities on success', async () => {
      const entities = [makeExtractedEntity('1', 'Sauron')];
      mockExtractEntities.mockResolvedValue(entities);

      const { result } = renderHook(() => useEntityExtractor());

      let extracted: ExtractedEntity[] = [];
      await act(async () => {
        extracted = await result.current.extractFromContent('Sauron arose');
      });

      expect(extracted).toEqual(entities);
    });

    test('should update usage status after successful extraction', async () => {
      const usageStatus = makeUsageStatus();
      mockExtractEntities.mockResolvedValue([]);
      mockGetCurrentUsage.mockReturnValue(usageStatus);

      const { result } = renderHook(() => useEntityExtractor());

      await act(async () => {
        await result.current.extractFromContent('Some content');
      });

      expect(mockUpdateUsageStatus).toHaveBeenCalledWith(usageStatus);
    });

    test('should throw error for content exceeding 10000 characters', async () => {
      const { result } = renderHook(() => useEntityExtractor());
      const longContent = 'b'.repeat(10001);

      let failure: unknown;
      await act(async () => {
        failure = await result.current.extractFromContent(longContent).catch((err: unknown) => err);
      });

      // A failure rejects; it is never an empty result (TEST-004).
      expect(failure).toBeInstanceOf(Error);
      expect(result.current.error).toBe('Content is too long (maximum 10,000 characters)');
    });

    test('should handle UsageLimitExceededError', async () => {
      const usage = makeUsageStatus({ limitExceeded: true });
      const contactInfo = { message: 'Limit', contactUrl: '', prefilledSubject: '' };
      const error = new MockUsageLimitExceededError({
        error: 'Limit exceeded',
        usage,
        contactInfo,
      });
      mockExtractEntities.mockRejectedValue(error);

      const { result } = renderHook(() => useEntityExtractor());

      let failure: unknown;
      await act(async () => {
        failure = await result.current.extractFromContent('content').catch((err: unknown) => err);
      });

      // A failure rejects; it is never an empty result (TEST-004).
      expect(failure).toBeInstanceOf(Error);
      expect(mockSetUsageLimitExceededWithInfo).toHaveBeenCalledWith(usage, contactInfo);
    });
  });

  // -------------------------------------------------------------------------
  // resetError
  // -------------------------------------------------------------------------
  describe('resetError', () => {
    test('should clear the error state', async () => {
      mockExtractEntities.mockRejectedValue(new Error('Extraction failed'));

      const { result } = renderHook(() => useEntityExtractor());

      await act(async () => {
        await result.current.extractWithOpenAI('content').catch(() => undefined);
      });

      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.resetError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getUsagePercentage
  // -------------------------------------------------------------------------
  describe('getUsagePercentage', () => {
    test('should return 0 when no usageStatus', () => {
      setupUsageContextMock({ usageStatus: null });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getUsagePercentage()).toBe(0);
    });

    test('should return 0 for unlimited users', () => {
      const status = makeUsageStatus({
        usage: {
          isUnlimited: true,
          daily: makePeriodUsage(0, 0),
          weekly: makePeriodUsage(0, 0),
          monthly: makePeriodUsage(0, 0),
        },
      });
      setupUsageContextMock({ usageStatus: status });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getUsagePercentage()).toBe(0);
    });

    test('should calculate percentage correctly for limited users', () => {
      const status = makeUsageStatus({
        usage: {
          isUnlimited: false,
          daily: makePeriodUsage(10, 20),
          weekly: makePeriodUsage(10, 60),
          monthly: makePeriodUsage(10, 200),
        },
      });
      setupUsageContextMock({ usageStatus: status });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getUsagePercentage()).toBe(50);
    });

    test('should cap percentage at 100', () => {
      const status = makeUsageStatus({
        usage: {
          isUnlimited: false,
          daily: makePeriodUsage(25, 20),
          weekly: makePeriodUsage(25, 60),
          monthly: makePeriodUsage(25, 200),
        },
      });
      setupUsageContextMock({ usageStatus: status });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getUsagePercentage()).toBe(100);
    });

    test('ignores a customLimit: the daily limit the server sends is the one in force', () => {
      const status = makeUsageStatus({
        usage: {
          isUnlimited: false,
          // A field the server no longer sends, as an old cached answer might.
          ...{ customLimit: 10 },
          daily: makePeriodUsage(5, 20),
          weekly: makePeriodUsage(5, 60),
          monthly: makePeriodUsage(5, 200),
        },
      });
      setupUsageContextMock({ usageStatus: status });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getUsagePercentage()).toBe(25);
    });
  });

  // -------------------------------------------------------------------------
  // getRemainingExtractions
  // -------------------------------------------------------------------------
  describe('getRemainingExtractions', () => {
    test('should return 0 when no usageStatus', () => {
      setupUsageContextMock({ usageStatus: null });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getRemainingExtractions()).toBe(0);
    });

    test('should return Infinity for unlimited users', () => {
      const status = makeUsageStatus({
        usage: {
          isUnlimited: true,
          daily: makePeriodUsage(0, 0),
          weekly: makePeriodUsage(0, 0),
          monthly: makePeriodUsage(0, 0),
        },
      });
      setupUsageContextMock({ usageStatus: status });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getRemainingExtractions()).toBe(Infinity);
    });

    test('should calculate remaining correctly', () => {
      const status = makeUsageStatus({
        usage: {
          isUnlimited: false,
          daily: makePeriodUsage(5, 20),
          weekly: makePeriodUsage(5, 60),
          monthly: makePeriodUsage(5, 200),
        },
      });
      setupUsageContextMock({ usageStatus: status });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getRemainingExtractions()).toBe(15);
    });

    test('should return 0 when limit is exceeded', () => {
      const status = makeUsageStatus({
        usage: {
          isUnlimited: false,
          daily: makePeriodUsage(25, 20),
          weekly: makePeriodUsage(25, 60),
          monthly: makePeriodUsage(25, 200),
        },
      });
      setupUsageContextMock({ usageStatus: status });
      const { result } = renderHook(() => useEntityExtractor());
      expect(result.current.getRemainingExtractions()).toBe(0);
    });
  });
});
