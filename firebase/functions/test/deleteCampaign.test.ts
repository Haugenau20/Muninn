// functions/test/deleteCampaign.test.ts
//
// T021: deleting a campaign also deletes its images -- and nobody else's.
import {
  BulkWriter,
  DocumentReference,
  Firestore,
} from "firebase-admin/firestore";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {deleteCampaign} from "../src/campaignManagement/deleteCampaign";
import {imageBucket} from "../src/shared/imageBucket";

const PROJECT = "demo-delete-campaign";
const db = useEmulatorProject(PROJECT);
const GROUP = "g1";

/** One file per place a file could be, keyed by what it stands for. */
const FILES = {
  npcImage: `groups/${GROUP}/campaigns/c1/npcs/n1/a.webp`,
  locationImage: `groups/${GROUP}/campaigns/c1/locations/l1/b.webp`,
  siblingCampaign: `groups/${GROUP}/campaigns/c2/npcs/n2/c.webp`,
  // Shares the "c1" prefix without the slash: the delete must stop at "c1/".
  lookalikeCampaign: `groups/${GROUP}/campaigns/c10/npcs/n3/d.webp`,
  crest: `groups/${GROUP}/crest/e.webp`,
  otherGroup: "groups/g2/campaigns/c1/npcs/n1/f.webp",
  // T163: members' private records' pictures, under their profiles.
  privateImage: `groups/${GROUP}/users/frodo/campaigns/c1/npcs/gollum/g.webp`,
  adminPrivateImage: `groups/${GROUP}/users/gandalf/campaigns/c1/locations/cave/h.webp`,
  privateOtherCampaign: `groups/${GROUP}/users/frodo/campaigns/c2/npcs/smeagol/i.webp`,
};

const exists = async (path: string) => (await imageBucket().file(path).exists())[0];

beforeEach(async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  await clearProject(PROJECT);
  await imageBucket().deleteFiles({prefix: "groups/"});

  await db.doc(`groups/${GROUP}`).set({name: "Fellowship"});
  await db.doc(`groups/${GROUP}/users/gandalf`).set({userId: "gandalf", role: "admin"});
  await db.doc(`groups/${GROUP}/users/frodo`).set({userId: "frodo", role: "member"});
  await db.doc("users/gandalf").set({id: "gandalf", groups: [GROUP]});
  await db.doc("users/frodo").set({id: "frodo", groups: [GROUP]});
  await db.doc(`groups/${GROUP}/campaigns/c1`).set({name: "There and back"});
  await db.doc(`groups/${GROUP}/campaigns/c1/npcs/n1`).set({name: "Bilbo"});

  await Promise.all(
    Object.values(FILES).map((path) =>
      imageBucket().file(path).save(Buffer.from("x"), {contentType: "image/webp"})
    )
  );
});

afterEach(() => jest.restoreAllMocks());

const remove = (uid: string, campaignId = "c1") =>
  call(deleteCampaign, {groupId: GROUP, campaignId}, uid);

describe("deleting a campaign", () => {
  it("control: every file exists before the call", async () => {
    for (const path of Object.values(FILES)) expect(await exists(path)).toBe(true);
  });

  it("deletes the campaign's images along with the campaign", async () => {
    await remove("gandalf");

    expect((await db.doc(`groups/${GROUP}/campaigns/c1`).get()).exists).toBe(false);
    expect(await exists(FILES.npcImage)).toBe(false);
    expect(await exists(FILES.locationImage)).toBe(false);
  });

  it("deletes every member's private records' pictures for the campaign (T163)", async () => {
    await remove("gandalf");

    expect(await exists(FILES.privateImage)).toBe(false);
    expect(await exists(FILES.adminPrivateImage)).toBe(false);
    expect(await exists(FILES.privateOtherCampaign)).toBe(true);
  });

  it("leaves every other campaign's, the crest's and other groups' images alone", async () => {
    await remove("gandalf");

    expect(await exists(FILES.siblingCampaign)).toBe(true);
    expect(await exists(FILES.lookalikeCampaign)).toBe(true);
    expect(await exists(FILES.crest)).toBe(true);
    expect(await exists(FILES.otherGroup)).toBe(true);
  });

  it("deletes nothing when a plain member asks", async () => {
    await expectHttpsError(remove("frodo"), "permission-denied");

    expect(await exists(FILES.npcImage)).toBe(true);
    expect((await db.doc(`groups/${GROUP}/campaigns/c1`).get()).exists).toBe(true);
  });

  it("deletes nothing when the global-admin flag's holder asks, not being the group's admin (T119)", async () => {
    await db.doc("users/saruman").set({id: "saruman", groups: [], isAdmin: true});

    await expectHttpsError(remove("saruman"), "permission-denied");

    expect(await exists(FILES.npcImage)).toBe(true);
    expect((await db.doc(`groups/${GROUP}/campaigns/c1`).get()).exists).toBe(true);
    expect((await db.doc(`groups/${GROUP}/campaigns/c1`).get()).data()?.deleting).toBeUndefined();
  });

  it("deletes nothing when the campaign does not exist", async () => {
    await expectHttpsError(remove("gandalf", "c10"), "not-found");

    expect(await exists(FILES.lookalikeCampaign)).toBe(true);
  });
});

