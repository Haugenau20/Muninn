// functions/test/deleteGroup.test.ts
//
// T037: deleting a group removes everything stored for it -- its campaigns,
// its members' profiles and private notes, its pictures -- and nothing of
// anyone else's. Members keep their accounts.
import {BulkWriter, Firestore} from "firebase-admin/firestore";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {deleteGroup} from "../src/groupManagement/deleteGroup";
import {imageBucket} from "../src/shared/imageBucket";

const PROJECT = "demo-delete-group";
const db = useEmulatorProject(PROJECT);
const GROUP = "g1";

/** One file per place a group's file could be, and two that are not its. */
const FILES = {
  npcImage: `groups/${GROUP}/campaigns/c1/npcs/n1/a.webp`,
  banner: `groups/${GROUP}/campaigns/c1/banner/b.webp`,
  crest: `groups/${GROUP}/crest/c.webp`,
  otherGroup: "groups/g2/crest/d.webp",
  // Shares the "g1" prefix without the slash: the delete must stop at "g1/".
  lookalikeGroup: "groups/g10/crest/e.webp",
};

/** Every document the group owns, beneath its own document. */
const OWNED = [
  `groups/${GROUP}/campaigns/c1`,
  `groups/${GROUP}/campaigns/c1/npcs/n1`,
  `groups/${GROUP}/campaigns/c1/chapters/ch1`,
  `groups/${GROUP}/users/gandalf`,
  `groups/${GROUP}/users/frodo`,
  `groups/${GROUP}/users/frodo/notes/note1`,
  `groups/${GROUP}/users/frodo/story-progress/c1`,
  `groups/${GROUP}/usernames/frodo`,
  `groups/${GROUP}/registrationTokens/tok1`,
  `groups/${GROUP}/pendingUploads/a.webp`,
  `groups/${GROUP}/releasedImages/r1`,
  `groups/${GROUP}/campaignDeletions/c9`,
];

const isThere = async (path: string) => (await db.doc(path).get()).exists;
const fileExists = async (path: string) => (await imageBucket().file(path).exists())[0];
const group = db.doc(`groups/${GROUP}`);
const record = db.doc(`groupDeletions/${GROUP}`);

beforeEach(async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  await clearProject(PROJECT);
  await imageBucket().deleteFiles({prefix: "groups/"});

  await group.set({name: "Fellowship"});
  await db.doc("groups/g2").set({name: "Rohirrim"});
  await db.doc(`groups/${GROUP}/users/gandalf`).set({userId: "gandalf", role: "admin"});
  await db.doc(`groups/${GROUP}/users/frodo`).set({userId: "frodo", role: "member"});
  await db.doc("groups/g2/users/frodo").set({userId: "frodo", role: "member"});
  await db.doc("users/gandalf").set({id: "gandalf", groups: [GROUP], activeGroupId: GROUP});
  // Frodo is in a second group and has it active: both must survive.
  await db.doc("users/frodo").set({id: "frodo", groups: [GROUP, "g2"], activeGroupId: "g2"});
  await db.doc("users/saruman").set({id: "saruman", groups: [], isAdmin: true});
  await db.doc("groups/g2/campaigns/c1").set({name: "Helm's Deep"});
  await db.doc("signUpReservations/g1_tok1").set({groupId: GROUP, email: "sam@example.com"});
  await db.doc("signUpReservations/g2_tok2").set({groupId: "g2", email: "eomer@example.com"});

  for (const path of OWNED) {
    if (!(await isThere(path))) await db.doc(path).set({seeded: true});
  }
  await Promise.all(
    Object.values(FILES).map((path) =>
      imageBucket().file(path).save(Buffer.from("x"), {contentType: "image/webp"})
    )
  );
});

afterEach(() => jest.restoreAllMocks());

const remove = (uid: string, groupId = GROUP) => call(deleteGroup, {groupId}, uid);

