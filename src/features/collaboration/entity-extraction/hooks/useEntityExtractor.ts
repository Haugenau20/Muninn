// src/features/collaboration/entity-extraction/hooks/useEntityExtractor.ts
import { useState, useCallback } from 'react';
import { ExtractedEntity } from '../../notes/types';
import EntityExtractionService, { UsageLimitExceededError } from '../services/EntityExtractionService';
import { useUsageContext } from '../context/UsageContext';

/**
 * Simplified hook for entity extraction - usage state now managed by UsageContext
 */
export const useEntityExtractor = () => {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const entityService = EntityExtractionService.getInstance();
  
  // Get usage state and functions from context
  const usageContext = useUsageContext();
  const { 
    usageStatus,
    isLoadingUsage,
    isUsageLimitExceeded,
    contactInfo,
    refreshUsageStatus,
    updateUsageStatus,
    setUsageLimitExceededWithInfo,
    clearUsageStatus,
    isExtractionAvailable,
    hasUsageData,
    isUnlimited
  } = usageContext;

  /**
   * Extract entities from content, with usage tracking.
   *
   * Rejects on every failure -- empty or oversized content, a refused or
   * failed call, the usage limit -- after putting the reason in `error`. It
   * used to resolve `[]` instead, which a caller could not tell from a scan
   * that found nothing: the notes panel then replaced a note's saved
   * detections with that empty list and said no new names were found
   * (FUNC-002, TEST-004).
   */
  const extractWithOpenAI = useCallback(async (content: string): Promise<ExtractedEntity[]> => {
    setIsExtracting(true);
    setError(null);
    /** Whether the call reached the server, which counts it before the model answers. */
    let sent = false;

    try {
      // Validate content before making the call
      if (!content || content.trim().length === 0) {
        throw new Error('Content is required for entity extraction');
      }

      if (content.length > 10000) {
        throw new Error('Content is too long (maximum 10,000 characters)');
      }

      // Extract entities - this will update usage in the service
      sent = true;
      const entities = await entityService.extractEntities(content);

      // Update shared usage status from the service after successful extraction
      const newUsageStatus = entityService.getCurrentUsage();
      if (newUsageStatus) {
        updateUsageStatus(newUsageStatus);
      }

      return entities;
    } catch (err) {
      if (err instanceof UsageLimitExceededError) {
        // Handle usage limit exceeded - update shared context
        setUsageLimitExceededWithInfo(err.usage, err.contactInfo);
        setError(err.message);
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to extract entities';
        setError(errorMessage);
        console.error('Entity extraction error:', err);
        // The server reserves a call before asking the model, so a failure
        // after that was still counted. Without asking again the meter shows
        // a slot that is gone (AI-001).
        if (sent) {
          void refreshUsageStatus();
        }
      }
      throw err;
    } finally {
      setIsExtracting(false);
    }
  }, [entityService, updateUsageStatus, setUsageLimitExceededWithInfo, refreshUsageStatus]);

  /**
   * Extract entities from arbitrary content (not tied to a note). The same
   * call as {@link extractWithOpenAI}, under the name a non-note caller reads.
   */
  const extractFromContent = extractWithOpenAI;

  /**
   * Reset error state
   */
  const resetError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Get usage percentage for display (based on daily usage)
   */
  const getUsagePercentage = useCallback((): number => {
    if (!usageStatus) return 0;
    if (usageStatus.usage.isUnlimited) return 0; // Unlimited users show 0%
    
    const { daily } = usageStatus.usage;
    return Math.min((daily.count / daily.limit) * 100, 100);
  }, [usageStatus]);

  /**
   * Get remaining extractions for today
   */
  const getRemainingExtractions = useCallback((): number => {
    if (!usageStatus) return 0;
    if (usageStatus.usage.isUnlimited) return Infinity;
    
    const { daily } = usageStatus.usage;
    return Math.max(0, daily.limit - daily.count);
  }, [usageStatus]);

  return {
    // Extraction functions
    extractWithOpenAI,
    extractFromContent,
    
    // Local state (extraction-specific)
    isExtracting,
    error,
    resetError,
    
    // Usage state (from context)
    usageStatus,
    isLoadingUsage,
    isUsageLimitExceeded,
    contactInfo,
    refreshUsageStatus,
    clearUsageCache: clearUsageStatus,
    isExtractionAvailable,
    getUsagePercentage,
    getRemainingExtractions,
    
    // Usage display helpers (from context)
    hasUsageData,
    isUnlimited,
    
    // Loading state for UI
    isReady: hasUsageData && !isLoadingUsage
  };
};