describe("members' reading progress (T073)", () => {
  const progress = (uid: string, campaignId: string) =>
    db.doc(`groups/${GROUP}/users/${uid}/story-progress/${campaignId}`);

  beforeEach(async () => {
    const place = {currentChapter: "chapter-01", chapterProgress: {}};
    await Promise.all([
      progress("gandalf", "c1").set(place),
      progress("frodo", "c1").set(place),
      progress("frodo", "c2").set(place),
    ]);
  });

  it("goes with the campaign, for every member", async () => {
    await remove("gandalf");

    expect((await progress("gandalf", "c1").get()).exists).toBe(false);
    expect((await progress("frodo", "c1").get()).exists).toBe(false);
  });

  it("stays for every other campaign", async () => {
    await remove("gandalf");

    expect((await progress("frodo", "c2").get()).exists).toBe(true);
  });
});

describe("members' private records (T163)", () => {
  const privately = (uid: string, campaignId: string, path: string) =>
    db.doc(`groups/${GROUP}/users/${uid}/private/${campaignId}/${path}`);

  beforeEach(async () => {
    await Promise.all([
      privately("frodo", "c1", "npcs/gollum").set({name: "Gollum"}),
      privately("frodo", "c1", "npcs/gollum/notes/n1").set({text: "Lost a ring"}),
      privately("frodo", "c1", "links/l1").set({from: {kind: "npc", id: "gollum"}, to: {kind: "quest", id: "q1"}}),
      privately("gandalf", "c1", "quests/the-ring").set({title: "The ring"}),
      privately("frodo", "c2", "npcs/smeagol").set({name: "Sméagol"}),
    ]);
  });

  it("go with the campaign, for every member, notes and held links too", async () => {
    await remove("gandalf");

    for (const ref of [
      privately("frodo", "c1", "npcs/gollum"),
      privately("frodo", "c1", "npcs/gollum/notes/n1"),
      privately("frodo", "c1", "links/l1"),
      privately("gandalf", "c1", "quests/the-ring"),
    ]) {
      expect((await ref.get()).exists).toBe(false);
    }
  });

  it("stay for every other campaign", async () => {
    await remove("gandalf");

    expect((await privately("frodo", "c2", "npcs/smeagol").get()).exists).toBe(true);
  });
});

