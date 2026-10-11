// e2e/support/seed.ts
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { E2E } from "./env";

// Read by the Admin SDK when Auth and Firestore are first used, below: they
// send it to the emulators, never to a real project.
process.env.FIRESTORE_EMULATOR_HOST = `${E2E.host}:${E2E.firestorePort}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${E2E.host}:${E2E.authPort}`;

/** The data every journey starts from. Ids are fixed so a test can name them. */
export const FIXTURES = {
  player: {
    uid: "e2e-player",
    email: "wren@e2e.test",
    username: "Wren",
    character: { id: "e2e-character", name: "Ilse Varn" },
  },
  group: { id: "e2e-group", name: "The Lantern Company" },
  campaign: { id: "e2e-campaign", name: "The Drowned Coast" },
  locations: {
    region: { id: "saltmarsh-reach", name: "Saltmarsh Reach" },
    town: { id: "kettleby", name: "Kettleby" },
    inn: { id: "the-gilded-lantern", name: "The Gilded Lantern" },
  },
  quest: { id: "find-the-keeper", title: "Find the Lighthouse Keeper" },
  npc: { id: "maren-hollis", name: "Maren Hollis" },
  /** Written before records stored their author's name: only the uid. */
  legacyNpc: { id: "old-tam", name: "Old Tam" },
  /**
   * A person with a note in its own document (T133), as the migration left
   * every older note, and one stray note still in the record's old array,
   * which nothing reads.
   */
  notedNpc: { id: "brin-salt", name: "Brin Salt", note: "Sold us a leaky boat", strayNote: "Left in the array" },
  /**
   * A chapter whose text the migration moved into its own body document
   * (T134), with older text still left on the chapter, which nothing reads.
   */
  movedChapter: {
    id: "chapter-01",
    title: "The Drowned Bell",
    text: "The bell rang under the water.",
    staleText: "The bell was silent.",
  },
  /**
   * An unused founder link (T127), as the operator's script issues one: it
   * admits one account, which may start one group.
   */
  founderLink: { token: "e2e-founder-link-0123456789abcdefghij" },
} as const;

const NOW = "2026-10-01T12:00:00.000Z";

/** Who wrote a seeded record, in the shape `ContentAttribution` has. */
const attribution = {
  createdBy: FIXTURES.player.uid,
  createdByUsername: FIXTURES.player.username,
  createdByCharacterId: FIXTURES.player.character.id,
  createdByCharacterName: FIXTURES.player.character.name,
  dateAdded: NOW,
};

/**
 * Empty both emulators. Runs before every seed, so a run never sees the last
 * one's leftovers, whether it was started fresh or not.
 */
async function resetEmulators(): Promise<void> {
  const targets = [
    `${E2E.firestoreUrl}/emulator/v1/projects/${E2E.projectId}/databases/(default)/documents`,
    `${E2E.authUrl}/emulator/v1/projects/${E2E.projectId}/accounts`,
  ];
  for (const url of targets) {
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(`Could not reset ${url}: ${response.status}. Are the e2e emulators running?`);
    }
  }
}

/**
 * Reset the emulators and write the fixtures: one player who administers one
 * group with one campaign, holding a three-level location tree, a quest set in
 * the town, an NPC who lives there, and an older NPC that names its author by
 * uid alone. And an unused founder link, which belongs to nobody yet.
 *
 * Written with the Admin SDK, which the rules do not apply to; everything the
 * journeys then do goes through the app, which they do.
 */
