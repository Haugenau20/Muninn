// src/utils/__dev__/generators/contentGenerators/records.ts

import type { CampaignSeed } from "../campaigns/types";
// Relative, not `shared/...`: this runs under ts-node, which ignores baseUrl.
import { toNoteDate } from "../../../../shared/utils/dateFormatter";

/** A seeded member: who a record names as its author. */
export interface SampleAuthor {
  uid: string;
  username: string;
}

/** What `records.ts` stamps on a record, as a migrated production record carries it. */
export interface SampleAttribution {
  createdBy: string;
  createdByUsername: string;
  modifiedBy: string;
  modifiedByUsername: string;
  /** The writer's clock, as records before T132 kept it. */
  dateAdded: string;
  dateModified: string;
  /** The server's clock (T132); Firestore stores a `Date` as a Timestamp. */
  createdAt: Date;
  modifiedAt: Date;
}

/** A note to write as a document of its own, under its record. */
export interface SampleNote {
  fields: Record<string, unknown>;
  author: SampleAuthor;
}

/** A record, and the notes to write under it. */
export interface SampleRecord {
  record: { id: string } & Record<string, unknown>;
  notes: SampleNote[];
}

/** A whole campaign's documents, ready to write. */
export interface SampleCampaignRecords {
  /** The campaign document. */
  campaign: Record<string, unknown> & { id: string };
  chapters: Array<{ record: { id: string } & Record<string, unknown>; text: string }>;
  locations: SampleRecord[];
  npcs: SampleRecord[];
  quests: SampleRecord[];
  rumors: SampleRecord[];
  saga: Record<string, unknown>;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Who wrote a record: the member it names, else the campaign's members in
 * turn, so the pages show several authors.
 */
const pickAuthor = (
  by: string | undefined,
  index: number,
  members: readonly SampleAuthor[]
): SampleAuthor => {
  if (by) {
    const named = members.find((member) => member.username === by);
    if (!named) throw new Error(`Sample data names "${by}", who is not in the campaign's group`);
    return named;
  }
  return members[index % members.length];
};

const attribution = (author: SampleAuthor, when: Date): SampleAttribution => ({
  createdBy: author.uid,
  createdByUsername: author.username,
  modifiedBy: author.uid,
  modifiedByUsername: author.username,
  dateAdded: when.toISOString(),
  dateModified: when.toISOString(),
  createdAt: when,
  modifiedAt: when,
});

/** Leave out fields the seed did not set, as the app's forms do. */
const defined = <T extends Record<string, unknown>>(fields: T): T =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;

/**
 * A sample campaign as the documents the app reads: each record attributed to
 * a member of the campaign's group, and dated. The chapters are a week apart,
 * ending `endedDaysAgo` before `now`; every other record is dated along the
 * same stretch, in the order it is listed.
 *
 * @param seed The campaign as written by hand
 * @param members The members of the campaign's group, admins included
 * @param now When the sample data is written
 */
export const buildCampaignRecords = (
  seed: CampaignSeed,
  members: readonly SampleAuthor[],
  now: Date
): SampleCampaignRecords => {
  if (members.length === 0) throw new Error(`${seed.id}'s group has no members`);

  const end = now.getTime() - seed.endedDaysAgo * DAY;
  const start = end - Math.max(seed.chapters.length - 1, 1) * 7 * DAY;
  /** The `index`th of `count` records, dated evenly from start to end. */
  const along = (index: number, count: number): Date =>
    new Date(start + ((end - start) * (index + 1)) / (count + 1));

  const nameOfPlace = (id: string | undefined): string | undefined =>
    seed.locations.find((place) => place.id === id)?.name;

  const admin = members[0];

  return {
    campaign: {
      id: seed.id,
      name: seed.name,
      description: seed.description,
      groupId: seed.groupId,
      isActive: seed.isActive,
      createdAt: new Date(start - DAY).toISOString(),
      createdBy: admin.uid,
    },

    chapters: seed.chapters.map((chapter, index) => {
      const author = pickAuthor(chapter.by, index, members);
      const when = new Date(start + index * 7 * DAY);
      return {
        record: {
          id: `chapter-${String(index + 1).padStart(2, "0")}`,
          title: chapter.title,
          summary: chapter.summary,
          order: index + 1,
          ...attribution(author, when),
        },
        text: chapter.text,
      };
    }),

    locations: seed.locations.map((place, index, all) => {
      const author = pickAuthor(place.by, index, members);
      const when = along(index, all.length);
      return {
        record: defined({
          id: place.id,
          name: place.name,
          type: place.type,
          status: place.status,
          description: place.description,
          parentId: place.parentId,
          features: place.features ?? [],
          connectedNPCs: place.people ?? [],
          tags: place.tags ?? [],
          lastVisited: place.visited ? when.toISOString() : undefined,
          ...attribution(author, when),
        }),
        notes: (place.notes ?? []).map((text) => ({
          fields: { date: toNoteDate(when), text },
          author,
        })),
      };
    }),

    npcs: seed.npcs.map((npc, index, all) => {
      const author = pickAuthor(npc.by, index, members);
      const when = along(index, all.length);
      return {
        record: defined({
          id: npc.id,
          name: npc.name,
          title: npc.title,
          status: npc.status,
          relationship: npc.relationship,
          race: npc.race,
          occupation: npc.occupation,
          location: npc.location,
          description: npc.description,
          appearance: npc.appearance,
          personality: npc.personality,
          background: npc.background,
          connections: { relatedNPCs: npc.knows ?? [], affiliations: npc.affiliations ?? [] },
          tags: npc.tags,
          ...attribution(author, when),
        }),
        notes: (npc.notes ?? []).map((text) => ({
          fields: { date: toNoteDate(when), text },
          author,
        })),
      };
    }),

    quests: seed.quests.map((quest, index, all) => {
      const author = pickAuthor(quest.by, index, members);
      const when = along(index, all.length);
      return {
        record: defined({
          id: quest.id,
          title: quest.title,
          description: quest.description,
          status: quest.status,
          background: quest.background,
          objectives: quest.objectives.map((objective, n) => ({
            id: `${quest.id}-objective-${n + 1}`,
            ...objective,
          })),
          leads: quest.leads ?? [],
          keyLocations: quest.keyLocations ?? [],
          relatedNPCIds: quest.people ?? [],
          complications: quest.complications ?? [],
          rewards: quest.rewards ?? [],
          locationId: quest.locationId,
          location: nameOfPlace(quest.locationId),
          levelRange: quest.levelRange,
          dateCompleted: quest.status === "completed" ? when.toISOString() : undefined,
          ...attribution(author, when),
        }),
        notes: [],
      };
    }),

    rumors: seed.rumors.map((rumor, index, all) => {
      const author = pickAuthor(rumor.by, index, members);
      const when = along(index, all.length);
      return {
        record: defined({
          id: rumor.id,
          title: rumor.title,
          content: rumor.content,
          status: rumor.status,
          sourceType: rumor.sourceType,
          sourceName: rumor.sourceName,
          sourceNpcId: rumor.sourceNpcId,
          locationId: rumor.locationId,
          location: nameOfPlace(rumor.locationId),
          relatedNPCs: rumor.people ?? [],
          relatedLocations: rumor.places ?? [],
          convertedToQuestId: rumor.convertedToQuestId,
          ...attribution(author, when),
        }),
        notes: (rumor.notes ?? []).map((note, n) => ({
          fields: { id: `${rumor.id}-note-${n + 1}`, content: note.content },
          author: pickAuthor(note.by, index + n + 1, members),
        })),
      };
    }),

    saga: {
      title: seed.saga.title,
      content: seed.saga.content,
      lastUpdated: new Date(end).toISOString(),
      version: "1.0",
      ...attribution(pickAuthor(undefined, 0, members), new Date(end)),
    },
  };
};
