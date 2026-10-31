// src/utils/__dev__/generators/campaigns/types.ts

import type {
  LocationStatus,
  LocationType,
  NPCRelationship,
  NPCStatus,
  QuestLocation,
  QuestStatus,
  RumorStatus,
  SourceType,
} from "features/campaign-entities";

/**
 * The sample campaigns, as they are written by hand: each record's own fields,
 * with its links named by id and no attribution. `records.ts` fills in the
 * rest (who wrote it and when) as the app's writes would.
 *
 * Every setting is invented (T123). Campaign 1-1 is the site's own example,
 * the Ashen Vale (`shared/example-campaign`), filled out.
 *
 * `by` is the username of the seeded member who wrote a record. Left out, the
 * campaign's members take turns, so the pages show several authors.
 */

/** One person the party has met. */
export interface NpcSeed {
  id: string;
  name: string;
  title?: string;
  status: NPCStatus;
  relationship: NPCRelationship;
  race?: string;
  occupation?: string;
  description: string;
  appearance?: string;
  personality?: string;
  background?: string;
  /** Free text for where they are, when no place lists them. */
  location?: string;
  /** Other people they are linked to, stored on this side only (T131). */
  knows?: string[];
  affiliations?: string[];
  notes?: string[];
  tags?: string[];
  by?: string;
}

/** One place. A parent is listed before its children. */
export interface LocationSeed {
  id: string;
  name: string;
  type: LocationType;
  status: LocationStatus;
  description: string;
  parentId?: string;
  features?: string[];
  /** The people met here: the place owns the link (T131). */
  people?: string[];
  notes?: string[];
  tags?: string[];
  /** Whether the party has been there, which sets `lastVisited`. */
  visited?: boolean;
  by?: string;
}

/** One quest. */
export interface QuestSeed {
  id: string;
  title: string;
  description: string;
  status: QuestStatus;
  background?: string;
  objectives: Array<{ description: string; completed: boolean }>;
  leads?: string[];
  keyLocations?: QuestLocation[];
  /** The people on it: the quest owns the link (T131). */
  people?: string[];
  complications?: string[];
  rewards?: string[];
  locationId?: string;
  levelRange?: string;
  notes?: string[];
  by?: string;
}

/** One rumour, with the notes players added under it. */
export interface RumorSeed {
  id: string;
  title: string;
  content: string;
  status: RumorStatus;
  sourceType: SourceType;
  sourceName: string;
  sourceNpcId?: string;
  /** Where it was heard. */
  locationId?: string;
  /** The people it is about. */
  people?: string[];
  /** The places it is about. */
  places?: string[];
  notes?: Array<{ content: string; by?: string }>;
  convertedToQuestId?: string;
  by?: string;
}

/** One chapter: its order is its place in the list. */
export interface ChapterSeed {
  title: string;
  summary: string;
  /** The chapter's text, paragraphs separated by a blank line. */
  text: string;
  by?: string;
}

/** A whole sample campaign. */
export interface CampaignSeed {
  /** Its document id; the default banner is picked from it. */
  id: string;
  groupId: "group1" | "group2";
  name: string;
  description: string;
  isActive: boolean;
  /**
   * How many days before the sample data is written its last session was:
   * the chapters are a week apart, ending then.
   */
  endedDaysAgo: number;
  chapters: ChapterSeed[];
  locations: LocationSeed[];
  npcs: NpcSeed[];
  quests: QuestSeed[];
  rumors: RumorSeed[];
  saga: { title: string; content: string };
}

/** Objectives from their text, the first `done` of them ticked. */
export const objectives = (done: number, ...descriptions: string[]): QuestSeed["objectives"] =>
  descriptions.map((description, index) => ({ description, completed: index < done }));
