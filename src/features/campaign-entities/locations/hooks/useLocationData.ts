// src/features/campaign-entities/locations/hooks/useLocationData.ts
import { Location } from '../types';
import { useCampaignCollection } from 'shared/hooks/useCampaignCollection';
import { useWithPrivate } from '../../shared/private/useWithPrivate';

/** Locations are shown in the order Firestore returns them. */
const asStored = (locations: Location[]): Location[] => locations;

/**
 * The active campaign's locations, kept current by a Firestore listener (T032).
 * See `useCampaignCollection` for how the list, `loading` and the refresh behave.
 * @param options.enabled Whether anything reads the list right now; see
 *   `useListenerDemand`. Defaults to `true`.
 * @returns The locations, loading and error state, a retry, and the campaign context status
 */
export const useLocationData = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const { items: shared, loading, error, refresh, hasRequiredContext, missingContext } =
    useCampaignCollection<Location>('locations', asStored, enabled);
  // With the author's private records beside them (T163).
  const items = useWithPrivate('location', shared, asStored);

  return {
    locations: items,
    loading,
    error,
    refreshLocations: refresh,
    hasRequiredContext,
    missingContext
  };
};

export default useLocationData;
