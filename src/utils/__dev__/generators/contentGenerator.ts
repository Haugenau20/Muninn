// src/utils/__dev__/generators/contentGenerator.ts

import { doc, setDoc } from 'firebase/firestore';
import { SAMPLE_MEMBERSHIPS, UserMapping } from './userGenerator';
import type { CampaignSeed } from './campaigns/types';
import { buildCampaignRecords, SampleAuthor } from './contentGenerators/records';
import { writeRecordWithNotes } from './contentGenerators/recordNotes';

/**
 * The members of a sample group, admins first: who the group's records are
 * credited to.
 *
 * @param groupId The sample group
 * @param userMapping Each seeded username's uid
 */
export const sampleAuthorsOf = (groupId: string, userMapping: UserMapping): SampleAuthor[] =>
  Object.entries(SAMPLE_MEMBERSHIPS)
    .filter(([, membership]) => (membership.groups as string[]).includes(groupId))
    .sort(([, a], [, b]) => Number(b.admin) - Number(a.admin))
    .map(([username]) => ({ uid: userMapping[username], username }))
    .filter((author) => Boolean(author.uid));

/**
 * Write a sample campaign: the campaign document, then everything in it.
 *
 * @param db Firestore
 * @param seed The campaign
 * @param userMapping Each seeded username's uid
 * @param now When the sample data is written
 */
export const generateContentForCampaign = async (
  db: any,
  seed: CampaignSeed,
  userMapping: UserMapping,
  now: Date
) => {
  console.log(`Generating content for campaign ${seed.id} in group ${seed.groupId}...`);
  const built = buildCampaignRecords(seed, sampleAuthorsOf(seed.groupId, userMapping), now);
  const campaignPath = ['groups', seed.groupId, 'campaigns', seed.id] as const;

  await setDoc(doc(db, ...campaignPath), built.campaign);
  console.log(`Created campaign: ${seed.name}`);

  // Each chapter's text is a document of its own (T134): `chapters/{id}/body/text`,
  // with its length on the chapter, as the app writes them.
  for (const { record, text } of built.chapters) {
    await setDoc(doc(db, ...campaignPath, 'chapters', record.id), {
      ...record,
      content: null,
      contentLength: text.length,
    });
    await setDoc(doc(db, ...campaignPath, 'chapters', record.id, 'body', 'text'), { content: text });
  }
  console.log(`Created ${built.chapters.length} chapters`);

  for (const collection of ['locations', 'npcs', 'quests', 'rumors'] as const) {
    for (const sample of built[collection]) {
      await writeRecordWithNotes(db, [...campaignPath, collection], sample);
    }
    console.log(`Created ${built[collection].length} ${collection}`);
  }

  await setDoc(doc(db, ...campaignPath, 'saga', 'sagaData'), built.saga);
  console.log(`Created saga: ${seed.saga.title}`);
};
