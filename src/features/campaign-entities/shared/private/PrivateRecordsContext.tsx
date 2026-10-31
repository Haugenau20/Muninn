// src/features/campaign-entities/shared/private/PrivateRecordsContext.tsx
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { campaignCollectionPath, privateCollectionPath } from 'core/services/firebase/data/campaignCollectionPath';
import { useFirebaseData } from 'shared/hooks/useFirebaseData';
import { useListenerDemand, useRetainListener } from 'shared/hooks/useListenerDemand';
import type { ListReaderOptions, RetainListener } from 'shared/hooks/useListenerDemand';
import { getActiveCharacterName, getUserName } from 'core/utils/user-utils';
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
 * Their five listeners (four kinds and the held links) open only while
 * something reads them (T032, `PERF-03`), and all together: each kind's
 * provider holds them open while its own list is open, and so does any
 * component reading them. All five, because what is private is decided
 * across kinds -- a link's other end, a publish's chain, a rekey's
 * references -- and a private place must not pass for a shared one because
 * only the people list is open. A page reading no list opens none of them.
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
  /**
   * The author's session notes and the campaign they are read for: a note's
   * extraction marks name the record it was turned into, so they follow it
   * when its id changes.
   */
  sessionNotes: { path: string | null; campaignId: string | null };
  /** Who signs a note a publish writes: the acting character, or the username. */
  author?: string;
  /** Where each kind lives in the campaign, which a publish moves records to. */
  campaignPaths: Record<PrivateKind, string | null>;
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
  campaignPaths: { npc: null, location: null, quest: null, rumor: null },
  isPrivate: () => false,
  sessionNotes: { path: null, campaignId: null },
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

/** Who wants the private listeners open; none outside a provider. */
const PrivateDemandContext = createContext<RetainListener | undefined>(undefined);

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

  // No linger of its own: everything reading them reads a list too, which
  // lingers already, so they close when the last list does.
  const demand = useListenerDemand(0);
  const listen = (path: string | null) => (demand.wanted ? path : null);
  const npcs = useFirebaseData<Record<string, any>>({ collection: paths.npc, subscribeTo: listen(paths.npc) });
  const locations = useFirebaseData<Record<string, any>>({
    collection: paths.location,
    subscribeTo: listen(paths.location),
  });
  const quests = useFirebaseData<Record<string, any>>({ collection: paths.quest, subscribeTo: listen(paths.quest) });
  const rumors = useFirebaseData<Record<string, any>>({ collection: paths.rumor, subscribeTo: listen(paths.rumor) });
  const held = useFirebaseData<Record<string, any>>({ collection: paths.links, subscribeTo: listen(paths.links) });

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
      sessionNotes: {
        path: user && activeGroupId ? `groups/${activeGroupId}/users/${user.uid}/notes` : null,
        campaignId: activeCampaignId ?? null,
      },
      author: getActiveCharacterName(activeGroupUserProfile) || getUserName(activeGroupUserProfile) || undefined,
      campaignPaths: {
        npc: campaignCollectionPath(Boolean(user), activeGroupId, activeCampaignId, 'npcs'),
        location: campaignCollectionPath(Boolean(user), activeGroupId, activeCampaignId, 'locations'),
        quest: campaignCollectionPath(Boolean(user), activeGroupId, activeCampaignId, 'quests'),
        rumor: campaignCollectionPath(Boolean(user), activeGroupId, activeCampaignId, 'rumors'),
      },
    }),
    [
      records, links, paths.npc, paths.location, paths.quest, paths.rumor, paths.links, isPrivate, stamps,
      activeGroupUserProfile, user, activeGroupId, activeCampaignId,
    ]
  );

  return (
    <PrivateDemandContext.Provider value={demand.retain}>
      <PrivateRecordsContext.Provider value={value}>{children}</PrivateRecordsContext.Provider>
    </PrivateDemandContext.Provider>
  );
};

/**
 * The author's private records, or none outside a provider. Holds their
 * listeners open while mounted, unless `subscribe` is false: a provider
 * above the router, which reads them only while its own list is open,
 * passes false and holds them with `useHoldPrivateRecords`.
 */
export const usePrivateRecords = ({ subscribe = true }: ListReaderOptions = {}): PrivateRecordsValue => {
  useRetainListener(useContext(PrivateDemandContext), subscribe);
  return useContext(PrivateRecordsContext);
};

/**
 * Holds the private listeners open while `wanted`: a kind's provider passes
 * whether its own list is open, since the private records are part of it.
 */
export const useHoldPrivateRecords = (wanted: boolean): void => {
  useRetainListener(useContext(PrivateDemandContext), wanted);
};
