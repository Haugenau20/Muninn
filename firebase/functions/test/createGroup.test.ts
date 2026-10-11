// functions/test/createGroup.test.ts
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {createGroup} from "../src/groupManagement/createGroup";
import {FOUNDER_INVITATIONS, issueFounderInvitation} from "../src/signUp/founderInvitations";
import {hashInvitationToken} from "../src/shared/invitationToken";

const PROJECT = "demo-create-group";
const db = useEmulatorProject(PROJECT);
const DAY = 24 * 60 * 60 * 1000;

const create = (data: object, uid?: string) =>
  call(createGroup, data, uid, uid ? `${uid}@example.com` : undefined) as
    Promise<{success: boolean; groupId: string}>;

/** A live founder link, as `issue-founder-invitation.js` issues one. */
const founderLink = async () => (await issueFounderInvitation(db, {issuedBy: "script"})).token;

/** A group `uid` started earlier. */
const startedEarlier = (groupId: string, uid: string) =>
  db.doc(`groups/${groupId}`).set({name: groupId, createdBy: uid});

/** A founder link's invitation, stored under its token's hash (T145). */
const invitation = (token: string) =>
  db.collection(FOUNDER_INVITATIONS).doc(hashInvitationToken(token)).get();

beforeEach(() => clearProject(PROJECT));

