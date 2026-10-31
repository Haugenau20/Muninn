// functions/test/lastAdminGuard.test.ts
//
// T035: leaving, and deleting your account, are the two other doors out of a
// group's administration. Both refuse when they would leave nobody able to run
// the group -- and both still work for everyone else.
import {getAuth} from "firebase-admin/auth";
import {Firestore, Query} from "firebase-admin/firestore";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {removeUserFromGroup} from "../src/userManagement/removeUserFromGroup";
import {deleteUser} from "../src/userManagement/deleteUser";
import {setMemberRole} from "../src/groupManagement/setMemberRole";
import {imageBucket} from "../src/shared/imageBucket";

const PROJECT = "demo-last-admin-guard";
const db = useEmulatorProject(PROJECT);
const GROUP = "g1";

const isMember = async (uid: string) =>
  (await db.doc(`groups/${GROUP}/users/${uid}`).get()).exists;

/** Seeds the group, each member's global profile and Auth account. */
async function seed(members: Record<string, string>) {
  await db.doc(`groups/${GROUP}`).set({name: "Fellowship"});
  for (const [uid, role] of Object.entries(members)) {
    await getAuth().createUser({uid});
    await db.doc(`users/${uid}`).set({id: uid, groups: [GROUP], activeGroupId: GROUP});
    await db.doc(`groups/${GROUP}/users/${uid}`).set({userId: uid, username: uid, role});
    await db.doc(`groups/${GROUP}/usernames/${uid}`).set({userId: uid, originalUsername: uid});
  }
}

const leave = (uid: string) => call(removeUserFromGroup, {groupId: GROUP, userId: uid}, uid);
const deleteAccount = (uid: string) => call(deleteUser, {userId: uid}, uid);

beforeEach(async () => {
  // Both functions log every refusal before rethrowing it; that is their
  // production behaviour, and noise here.
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  await clearProject(PROJECT);
});

afterEach(() => jest.restoreAllMocks());

describe("leaving a group", () => {
  it("is refused to the only admin while anyone else remains, and changes nothing", async () => {
    await seed({gandalf: "admin", frodo: "member"});
    const error = await expectHttpsError(leave("gandalf"), "failed-precondition");
    expect(error.message).toMatch(/only admin/);
    expect(await isMember("gandalf")).toBe(true);
    expect((await db.doc("users/gandalf").get()).get("activeGroupId")).toBe(GROUP);
  });

  it("is allowed to the only admin when nobody else is in the group", async () => {
    await seed({gandalf: "admin"});
    await leave("gandalf");
    expect(await isMember("gandalf")).toBe(false);
  });

  it("is allowed to an admin when another admin remains", async () => {
    await seed({gandalf: "admin", aragorn: "admin", frodo: "member"});
    await leave("gandalf");
    expect(await isMember("gandalf")).toBe(false);
  });

  it("is allowed to a member", async () => {
    await seed({gandalf: "admin", frodo: "member"});
    await leave("frodo");
    expect(await isMember("frodo")).toBe(false);
    expect((await db.doc("users/frodo").get()).get("activeGroupId")).toBeNull();
  });
});

describe("deleting your account", () => {
  it("is refused to the only admin of a group others are in, and deletes nothing", async () => {
    await seed({gandalf: "admin", frodo: "member"});
    await expectHttpsError(deleteAccount("gandalf"), "failed-precondition");
    expect(await isMember("gandalf")).toBe(true);
    expect((await db.doc("users/gandalf").get()).exists).toBe(true);
    await expect(getAuth().getUser("gandalf")).resolves.toBeDefined();
  });

  it("is allowed to a member", async () => {
    await seed({gandalf: "admin", frodo: "member"});
    await deleteAccount("frodo");
    expect(await isMember("frodo")).toBe(false);
    expect((await db.doc("users/frodo").get()).exists).toBe(false);
  });
});

describe("a member's reading progress (T073)", () => {
  // Progress sits beside private notes, so it goes with the member's subtree
  // on both ways out. Pinned because nothing else says so.
  const progress = (uid: string) =>
    db.doc(`groups/${GROUP}/users/${uid}/story-progress/c1`);

  it("is deleted when they leave the group", async () => {
    await seed({gandalf: "admin", frodo: "member"});
    await progress("frodo").set({currentChapter: "chapter-01", chapterProgress: {}});

    await leave("frodo");

    expect((await progress("frodo").get()).exists).toBe(false);
  });

  it("is deleted with their account", async () => {
    await seed({gandalf: "admin", frodo: "member"});
    await progress("frodo").set({currentChapter: "chapter-01", chapterProgress: {}});

    await deleteAccount("frodo");

    expect((await progress("frodo").get()).exists).toBe(false);
  });
});

describe("a member's private records and their pictures (T163)", () => {
  // Under the member's profile, so they go with it on both ways out: the
  // records with the subtree, the pictures by their prefix in the bucket.
  const record = () => db.doc(`groups/${GROUP}/users/frodo/private/c1/npcs/gollum`);
  const picture = `groups/${GROUP}/users/frodo/campaigns/c1/npcs/gollum/a.webp`;
  const othersPicture = `groups/${GROUP}/users/gandalf/campaigns/c1/npcs/cave/b.webp`;
  const exists = async (path: string) => (await imageBucket().file(path).exists())[0];

  beforeEach(async () => {
    await seed({gandalf: "admin", frodo: "member"});
    await record().set({name: "Gollum"});
    await imageBucket().file(picture).save(Buffer.from("x"), {contentType: "image/webp"});
    await imageBucket().file(othersPicture).save(Buffer.from("x"), {contentType: "image/webp"});
  });

  it("go when they leave the group, and nobody else's do", async () => {
    await leave("frodo");

    expect((await record().get()).exists).toBe(false);
    expect(await exists(picture)).toBe(false);
    expect(await exists(othersPicture)).toBe(true);
  });

  it("go with their account", async () => {
    await deleteAccount("frodo");

    expect((await record().get()).exists).toBe(false);
    expect(await exists(picture)).toBe(false);
  });
});

