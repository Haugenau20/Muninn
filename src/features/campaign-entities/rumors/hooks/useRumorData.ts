// src/features/campaign-entities/rumors/hooks/useRumorData.ts
import { Rumor } from '../types';
import { useCampaignCollection } from 'shared/hooks/useCampaignCollection';
import { useWithPrivate } from '../../shared/private/useWithPrivate';

/** Rumours are shown in the order Firestore returns them. */
const asStored = (rumors: Rumor[]): Rumor[] => rumors;

/**
 * The active campaign's rumors, kept current by a Firestore listener (T032).
 * See `useCampaignCollection` for how the list, `loading` and the refresh behave.
 * @param options.enabled Whether anything reads the list right now; see
 *   `useListenerDemand`. Defaults to `true`.
 * @returns The rumors, loading and error state, a retry, and the campaign context status
 */
export const useRumorData = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const { items: shared, loading, error, refresh, hasRequiredContext, missingContext } =
    useCampaignCollection<Rumor>('rumors', asStored, enabled);
  // With the author's private records beside them (T163).
  const items = useWithPrivate('rumor', shared, asStored);

  return {
    rumors: items,
    loading,
    error,
    refreshRumors: refresh,
    hasRequiredContext,
    missingContext
  };
};

export default useRumorData;