describe("a deletion that fails partway (T037)", () => {
  // Every stage can fail. Whatever failed, calling again must finish the
  // job, and a failure must never leave a live campaign whose pictures are
  // gone (DATA-004, IMG-005, TEST-005).
  const campaign = db.doc(`groups/${GROUP}/campaigns/c1`);
  const npc = db.doc(`groups/${GROUP}/campaigns/c1/npcs/n1`);
  const record = db.doc(`groups/${GROUP}/campaignDeletions/c1`);
  const note = db.doc(`groups/${GROUP}/users/frodo/notes/note-c1`);
  const otherNote = db.doc(`groups/${GROUP}/users/frodo/notes/note-c2`);
  const isThere = async (ref: DocumentReference) =>
    (await ref.get()).exists;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bulkWriterProto = BulkWriter.prototype as any;

  /** Fails the next BulkWriter delete of `path`, the way a write that has
   * exhausted its retries does: its own promise rejects, `close()` does not. */
  const failNextDeleteOf = (path: string) => {
    const original = bulkWriterProto.delete;
    let failed = false;
    jest.spyOn(bulkWriterProto, "delete").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function(this: unknown, ...args: any[]) {
        if (!failed && args[0].path === path) {
          failed = true;
          return Promise.reject(new Error("injected: delete failed"));
        }
        // eslint-disable-next-line no-invalid-this
        return original.apply(this, args);
      }
    );
  };

  beforeEach(async () => {
    await note.set({campaignId: "c1", title: "Bree", content: "secret"});
    await otherNote.set({campaignId: "c2", title: "Rohan", content: "kept"});
    await db.doc(`groups/${GROUP}/users/frodo`).update({activeCampaignId: "c1"});
  });

  it("control: a clean run removes the descendants, the notes and the record", async () => {
    await remove("gandalf");

    expect(await isThere(npc)).toBe(false);
    expect(await isThere(note)).toBe(false);
    expect(await isThere(otherNote)).toBe(true);
    expect((await db.doc(`groups/${GROUP}/users/frodo`).get()).data()?.activeCampaignId)
      .toBeNull();
    expect(await isThere(record)).toBe(false);
  });

  it("stops at a member's note it could not delete, and a retry finishes", async () => {
    failNextDeleteOf(note.path);

    await expectHttpsError(remove("gandalf"), "internal");
    // Nothing past the failed stage happened, and the campaign stays closed
    // to writes until a retry finishes it (DATA-010).
    expect(await isThere(note)).toBe(true);
    expect(await isThere(campaign)).toBe(true);
    expect((await campaign.get()).data()?.deleting).toBe(true);
    expect(await exists(FILES.npcImage)).toBe(true);

    await remove("gandalf");
    expect(await isThere(note)).toBe(false);
    expect(await isThere(campaign)).toBe(false);
    expect(await exists(FILES.npcImage)).toBe(false);
    expect(await isThere(record)).toBe(false);
  });

  it("finishes on retry after the campaign document went but a descendant did not", async () => {
    // The real recursiveDelete deletes the root even when a child failed.
    failNextDeleteOf(npc.path);

    await expectHttpsError(remove("gandalf"), "internal");
    expect(await isThere(campaign)).toBe(false);
    expect(await isThere(npc)).toBe(true);

    await remove("gandalf");
    expect(await isThere(npc)).toBe(false);
    expect(await exists(FILES.npcImage)).toBe(false);
    expect(await isThere(record)).toBe(false);
  });

  it("keeps the pictures while the documents that show them could not be deleted", async () => {
    jest.spyOn(Firestore.prototype, "recursiveDelete")
      .mockRejectedValueOnce(new Error("injected: backend unavailable"));

    await expectHttpsError(remove("gandalf"), "internal");
    expect(await isThere(npc)).toBe(true);
    expect(await exists(FILES.npcImage)).toBe(true);
    expect(await exists(FILES.locationImage)).toBe(true);
  });

  it("finishes on retry after the pictures could not be deleted", async () => {
    const bucketProto = Object.getPrototypeOf(imageBucket());
    jest.spyOn(bucketProto, "deleteFiles")
      .mockRejectedValueOnce(new Error("injected: storage unavailable"));

    await expectHttpsError(remove("gandalf"), "internal");
    expect(await isThere(campaign)).toBe(false);
    expect(await exists(FILES.npcImage)).toBe(true);
    expect(await isThere(record)).toBe(true);

    await remove("gandalf");
    expect(await exists(FILES.npcImage)).toBe(false);
    expect(await exists(FILES.siblingCampaign)).toBe(true);
    expect(await isThere(record)).toBe(false);
  });

  it("still refuses a plain member, even with a deletion under way", async () => {
    failNextDeleteOf(npc.path);
    await expectHttpsError(remove("gandalf"), "internal");

    await expectHttpsError(remove("frodo"), "permission-denied");
    expect(await isThere(npc)).toBe(true);
  });

  it("answers not-found once a finished deletion is asked for again", async () => {
    await remove("gandalf");
    await expectHttpsError(remove("gandalf"), "not-found");
  });
});