/**
 * Holds every caller at its first query of the group's members until
 * `parties` callers have made one, then lets them all go on.
 *
 * That forces the interleaving AUTH-001 needs: each admin reads the roster
 * before the other has changed it. Patching `Query._get` catches the read
 * whether it runs in a transaction or not, so the same barrier exercises
 * the guard before and after it moved into one. Retries (a transaction
 * that lost a conflict) pass straight through once the barrier has opened.
 *
 * @param {number} parties How many callers to hold
 * @return {() => number} How many callers have arrived so far
 */
function holdRosterReads(parties: number): () => number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = Query.prototype as any;
  const original = proto._get;
  let arrived = 0;
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const watchdog = setTimeout(open, 5000);
  // `this` is the query being read: the patch has to be a method.
  /* eslint-disable no-invalid-this, @typescript-eslint/no-explicit-any */
  jest.spyOn(proto, "_get").mockImplementation(async function(this: any, ...args: unknown[]) {
    const result = await original.apply(this, args);
    const isRoster = this._queryOptions?.collectionId === "users" &&
      this._queryOptions?.parentPath?.relativeName?.endsWith(`groups/${GROUP}`);
    if (isRoster && arrived < parties) {
      if (++arrived === parties) {
        clearTimeout(watchdog);
        open();
      }
      await opened;
    }
    return result;
  });
  /* eslint-enable no-invalid-this, @typescript-eslint/no-explicit-any */
  return () => arrived;
}

const rolesInGroup = async () => Object.fromEntries(
  (await db.collection(`groups/${GROUP}/users`).get()).docs
    .map((doc) => [doc.id, doc.data().role])
);

describe("two admins stepping away at once (AUTH-001)", () => {
  // Each pair passed the guard separately and together left Sam's group
  // with no admin. Afterwards, at least one admin must remain whenever
  // anybody does.
  const seedTwoAdmins = () =>
    seed({gandalf: "admin", aragorn: "admin", sam: "member"});

  const ways: Record<string, (uid: string) => Promise<unknown>> = {
    "demote themselves": (uid) =>
      call(setMemberRole, {groupId: GROUP, userId: uid, role: "member"}, uid),
    "leave": leave,
    "delete their accounts": deleteAccount,
  };

  it.each(Object.keys(ways))("cannot both %s", async (way) => {
    await seedTwoAdmins();
    const arrived = holdRosterReads(2);

    const results = await Promise.allSettled(
      ["gandalf", "aragorn"].map((uid) => ways[way](uid))
    );

    expect(arrived()).toBe(2);
    expect(Object.values(await rolesInGroup())).toContain("admin");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.code).toBe("failed-precondition");
  });

  it("cannot demote each other", async () => {
    await seedTwoAdmins();
    const arrived = holdRosterReads(2);

    await Promise.allSettled([
      call(setMemberRole, {groupId: GROUP, userId: "aragorn", role: "member"}, "gandalf"),
      call(setMemberRole, {groupId: GROUP, userId: "gandalf", role: "member"}, "aragorn"),
    ]);

    expect(arrived()).toBe(2);
    expect(Object.values(await rolesInGroup())).toContain("admin");
  });

  it("cannot both leave in different ways", async () => {
    await seedTwoAdmins();
    const arrived = holdRosterReads(2);

    await Promise.allSettled([leave("gandalf"), deleteAccount("aragorn")]);

    expect(arrived()).toBe(2);
    expect(Object.values(await rolesInGroup())).toContain("admin");
  });
});

describe("an admin who passes the guard", () => {
  it("is demoted before the rest of leaving, so a failed leave can be retried", async () => {
    // The demotion commits before the member's documents are touched; if
    // what follows fails, they stay behind as a member, and the retry
    // passes the guard instead of counting them as the admin who remains.
    await seed({gandalf: "admin", aragorn: "admin", sam: "member"});
    jest.spyOn(Firestore.prototype, "recursiveDelete")
      .mockRejectedValueOnce(new Error("injected"));

    await expectHttpsError(leave("gandalf"), "internal");
    expect((await rolesInGroup()).gandalf).toBe("member");

    await leave("gandalf");
    expect(await isMember("gandalf")).toBe(false);
    expect((await rolesInGroup()).aragorn).toBe("admin");
  });

  it("is demoted in none of their groups when one of them refuses", async () => {
    await seed({gandalf: "admin", aragorn: "admin", sam: "member"});
    await db.doc("groups/g2").set({name: "Rohan"});
    await db.doc("groups/g2/users/gandalf").set({userId: "gandalf", username: "gandalf", role: "admin"});
    await db.doc("groups/g2/users/eowyn").set({userId: "eowyn", username: "eowyn", role: "member"});
    await db.doc("users/gandalf").update({groups: [GROUP, "g2"]});

    await expectHttpsError(deleteAccount("gandalf"), "failed-precondition");

    expect((await rolesInGroup()).gandalf).toBe("admin");
    expect((await db.doc("groups/g2/users/gandalf").get()).data()?.role).toBe("admin");
  });
});
