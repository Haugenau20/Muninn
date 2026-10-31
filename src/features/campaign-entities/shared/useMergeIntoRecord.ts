// src/features/campaign-entities/shared/useMergeIntoRecord.ts
import { useCallback } from 'react';
import firebaseServices from 'core/services/firebase';
import type { CreateAlongside } from 'core/types/common';
import { getActiveCharacterName, getUserName } from 'core/utils/user-utils';
import { useUser } from 'features/user-management';
import { useCampaignCollectionPath } from 'shared/hooks/useCampaignCollectionPath';
import { mergeNote, planMerge } from './mergeRecords';
import { nameOf, type SameNameKind } from './sameName';
import { usePrivateRecords } from './private/PrivateRecordsContext';
import { privateIdsIn } from './private/idFields';
import { PrivateLinkError } from './private/usePrivateRouting';

/** Each kind's collection in the campaign. */
const COLLECTION: Record<SameNameKind, string> = {
  npc: 'npcs',
  location: 'locations',
  quest: 'quests',
  rumor: 'rumors',
};

/**
 * "Add what you know to it" (T163): write what the player was about to
 * create into the record of the same name, as `planMerge` works it out from
 * the copy the server holds, and its note of what differed, signed by the
 * acting character -- in one transaction with `alongside`, the change that
 * pointed at the newcomer (a session note's mark), now pointing here.
 *
 * Resolves with the existing record's id, which is where the player lands.
 */
export function useMergeIntoRecord() {
  const paths: Record<SameNameKind, string | null> = {
    npc: useCampaignCollectionPath(COLLECTION.npc),
    location: useCampaignCollectionPath(COLLECTION.location),
    quest: useCampaignCollectionPath(COLLECTION.quest),
    rumor: useCampaignCollectionPath(COLLECTION.rumor),
  };
  const { npc, location, quest, rumor } = paths;
  const { activeGroupUserProfile } = useUser();
  // Into one of the author's private records, it stays in their space (T163).
  const { isPrivate, paths: privatePaths } = usePrivateRecords();

  return useCallback(
    async (
      kind: SameNameKind,
      existingId: string,
      incoming: object,
      alongside?: CreateAlongside
    ): Promise<string> => {
      const intoPrivate = isPrivate(kind, existingId);
      const path = intoPrivate ? privatePaths[kind] : { npc, location, quest, rumor }[kind];
      if (!path) throw new Error('No campaign selected');
      const author =
        getActiveCharacterName(activeGroupUserProfile) || getUserName(activeGroupUserProfile) || undefined;
      // Fixed once, so a retried transaction writes the same note, not another.
      const noteId = crypto.randomUUID();

      await firebaseServices.document.mergeIntoDocument<Record<string, unknown>, Record<string, unknown>>(
        path,
        existingId,
        alongside?.collection ?? path,
        async (target, read) => {
          const plan = planMerge(kind, target, incoming);
          // A shared record never names a private one (T163).
          if (!intoPrivate && privateIdsIn(kind, plan.fields, isPrivate).length) throw new PrivateLinkError();
          const note = mergeNote(kind, nameOf(kind, incoming), plan.differing, author);
          return {
            fields: plan.fields,
            updates: alongside
              ? [{ id: alongside.id, data: alongside.change(await read(alongside.id), existingId) }]
              : [],
            notes: note ? [{ under: 'target' as const, id: noteId, data: note }] : [],
          };
        }
      );
      return existingId;
    },
    [npc, location, quest, rumor, activeGroupUserProfile, isPrivate, privatePaths]
  );
}
