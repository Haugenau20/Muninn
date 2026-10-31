// src/features/campaign-entities/shared/private/heldLinks.ts
import { useMemo } from 'react';
import firebaseServices from 'core/services/firebase';
import { creationTimes } from 'core/attribution';
import type { Location } from '../../locations/types';
import { linkWrite, type LinkEnd, type LinkPrivacy } from '../linkActions';
import { usePrivateRecords, type HeldLink, type PrivateKind } from './PrivateRecordsContext';

/**
 * Held links (T163): a link between a private record and a shared one that
 * owns it. The shared record must not carry the private id, so the link is
 * kept in the author's private space and shown to them as if it were
 * written: their copy of the owner gains it in memory.
 */

/**
 * The shared records of one kind as their author sees them: each owner of a
 * held link carries it, in this client's copy only.
 *
 * @param kind The records' kind
 * @param records The shared records, as read
 * @param links The author's held links
 * @param locationOf A private place, for a quest held to one
 */
export function withHeldLinks<T extends { id: string }>(
  kind: PrivateKind,
  records: T[],
  links: readonly HeldLink[],
  locationOf: (id: string) => Location | undefined
): T[] {
  const mine = links.filter((link) => link.to.kind === kind);
  if (mine.length === 0) return records;
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const link of mine) {
    const owner = byId.get(link.to.id);
    if (!owner) continue;
    const write = linkWrite(link.from, link.to, locationOf);
    if (!write || write.owner.kind !== kind || write.owner.id !== owner.id) continue;
    byId.set(owner.id, { ...owner, ...write.change(owner) });
  }
  return records.map((record) => byId.get(record.id) ?? record);
}

const sameEnd = (a: LinkEnd, b: LinkEnd) => a.kind === b.kind && a.id === b.id;

/**
 * The link actions' privacy (`LinkDeps.privacy`) for the signed-in author:
 * which ends are private, and holding and letting go of a link in their
 * private space.
 */
export function useLinkPrivacy(): LinkPrivacy {
  const { isPrivate, links, paths } = usePrivateRecords();
  const linksPath = paths.links;

  return useMemo<LinkPrivacy>(
    () => ({
      isPrivate: (end) => isPrivate(end.kind, end.id),
      hold: async (from, to) => {
        if (!linksPath) throw new Error('No campaign selected');
        if (links.some((link) => sameEnd(link.from, from) && sameEnd(link.to, to))) return;
        await firebaseServices.document.setDocument(linksPath, crypto.randomUUID(), {
          from: { kind: from.kind, id: from.id },
          to: { kind: to.kind, id: to.id },
          createdAt: creationTimes().createdAt,
        });
      },
      release: async (from, to) => {
        if (!linksPath) throw new Error('No campaign selected');
        const held = links.filter((link) => sameEnd(link.from, from) && sameEnd(link.to, to));
        for (const link of held) {
          await firebaseServices.document.deleteDocument(linksPath, link.id);
        }
      },
    }),
    [isPrivate, links, linksPath]
  );
}