describe("deleting a group", () => {
  it("control: everything exists before the call", async () => {
    for (const path of OWNED) expect(await isThere(path)).toBe(true);
    for (const path of Object.values(FILES)) expect(await fileExists(path)).toBe(true);
  });

  it("deletes the group and every document beneath it", async () => {
    await remove("gandalf");

    expect(await isThere(group.path)).toBe(false);
    for (const path of OWNED) expect({path, there: await isThere(path)}).toEqual({path, there: false});
  });

  it("deletes the group's pictures, and nobody else's", async () => {
    await remove("gandalf");

    expect(await fileExists(FILES.npcImage)).toBe(false);
    expect(await fileExists(FILES.banner)).toBe(false);
    expect(await fileExists(FILES.crest)).toBe(false);
    expect(await fileExists(FILES.otherGroup)).toBe(true);
    expect(await fileExists(FILES.lookalikeGroup)).toBe(true);
  });

  it("keeps every member's account, without the group", async () => {
    await remove("gandalf");

    const gandalf = (await db.doc("users/gandalf").get()).data();
    expect(gandalf?.groups).toEqual([]);
    expect(gandalf?.activeGroupId).toBeNull();

    const frodo = (await db.doc("users/frodo").get()).data();
    expect(frodo?.groups).toEqual(["g2"]);
    expect(frodo?.activeGroupId).toBe("g2");
  });

  it("leaves other groups alone", async () => {
    await remove("gandalf");

    expect(await isThere("groups/g2")).toBe(true);
    expect(await isThere("groups/g2/users/frodo")).toBe(true);
    expect(await isThere("groups/g2/campaigns/c1")).toBe(true);
  });

  it("deletes pending sign-ups for the group's invitations, which hold an email", async () => {
    await remove("gandalf");

    expect(await isThere("signUpReservations/g1_tok1")).toBe(false);
    expect(await isThere("signUpReservations/g2_tok2")).toBe(true);
  });

  it("refuses the global-admin flag to a caller who is not the group's admin (T119)", async () => {
    await expectHttpsError(remove("saruman"), "permission-denied");

    expect(await isThere(group.path)).toBe(true);
    expect((await group.get()).data()?.deleting).toBeUndefined();
    expect(await isThere(record.path)).toBe(false);
  });

  it("refuses a plain member, and deletes nothing", async () => {
    await expectHttpsError(remove("frodo"), "permission-denied");

    expect(await isThere(group.path)).toBe(true);
    expect((await group.get()).data()?.deleting).toBeUndefined();
    expect(await fileExists(FILES.crest)).toBe(true);
  });

  it("refuses an anonymous caller", async () => {
    await expectHttpsError(remove(""), "unauthenticated");
  });

  it("refuses a group that does not exist", async () => {
    await db.doc("groups/g10/users/gandalf").set({userId: "gandalf", role: "admin"});

    await expectHttpsError(remove("gandalf", "g10"), "not-found");
    expect(await fileExists(FILES.lookalikeGroup)).toBe(true);
  });

  it("a finished deletion asked for again by its starter starts nothing new", async () => {
    await remove("gandalf");
    // Their admin profile went with the group, and so did the deletion's
    // record, which is what let them finish it.
    await expectHttpsError(remove("gandalf"), "permission-denied");

    expect(await isThere(group.path)).toBe(false);
    expect(await isThere(record.path)).toBe(false);
  });
});

