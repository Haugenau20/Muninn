// functions/test/signUpGate.test.ts
import {getAuth} from "firebase-admin/auth";
import {AuthBlockingEvent, HttpsError} from "firebase-functions/v2/identity";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {reserveSignUp} from "../src/signUp/reserveSignUp";
import {admitAccount} from "../src/signUp/gateAccountCreation";
import {MAX_ACCOUNTS, RESERVATIONS, reservationId} from "../src/signUp/signUpGate";
import {ACCOUNT_COUNT} from "../src/signUp/accountCount";
import {MAX_GROUP_MEMBERS} from "../src/groupManagement/groupLimits";
import {HASHED_SCHEME, hashInvitationToken} from "../src/shared/invitationToken";

const PROJECT = "demo-sign-up-gate";
const db = useEmulatorProject(PROJECT);

const GROUP = "g1";
const TOKEN = "tok-live";
/** The invitation's id: its token's hash (T145). */
const TOKEN_ID = hashInvitationToken(TOKEN);
const TOKEN_PATH = `groups/${GROUP}/registrationTokens/${TOKEN_ID}`;
const DAY = 24 * 60 * 60 * 1000;

/** Every string value in a document, however deeply nested. */
const stringsIn = (value: unknown): string[] =>
  typeof value === "string" ? [value] :
    value && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];

const reserve = (data: object) => call(reserveSignUp, data);

/** What Auth hands the blocking function for an account about to exist. */
const creating = (email?: string, signInMethod = "emailLink") =>
  admitAccount({
    data: email ? {email} : {},
    eventType: `providers/cloud.auth/eventTypes/user.beforeCreate:${signInMethod}`,
  } as unknown as AuthBlockingEvent);

/** Asserts the gate refuses, with the given code and client-facing marker. */
async function expectRefused(promise: Promise<unknown>, code: string, marker: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe(code);
  expect((caught as HttpsError).message).toContain(marker);
}

async function seedToken(token: object = {used: false}) {
  await db.doc(`groups/${GROUP}`).set({name: "Fellowship"});
  await db.doc(TOKEN_PATH).set({scheme: HASHED_SCHEME, ...token});
}

async function fillAccounts(count: number) {
  for (let i = 0; i < count; i++) {
    await getAuth().createUser({email: `existing${i}@test.dev`});
  }
}

const reservationDoc = () => db.collection(RESERVATIONS).doc(reservationId(GROUP, TOKEN_ID)).get();

beforeEach(() => clearProject(PROJECT));

