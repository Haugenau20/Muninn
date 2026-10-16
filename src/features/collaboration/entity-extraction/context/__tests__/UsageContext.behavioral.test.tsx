// src/features/collaboration/entity-extraction/context/__tests__/UsageContext.behavioral.test.tsx

import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { UsageProvider, useUsageContext } from "../UsageContext";
import { UsageStatus } from "../../types";

/**
 * UsageContext Behavioral Testing
 *
 * Tests the REAL UsageProvider and useUsageContext hook with a mocked
 * EntityExtractionService. Validates state initialization, refresh/update
 * flows, limit-exceeded state, clearance, and derived computed values.
 *
 * STRATEGY:
 * - Use real UsageProvider wrapping a renderHook consumer
 * - Mock EntityExtractionService.getInstance() to control fetchUsageStatus
 *   and clearUsageCache without hitting Firebase/Functions
 * - Assert on observable state shape and transitions
 *
 * KNOWN BUG: #650
 * When fetchUsageStatus() returns null, hasLoadedUsage.current is never set
 * to true, causing an infinite refresh loop (isLoadingUsage toggles false →
 * effect fires → true → false → effect fires…). Tests that rely on
 * null-status behavior skip the waitFor(isLoadingUsage===false) pattern and
 * instead wait for the first fetch call, then assert the synchronous state.
 * This is bug #650's regression suite.
 */

// ---------------------------------------------------------------------------
// Mock EntityExtractionService
// ---------------------------------------------------------------------------
const mockFetchUsageStatus = jest.fn();
const mockClearUsageCache = jest.fn();

jest.mock("../../services/EntityExtractionService", () => ({
  __esModule: true,
  default: {
    getInstance: () => ({
      fetchUsageStatus: mockFetchUsageStatus,
      clearUsageCache: mockClearUsageCache,
    }),
  },
}));

// Usage is fetched per authenticated user: `auth.currentUser` is null on the
// first render while auth restores, so a fetch issued then never reaches the
// network. See the "waits for auth" block below.
jest.mock("@/features/user-management", () => ({ useAuth: jest.fn() }));

const { useAuth } = require("@/features/user-management");

/** Signed in by default — the state nearly every test here assumes. */
function setUser(uid: string | null = "user-1") {
  (useAuth as jest.Mock).mockReturnValue({ user: uid ? { uid } : null });
}

// ---------------------------------------------------------------------------
// Helpers / Fixtures
// ---------------------------------------------------------------------------