describe("a deletion that fails partway", () => {
  // Every stage can fail, and calling again must finish the job. A failure
  // must never leave live documents whose pictures are gone. The retry comes
  // from whoever started the deletion, as in the app: their admin profile may
  // already have gone with the group, and the deletion's record lets them in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bulkWriterProto = BulkWriter.prototype as any;

  /** Fails the next BulkWriter update of `path`; `close()` still resolves. */
  const failNextUpdateOf = (path: string) => {
    const original = bulkWriterProto.update;
    let failed = false;
    jest.spyOn(bulkWriterProto, "update").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function(this: unknown, ...args: any[]) {
        if (!failed && args[0].path === path) {
          failed = true;
          return Promise.reject(new Error("injected: update failed"));
        }
        // eslint-disable-next-line no-invalid-this
        return original.apply(this, args);
      }
    );
  };

  it("control: a clean run leaves no record", async () => {
    await remove("gandalf");
    expect(await isThere(record.path)).toBe(false);
  });

  it("stops at a member it could not take the group from, and a retry finishes", async () => {
    failNextUpdateOf("users/frodo");

    await expectHttpsError(remove("gandalf"), "internal");
    // Nothing past the failed stage happened; the group is marked and
    // the record kept for the retry.
    expect((await group.get()).data()?.deleting).toBe(true);
    expect(await isThere(record.path)).toBe(true);
    expect(await isThere(`groups/${GROUP}/users/frodo/notes/note1`)).toBe(true);
    expect(await fileExists(FILES.crest)).toBe(true);

    await remove("gandalf");
    expect((await db.doc("users/frodo").get()).data()?.groups).toEqual(["g2"]);
    expect(await isThere(group.path)).toBe(false);
    expect(await isThere(record.path)).toBe(false);
  });

  it("keeps the pictures while the documents could not be deleted", async () => {
    jest.spyOn(Firestore.prototype, "recursiveDelete")
      .mockRejectedValueOnce(new Error("injected: backend unavailable"));

    await expectHttpsError(remove("gandalf"), "internal");
    expect(await fileExists(FILES.crest)).toBe(true);
    expect(await fileExists(FILES.npcImage)).toBe(true);
    expect(await isThere(record.path)).toBe(true);

    await remove("gandalf");
    expect(await isThere(`groups/${GROUP}/campaigns/c1/npcs/n1`)).toBe(false);
    expect(await fileExists(FILES.crest)).toBe(false);
  });

  // T136: the member profile is the record of membership, so it goes before
  // anything beneath it: a failure there leaves no member, only their
  // leftovers, which a retry takes.
  it("ends membership before emptying the profiles, and a retry finishes", async () => {
    jest.spyOn(Firestore.prototype, "recursiveDelete")
      .mockRejectedValueOnce(new Error("injected: backend unavailable"));

    await expectHttpsError(remove("gandalf"), "internal");
    expect(await isThere(`groups/${GROUP}/users/gandalf`)).toBe(false);
    expect(await isThere(`groups/${GROUP}/users/frodo`)).toBe(false);
    expect(await isThere(`groups/${GROUP}/users/frodo/notes/note1`)).toBe(true);
    expect(await isThere("groups/g2/users/frodo")).toBe(true);

    await remove("gandalf");
    expect(await isThere(`groups/${GROUP}/users/frodo/notes/note1`)).toBe(false);
    expect(await isThere(record.path)).toBe(false);
  });

  it("finishes on retry after the pictures could not be deleted", async () => {
    const bucketProto = Object.getPrototypeOf(imageBucket());
    jest.spyOn(bucketProto, "deleteFiles")
      .mockRejectedValueOnce(new Error("injected: storage unavailable"));

    await expectHttpsError(remove("gandalf"), "internal");
    expect(await isThere(group.path)).toBe(false);
    expect(await fileExists(FILES.crest)).toBe(true);
    expect(await isThere(record.path)).toBe(true);

    await remove("gandalf");
    expect(await fileExists(FILES.crest)).toBe(false);
    expect(await fileExists(FILES.otherGroup)).toBe(true);
    expect(await isThere(record.path)).toBe(false);
  });

  it("takes the group from someone who joined while it was being deleted", async () => {
    failNextUpdateOf("users/frodo");
    await expectHttpsError(remove("gandalf"), "internal");
    // The function refuses to admit anyone to a marked group; this is the
    // backstop for a write that slipped in anyway.
    await db.doc("users/sam").set({id: "sam", groups: [GROUP], activeGroupId: GROUP});

    await remove("gandalf");
    const sam = (await db.doc("users/sam").get()).data();
    expect(sam?.groups).toEqual([]);
    expect(sam?.activeGroupId).toBeNull();
  });
});
