// src/features/campaign-entities/shared/private/useRecordImagePrefix.ts
import {
  entityImagePrefix,
  privateEntityImagePrefix,
} from 'core/services/firebase/storage/ImageStorageService';
import { useAuth, useGroups, useCampaigns } from 'features/user-management';
import { usePrivateRecords } from './PrivateRecordsContext';

/**
 * The folder a person's or a place's picture is uploaded to: the campaign's,
 * which every member reads, or for one of the author's private records their
 * own (T163), which only they read. Null until the record and its campaign
 * are known.
 *
 * @param kind A person or a place: the two that carry a picture
 * @param id The record
 */
export function useRecordImagePrefix(kind: 'npc' | 'location', id: string | undefined): string | null {
  const { user } = useAuth();
  const { activeGroupId } = useGroups();
  const { activeCampaignId } = useCampaigns();
  const { isPrivate } = usePrivateRecords();
  if (!id || !activeGroupId || !activeCampaignId) return null;
  const type = kind === 'npc' ? 'npcs' : 'locations';
  if (isPrivate(kind, id)) {
    return user ? privateEntityImagePrefix(activeGroupId, user.uid, activeCampaignId, type, id) : null;
  }
  return entityImagePrefix(activeGroupId, activeCampaignId, type, id);
}