export async function seed(): Promise<void> {
  await resetEmulators();

  const app = getApps()[0] ?? initializeApp({ projectId: E2E.projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const { player, group, campaign, locations, quest, npc, legacyNpc, notedNpc, movedChapter, founderLink } = FIXTURES;

  await auth.createUser({
    uid: player.uid,
    email: player.email,
    emailVerified: true,
    displayName: player.username,
  });

  const groupPath = `groups/${group.id}`;
  const campaignPath = `${groupPath}/campaigns/${campaign.id}`;
  const batch = db.batch();

  batch.set(db.doc(`users/${player.uid}`), {
    email: player.email,
    groups: [group.id],
    activeGroupId: group.id,
    createdAt: NOW,
    lastLoginAt: NOW,
  });
  batch.set(db.doc(groupPath), {
    name: group.name,
    description: "Lamplighters turned treasure hunters.",
    createdAt: NOW,
    createdBy: player.uid,
  });
  batch.set(db.doc(`${groupPath}/users/${player.uid}`), {
    // As `redeemInvitation` writes it: the app lists a user's groups by this
    // field (T136).
    userId: player.uid,
    username: player.username,
    role: "admin",
    joinedAt: NOW,
    characters: [player.character],
    activeCampaignId: campaign.id,
    preferences: { theme: "light", notifications: true },
  });
  batch.set(db.doc(`${groupPath}/usernames/${player.username.toLowerCase()}`), {
    userId: player.uid,
    originalUsername: player.username,
    createdAt: NOW,
  });
  batch.set(db.doc(campaignPath), {
    id: campaign.id,
    name: campaign.name,
    description: "Something is putting out the lighthouses.",
    groupId: group.id,
    createdAt: NOW,
    createdBy: player.uid,
    isActive: true,
  });

  batch.set(db.doc(`${campaignPath}/locations/${locations.region.id}`), {
    ...attribution,
    id: locations.region.id,
    name: locations.region.name,
    type: "region",
    status: "explored",
    description: "Salt flats and drowned villages along the coast.",
  });
  batch.set(db.doc(`${campaignPath}/locations/${locations.town.id}`), {
    ...attribution,
    id: locations.town.id,
    name: locations.town.name,
    type: "town",
    status: "visited",
    description: "A fishing town under a dark lighthouse.",
    parentId: locations.region.id,
  });
  batch.set(db.doc(`${campaignPath}/locations/${locations.inn.id}`), {
    ...attribution,
    id: locations.inn.id,
    name: locations.inn.name,
    type: "building",
    status: "visited",
    description: "The inn by the harbour.",
    parentId: locations.town.id,
  });

  batch.set(db.doc(`${campaignPath}/quests/${quest.id}`), {
    ...attribution,
    id: quest.id,
    title: quest.title,
    description: "The keeper of Kettleby light has not been seen for a week.",
    status: "active",
    objectives: [
      { id: "obj-1", description: "Climb the lighthouse", completed: false },
    ],
    location: locations.town.name,
    locationId: locations.town.id,
  });

  batch.set(db.doc(`${campaignPath}/npcs/${npc.id}`), {
    ...attribution,
    id: npc.id,
    name: npc.name,
    status: "alive",
    relationship: "friendly",
    description: "Runs the harbour inn and hears everything.",
    occupation: "Innkeeper",
    location: locations.town.name,
    locationId: locations.town.id,
    connections: { relatedNPCs: [], affiliations: [], relatedQuests: [] },
    notes: [],
  });

  batch.set(db.doc(`${campaignPath}/npcs/${legacyNpc.id}`), {
    createdBy: player.uid,
    dateAdded: NOW,
    id: legacyNpc.id,
    name: legacyNpc.name,
    status: "alive",
    relationship: "neutral",
    description: "Mends nets on the harbour wall.",
    connections: { relatedNPCs: [], affiliations: [], relatedQuests: [] },
    notes: [],
  });

  batch.set(db.doc(`${campaignPath}/npcs/${notedNpc.id}`), {
    ...attribution,
    id: notedNpc.id,
    name: notedNpc.name,
    status: "alive",
    relationship: "neutral",
    description: "Hires out boats in Kettleby.",
    connections: { relatedNPCs: [], affiliations: [], relatedQuests: [] },
    notes: [{ date: "2026-09-19", text: notedNpc.strayNote, author: player.character.name }],
  });
  batch.set(db.doc(`${campaignPath}/npcs/${notedNpc.id}/notes/moved-1`), {
    ...attribution,
    date: "2026-09-20",
    text: notedNpc.note,
    author: player.character.name,
  });

  batch.set(db.doc(`${campaignPath}/chapters/${movedChapter.id}`), {
    ...attribution,
    id: movedChapter.id,
    title: movedChapter.title,
    order: 1,
    summary: "The first night on the coast.",
    content: movedChapter.staleText,
    contentLength: movedChapter.text.length,
  });
  batch.set(db.doc(`${campaignPath}/chapters/${movedChapter.id}/body/text`), { content: movedChapter.text });

  // Stored under its token's hash, as `issueFounderInvitation` stores one (T145).
  const founderLinkId = createHash("sha256").update(founderLink.token, "utf8").digest("hex");
  batch.set(db.doc(`founderInvitations/${founderLinkId}`), {
    scheme: "sha256",
    used: false,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    issuedBy: "e2e",
  });

  await batch.commit();
}