describe("createGroup", () => {
  describe("refuses", () => {
    it("an anonymous caller", async () => {
      await expectHttpsError(create({name: "Fellowship", username: "Gandalf"}), "unauthenticated");
    });

    it("a name that is only whitespace", async () => {
      const founderToken = await founderLink();
      await expectHttpsError(create({name: "   ", username: "Gandalf", founderToken}, "gandalf"), "invalid-argument");
      expect((await invitation(founderToken)).data()?.used).toBe(false);
    });

    // T119: the rules cap a group's name and description for the client's
    // edits; the group is written here, past the rules, so the same caps are
    // checked here.
    it("a name over 200 characters, or a description over 10,000, creating nothing", async () => {
      const founderToken = await founderLink();
      await expectHttpsError(
        create({name: "x".repeat(201), username: "Gandalf", founderToken}, "gandalf"), "invalid-argument"
      );
      await expectHttpsError(
        create({name: "Fellowship", description: "x".repeat(10_001), username: "Gandalf", founderToken}, "gandalf"),
        "invalid-argument"
      );
      expect((await db.collection("groups").get()).size).toBe(0);
      expect((await invitation(founderToken)).data()?.used).toBe(false);
    });

    it("a description that is not text", async () => {
      const founderToken = await founderLink();
      await expectHttpsError(
        create({name: "Fellowship", description: {long: true}, username: "Gandalf", founderToken}, "gandalf"),
        "invalid-argument"
      );
      expect((await db.collection("groups").get()).size).toBe(0);
    });

    // T126: the founder is named in their group as members are when they join.
    it.each([
      ["no name in the group", undefined],
      ["a name under 3 characters", "Ga"],
      ["a name over 20 characters", "G".repeat(21)],
    ])("%s for the founder", async (_label, username) => {
      const founderToken = await founderLink();
      await expectHttpsError(create({name: "Fellowship", username, founderToken}, "gandalf"), "invalid-argument");
      expect((await db.collection("groups").get()).size).toBe(0);
      expect((await invitation(founderToken)).data()?.used).toBe(false);
    });

    it("nothing at the limits: a name of 200 and a description of 10,000", async () => {
      const founderToken = await founderLink();
      const {groupId} = await create(
        {name: "x".repeat(200), description: "y".repeat(10_000), username: "Gandalf", founderToken},
        "gandalf"
      );
      expect((await db.doc(`groups/${groupId}`).get()).data()?.description).toHaveLength(10_000);
    });
  });

  // T126 (the onboarding plan, D1 and D4): a group starts from a founder link,
  // and whoever started one may start two more without asking.
  describe("who may start a group", () => {
    it("not someone who has neither a founder link nor a group of their own", async () => {
      await db.doc("groups/joined").set({name: "joined", createdBy: "someone-else"});

      const error = await expectHttpsError(create({name: "Fellowship", username: "Gandalf"}, "gandalf"), "permission-denied");
      expect(error.message).toMatch(/link to start a group/i);
      expect((await db.collection("groups").get()).size).toBe(1);
    });

    it("someone holding a founder link, which it spends", async () => {
      const founderToken = await founderLink();
      const {groupId} = await create({name: "Fellowship", username: "Gandalf", founderToken}, "gandalf");

      expect((await db.doc(`groups/${groupId}`).get()).exists).toBe(true);
      expect((await invitation(founderToken)).data()).toMatchObject({used: true, usedBy: "gandalf", groupId});
    });

    it("someone holding a founder link issued before T145, stored under its token", async () => {
      const founderToken = "legacy-founder-token-0123456789";
      await db.collection(FOUNDER_INVITATIONS).doc(founderToken).set({used: false, createdAt: new Date(), expiresAt: new Date(Date.now() + DAY)});
      const {groupId} = await create({name: "Fellowship", username: "Gandalf", founderToken}, "gandalf");

      expect((await db.collection(FOUNDER_INVITATIONS).doc(founderToken).get()).data()).toMatchObject({used: true, groupId});
    });

    it("not with a founder link's id presented as its token (T145)", async () => {
      const {invitationId} = await issueFounderInvitation(db, {issuedBy: "script"});
      await expectHttpsError(create({name: "Fellowship", username: "Gandalf", founderToken: invitationId}, "gandalf"), "not-found");
      expect((await db.collection("groups").get()).size).toBe(0);
    });

    it("not with a founder link that does not exist", async () => {
      await expectHttpsError(create({name: "Fellowship", username: "Gandalf", founderToken: "forged"}, "gandalf"), "not-found");
      expect((await db.collection("groups").get()).size).toBe(0);
    });

    it("not with a founder link already used", async () => {
      const founderToken = await founderLink();
      await create({name: "Fellowship", username: "Gandalf", founderToken}, "gandalf");

      await expectHttpsError(create({name: "Second", username: "Saruman", founderToken}, "saruman"), "failed-precondition");
      expect((await db.collection("groups").get()).size).toBe(1);
    });

    it("not with a founder link past its 14 days", async () => {
      const founderToken = (await issueFounderInvitation(db, {issuedBy: "script", now: new Date(Date.now() - 15 * DAY)})).token;
      await expectHttpsError(create({name: "Fellowship", username: "Gandalf", founderToken}, "gandalf"), "failed-precondition");
      expect((await db.collection("groups").get()).size).toBe(0);
    });

    it("only one of two callers racing with the same founder link", async () => {
      const founderToken = await founderLink();
      const outcomes = await Promise.allSettled([
        create({name: "Fellowship", username: "Gandalf", founderToken}, "gandalf"),
        create({name: "Isengard", username: "Saruman", founderToken}, "saruman"),
      ]);

      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      expect((await db.collection("groups").get()).size).toBe(1);
    });

    it("someone who started a group, a second and a third time without a link", async () => {
      await startedEarlier("first", "gandalf");

      await create({name: "Second", username: "Gandalf"}, "gandalf");
      await create({name: "Third", username: "Gandalf"}, "gandalf");

      expect((await db.collection("groups").where("createdBy", "==", "gandalf").get()).size).toBe(3);
    });

    it("not a fourth time without a link", async () => {
      for (const id of ["first", "second", "third"]) await startedEarlier(id, "gandalf");

      const error = await expectHttpsError(create({name: "Fourth", username: "Gandalf"}, "gandalf"), "resource-exhausted");
      expect(error.message).toMatch(/3 groups/);
      expect((await db.collection("groups").get()).size).toBe(3);
    });

    it("a fourth time with a founder link: the maintainer issued it on purpose", async () => {
      for (const id of ["first", "second", "third"]) await startedEarlier(id, "gandalf");
      const founderToken = await founderLink();

      await create({name: "Fourth", username: "Gandalf", founderToken}, "gandalf");
      expect((await db.collection("groups").get()).size).toBe(4);
    });

    it("counts only the groups the caller started, not those they joined", async () => {
      for (const id of ["a", "b", "c"]) await startedEarlier(id, "someone-else");
      await startedEarlier("mine", "gandalf");

      await create({name: "Second", username: "Gandalf"}, "gandalf");
    });
  });

  // The transaction wrote the group before it read the caller's profile, and
  // the Firestore SDK refuses a read after a write: every call failed with
  // "Firestore transactions require all reads to be executed before all
  // writes" -- in production too. No test covered this callable until then.
  describe("for a caller with a profile", () => {
    let founderToken: string;
    beforeEach(async () => {
      founderToken = await founderLink();
      await db.doc("users/gandalf").set({
        id: "gandalf",
        groups: ["older-group"],
        activeGroupId: "older-group",
      });
    });

    it("creates the group, named as asked", async () => {
      const {success, groupId} = await create(
        {name: "  The Fellowship  ", description: "Nine walkers", username: "Gandalf", founderToken},
        "gandalf"
      );

      expect(success).toBe(true);
      expect((await db.doc(`groups/${groupId}`).get()).data()).toMatchObject({
        name: "The Fellowship",
        description: "Nine walkers",
        createdBy: "gandalf",
      });
    });

    // T126: every creator used to be named "Admin", read from a global
    // `username` no flow writes.
    it("makes the caller its admin, under the name they gave", async () => {
      const {groupId} = await create({name: "The Fellowship", username: " Mithrandir ", founderToken}, "gandalf");

      expect((await db.doc(`groups/${groupId}/users/gandalf`).get()).data()).toMatchObject({
        userId: "gandalf",
        username: "Mithrandir",
        role: "admin",
      });
      expect((await db.doc(`groups/${groupId}/usernames/mithrandir`).get()).data()).toMatchObject({
        userId: "gandalf",
        originalUsername: "Mithrandir",
      });
    });

    // T136: membership is the group profile above; the global profile no
    // longer lists groups, and an array left on it from before is not touched.
    it("makes the group the caller's active one, and lists it nowhere else", async () => {
      const {groupId} = await create({name: "The Fellowship", username: "Gandalf", founderToken}, "gandalf");

      expect((await db.doc("users/gandalf").get()).data()).toEqual({
        id: "gandalf",
        groups: ["older-group"],
        activeGroupId: groupId,
      });
    });
  });

  it("creates the profile of a caller who has none", async () => {
    const founderToken = await founderLink();
    const {groupId} = await create({name: "The Fellowship", username: "Frodo", founderToken}, "frodo");

    const profile = (await db.doc("users/frodo").get()).data();
    expect(profile).toMatchObject({id: "frodo", email: "frodo@example.com", activeGroupId: groupId});
    expect(profile).not.toHaveProperty("groups");
    expect((await db.doc(`groups/${groupId}/users/frodo`).get()).data()?.role).toBe("admin");
  });
});
