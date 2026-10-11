// functions/test/invitations.test.ts
//
// T145: an invitation into a group is made by `createInvitation`, stored under
// its token's hash with the token sealed beside it, and shown again to the
// group's admins by `revealInvitation`. Whoever can read the collection
// holds no working link.
import {randomBytes} from "crypto";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {
  GROUP_INVITATION_DAILY_BUDGET,
  GROUP_INVITATION_LIFETIME_MS,
  INVITATION_NOTE_MAX,
  createInvitation,
  revealInvitation,
} from "../src/groupManagement/invitations";
import {redeemInvitation} from "../src/groupManagement/redeemInvitation";
import {HASHED_SCHEME, hashInvitationToken} from "../src/shared/invitationToken";
import {INVITATION_LINK_KEY} from "../src/shared/invitationSeal";

const PROJECT = "demo-invitations";
const db = useEmulatorProject(PROJECT);

const GROUP = "g1";
const DAY = 24 * 60 * 60 * 1000;
const invitations = () => db.collection(`groups/${GROUP}/registrationTokens`);

interface Created {
  token: string;
  invitationId: string;
  expiresAt: number;
}

const create = (data: object, uid?: string) => call(createInvitation, data, uid) as Promise<Created>;
const reveal = (data: object, uid?: string) => call(revealInvitation, data, uid) as Promise<{token: string}>;

/** Every string value in a document, however deeply nested. */
const stringsIn = (value: unknown): string[] =>
  typeof value === "string" ? [value] :
    value && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];

/** A group with an admin, Gandalf, and a member, Frodo. */
async function seedGroup(group: object = {}) {
  await db.doc(`groups/${GROUP}`).set({name: "Fellowship", createdBy: "gandalf", ...group});
  await db.doc(`groups/${GROUP}/users/gandalf`).set({userId: "gandalf", username: "Gandalf", role: "admin"});
  await db.doc(`groups/${GROUP}/users/frodo`).set({userId: "frodo", username: "Frodo", role: "member"});
}

// Outside the Functions emulator, as in production: the key comes from the
// secret. Each test gets a fresh one.
const savedEmulator = process.env.FUNCTIONS_EMULATOR;
beforeEach(async () => {
  delete process.env.FUNCTIONS_EMULATOR;
  process.env[INVITATION_LINK_KEY] = randomBytes(32).toString("base64");
  await clearProject(PROJECT);
});
afterAll(() => {
  if (savedEmulator === undefined) delete process.env.FUNCTIONS_EMULATOR;
  else process.env.FUNCTIONS_EMULATOR = savedEmulator;
  delete process.env[INVITATION_LINK_KEY];
});

describe("createInvitation", () => {
  it("stores the invitation under its token's hash, and the token nowhere readable", async () => {
    await seedGroup();
    const before = Date.now();
    const created = await create({groupId: GROUP, notes: "  for Sam  "}, "gandalf");

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.invitationId).toBe(hashInvitationToken(created.token));
    const all = await invitations().get();
    expect(all.docs.map((doc) => doc.id)).toEqual([created.invitationId]);
    const stored = all.docs[0].data();
    expect(stored).toMatchObject({scheme: HASHED_SCHEME, used: false, createdBy: "gandalf", notes: "for Sam"});
    expect(stored.expiresAt.toDate().getTime()).toBe(created.expiresAt);
    expect(created.expiresAt - before).toBeGreaterThanOrEqual(GROUP_INVITATION_LIFETIME_MS);
    expect(stringsIn(stored).some((value) => value.includes(created.token))).toBe(false);
  });

  it("makes a token that admits its holder to the group", async () => {
    await seedGroup();
    const {token} = await create({groupId: GROUP}, "gandalf");

    await call(redeemInvitation, {groupId: GROUP, token, username: "Samwise"}, "sam");

    expect((await db.doc(`groups/${GROUP}/users/sam`).get()).data()?.role).toBe("member");
  });

  describe("refuses", () => {
    it("an anonymous caller", async () => {
      await seedGroup();
      await expectHttpsError(create({groupId: GROUP}), "unauthenticated");
    });

    it("a member who is not an admin, making nothing", async () => {
      await seedGroup();
      await expectHttpsError(create({groupId: GROUP}, "frodo"), "permission-denied");
      expect((await invitations().get()).empty).toBe(true);
    });

    it("someone outside the group", async () => {
      await seedGroup();
      await expectHttpsError(create({groupId: GROUP}, "saruman"), "permission-denied");
    });

    it("a group that does not exist", async () => {
      await expectHttpsError(create({groupId: "nowhere"}, "gandalf"), "permission-denied");
    });

    it("a group being deleted (T037)", async () => {
      await seedGroup({deleting: true});
      await expectHttpsError(create({groupId: GROUP}, "gandalf"), "failed-precondition");
      expect((await invitations().get()).empty).toBe(true);
    });

    it.each([
      ["no group", {}],
      ["a group path", {groupId: `${GROUP}/users/gandalf`}],
      ["a note that is too long", {groupId: GROUP, notes: "x".repeat(INVITATION_NOTE_MAX + 1)}],
    ])("a request with %s", async (_label, data) => {
      await seedGroup();
      await expectHttpsError(create(data, "gandalf"), "invalid-argument");
    });

    it("more than the day's budget, counting only the last 24 hours", async () => {
      await seedGroup();
      const old = new Date(Date.now() - DAY - 60_000);
      await invitations().doc("old").set({scheme: HASHED_SCHEME, used: false, createdAt: old});
      for (let i = 1; i < GROUP_INVITATION_DAILY_BUDGET; i++) {
        await invitations().doc(`recent-${i}`).set({scheme: HASHED_SCHEME, used: false, createdAt: new Date()});
      }

      await create({groupId: GROUP}, "gandalf");
      await expectHttpsError(create({groupId: GROUP}, "gandalf"), "resource-exhausted");
      expect((await invitations().get()).size).toBe(GROUP_INVITATION_DAILY_BUDGET + 1);
    });

    it("anything, writing nothing, when the key is missing", async () => {
      await seedGroup();
      delete process.env[INVITATION_LINK_KEY];
      await expectHttpsError(create({groupId: GROUP}, "gandalf"), "internal");
      expect((await invitations().get()).empty).toBe(true);
    });
  });

  it("seals with a fixed key inside the Functions emulator, needing no secret", async () => {
    await seedGroup();
    process.env.FUNCTIONS_EMULATOR = "true";
    delete process.env[INVITATION_LINK_KEY];
    const {token, invitationId} = await create({groupId: GROUP}, "gandalf");
    expect((await reveal({groupId: GROUP, invitationId}, "gandalf")).token).toBe(token);
  });
});