function makeUsageStatus(overrides: Partial<UsageStatus> = {}): UsageStatus {
  return {
    usage: {
      daily: { count: 3, lastReset: "2026-05-21T00:00:00Z", limit: 10 },
      weekly: { count: 10, lastReset: "2026-05-18T00:00:00Z", limit: 30 },
      monthly: { count: 20, lastReset: "2026-05-01T00:00:00Z", limit: 100 },
      isUnlimited: false,
    },
    limitExceeded: false,
    nextReset: {
      daily: "2026-05-22T00:00:00Z",
      weekly: "2026-05-25T00:00:00Z",
      monthly: "2026-06-01T00:00:00Z",
    },
    ...overrides,
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <UsageProvider>{children}</UsageProvider>
);

/**
 * A consumer that shows usage, as `UsageMeter` does: it asks for it on mount.
 * Since T032 (`PERF-03`) nothing is loaded until something asks, so every
 * test of the loaded state reads through this.
 */
function useShownUsage() {
  const context = useUsageContext();
  const { requestUsageStatus } = context;
  React.useEffect(() => {
    requestUsageStatus();
  }, [requestUsageStatus]);
  return context;
}

/** Wait for the provider to finish its initial load cycle (status is non-null) */
async function waitForInitialLoad(result: { current: any }) {
  await waitFor(() => expect(result.current.usageStatus).not.toBeNull());
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("UsageContext Behavioral Testing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: fetchUsageStatus resolves to a valid status (avoids bug #650 loop)
    mockFetchUsageStatus.mockResolvedValue(makeUsageStatus());
    mockClearUsageCache.mockReturnValue(undefined);
    setUser();
  });

  // -------------------------------------------------------------------------
  describe("Initialization Behavior", () => {
    test("should throw when useUsageContext is used outside of UsageProvider", () => {
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(() => {
          renderHook(() => useUsageContext());
        }).toThrow("useUsageContext must be used within UsageProvider");
      } finally {
        consoleError.mockRestore();
      }
    });

    test("loads nothing until something asks to show usage", async () => {
      // The provider is mounted on every route; the callable is only worth
      // its round trip where the meter is on screen (T032, PERF-03).
      const { result } = renderHook(() => useUsageContext(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockFetchUsageStatus).not.toHaveBeenCalled();
      expect(result.current.usageStatus).toBeNull();
    });

    test("should call fetchUsageStatus once when a reader asks", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });

      await waitForInitialLoad(result);

      // BEHAVIOR: exactly one auto-load call on mount (hasLoadedUsage guards against re-entry)
      expect(mockFetchUsageStatus).toHaveBeenCalledTimes(1);
    });

    test("should expose all required API members", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });

      await waitForInitialLoad(result);

      const requiredFunctions = [
        "refreshUsageStatus",
        "requestUsageStatus",
        "updateUsageStatus",
        "setUsageLimitExceededWithInfo",
        "clearUsageStatus",
        "isExtractionAvailable",
      ];

      requiredFunctions.forEach((fn) => {
        expect(typeof (result.current as any)[fn]).toBe("function");
      });

      expect(typeof result.current.hasUsageData).toBe("boolean");
      expect(typeof result.current.isUnlimited).toBe("boolean");
    });

    test("should initialize isUsageLimitExceeded as false before first load", () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });

      // Synchronous initial state before the async fetch resolves
      expect(result.current.isUsageLimitExceeded).toBe(false);
    });

    test("should initialize contactInfo as null", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });

      await waitForInitialLoad(result);

      expect(result.current.contactInfo).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("refreshUsageStatus Behavior", () => {
    test("should update usageStatus when fetchUsageStatus resolves with data", async () => {
      const status = makeUsageStatus();
      mockFetchUsageStatus.mockResolvedValue(status);

      const { result } = renderHook(() => useShownUsage(), { wrapper });

      await waitFor(() => {
        expect(result.current.usageStatus).not.toBeNull();
      });

      expect(result.current.usageStatus).toEqual(status);
    });

    test("should set isUsageLimitExceeded when status.limitExceeded is true", async () => {
      const status = makeUsageStatus({ limitExceeded: true });
      mockFetchUsageStatus.mockResolvedValue(status);

      const { result } = renderHook(() => useShownUsage(), { wrapper });

      await waitFor(() => {
        expect(result.current.isUsageLimitExceeded).toBe(true);
      });
    });

    test("should set isLoadingUsage to false after refresh completes with data", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });

      await waitForInitialLoad(result);

      expect(result.current.isLoadingUsage).toBe(false);
    });

    test("should set isLoadingUsage to false even when fetchUsageStatus throws", async () => {
      // Override: first call throws, then resolves to prevent bug #650 loop
      let callCount = 0;
      mockFetchUsageStatus.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("Network failure"));
        return Promise.resolve(makeUsageStatus());
      });

      const { result } = renderHook(() => useShownUsage(), { wrapper });

      // Wait for loading to settle after the error
      await waitFor(() => {
        expect(result.current.isLoadingUsage).toBe(false);
      });

      // BEHAVIOR: error caught, usageStatus stays null (first call rejected)
      // Note: due to bug #650, if null is returned repeatedly the effect loops,
      // so we only verify loading settled, not that usageStatus is null.
    });

    test("should allow manual refresh via refreshUsageStatus", async () => {
      const initialStatus = makeUsageStatus();
      mockFetchUsageStatus.mockResolvedValue(initialStatus);

      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      const updatedStatus = makeUsageStatus({
        usage: {
          daily: { count: 9, lastReset: "2026-05-21T00:00:00Z", limit: 10 },
          weekly: { count: 25, lastReset: "2026-05-18T00:00:00Z", limit: 30 },
          monthly: { count: 60, lastReset: "2026-05-01T00:00:00Z", limit: 100 },
        },
        limitExceeded: false,
      });
      mockFetchUsageStatus.mockResolvedValue(updatedStatus);

      await act(async () => {
        await result.current.refreshUsageStatus();
      });

      expect(result.current.usageStatus).toEqual(updatedStatus);
    });
  });

  // -------------------------------------------------------------------------
  describe("updateUsageStatus Behavior", () => {
    test("should update usageStatus synchronously", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      const newStatus = makeUsageStatus({
        usage: {
          daily: { count: 8, lastReset: "2026-05-21T00:00:00Z", limit: 10 },
          weekly: { count: 20, lastReset: "2026-05-18T00:00:00Z", limit: 30 },
          monthly: { count: 50, lastReset: "2026-05-01T00:00:00Z", limit: 100 },
        },
      });

      act(() => {
        result.current.updateUsageStatus(newStatus);
      });

      expect(result.current.usageStatus).toEqual(newStatus);
    });

    test("should set isUsageLimitExceeded true when status.limitExceeded is true", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      const exceededStatus = makeUsageStatus({ limitExceeded: true });

      act(() => {
        result.current.updateUsageStatus(exceededStatus);
      });

      expect(result.current.isUsageLimitExceeded).toBe(true);
    });

    test("should set isUsageLimitExceeded false when limit is no longer exceeded", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      // First exceed it
      act(() => {
        result.current.updateUsageStatus(makeUsageStatus({ limitExceeded: true }));
      });

      expect(result.current.isUsageLimitExceeded).toBe(true);

      // Then resolve
      act(() => {
        result.current.updateUsageStatus(makeUsageStatus({ limitExceeded: false }));
      });

      expect(result.current.isUsageLimitExceeded).toBe(false);
    });

    test("should clear contactInfo when limit is no longer exceeded", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      // Set contact info via the exceeded path first
      act(() => {
        result.current.setUsageLimitExceededWithInfo(
          makeUsageStatus({ limitExceeded: true }),
          {
            message: "Limit reached",
            contactUrl: "/contact",
            prefilledSubject: "Increase Limit",
          }
        );
      });

      expect(result.current.contactInfo).not.toBeNull();

      // Now update with non-exceeded status
      act(() => {
        result.current.updateUsageStatus(makeUsageStatus({ limitExceeded: false }));
      });

      // BEHAVIOR: contactInfo is cleared when limit is no longer exceeded
      expect(result.current.contactInfo).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("setUsageLimitExceededWithInfo Behavior", () => {
    test("should set usageStatus, isUsageLimitExceeded, and contactInfo together", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      const status = makeUsageStatus({ limitExceeded: true });
      const info = {
        message: "You have reached your limit",
        contactUrl: "/contact",
        prefilledSubject: "Increase my limit",
      };

      act(() => {
        result.current.setUsageLimitExceededWithInfo(status, info);
      });

      expect(result.current.usageStatus).toEqual(status);
      expect(result.current.isUsageLimitExceeded).toBe(true);
      expect(result.current.contactInfo).toEqual(info);
    });

    test("should always set isUsageLimitExceeded to true regardless of status.limitExceeded", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      // Pass a status with limitExceeded: false but call setUsageLimitExceededWithInfo
      const status = makeUsageStatus({ limitExceeded: false });

      act(() => {
        result.current.setUsageLimitExceededWithInfo(status, {
          message: "Limit",
          contactUrl: "/",
          prefilledSubject: "Sub",
        });
      });

      // BEHAVIOR: setUsageLimitExceededWithInfo always forces isUsageLimitExceeded true
      expect(result.current.isUsageLimitExceeded).toBe(true);
    });

    test("should store the contact info message correctly", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      const info = {
        message: "Specific error message for the user",
        contactUrl: "/support",
        prefilledSubject: "Please increase my limit",
      };

      act(() => {
        result.current.setUsageLimitExceededWithInfo(
          makeUsageStatus({ limitExceeded: true }),
          info
        );
      });

      expect(result.current.contactInfo?.message).toBe("Specific error message for the user");
      expect(result.current.contactInfo?.contactUrl).toBe("/support");
      expect(result.current.contactInfo?.prefilledSubject).toBe("Please increase my limit");
    });
  });

  // -------------------------------------------------------------------------
  describe("clearUsageStatus Behavior", () => {
    test("should reset usageStatus to null", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      expect(result.current.usageStatus).not.toBeNull();

      act(() => {
        result.current.clearUsageStatus();
      });

      expect(result.current.usageStatus).toBeNull();
    });

    test("should reset isUsageLimitExceeded to false", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      act(() => {
        result.current.updateUsageStatus(makeUsageStatus({ limitExceeded: true }));
      });
      expect(result.current.isUsageLimitExceeded).toBe(true);

      act(() => {
        result.current.clearUsageStatus();
      });

      expect(result.current.isUsageLimitExceeded).toBe(false);
    });

    test("should reset contactInfo to null", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      act(() => {
        result.current.setUsageLimitExceededWithInfo(
          makeUsageStatus({ limitExceeded: true }),
          { message: "msg", contactUrl: "/c", prefilledSubject: "sub" }
        );
      });

      act(() => {
        result.current.clearUsageStatus();
      });

      expect(result.current.contactInfo).toBeNull();
    });

    test("should call entityService.clearUsageCache", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      act(() => {
        result.current.clearUsageStatus();
      });

      expect(mockClearUsageCache).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("isExtractionAvailable Behavior", () => {
    // NOTE: Testing the null-status case would trigger bug #650 (infinite loop).
    // The behavior "return true when usageStatus is null" is defined in source
    // but cannot be safely asserted via waitFor in the test environment.
    // See bug #650 for details.
    test("should return true when usageStatus is null (optimistic default) — skipped due to bug #650 infinite loop", () => {
      // This behavior is specified but cannot be safely tested while bug #650 exists.
      // Fix: When fetchUsageStatus returns null, hasLoadedUsage.current should still be set true.
    });

    test("should return true for unlimited users regardless of limit state", async () => {
      const unlimitedStatus: UsageStatus = makeUsageStatus({
        limitExceeded: true, // would normally block
        usage: {
          daily: { count: 999, lastReset: "2026-05-21T00:00:00Z", limit: 10 },
          weekly: { count: 999, lastReset: "2026-05-18T00:00:00Z", limit: 30 },
          monthly: { count: 999, lastReset: "2026-05-01T00:00:00Z", limit: 100 },
          isUnlimited: true,
        },
      });
      mockFetchUsageStatus.mockResolvedValue(unlimitedStatus);

      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      expect(result.current.isExtractionAvailable()).toBe(true);
    });

    test("should return false when limitExceeded is true for a non-unlimited user", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      act(() => {
        result.current.updateUsageStatus(makeUsageStatus({ limitExceeded: true }));
      });

      expect(result.current.isExtractionAvailable()).toBe(false);
    });

    test("should return true when limitExceeded is false for a non-unlimited user", async () => {
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      act(() => {
        result.current.updateUsageStatus(makeUsageStatus({ limitExceeded: false }));
      });

      expect(result.current.isExtractionAvailable()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("Computed / Derived Values Behavior", () => {
    // NOTE: hasUsageData/isUnlimited when usageStatus is null would trigger bug
    // #650. Tests in this section use a non-null status by default.
    test("hasUsageData should be false when usageStatus is null — skipped due to bug #650 infinite loop", () => {
      // Behavior defined in source: hasUsageData: !!usageStatus
      // Cannot be safely tested while bug #650 exists.
    });

    test("isUnlimited should be false when usageStatus is null — skipped due to bug #650 infinite loop", () => {
      // Behavior defined in source: isUnlimited: usageStatus?.usage.isUnlimited ?? false
      // Cannot be safely tested while bug #650 exists.
    });

    test("hasUsageData should be true when usageStatus is populated", async () => {
      mockFetchUsageStatus.mockResolvedValue(makeUsageStatus());

      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      expect(result.current.hasUsageData).toBe(true);
    });

    test("isUnlimited should be true when status.usage.isUnlimited is true", async () => {
      const unlimitedStatus = makeUsageStatus({
        usage: {
          daily: { count: 0, lastReset: "2026-05-21T00:00:00Z", limit: 10 },
          weekly: { count: 0, lastReset: "2026-05-18T00:00:00Z", limit: 30 },
          monthly: { count: 0, lastReset: "2026-05-01T00:00:00Z", limit: 100 },
          isUnlimited: true,
        },
      });
      mockFetchUsageStatus.mockResolvedValue(unlimitedStatus);

      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      expect(result.current.isUnlimited).toBe(true);
    });

    test("isUnlimited should be false when status.usage.isUnlimited is false", async () => {
      const nonUnlimitedStatus = makeUsageStatus({
        usage: {
          daily: { count: 0, lastReset: "2026-05-21T00:00:00Z", limit: 10 },
          weekly: { count: 0, lastReset: "2026-05-18T00:00:00Z", limit: 30 },
          monthly: { count: 0, lastReset: "2026-05-01T00:00:00Z", limit: 100 },
          isUnlimited: false,
        },
      });
      mockFetchUsageStatus.mockResolvedValue(nonUnlimitedStatus);

      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitForInitialLoad(result);

      expect(result.current.isUnlimited).toBe(false);
    });
  });
  describe("waits for auth before fetching", () => {
    test("should not fetch while there is no authenticated user", () => {
      setUser(null);

      renderHook(() => useShownUsage(), { wrapper });

      // fetchUsageStatus bails on a null auth.currentUser WITHOUT calling the
      // server, so a fetch issued now is wasted -- and the old guard then
      // marked usage "loaded", so it never tried again for the whole session.
      expect(mockFetchUsageStatus).not.toHaveBeenCalled();
    });

    test("should fetch once the user arrives", async () => {
      setUser(null);
      const { rerender } = renderHook(() => useShownUsage(), { wrapper });
      expect(mockFetchUsageStatus).not.toHaveBeenCalled();

      setUser("user-1");
      rerender();

      await waitFor(() => expect(mockFetchUsageStatus).toHaveBeenCalledTimes(1));
    });

    test("should fetch exactly once per user, even across re-renders", async () => {
      const { rerender } = renderHook(() => useShownUsage(), { wrapper });
      await waitFor(() => expect(mockFetchUsageStatus).toHaveBeenCalledTimes(1));

      rerender();
      rerender();

      expect(mockFetchUsageStatus).toHaveBeenCalledTimes(1);
    });

    test("should not loop when the fetch keeps resolving null (bug #650)", async () => {
      mockFetchUsageStatus.mockResolvedValue(null);

      const { rerender } = renderHook(() => useShownUsage(), { wrapper });
      await waitFor(() => expect(mockFetchUsageStatus).toHaveBeenCalledTimes(1));

      rerender();
      rerender();

      expect(mockFetchUsageStatus).toHaveBeenCalledTimes(1);
    });

    test("should re-fetch when a different user signs in", async () => {
      const { rerender } = renderHook(() => useShownUsage(), { wrapper });
      await waitFor(() => expect(mockFetchUsageStatus).toHaveBeenCalledTimes(1));

      setUser("user-2");
      rerender();

      await waitFor(() => expect(mockFetchUsageStatus).toHaveBeenCalledTimes(2));
    });
  });

  // -------------------------------------------------------------------------
  // AI-001: an exhausted allowance is looked at again once it resets.
  describe("when the allowance resets", () => {
    afterEach(() => jest.useRealTimers());

    test("asks the server again at the reset time, and lifts the block", async () => {
      jest.useFakeTimers("modern");
      jest.setSystemTime(new Date("2026-10-03T23:59:00Z"));
      const exhausted = makeUsageStatus({
        limitExceeded: true,
        exceededPeriod: "daily",
        nextReset: {
          daily: "2026-10-04T00:00:00Z",
          weekly: "2026-10-05T00:00:00Z",
          monthly: "2026-11-01T00:00:00Z",
        },
      });
      mockFetchUsageStatus
        .mockResolvedValueOnce(exhausted)
        .mockResolvedValueOnce(makeUsageStatus({ limitExceeded: false }));

      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitFor(() => expect(result.current.isUsageLimitExceeded).toBe(true));
      expect(result.current.isExtractionAvailable()).toBe(false);

      await act(async () => {
        jest.advanceTimersByTime(61 * 1000);
      });

      await waitFor(() => expect(result.current.isUsageLimitExceeded).toBe(false));
      expect(mockFetchUsageStatus).toHaveBeenCalledTimes(2);
      expect(result.current.isExtractionAvailable()).toBe(true);
    });

    test("does not ask again while nothing is exhausted", async () => {
      jest.useFakeTimers("modern");
      jest.setSystemTime(new Date("2026-05-21T23:59:00Z"));
      const { result } = renderHook(() => useShownUsage(), { wrapper });
      await waitFor(() => expect(result.current.usageStatus).not.toBeNull());

      await act(async () => {
        jest.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
      });

      expect(mockFetchUsageStatus).toHaveBeenCalledTimes(1);
    });
  });
});
