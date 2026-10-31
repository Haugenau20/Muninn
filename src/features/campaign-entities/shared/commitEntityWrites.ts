// src/features/campaign-entities/shared/commitEntityWrites.ts
import firebaseServices from 'core/services/firebase';

/** Firestore commits at most 500 writes in one batch. */
export const MAX_BATCH_WRITES = 500;

/** One write in a batch action: an update with the fields to merge, or a delete. */
export interface EntityBatchWrite<T> {
  type: 'update' | 'delete';
  id: string;
  data?: Partial<T>;
  /**
   * The record's collection when it is not the batch's: a private record's
   * (T163), so one batch can hold the author's private records and shared ones.
   */
  collection?: string | null;
}

/**
 * Commits several writes to one entity collection as a single batch (T017):
 * one round trip instead of one per record, and all or nothing, so a batch
 * action can never stop halfway through a selection. The list follows through
 * its listener, so nothing is read back.
 *
 * Callers stamp attribution themselves: `DocumentService.batchOperations`
 * writes `data` exactly as given.
 *
 * @param collection - the collection's full path, from the caller's render
 *   (`useCampaignCollectionPath`), so the batch lands in the campaign the
 *   action was taken in (T082); `null` when there is no campaign
 * @param plural - how the error names the records, e.g. `'NPCs'`
 * @param writes - the writes; an empty list commits nothing
 * @throws when there are more writes than one batch can hold
 */
export async function commitEntityWrites<T>(
  collection: string | null,
  plural: string,
  writes: EntityBatchWrite<T>[]
): Promise<void> {
  if (writes.length === 0) return;
  if (collection === null) {
    throw new Error('No campaign selected');
  }
  if (writes.length > MAX_BATCH_WRITES) {
    throw new Error(`One action can change at most ${MAX_BATCH_WRITES} ${plural} at once.`);
  }
  await firebaseServices.document.batchOperations(
    writes.map((write) => ({ ...write, collection: write.collection ?? collection }))
  );
}
