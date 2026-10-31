// src/features/campaign-entities/shared/private/PrivateRecordsContext.tsx
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { privateCollectionPath } from 'core/services/firebase/data/campaignCollectionPath';
import { useFirebaseData } from 'shared/hooks/useFirebaseData';
import { useAuth, useUser, useGroups, useCampaigns } from 'features/user-management';
import {
  buildCreationAttribution,
  buildModificationAttribution,
  creationTimes,
  modificationTimes,
} from 'core/attribution';
import type { SameNameKind } from '../sameName';

/**
 * Private records (T163): the people, places, quests and rumours a player
 * keeps to themselves until they publish them -- what happened in a
 * one-to-one session with the DM.
 *
 * They live under the player's own group profile,
 * `groups/{g}/users/{uid}/private/{c}/{npcs|locations|quests|rumors}/{id}`,
 * which the rules let no one else read. The campaign's shared records and
 * their listeners are untouched: each kind's list adds the author's private
 * records to its own, marked `isPrivate`, and its writes go where the record
 * lives. A private record never appears in a shared document: a link whose
 * owner is shared is held here (`links`) instead, and written on publish.
 *
 * Each list is the author's own, so a listener on it costs its few
 * documents; they open with the campaign.
 */

/** The kinds of record that can be private. */
export type PrivateKind = SameNameKind;

/** Each kind's collection, in the campaign and in the private space alike. */
export const COLLECTION_OF: Record<PrivateKind, 'npcs' | 'locations' | 'quests' | 'rumors'> = {
  npc: 'npcs',
  location: 'locations',
  quest: 'quests',
  rumor: 'rumors',
};

/** One end of a held link. */
export interface HeldEnd {
  kind: PrivateKind;
  id: string;
}

/**
 * A link between a private record (`from`) and a shared one that owns it
 * (`to`), kept out of the shared record until the private one is published.
 */
export interface HeldLink {
  id: string;
  from: HeldEnd;
  to: HeldEnd;
}

/** A record as read from the private space. */
export type PrivateDoc = Record<string, any> & { id: string; isPrivate: true };

export interface PrivateRecordsValue {
  /** The author's private records of each kind, each marked `isPrivate`. */
  records: Record<PrivateKind, PrivateDoc[]>;
  /** The links held for them. */
  links: HeldLink[];
  /** Where each kind lives privately, and the held links; null when unscoped. */
  paths: Record<PrivateKind | 'links', string | null>;
  /** Whether a record of this kind and id is one of the author's private ones. */
  isPrivate: (kind: PrivateKind, id: string) => boolean;
  /**
   * The attribution a move or a publish stamps, worked out when it is
   * written: the author's id and names, and the server's time.
   */
  stamps: () => MoveStamps;
}

/** What a move stamps: a document created now, and one changed now. */
export interface MoveStamps {
  creation: Record<string, unknown>;
  modification: Record<string, unknown>;
}

const EMPTY: PrivateRecordsValue = {
  records: { npc: [], location: [], quest: [], rumor: [] },
  links: [],
  paths: { npc: null, location: null, quest: null, rumor: null, links: null },
  isPrivate: () => false,
  stamps: () => {
    throw new Error('You need to be signed in.');
  },
};

/**
 * Without a provider -- a test, the signed-out example -- nobody has private
 * records, and nothing is read.
 */
const PrivateRecordsContext = createContext<PrivateRecordsValue>(EMPTY);

/**
 * Hands a ready value to everything under it, in place of
 * `PrivateRecordsProvider`'s own: a suite's, without Firestore.
 */
export const PrivateRecordsValueProvider = PrivateRecordsContext.Provider;

const mark = (docs: Array<Record<string, any>>): PrivateDoc[] =>
  docs.map((doc) => ({ ...doc, isPrivate: true }) as PrivateDoc);

/** Reads the author's private records and held links for the active campaign. */
export const PrivateRecordsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { activeGroupUserProfile } = useUser();
  const { activeGroupId } = useGroups();
  const { activeCampaignId } = useCampaigns();
  const pathOf = (collection: string) =>
    privateCollectionPath(user?.uid, activeGroupId, activeCampaignId, collection);

  const paths = {
    npc: pathOf('npcs'),
    location: pathOf('locations'),
    quest: pathOf('quests'),
    rumor: pathOf('rumors'),
    links: pathOf('links'),
  };

  const npcs = useFirebaseData<Record<string, any>>({ collection: paths.npc, subscribeTo: paths.npc });
  const locations = useFirebaseData<Record<string, any>>({ collection: paths.location, subscribeTo: paths.location });
  const quests = useFirebaseData<Record<string, any>>({ collection: paths.quest, subscribeTo: paths.quest });
  const rumors = useFirebaseData<Record<string, any>>({ collection: paths.rumor, subscribeTo: paths.rumor });
  const held = useFirebaseData<Record<string, any>>({ collection: paths.links, subscribeTo: paths.links });

  const records = useMemo(
    () => ({
      npc: paths.npc ? mark(npcs.data) : [],
      location: paths.location ? mark(locations.data) : [],
      quest: paths.quest ? mark(quests.data) : [],
      rumor: paths.rumor ? mark(rumors.data) : [],
    }),
    [paths.npc, paths.location, paths.quest, paths.rumor, npcs.data, locations.data, quests.data, rumors.data]
  );
  const links = useMemo(
    () => (paths.links ? (held.data as HeldLink[]) : []),
    [paths.links, held.data]
  );

  const ids = useMemo(
    () => ({
      npc: new Set(records.npc.map((record) => record.id)),
      location: new Set(records.location.map((record) => record.id)),
      quest: new Set(records.quest.map((record) => record.id)),
      rumor: new Set(records.rumor.map((record) => record.id)),
    }),
    [records]
  );
  const isPrivate = useCallback((kind: PrivateKind, id: string) => ids[kind].has(id), [ids]);

  const stamps = useCallback((): MoveStamps => {
    if (!user) throw new Error('You need to be signed in.');
    const source = { uid: user.uid, activeGroupUserProfile };
    return {
      creation: { ...buildCreationAttribution(source), ...creationTimes() },
      modification: { ...buildModificationAttribution(source), ...modificationTimes() },
    };
  }, [user, activeGroupUserProfile]);

  const value = useMemo<PrivateRecordsValue>(
    () => ({
      records,
      links,
      paths: {
        npc: paths.npc,
        location: paths.location,
        quest: paths.quest,
        rumor: paths.rumor,
        links: paths.links,
      },
      isPrivate,
      stamps,
    }),
    [records, links, paths.npc, paths.location, paths.quest, paths.rumor, paths.links, isPrivate, stamps]
  );

  return <PrivateRecordsContext.Provider value={value}>{children}</PrivateRecordsContext.Provider>;
};

/** The author's private records, or none outside a provider. */
export const usePrivateRecords = (): PrivateRecordsValue => useContext(PrivateRecordsContext);
