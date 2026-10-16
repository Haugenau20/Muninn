// src/features/collaboration/entity-extraction/context/UsageContext.tsx
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { UsageStatus } from '../types';
import EntityExtractionService from '../services/EntityExtractionService';
import { useAuth } from 'features/user-management';

interface UsageContextValue {
  usageStatus: UsageStatus | null;
  isLoadingUsage: boolean;
  isUsageLimitExceeded: boolean;
  contactInfo: {
    message: string;
    contactUrl: string;
    prefilledSubject: string;
  } | null;
  refreshUsageStatus: () => Promise<void>;
  /**
   * Ask for the signed-in user's usage to be loaded, once per user. Called by
   * the component that shows it (`UsageMeter`), so the callable runs only
   * where the meter renders rather than on every page load (T032, `PERF-03`).
   */
  requestUsageStatus: () => void;
  updateUsageStatus: (status: UsageStatus) => void;
  setUsageLimitExceededWithInfo: (status: UsageStatus, info: { message: string; contactUrl: string; prefilledSubject: string; }) => void;  // ← Add this line
  clearUsageStatus: () => void;
  isExtractionAvailable: () => boolean;
  hasUsageData: boolean;
  isUnlimited: boolean;
}

const UsageContext = createContext<UsageContextValue | undefined>(undefined);

export const UsageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [usageStatus, setUsageStatus] = useState<UsageStatus | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [isUsageLimitExceeded, setIsUsageLimitExceeded] = useState(false);
  const [contactInfo, setContactInfo] = useState<{
    message: string;
    contactUrl: string;
    prefilledSubject: string;
  } | null>(null);
  
  const entityService = EntityExtractionService.getInstance();
  const { user } = useAuth();
  /** uid whose usage has already been fetched -- see the load effect below. */
  const loadedForUid = useRef<string | null>(null);
  /** Whether anything has asked to see usage yet; see `requestUsageStatus`. */
  const [requested, setRequested] = useState(false);
  const requestUsageStatus = useCallback(() => setRequested(true), []);

  /**
   * Refresh usage status from server
   */
  const refreshUsageStatus = useCallback(async () => {
    setIsLoadingUsage(true);
    try {
      const status = await entityService.fetchUsageStatus();
      if (status) {
        setUsageStatus(status);
        setIsUsageLimitExceeded(status.limitExceeded);
      }
      // Nothing to mark here: the load effect below claims the uid BEFORE
      // calling, so a null or thrown response cannot retrigger it (bug #650).
    } catch (error) {
      console.error('Error refreshing usage status:', error);
    } finally {
      setIsLoadingUsage(false);
    }
  }, [entityService]);

  /**
   * Update usage status (called after successful extractions)
   */
  const updateUsageStatus = useCallback((status: UsageStatus) => {
    setUsageStatus(status);
    setIsUsageLimitExceeded(status.limitExceeded);
    
    // Clear any existing contact info if limit is no longer exceeded
    if (!status.limitExceeded) {
      setContactInfo(null);
    }
  }, []);

  /**
   * Set usage limit exceeded state with contact info
   */
  const setUsageLimitExceededWithInfo = useCallback((
    status: UsageStatus, 
    info: { message: string; contactUrl: string; prefilledSubject: string; }
  ) => {
    setUsageStatus(status);
    setIsUsageLimitExceeded(true);
    setContactInfo(info);
  }, []);

  /**
   * Clear usage status
   */
  const clearUsageStatus = useCallback(() => {
    setUsageStatus(null);
    setIsUsageLimitExceeded(false);
    setContactInfo(null);
    // Release the uid claim so the next signed-in user (or the same one after
    // a manual limit increase) is fetched afresh.
    loadedForUid.current = null;
    entityService.clearUsageCache();
  }, [entityService]);

  /**
   * Check if extraction is available (not at limit)
   */
  const isExtractionAvailable = useCallback((): boolean => {
    if (!usageStatus) return true; // Allow if we don't have status yet
    if (usageStatus.usage.isUnlimited) return true; // Always allow for unlimited users
    return !usageStatus.limitExceeded;
  }, [usageStatus]);

  /**
   * Load usage once per signed-in user.
   *
   * This used to fire on mount and guard itself with a plain boolean. But
   * `fetchUsageStatus` reads `auth.currentUser`, which is still null on the
   * first render while Firebase restores the session — so that fetch returned
   * null WITHOUT ever calling `getUsageStatus`, flipped the guard, and never
   * tried again. Usage therefore stayed empty for the whole session unless a
   * scan happened to populate it from its own response, which is why the
   * usage meter appeared only after someone's first scan.
   *
   * Keying on the uid fixes that and is still loop-proof: the ref is set
   * BEFORE the call, so a response of null cannot retrigger it (bug #650).
   * A different uid — a genuine account switch — legitimately refetches.
   *
   * Nothing loads until something asks (`requestUsageStatus`): the callable
   * is only worth its round trip where the meter is on screen.
   */
  useEffect(() => {
    const uid = user?.uid ?? null;
    if (!uid || !requested || loadedForUid.current === uid) return;

    loadedForUid.current = uid;
    refreshUsageStatus();
  }, [user?.uid, requested, refreshUsageStatus]);

  /**
   * Ask again once an exhausted allowance resets (AI-001).
   *
   * The status is a snapshot. Without this, a tab left open past midnight
   * kept its "exhausted" copy, and the Scan button it disables is the only
   * thing that would have reached the server to learn otherwise.
   */
  useEffect(() => {
    if (!usageStatus?.limitExceeded || usageStatus.usage.isUnlimited) return;
    const period = usageStatus.exceededPeriod;
    const resetAt = Date.parse(period ? usageStatus.nextReset[period] : '');
    if (!Number.isFinite(resetAt)) return;

    // A timer longer than this overflows and fires at once; a monthly reset
    // further off than ~24 days is checked again when this one fires.
    const MAX_TIMER_MS = 2 ** 31 - 1;
    // A moment past the reset, so the server's clock has crossed it too. A
    // reset already behind this device's clock means the server has not
    // reached it yet: wait a minute rather than ask again every second.
    const untilReset = resetAt - Date.now();
    const delay = Math.min(untilReset > 0 ? untilReset + 1000 : 60 * 1000, MAX_TIMER_MS);
    const timer = setTimeout(() => {
      void refreshUsageStatus();
    }, delay);
    return () => clearTimeout(timer);
  }, [usageStatus, refreshUsageStatus]);

  const value: UsageContextValue = {
    usageStatus,
    isLoadingUsage,
    isUsageLimitExceeded,
    contactInfo,
    refreshUsageStatus,
    requestUsageStatus,
    updateUsageStatus,
    setUsageLimitExceededWithInfo,
    clearUsageStatus,
    isExtractionAvailable,
    hasUsageData: !!usageStatus,
    isUnlimited: usageStatus?.usage.isUnlimited ?? false,
  };

  // Expose the setUsageLimitExceededWithInfo method for extraction errors
  (value as any).setUsageLimitExceededWithInfo = setUsageLimitExceededWithInfo;

  return (
    <UsageContext.Provider value={value}>
      {children}
    </UsageContext.Provider>
  );
};

export const useUsageContext = () => {
  const context = useContext(UsageContext);
  if (!context) {
    throw new Error('useUsageContext must be used within UsageProvider');
  }
  return context;
};