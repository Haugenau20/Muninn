// functions/test/deleteUserNotes.test.ts
//
// #1405: a player's notes live at groups/{g}/users/{uid}/notes, beneath their
// group profile. Firestore does not cascade deletes to subcollections, so
// removing the profile document alone leaves every note behind -- unreachable
// by the app, but still stored and still readable by anything holding the path.
// Both ways out of a group (leaving it, deleting the account) must take the
// notes with them, and must touch nobody else's.
import {getAuth} from "firebase-admin/auth";
import {Firestore, WriteBatch} from "firebase-admin/firestore";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {removeUserFromGroup} from "../src/userManagement/removeUserFromGroup";
import {deleteUser} from "../src/userManagement/deleteUser";

const PROJECT = "demo-delete-user-notes";
const db = useEmulatorProject(PROJECT);
const G1 = "g1";
const G2 = "g2";

const notesOf = (group: string, uid: string) =>
  db.collection(`groups/${group}/users/${uid}/notes`);
const noteCount = async (group: string, uid: string) =>
  (await notesOf(group, uid).get()).size;
const historyCount = async (group: string, uid: string) =>
  (await notesOf(group, uid).doc("n1").collection("history").get()).size;

/** Seeds a member: Auth account, global profile, group profiles and usernames. */
async function seedMember(uid: string, role: string, groups: string[] = [G1]) {
  await getAuth().createUser({uid});
  await db.doc(`users/${uid}`).set({id: uid, groups, activeGroupId: groups[0]});
  for (const group of groups) {
    await db.doc(`groups/${group}`).set({name: group});
    await db.doc(`groups/${group}/users/${uid}`).set({userId: uid, username: uid, role});
    await db.doc(`groups/${group}/usernames/${uid}`).set({userId: uid, originalUsername: uid});
  }
}

/** Gives a member three notes in a group, one with a nested subcollection. */
async function seedNotes(group: string, uid: string) {
  await notesOf(group, uid).doc("n1").set({title: "Rumours", content: "secret"});
  await notesOf(group, uid).doc("n2").set({title: "Plans", content: "also secret"});
  await notesOf(group, uid).doc("n3").set({title: "Draft", content: "unsent"});
  await notesOf(group, uid).doc("n1").collection("history").doc("v1").set({content: "older"});
}

const leave = (group: string, uid: string) =>
  call(removeUserFromGroup, {groupId: group, userId: uid}, uid);
const deleteAccount = (uid: string) => call(deleteUser, {userId: uid}, uid);

beforeEach(async () => {
  // Both functions log every failure before rethrowing it; that is their
  // production behaviour, and noise here.
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  await clearProject(PROJECT);
  await seedMember("gandalf", "admin");
  await seedMember("frodo", "member");
  await seedMember("sam", "member");
  await seedNotes(G1, "frodo");
  await seedNotes(G1, "sam");
});

afterEach(() => jest.restoreAllMocks());

describe("deleting an account", () => {
  it("deletes the user's notes, including anything nested under them", async () => {
    await deleteAccount("frodo");

    expect(await noteCount(G1, "frodo")).toBe(0);
    expect(await historyCount(G1, "frodo")).toBe(0);
    expect((await db.doc(`groups/${G1}/users/frodo`).get()).exists).toBe(false);
    expect((await db.doc("users/frodo").get()).exists).toBe(false);
  });

  it("leaves other members' notes and profiles untouched", async () => {
    await deleteAccount("frodo");

    expect(await noteCount(G1, "sam")).toBe(3);
    expect(await historyCount(G1, "sam")).toBe(1);
    expect((await notesOf(G1, "sam").doc("n1").get()).data()).toEqual({
      title: "Rumours",
      content: "secret",
    });
    expect((await db.doc(`groups/${G1}/users/sam`).get()).exists).toBe(true);
    expect((await db.doc(`groups/${G1}/users/gandalf`).get()).exists).toBe(true);
  });

  it("deletes the user's notes in every group they belonged to", async () => {
    await seedMember("bilbo", "member", [G1, G2]);
    await seedMember("elrond", "admin", [G2]);
    await seedNotes(G1, "bilbo");
    await seedNotes(G2, "bilbo");

    await deleteAccount("bilbo");

    expect(await noteCount(G1, "bilbo")).toBe(0);
    expect(await noteCount(G2, "bilbo")).toBe(0);
    expect(await noteCount(G1, "frodo")).toBe(3);
  });

  it("deletes no other account, even for the global-admin flag (T119)", async () => {
    // The flag used to let its holder delete anyone. Only the maintainer
    // holds it, and the console and the Admin SDK already reach every
    // account, so in the app it only made their session able to.
    await db.doc("users/gandalf").update({isAdmin: true});

    await expectHttpsError(call(deleteUser, {userId: "frodo"}, "gandalf"), "permission-denied");

    expect(await noteCount(G1, "frodo")).toBe(3);
    expect((await db.doc("users/frodo").get()).exists).toBe(true);
    await expect(getAuth().getUser("frodo")).resolves.toBeDefined();
  });

  it("is retryable: if the notes cannot be deleted, nothing else is", async () => {
    jest
      .spyOn(Firestore.prototype, "recursiveDelete")
      .mockRejectedValueOnce(new Error("backend unavailable"));

    await expectHttpsError(deleteAccount("frodo"), "internal");

    // The account is still whole, so the user can simply try again.
    expect((await db.doc("users/frodo").get()).exists).toBe(true);
    expect((await db.doc(`groups/${G1}/users/frodo`).get()).exists).toBe(true);
    expect((await db.doc(`groups/${G1}/usernames/frodo`).get()).exists).toBe(true);
    await expect(getAuth().getUser("frodo")).resolves.toBeDefined();
    expect(await noteCount(G1, "frodo")).toBe(3);

    jest.restoreAllMocks();
    await deleteAccount("frodo");

    expect(await noteCount(G1, "frodo")).toBe(0);
    expect((await db.doc("users/frodo").get()).exists).toBe(false);
  });
});