describe("reserveSignUp", () => {
  it("reserves the normalised email against a live invitation", async () => {
    await seedToken();
    await reserve({groupId: GROUP, token: TOKEN, email: "  Frodo@Shire.dev "});
    const reservation = await reservationDoc();
    expect(reservation.data()?.email).toBe("frodo@shire.dev");
    expect(reservation.data()?.expiresAt.toDate().getTime()).toBeGreaterThan(Date.now());
  });

  it("spends nothing -- the invitation stays unused", async () => {
    await seedToken();
    await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
    expect((await db.doc(TOKEN_PATH).get()).data()?.used).toBe(false);
  });

  it("names the invitation by its id, and keeps its token nowhere (T145)", async () => {
    await seedToken();
    await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
    const [reservation] = (await db.collection(RESERVATIONS).get()).docs;
    expect(reservation.data().invitationId).toBe(TOKEN_ID);
    expect([reservation.id, ...stringsIn(reservation.data())].some((value) => value.includes(TOKEN))).toBe(false);
  });

  it("refuses an invitation made before T145, stored under its token", async () => {
    await db.doc(`groups/${GROUP}`).set({name: "Fellowship"});
    await db.doc(`groups/${GROUP}/registrationTokens/${TOKEN}`).set({token: TOKEN, used: false});
    await expectHttpsError(reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"}), "not-found");
    expect((await db.collection(RESERVATIONS).get()).size).toBe(0);
  });

  it("holds one email per invitation: reserving again replaces it", async () => {
    await seedToken();
    await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
    await reserve({groupId: GROUP, token: TOKEN, email: "sam@shire.dev"});
    const all = await db.collection(RESERVATIONS).get();
    expect(all.docs.map((doc) => doc.data().email)).toEqual(["sam@shire.dev"]);
  });

  describe("refuses", () => {
    it.each([
      ["no token", {groupId: GROUP, email: "frodo@shire.dev"}],
      ["no group", {token: TOKEN, email: "frodo@shire.dev"}],
      ["no email", {groupId: GROUP, token: TOKEN}],
      ["a malformed email", {groupId: GROUP, token: TOKEN, email: "frodo"}],
    ])("a request with %s", async (_label, data) => {
      await seedToken();
      await expectHttpsError(reserve(data), "invalid-argument");
      expect((await db.collection(RESERVATIONS).get()).empty).toBe(true);
    });

    it("a token that does not exist", async () => {
      await seedToken();
      await expectHttpsError(reserve({groupId: GROUP, token: "forged", email: "frodo@shire.dev"}), "not-found");
      expect((await db.collection(RESERVATIONS).get()).empty).toBe(true);
    });

    it("an invitation's id presented as its token: whoever reads the collection holds no link (T145)", async () => {
      await seedToken();
      await expectHttpsError(reserve({groupId: GROUP, token: TOKEN_ID, email: "frodo@shire.dev"}), "not-found");
      expect((await db.collection(RESERVATIONS).get()).empty).toBe(true);
    });

    it("a used token", async () => {
      await seedToken({used: true});
      await expectHttpsError(reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"}), "failed-precondition");
      expect((await reservationDoc()).exists).toBe(false);
    });

    it("an expired token", async () => {
      await seedToken({used: false, expiresAt: new Date(Date.now() - DAY)});
      await expectHttpsError(reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"}), "failed-precondition");
      expect((await reservationDoc()).exists).toBe(false);
    });

    it("a token for a group being deleted (T037)", async () => {
      await seedToken();
      await db.doc(`groups/${GROUP}`).update({deleting: true});
      const error = await expectHttpsError(
        reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"}),
        "failed-precondition"
      );
      expect(error.message).toMatch(/being deleted/);
      expect((await reservationDoc()).exists).toBe(false);
    });

    // T128: said before the visitor signs up, as for a full project.
    it("an invitation into a group that is already full", async () => {
      await seedToken();
      for (let i = 0; i < MAX_GROUP_MEMBERS; i++) {
        await db.doc(`groups/${GROUP}/users/m${i}`).set({userId: `m${i}`, role: "member"});
      }
      const error = await expectHttpsError(
        reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"}),
        "resource-exhausted"
      );
      expect(error.message).toMatch(/group is full/);
      expect((await reservationDoc()).exists).toBe(false);
    });

    it("anyone once the account count says the project is full", async () => {
      await seedToken();
      await db.doc(ACCOUNT_COUNT).set({count: MAX_ACCOUNTS});
      const error = await expectHttpsError(
        reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"}),
        "resource-exhausted"
      );
      expect(error.message).toContain("ACCOUNTS_FULL");
    });

    it("anyone once the project is at the account limit", async () => {
      await seedToken();
      await fillAccounts(MAX_ACCOUNTS);
      const error = await expectHttpsError(
        reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"}),
        "resource-exhausted"
      );
      expect(error.message).toContain("ACCOUNTS_FULL");
      expect((await reservationDoc()).exists).toBe(false);
    });
  });
});

describe("admitAccount (beforeUserCreated)", () => {
  it("admits an email holding a live reservation, and consumes it", async () => {
    await seedToken();
    await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
    await expect(creating("Frodo@Shire.dev")).resolves.toBeUndefined();
    expect((await reservationDoc()).exists).toBe(false);
  });

  // T128: the count is kept here, so the cap holds without listing Auth.
  it("counts the account it admits", async () => {
    await seedToken();
    await db.doc(ACCOUNT_COUNT).set({count: 7});
    await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
    await creating("frodo@shire.dev");
    expect((await db.doc(ACCOUNT_COUNT).get()).data()?.count).toBe(8);
  });

  it("starts the count from the accounts there are, the first time", async () => {
    await seedToken();
    await fillAccounts(3);
    await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
    await creating("frodo@shire.dev");
    expect((await db.doc(ACCOUNT_COUNT).get()).data()?.count).toBe(4);
  });

  it("lets only one of two sign-ups racing for the last account in", async () => {
    await seedToken();
    await db.doc(`groups/${GROUP}/registrationTokens/${hashInvitationToken("tok-2")}`).set({scheme: HASHED_SCHEME, used: false});
    await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
    await reserve({groupId: GROUP, token: "tok-2", email: "sam@shire.dev"});
    await db.doc(ACCOUNT_COUNT).set({count: MAX_ACCOUNTS - 1});

    const results = await Promise.allSettled([creating("frodo@shire.dev"), creating("sam@shire.dev")]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await db.doc(ACCOUNT_COUNT).get()).data()?.count).toBe(MAX_ACCOUNTS);
  });

  it("admits one account per reservation", async () => {
    await seedToken();
    await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
    await creating("frodo@shire.dev");
    await expectRefused(creating("frodo@shire.dev"), "permission-denied", "INVITE_REQUIRED");
  });

  describe("refuses", () => {
    it("an email nobody invited", async () => {
      await expectRefused(creating("stranger@elsewhere.dev"), "permission-denied", "INVITE_REQUIRED");
    });

    it("an email other than the one reserved", async () => {
      await seedToken();
      await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
      await expectRefused(creating("sam@shire.dev"), "permission-denied", "INVITE_REQUIRED");
      expect((await reservationDoc()).exists).toBe(true);
    });

    it("an account with no email at all", async () => {
      await expectRefused(creating(undefined), "permission-denied", "INVITE_REQUIRED");
    });

    it("a reservation past its own expiry, and deletes it", async () => {
      await seedToken();
      await db.collection(RESERVATIONS).doc(reservationId(GROUP, TOKEN_ID)).set({
        email: "frodo@shire.dev", groupId: GROUP, invitationId: TOKEN_ID,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expectRefused(creating("frodo@shire.dev"), "permission-denied", "INVITE_REQUIRED");
      expect((await reservationDoc()).exists).toBe(false);
    });

    it("a reservation whose invitation was used since", async () => {
      await seedToken();
      await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
      await db.doc(TOKEN_PATH).update({used: true});
      await expectRefused(creating("frodo@shire.dev"), "permission-denied", "INVITE_REQUIRED");
    });

    it("a reservation made before T145, naming its invitation by its token, and deletes it", async () => {
      await db.doc(`groups/${GROUP}/registrationTokens/${TOKEN}`).set({token: TOKEN, used: false});
      const old = db.collection(RESERVATIONS).doc(`${GROUP}_${TOKEN}`);
      await old.set({email: "frodo@shire.dev", groupId: GROUP, token: TOKEN, expiresAt: new Date(Date.now() + DAY)});
      await expectRefused(creating("frodo@shire.dev"), "permission-denied", "INVITE_REQUIRED");
      expect((await old.get()).exists).toBe(false);
    });

    it("a reservation whose invitation carries no scheme", async () => {
      await db.doc(TOKEN_PATH).set({used: false});
      await db.collection(RESERVATIONS).doc(reservationId(GROUP, TOKEN_ID)).set({
        email: "frodo@shire.dev", groupId: GROUP, invitationId: TOKEN_ID,
        expiresAt: new Date(Date.now() + DAY),
      });
      await expectRefused(creating("frodo@shire.dev"), "permission-denied", "INVITE_REQUIRED");
      expect((await reservationDoc()).exists).toBe(false);
    });

    it("a reservation whose invitation was deleted since", async () => {
      await seedToken();
      await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
      await db.doc(TOKEN_PATH).delete();
      await expectRefused(creating("frodo@shire.dev"), "permission-denied", "INVITE_REQUIRED");
    });

    it("a reserved email once the project is at the account limit, keeping the reservation", async () => {
      await seedToken();
      await reserve({groupId: GROUP, token: TOKEN, email: "frodo@shire.dev"});
      await fillAccounts(MAX_ACCOUNTS);
      await expectRefused(creating("frodo@shire.dev"), "resource-exhausted", "ACCOUNTS_FULL");
      expect((await reservationDoc()).exists).toBe(true);
    });
  });

  describe("the emulator's sample-data exemption", () => {
    afterEach(() => {
      delete process.env.FUNCTIONS_EMULATOR;
    });

    it("admits an example.com password sign-up inside the emulator", async () => {
      process.env.FUNCTIONS_EMULATOR = "true";
      await expect(creating("dm@example.com", "password")).resolves.toBeUndefined();
    });

    it("does not exist outside it", async () => {
      await expectRefused(creating("dm@example.com", "password"), "permission-denied", "INVITE_REQUIRED");
    });

    // The generator signs up with a password; the app never does. A Google or
    // magic-link sign-up with an example.com address is a manual test of the
    // real gate and must meet it.
    it.each(["google.com", "emailLink"])("does not cover a %s sign-up, even in the emulator", async (method) => {
      process.env.FUNCTIONS_EMULATOR = "true";
      await expectRefused(creating("play57@example.com", method), "permission-denied", "INVITE_REQUIRED");
    });
  });
});