describe("revealInvitation", () => {
  it("shows an admin the token of an open invitation again", async () => {
    await seedGroup();
    const {token, invitationId} = await create({groupId: GROUP}, "gandalf");
    expect(await reveal({groupId: GROUP, invitationId}, "gandalf")).toEqual({token});
  });

  it("shows an invitation made before T145 by its id, which is its token", async () => {
    await seedGroup();
    await invitations().doc("old-token").set({token: "old-token", used: false});
    expect(await reveal({groupId: GROUP, invitationId: "old-token"}, "gandalf")).toEqual({token: "old-token"});
  });

  describe("refuses", () => {
    it("an anonymous caller", async () => {
      await seedGroup();
      const {invitationId} = await create({groupId: GROUP}, "gandalf");
      await expectHttpsError(reveal({groupId: GROUP, invitationId}), "unauthenticated");
    });

    it("a member who is not an admin", async () => {
      await seedGroup();
      const {invitationId} = await create({groupId: GROUP}, "gandalf");
      await expectHttpsError(reveal({groupId: GROUP, invitationId}, "frodo"), "permission-denied");
    });

    it("an admin of another group", async () => {
      await seedGroup();
      const {invitationId} = await create({groupId: GROUP}, "gandalf");
      await db.doc("groups/g2").set({name: "Isengard"});
      await db.doc("groups/g2/users/saruman").set({userId: "saruman", role: "admin"});
      await expectHttpsError(reveal({groupId: GROUP, invitationId}, "saruman"), "permission-denied");
      await expectHttpsError(reveal({groupId: "g2", invitationId}, "saruman"), "not-found");
    });

    it("an invitation that does not exist", async () => {
      await seedGroup();
      await expectHttpsError(reveal({groupId: GROUP, invitationId: "nosuch"}, "gandalf"), "not-found");
    });

    it("a used invitation", async () => {
      await seedGroup();
      const {invitationId} = await create({groupId: GROUP}, "gandalf");
      await invitations().doc(invitationId).update({used: true});
      await expectHttpsError(reveal({groupId: GROUP, invitationId}, "gandalf"), "failed-precondition");
    });

    it("an expired invitation", async () => {
      await seedGroup();
      const {invitationId} = await create({groupId: GROUP}, "gandalf");
      await invitations().doc(invitationId).update({expiresAt: new Date(Date.now() - 1000)});
      await expectHttpsError(reveal({groupId: GROUP, invitationId}, "gandalf"), "failed-precondition");
    });

    it("an invitation stored without its sealed token", async () => {
      await seedGroup();
      await invitations().doc("a".repeat(64)).set({scheme: HASHED_SCHEME, used: false});
      await expectHttpsError(reveal({groupId: GROUP, invitationId: "a".repeat(64)}, "gandalf"), "failed-precondition");
    });

    it("a sealed token copied onto another invitation", async () => {
      await seedGroup();
      const {invitationId} = await create({groupId: GROUP}, "gandalf");
      const sealed = (await invitations().doc(invitationId).get()).get("sealed");
      await invitations().doc("b".repeat(64)).set({scheme: HASHED_SCHEME, used: false, sealed});
      await expectHttpsError(reveal({groupId: GROUP, invitationId: "b".repeat(64)}, "gandalf"), "internal");
    });

    it("a sealed token once the key has changed", async () => {
      await seedGroup();
      const {invitationId} = await create({groupId: GROUP}, "gandalf");
      process.env[INVITATION_LINK_KEY] = randomBytes(32).toString("base64");
      await expectHttpsError(reveal({groupId: GROUP, invitationId}, "gandalf"), "internal");
    });
  });
});
