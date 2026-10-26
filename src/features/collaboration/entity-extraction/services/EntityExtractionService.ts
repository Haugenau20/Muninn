// src/features/collaboration/entity-extraction/services/EntityExtractionService.ts
import { httpsCallable } from 'firebase/functions';
import BaseFirebaseService from 'core/services/firebase/core/BaseFirebaseService';
import ServiceRegistry from 'core/services/firebase/core/ServiceRegistry';
import { ExtractedEntity, EntityType } from '../../notes/types';
import { UsageStatus, UsageLimitError } from '../types';
import { OpenAIEntityResponse, ExtractedEntityDetails } from 'core/services/openai/types';
import { extractDetailsByType } from './entityMapper';

interface ExtractEntitiesResponse {
  success: boolean;
  entities?: OpenAIEntityResponse[];
  usage?: UsageStatus;
  error?: string;
}

/**
 * How long the browser waits for an extraction, in milliseconds (T155).
 *
 * Longer than the function's own `timeoutSeconds` (90 s, `entityExtraction.ts`),
 * with room for a cold start. The SDK's default is 70 s, so a slow call would
 * otherwise be abandoned here while the function finished it -- counted
 * against the player's allowance, and its result thrown away.
 */
export const EXTRACTION_TIMEOUT_MS = 100_000;

interface GetUsageStatusResponse {
  success: boolean;
  usage?: UsageStatus;
  error?: string;
}

/**
 * Custom error class for usage limit exceeded
 */
export class UsageLimitExceededError extends Error {
  public usage: UsageStatus;
  public contactInfo: {
    message: string;
    contactUrl: string;
    prefilledSubject: string;
  };

  constructor(errorData: UsageLimitError) {
    super(errorData.error);
    this.name = 'UsageLimitExceededError';
    this.usage = errorData.usage;
    this.contactInfo = errorData.contactInfo;
  }
}

/**
 * Service for handling entity extraction through Firebase Functions
 * Uses Firebase SDK httpsCallable for proper environment handling
 */
class EntityExtractionService extends BaseFirebaseService {
  private static instance: EntityExtractionService;
  private currentUsage: UsageStatus | null = null;

  private constructor() {
    super();
    
    // Register with ServiceRegistry
    ServiceRegistry.getInstance().register('EntityExtractionService', this);
  }

  public static getInstance(): EntityExtractionService {
    if (!EntityExtractionService.instance) {
      EntityExtractionService.instance = new EntityExtractionService();
    }
    return EntityExtractionService.instance;
  }

  /**
   * Get current usage status
   */
  public getCurrentUsage(): UsageStatus | null {
    return this.currentUsage;
  }

  /**
   * Extract entities from content using Firebase Functions
   * Firebase SDK automatically handles emulator vs production routing
   *
   * There is deliberately no `model` parameter. It used to take one,
   * defaulting to `gpt-3.5-turbo`, and send it to the callable -- which passed
   * it to OpenAI unchecked, so the browser chose what the project's key was
   * billed for. The model is pinned in the function (`EXTRACTION_MODEL`), and
   * a second default here would only be a second place for it to drift.
   */
  public async extractEntities(
    content: string
  ): Promise<ExtractedEntity[]> {
    try {
      const user = this.getCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Use Firebase SDK httpsCallable - automatically handles CORS and routing
      const extractEntitiesFunction = httpsCallable(this.functions, 'extractEntities', {
        timeout: EXTRACTION_TIMEOUT_MS,
      });
      
      // The active group, so the function can read its members' characters
      // and keep the party out of the NPC suggestions (T019). The roster is
      // read on the server; only the group's id travels.
      const groupId = this.getActiveGroupId();
      const result = await extractEntitiesFunction(groupId ? { content, groupId } : { content });

      const extractionResult = result.data as ExtractEntitiesResponse;

      // With onCall functions, errors are thrown as exceptions, so if we get here,
      // the call was successful. Just check that we have entities.
      if (!extractionResult.success || !extractionResult.entities) {
        throw new Error('No entities returned');
      }

      // Store current usage for UI display
      if (extractionResult.usage) {
        this.currentUsage = extractionResult.usage;
      }

      return extractionResult.entities.map(this.mapOpenAIEntityToExtractedEntity);
      
    } catch (error) {
      console.error('Entity extraction service error:', error);
      
      // Handle Firebase Functions errors (from HttpsError throws)
      if (error && typeof error === 'object' && 'code' in error && 'details' in error) {
        const firebaseError = error as any;
        
        // Check for usage limit exceeded error
        if (firebaseError.code === 'functions/resource-exhausted' && 
            firebaseError.message.includes('USAGE_LIMIT_EXCEEDED')) {
          
          // Extract usage data from error details if available
          const errorDetails = firebaseError.details;
          if (errorDetails && errorDetails.usage) {
            this.currentUsage = errorDetails.usage;
          }
          
          throw new UsageLimitExceededError({
            error: firebaseError.message,
            code: 'USAGE_LIMIT_EXCEEDED',
            usage: errorDetails?.usage,
            contactInfo: errorDetails?.contactInfo || {
              message: "You've reached your smart detection limit. Contact support for assistance.",
              contactUrl: "/contact",
              prefilledSubject: "Smart Detection Limit Increase Request"
            }
          });
        }
        
        // The project's OpenAI balance has run out; the function gave the
        // call back, so the player's allowance is untouched (T129).
        if (firebaseError.code === 'functions/unavailable' &&
            firebaseError.message === 'AI_EXTRACTION_PAUSED') {
          throw new Error(
            'Smart detection is paused for now. This scan was not counted against your limit.'
          );
        }

        // Handle other Firebase function errors
        throw new Error(firebaseError.message || 'Smart Detection failed');
      }
      
      // Handle other errors
      throw error;
    }
  }

