// src/features/campaign-entities/shared/private/useRecordNotesPath.ts
import { useCampaignCollectionPath } from 'shared/hooks/useCampaignCollectionPath';
import { COLLECTION_OF, usePrivateRecords, type PrivateKind } from './PrivateRecordsContext';

/**
 * The collection a record lives in, which its notes sit under: the author's
 * private space for one of their private records (T163), else the campaign's.
 *
 * @param kind The record's kind
 * @param id The record, or undefined while none is known
 */
export function useRecordNotesPath(kind: PrivateKind, id: string | undefined): string | null {
  const shared = useCampaignCollectionPath(COLLECTION_OF[kind]);
  const { isPrivate, paths } = usePrivateRecords();
  return id && isPrivate(kind, id) ? paths[kind] : shared;
}