describe("leaving a group", () => {
  it("deletes the member's notes in that group", async () => {
    await leave(G1, "frodo");

    expect(await noteCount(G1, "frodo")).toBe(0);
    expect(await historyCount(G1, "frodo")).toBe(0);
    expect((await db.doc(`groups/${G1}/users/frodo`).get()).exists).toBe(false);
  });

  it("leaves other members' notes untouched", async () => {
    await leave(G1, "frodo");

    expect(await noteCount(G1, "sam")).toBe(3);
    expect(await historyCount(G1, "sam")).toBe(1);
  });

  it("keeps the member's notes in the groups they stay in", async () => {
    await seedMember("bilbo", "member", [G1, G2]);
    await seedNotes(G1, "bilbo");
    await seedNotes(G2, "bilbo");

    await leave(G1, "bilbo");

    expect(await noteCount(G1, "bilbo")).toBe(0);
    expect(await noteCount(G2, "bilbo")).toBe(3);
    // T136: the group profiles are the membership.
    expect((await db.doc(`groups/${G1}/users/bilbo`).get()).exists).toBe(false);
    expect((await db.doc(`groups/${G2}/users/bilbo`).get()).exists).toBe(true);
  });

  it("lets a group admin remove a member, notes included", async () => {
    await call(removeUserFromGroup, {groupId: G1, userId: "frodo"}, "gandalf");

    expect(await noteCount(G1, "frodo")).toBe(0);
    expect(await noteCount(G1, "sam")).toBe(3);
  });

  it("is retryable: if the notes cannot be deleted, the membership stays", async () => {
    jest
      .spyOn(Firestore.prototype, "recursiveDelete")
      .mockRejectedValueOnce(new Error("backend unavailable"));

    await expectHttpsError(leave(G1, "frodo"), "internal");

    // Still a member -- the profile is the membership (T136) -- so the leave
    // path can see the membership and retry.
    expect((await db.doc(`groups/${G1}/users/frodo`).get()).exists).toBe(true);
    expect(await noteCount(G1, "frodo")).toBe(3);

    jest.restoreAllMocks();
    await leave(G1, "frodo");

    expect(await noteCount(G1, "frodo")).toBe(0);
    expect((await db.doc(`groups/${G1}/users/frodo`).get()).exists).toBe(false);
  });
});

describe("a removal that fails after the notes are gone", () => {
  // Each step after the subtree deletion can fail too. The retry must still
  // find everything left to do -- the name reservation (DATA-009) and the
  // Auth account (AUTH-002) -- instead of refusing or skipping it.
  const failNextCommit = () => jest
    .spyOn(WriteBatch.prototype, "commit")
    .mockRejectedValueOnce(new Error("backend unavailable"));

  it("leaving: a retry still releases the member's name", async () => {
    failNextCommit();
    await expectHttpsError(leave(G1, "frodo"), "internal");
    expect((await db.doc(`groups/${G1}/users/frodo`).get()).exists).toBe(false);

    await leave(G1, "frodo");

    expect((await db.doc(`groups/${G1}/usernames/frodo`).get()).exists).toBe(false);
    expect((await db.doc("users/frodo").get()).get("activeGroupId")).not.toBe(G1);
  });

  it("deleting an account: a retry still releases the member's name", async () => {
    failNextCommit();
    await expectHttpsError(deleteAccount("frodo"), "internal");
    expect((await db.doc(`groups/${G1}/users/frodo`).get()).exists).toBe(false);

    await deleteAccount("frodo");

    expect((await db.doc(`groups/${G1}/usernames/frodo`).get()).exists).toBe(false);
    expect((await db.doc("users/frodo").get()).exists).toBe(false);
    await expect(getAuth().getUser("frodo")).rejects.toMatchObject({code: "auth/user-not-found"});
  });

  it("deleting an account: a retry finishes an Auth deletion that failed", async () => {
    jest.spyOn(getAuth(), "deleteUser")
      .mockRejectedValueOnce(new Error("auth backend unavailable"));
    await expectHttpsError(deleteAccount("frodo"), "internal");
    expect((await db.doc("users/frodo").get()).exists).toBe(false);
    await expect(getAuth().getUser("frodo")).resolves.toBeDefined();

    await deleteAccount("frodo");

    await expect(getAuth().getUser("frodo")).rejects.toMatchObject({code: "auth/user-not-found"});
  });

  it("deleting an account: still not-found once nothing is left", async () => {
    await deleteAccount("frodo");
    await expectHttpsError(deleteAccount("frodo"), "not-found");
  });

  it("deleting another account: still refused once the profile is gone", async () => {
    jest.spyOn(getAuth(), "deleteUser")
      .mockRejectedValueOnce(new Error("auth backend unavailable"));
    await expectHttpsError(deleteAccount("frodo"), "internal");

    await expectHttpsError(call(deleteUser, {userId: "frodo"}, "sam"), "permission-denied");
    await expect(getAuth().getUser("frodo")).resolves.toBeDefined();
  });
});
