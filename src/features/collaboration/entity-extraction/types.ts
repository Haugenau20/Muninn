// src/features/collaboration/entity-extraction/types.ts

/**
 * Time period for usage tracking
 */
export type UsagePeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Usage data for a specific time period
 */
export interface PeriodUsage {
  /** Current usage count for this period */
  count: number;
  /** Timestamp when this period last reset */
  lastReset: string; // ISO string
  /** Maximum allowed for this period */
  limit: number;
}

/**
 * Complete usage tracking data for entity extraction
 */
export interface EntityExtractionUsage {
  /** Daily usage tracking */
  daily: PeriodUsage;
  /** Weekly usage tracking */
  weekly: PeriodUsage;
  /** Monthly usage tracking */
  monthly: PeriodUsage;
  /** Whether the user's allowance lifts every limit (set on the operator page) */
  isUnlimited?: boolean;
  /** When a raised allowance runs out, if it does (ISO 8601) */
  raisedUntil?: string;
  /** Last extraction timestamp */
  lastExtraction?: string;
}

/**
 * Usage status returned from the server
 */
export interface UsageStatus {
  /** Current usage data */
  usage: EntityExtractionUsage;
  /** Whether any limit has been exceeded */
  limitExceeded: boolean;
  /** Which limit was exceeded (if any) */
  exceededPeriod?: UsagePeriod;
  /** When the next reset will occur */
  nextReset: {
    daily: string;
    weekly: string;
    monthly: string;
  };
}

/**
 * Usage limit error response
 */
export interface UsageLimitError {
  error: string;
  code: 'USAGE_LIMIT_EXCEEDED';
  usage: UsageStatus;
  contactInfo: {
    message: string;
    contactUrl: string;
    prefilledSubject: string;
  };
}