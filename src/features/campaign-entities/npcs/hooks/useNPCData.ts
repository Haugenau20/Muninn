// src/features/campaign-entities/npcs/hooks/useNPCData.ts
import { NPC } from '../types';
import { useCampaignCollection } from 'shared/hooks/useCampaignCollection';
import { useWithPrivate } from '../../shared/private/useWithPrivate';

/** Alphabetical by name. */
const byName = (npcs: NPC[]): NPC[] =>
  [...npcs].sort((a, b) => a.name.localeCompare(b.name));

/**
 * The active campaign's NPCs, kept current by a Firestore listener (T032).
 * See `useCampaignCollection` for how the list, `loading` and the refresh behave.
 * @param options.enabled Whether anything reads the list right now; see
 *   `useListenerDemand`. Defaults to `true`.
 * @returns The NPCs, loading and error state, a retry, and the campaign context status
 */
export const useNPCData = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const { items: shared, loading, error, refresh, hasRequiredContext, missingContext } =
    useCampaignCollection<NPC>('npcs', byName, enabled);
  // With the author's private records beside them (T163).
  const items = useWithPrivate('npc', shared, byName);

  return {
    npcs: items,
    loading,
    error,
    refreshNPCs: refresh,
    hasRequiredContext,
    missingContext
  };
};

export default useNPCData;
