// functions/test/redeemInvitation.test.ts
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {redeemInvitation} from "../src/groupManagement/redeemInvitation";
import {MAX_GROUP_MEMBERS} from "../src/groupManagement/groupLimits";
import {HASHED_SCHEME, hashInvitationToken} from "../src/shared/invitationToken";

const PROJECT = "demo-redeem-invitation";
const db = useEmulatorProject(PROJECT);

const GROUP = "g1";
const TOKEN = "tok-live";
/** Where the invitation is stored: under its token's hash (T145). */
const TOKEN_PATH = `groups/${GROUP}/registrationTokens/${hashInvitationToken(TOKEN)}`;
const DAY = 24 * 60 * 60 * 1000;

const redeem = (data: object, uid?: string, email?: string) =>
  call(redeemInvitation, data, uid, email);

/** Seeds a group with one admin and a token in the given state. */
async function seed(token: object = {used: false}) {
  await db.doc(`groups/${GROUP}`).set({name: "Fellowship", createdBy: "admin"});
  await db.doc(`groups/${GROUP}/users/admin`).set({userId: "admin", username: "Gandalf", role: "admin"});
  await db.doc(`groups/${GROUP}/usernames/gandalf`).set({userId: "admin", originalUsername: "Gandalf"});
  await db.doc(TOKEN_PATH).set({scheme: HASHED_SCHEME, ...token});
}

const tokenDoc = () => db.doc(TOKEN_PATH).get();

beforeEach(() => clearProject(PROJECT));