  /**
   * Fetch current usage status without performing extraction
   * NO OpenAI API calls - only reads Firestore data
   * Useful for displaying usage info in the UI
   */
  public async fetchUsageStatus(): Promise<UsageStatus | null> {
    try {
      const user = this.getCurrentUser();
      if (!user) {
        return null;
      }

      // Use the new getUsageStatus function - NO OpenAI calls, NO usage increments
      const getUsageStatusFunction = httpsCallable(this.functions, 'getUsageStatus');
      
      const result = await getUsageStatusFunction();
      const statusResult = result.data as GetUsageStatusResponse;

      // If successful, extract usage from response
      if (statusResult.success && statusResult.usage) {
        this.currentUsage = statusResult.usage;
        return statusResult.usage;
      }

      return null;
    } catch (error) {
      // Handle Firebase Functions errors to extract usage data even from limit exceeded errors
      if (error && typeof error === 'object' && 'code' in error && 'details' in error) {
        const firebaseError = error as any;
        
        // If it's a usage limit error, we can still extract the usage from it
        if (firebaseError.code === 'functions/resource-exhausted' && 
            firebaseError.details?.usage) {
          this.currentUsage = firebaseError.details.usage;
          return firebaseError.details.usage;
        }
      }
      
      console.error('Error fetching usage status:', error);
      return null;
    }
  }

  /**
   * Clear cached usage data (useful after manual limit increases)
   */
  public clearUsageCache(): void {
    this.currentUsage = null;
  }

  /**
   * Map OpenAI entity response to ExtractedEntity format
   */
  private mapOpenAIEntityToExtractedEntity = (
    openaiEntity: OpenAIEntityResponse
  ): ExtractedEntity => {
    const baseEntity: ExtractedEntity = {
      id: `${openaiEntity.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: openaiEntity.text,
      type: openaiEntity.type as EntityType,
      confidence: openaiEntity.confidence,
      isConverted: false,
      createdAt: new Date().toISOString(),
      extraData: {}
    };

    // Handle both formats
    let details: any;
    if ('details' in openaiEntity && openaiEntity.details) {
      details = this.extractDetailsByType(openaiEntity.details, openaiEntity.type);
    } else {
      const { text, type, confidence, ...extraFields } = openaiEntity as any;
      details = extraFields;
    }
    
    baseEntity.extraData = {
      ...details,
      originalText: openaiEntity.text
    };

    return baseEntity;
  };

  /**
   * Extract specific details from OpenAI response based on entity type
   *
   * Delegates to the shared implementation in entityMapper.ts so there is a
   * single source of truth for this mapping (see bug #023).
   */
  private extractDetailsByType = (
    details: ExtractedEntityDetails,
    type: EntityType
  ): any => {
    return extractDetailsByType(details, type);
  };
}

export default EntityExtractionService;