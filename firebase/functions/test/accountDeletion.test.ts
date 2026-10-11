// functions/test/accountDeletion.test.ts
//
// Deleting an account, as the `deleteUser` callable does for its holder and
// `scripts/delete-account.js` does for the maintainer on request: first a plan
// that reads what would go and changes nothing, then the deletion itself.
import {getAuth} from "firebase-admin/auth";
import {clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {deleteAccount, planAccountDeletion} from "../src/userManagement/accountDeletion";
import {ACCOUNT_COUNT} from "../src/signUp/accountCount";

const PROJECT = "demo-account-deletion";
const db = useEmulatorProject(PROJECT);

/** Seeds a member: Auth account, global profile, group profiles and names. */
async function seedMember(uid: string, roles: Record<string, "admin" | "member">) {
  const groups = Object.keys(roles);
  await getAuth().createUser({uid, email: `${uid}@example.com`});
  await db.doc(`users/${uid}`).set({id: uid, groups, activeGroupId: groups[0] ?? null});
  for (const group of groups) {
    await db.doc(`groups/${group}`).set({name: group});
    await db.doc(`groups/${group}/users/${uid}`).set({userId: uid, username: uid, role: roles[group]});
    await db.doc(`groups/${group}/usernames/${uid}`).set({userId: uid, originalUsername: uid});
  }
}

const count = async (path: string) => (await db.collection(path).count().get()).data().count;
const exists = async (path: string) => (await db.doc(path).get()).exists;

beforeEach(async () => {
  await clearProject(PROJECT);
  await seedMember("gandalf", {g1: "admin"});
  await seedMember("frodo", {g1: "member", g2: "member"});
  for (const id of ["n1", "n2", "n3"]) {
    await db.doc(`groups/g1/users/frodo/notes/${id}`).set({title: id, content: "secret"});
  }
  await db.doc("groups/g1/users/frodo/story-progress/c1").set({currentChapter: "chapter-2"});
  // A second name, from a rename that kept the old reservation.
  await db.doc("groups/g1/usernames/mr-underhill").set({userId: "frodo", originalUsername: "Mr Underhill"});
});

describe("planning an account's deletion", () => {
  it("lists each group with the names, notes and reading progress that would go", async () => {
    const plan = await planAccountDeletion("frodo");

    expect(plan).toEqual({
      uid: "frodo",
      email: "frodo@example.com",
      hasSignIn: true,
      hasProfile: true,
      groups: [
        {groupId: "g1", names: ["Mr Underhill", "frodo"], notes: 3, readingProgress: 1, onlyAdmin: false},
        {groupId: "g2", names: ["frodo"], notes: 0, readingProgress: 0, onlyAdmin: false},
      ],
    });
  });

  it("changes nothing", async () => {
    await planAccountDeletion("frodo");

    expect(await exists("users/frodo")).toBe(true);
    expect(await exists("groups/g1/users/frodo")).toBe(true);
    expect(await count("groups/g1/users/frodo/notes")).toBe(3);
    await expect(getAuth().getUser("frodo")).resolves.toBeDefined();
  });

  it("marks a group whose only admin they are, which the deletion would strand", async () => {
    const plan = await planAccountDeletion("gandalf");
    expect(plan.groups).toEqual([
      {groupId: "g1", names: ["gandalf"], notes: 0, readingProgress: 0, onlyAdmin: true},
    ]);
    // Nobody was demoted to find out.
    expect((await db.doc("groups/g1/users/gandalf").get()).data()?.role).toBe("admin");
  });

  it("does not mark a group they are alone in: there is nobody to hand it to", async () => {
    await seedMember("bilbo", {g3: "admin"});
    expect((await planAccountDeletion("bilbo")).groups[0].onlyAdmin).toBe(false);
  });

  it("reports a sign-in whose profile is already gone", async () => {
    await db.doc("users/frodo").delete();
    await db.recursiveDelete(db.collection("groups/g1/users/frodo/notes"));
    await db.recursiveDelete(db.doc("groups/g1/users/frodo"));
    await db.doc("groups/g2/users/frodo").delete();
    expect(await planAccountDeletion("frodo")).toEqual({
      uid: "frodo", email: "frodo@example.com", hasSignIn: true, hasProfile: false, groups: [],
    });
  });

  // T136: the group profiles are the membership, so they are found without
  // the global profile that used to list them.
  it("reports the group profiles of an account whose global profile is gone", async () => {
    await db.doc("users/frodo").delete();
    expect((await planAccountDeletion("frodo")).groups.map((group) => group.groupId)).toEqual(["g1", "g2"]);
  });

  it("reports an account that does not exist as having nothing", async () => {
    expect(await planAccountDeletion("sauron")).toEqual({
      uid: "sauron", email: undefined, hasSignIn: false, hasProfile: false, groups: [],
    });
  });
});

describe("deleting an account", () => {
  it("removes everything the plan listed, and the sign-in", async () => {
    await deleteAccount("frodo");

    expect(await planAccountDeletion("frodo")).toEqual({
      uid: "frodo", email: undefined, hasSignIn: false, hasProfile: false, groups: [],
    });
    expect(await count("groups/g1/users/frodo/notes")).toBe(0);
    expect(await count("groups/g1/users/frodo/story-progress")).toBe(0);
    expect(await exists("groups/g1/usernames/mr-underhill")).toBe(false);
  });

  it("leaves everyone else alone", async () => {
    await deleteAccount("frodo");

    expect(await exists("users/gandalf")).toBe(true);
    expect(await exists("groups/g1/users/gandalf")).toBe(true);
    expect(await exists("groups/g1/usernames/gandalf")).toBe(true);
  });

  it("refuses the only admin of a group, naming it, and changes nothing", async () => {
    const error = await deleteAccount("gandalf").then(() => null, (e: unknown) => e);

    expect(error).toMatchObject({code: "failed-precondition", details: {groupId: "g1"}});
    expect(await exists("users/gandalf")).toBe(true);
    expect((await db.doc("groups/g1/users/gandalf").get()).data()?.role).toBe("admin");
  });

  // T136: the group profile is the record of membership, so a group whose
  // profile the array no longer lists is still theirs to clean up -- with
  // its private notes. While the array exists, what it lists is too.
  it("deletes a group profile the array does not list, with its private notes", async () => {
    await db.doc("users/frodo").update({groups: ["g2"]});

    expect((await planAccountDeletion("frodo")).groups.map((group) => group.groupId)).toEqual(["g1", "g2"]);
    await deleteAccount("frodo");

    expect(await exists("groups/g1/users/frodo")).toBe(false);
    expect(await count("groups/g1/users/frodo/notes")).toBe(0);
    expect(await exists("groups/g1/usernames/mr-underhill")).toBe(false);
  });

  it("still releases the names in a group only the array lists", async () => {
    await db.doc("groups/g2/users/frodo").delete();

    expect((await planAccountDeletion("frodo")).groups.map((group) => group.groupId)).toEqual(["g1", "g2"]);
    await deleteAccount("frodo");

    expect(await exists("groups/g2/usernames/frodo")).toBe(false);
  });

  it("finishes a profile whose sign-in is already gone", async () => {
    await getAuth().deleteUser("frodo");

    await deleteAccount("frodo");

    expect(await exists("users/frodo")).toBe(false);
    expect(await exists("groups/g1/users/frodo")).toBe(false);
  });

  it("deletes group profiles that outlived the global profile, with their private notes", async () => {
    await db.doc("users/frodo").delete();

    await deleteAccount("frodo");

    expect(await exists("groups/g1/users/frodo")).toBe(false);
    expect(await count("groups/g1/users/frodo/notes")).toBe(0);
    expect(await exists("groups/g2/users/frodo")).toBe(false);
    await expect(getAuth().getUser("frodo")).rejects.toMatchObject({code: "auth/user-not-found"});
  });

  it("finishes a sign-in whose profile is already gone", async () => {
    await db.doc("users/frodo").delete();

    await deleteAccount("frodo");

    await expect(getAuth().getUser("frodo")).rejects.toMatchObject({code: "auth/user-not-found"});
  });

  // T128: the account count gives the slot back.
  it("counts one account fewer", async () => {
    await db.doc(ACCOUNT_COUNT).set({count: 12});
    await deleteAccount("frodo");
    expect((await db.doc(ACCOUNT_COUNT).get()).data()?.count).toBe(11);
  });

  it("counts nothing for a sign-in that was already gone", async () => {
    await db.doc(ACCOUNT_COUNT).set({count: 12});
    await getAuth().deleteUser("frodo");
    await deleteAccount("frodo");
    expect((await db.doc(ACCOUNT_COUNT).get()).data()?.count).toBe(12);
  });

  it("is not-found when there is nothing to delete", async () => {
    await expectHttpsError(deleteAccount("sauron"), "not-found");
  });
});