describe("redeemInvitation", () => {
  describe("refuses", () => {
    it("an anonymous caller", async () => {
      await seed();
      await expectHttpsError(redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}), "unauthenticated");
    });

    it("a request with no token", async () => {
      await seed();
      await expectHttpsError(redeem({groupId: GROUP, username: "Frodo"}, "u1"), "invalid-argument");
    });

    it.each([["too short", "Fr"], ["too long", "F".repeat(21)], ["blank once trimmed", "     "]])(
      "a username that is %s",
      async (_label, username) => {
        await seed();
        await expectHttpsError(redeem({groupId: GROUP, token: TOKEN, username}, "u1"), "invalid-argument");
      }
    );

    it("a token that does not exist, and grants nothing", async () => {
      await seed();
      await expectHttpsError(redeem({groupId: GROUP, token: "forged", username: "Frodo"}, "u1"), "not-found");
      expect((await db.doc("users/u1").get()).exists).toBe(false);
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).exists).toBe(false);
    });

    it("an invitation's id presented as its token: whoever reads the collection holds no link (T145)", async () => {
      await seed();
      await expectHttpsError(
        redeem({groupId: GROUP, token: hashInvitationToken(TOKEN), username: "Frodo"}, "u1"),
        "not-found"
      );
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).exists).toBe(false);
      expect((await tokenDoc()).data()?.used).toBe(false);
    });

    it("a token for a group that does not exist", async () => {
      await db.doc(TOKEN_PATH).set({scheme: HASHED_SCHEME, used: false});
      await expectHttpsError(redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1"), "not-found");
    });

    it("a token for a group being deleted, and grants nothing (T037)", async () => {
      await seed();
      await db.doc(`groups/${GROUP}`).update({deleting: true});
      const error = await expectHttpsError(
        redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1"),
        "failed-precondition"
      );
      expect(error.message).toMatch(/being deleted/);
      expect((await db.doc("users/u1").get()).exists).toBe(false);
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).exists).toBe(false);
      expect((await tokenDoc()).data()?.used).toBe(false);
    });

    it("a used token, and grants nothing", async () => {
      await seed({used: true, usedBy: "someone-else"});
      const error = await expectHttpsError(
        redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1"),
        "failed-precondition"
      );
      expect(error.message).toMatch(/already been used/);
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).exists).toBe(false);
      expect((await tokenDoc()).data()?.usedBy).toBe("someone-else");
    });

    it("an expired token, and grants nothing", async () => {
      await seed({used: false, expiresAt: new Date(Date.now() - DAY)});
      const error = await expectHttpsError(
        redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1"),
        "failed-precondition"
      );
      expect(error.message).toMatch(/expired/);
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).exists).toBe(false);
      expect((await tokenDoc()).data()?.used).toBe(false);
    });

    // A member is someone with a group profile there, the one record of
    // membership (T136).
    it("an existing member, without spending the token", async () => {
      await seed();
      await db.doc("users/u1").set({id: "u1", groups: [GROUP]});
      await db.doc(`groups/${GROUP}/users/u1`).set({userId: "u1", username: "Frodo", role: "member"});
      await expectHttpsError(redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1"), "already-exists");
      expect((await tokenDoc()).data()?.used).toBe(false);
    });

    it("an existing member the array does not list, without spending the token", async () => {
      await seed();
      await db.doc("users/u1").set({id: "u1", groups: []});
      await db.doc(`groups/${GROUP}/users/u1`).set({userId: "u1", username: "Frodo", role: "member"});
      await expectHttpsError(redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1"), "already-exists");
      expect((await tokenDoc()).data()?.used).toBe(false);
    });

    it("a name someone else holds, case-insensitively, without spending the token", async () => {
      await seed();
      const error = await expectHttpsError(
        redeem({groupId: GROUP, token: TOKEN, username: "GANDALF"}, "u1"),
        "already-exists"
      );
      expect(error.message).toMatch(/Username is already taken/);
      expect((await tokenDoc()).data()?.used).toBe(false);
    });

    it("a second redemption of the same token by someone else", async () => {
      await seed();
      await redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1");
      await expectHttpsError(redeem({groupId: GROUP, token: TOKEN, username: "Sam"}, "u2"), "failed-precondition");
      expect((await db.doc(`groups/${GROUP}/users/u2`).get()).exists).toBe(false);
    });
  });

  // T128: a group holds at most ten members.
  describe("a group's member limit", () => {
    /** Members beside the seeded admin, until the group holds `total`. */
    async function fillTo(total: number) {
      for (let i = 1; i < total; i++) {
        await db.doc(`groups/${GROUP}/users/m${i}`).set({userId: `m${i}`, username: `Member${i}`, role: "member"});
      }
    }

    it("refuses a joiner once the group is full, and grants nothing", async () => {
      await seed();
      await fillTo(MAX_GROUP_MEMBERS);
      const error = await expectHttpsError(
        redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1"),
        "resource-exhausted"
      );
      expect(error.message).toMatch(/group is full/);
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).exists).toBe(false);
      expect((await tokenDoc()).data()?.used).toBe(false);
    });

    it("admits the joiner who takes the last place", async () => {
      await seed();
      await fillTo(MAX_GROUP_MEMBERS - 1);
      await redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1");
      expect((await db.collection(`groups/${GROUP}/users`).count().get()).data().count).toBe(MAX_GROUP_MEMBERS);
    });

    it("lets only one of two joiners racing for the last place in", async () => {
      await seed();
      await fillTo(MAX_GROUP_MEMBERS - 1);
      await db.doc(`groups/${GROUP}/registrationTokens/${hashInvitationToken("tok-2")}`).set({scheme: HASHED_SCHEME, used: false});

      const results = await Promise.allSettled([
        redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1"),
        redeem({groupId: GROUP, token: "tok-2", username: "Samwise"}, "u2"),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((await db.collection(`groups/${GROUP}/users`).count().get()).data().count).toBe(MAX_GROUP_MEMBERS);
    });
  });

  describe("for a brand-new account", () => {
    it("creates the global profile, the member profile and the reservation, and spends the token", async () => {
      await seed({used: false, expiresAt: new Date(Date.now() + DAY)});

      const result = await redeem({groupId: GROUP, token: TOKEN, username: "  Frodo  "}, "u1", "frodo@shire.test");

      expect(result).toEqual({success: true, groupId: GROUP});

      const user = (await db.doc("users/u1").get()).data();
      expect(user).toMatchObject({id: "u1", email: "frodo@shire.test", activeGroupId: GROUP});
      expect(user?.isAdmin).toBeUndefined();
      // T136: membership is the group profile below; the global profile lists no groups.
      expect(user).not.toHaveProperty("groups");

      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).data()).toMatchObject({
        userId: "u1",
        username: "Frodo",
        role: "member",
        preferences: {theme: "light"},
      });
      expect((await db.doc(`groups/${GROUP}/usernames/frodo`).get()).data()).toMatchObject({
        userId: "u1",
        originalUsername: "Frodo",
      });
      expect((await tokenDoc()).data()).toMatchObject({used: true, usedBy: "u1"});
    });

    it("accepts an invitation made before T145, stored under its token, and spends it", async () => {
      await seed();
      const legacy = db.doc(`groups/${GROUP}/registrationTokens/old-token`);
      await legacy.set({token: "old-token", used: false, expiresAt: new Date(Date.now() + DAY)});

      await redeem({groupId: GROUP, token: "old-token", username: "Frodo"}, "u1");

      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).exists).toBe(true);
      expect((await legacy.get()).data()).toMatchObject({used: true, usedBy: "u1"});
    });

    it("accepts a token minted before expiry existed", async () => {
      await seed({used: false});
      await redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1");
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).exists).toBe(true);
    });
  });

  describe("for an existing account", () => {
    // T136: an array left on the global profile from before is not touched.
    it("makes the group active, and leaves an old array as it was", async () => {
      await seed();
      await db.doc("users/u1").set({id: "u1", email: "frodo@shire.test", groups: ["other"], activeGroupId: "other"});

      await redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1");

      expect((await db.doc("users/u1").get()).data()).toEqual({
        id: "u1",
        email: "frodo@shire.test",
        groups: ["other"],
        activeGroupId: GROUP,
      });
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).data()).toMatchObject({
        role: "member",
        preferences: {theme: "default"},
      });
    });

    // The array listing a group is not membership (T136): someone it lists
    // with no profile there joins, and gains the profile they lacked.
    it("admits someone the array lists without a profile, and gives them one", async () => {
      await seed();
      await db.doc("users/u1").set({id: "u1", groups: [GROUP], activeGroupId: GROUP});

      await redeem({groupId: GROUP, token: TOKEN, username: "Frodo"}, "u1");

      expect((await db.doc("users/u1").get()).get("groups")).toEqual([GROUP]);
      expect((await db.doc(`groups/${GROUP}/users/u1`).get()).data()).toMatchObject({userId: "u1", role: "member"});
      expect((await tokenDoc()).data()?.used).toBe(true);
    });
  });
});
