// functions/test/founderInvitations.test.ts
//
// T125: a founder invitation lets one person create an account in order to
// start a group (the onboarding plan, D1). The maintainer issues them with
// `scripts/issue-founder-invitation.js`; the sign-up gate admits them the way
// it admits an invitation into a group. Spending one is `createGroup`'s (T126).
import {getAuth} from "firebase-admin/auth";
import {AuthBlockingEvent, HttpsError} from "firebase-functions/v2/identity";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "./emulator";
import {reserveSignUp} from "../src/signUp/reserveSignUp";
import {admitAccount} from "../src/signUp/gateAccountCreation";
import {MAX_ACCOUNTS, RESERVATIONS} from "../src/signUp/signUpGate";
import {
  FOUNDER_INVITATIONS,
  FOUNDER_INVITATION_LIFETIME_MS,
  founderLink,
  founderReservationId,
  issueFounderInvitation,
} from "../src/signUp/founderInvitations";
import {hashInvitationToken} from "../src/shared/invitationToken";

const PROJECT = "demo-founder-invitations";
const db = useEmulatorProject(PROJECT);
const DAY = 24 * 60 * 60 * 1000;

const reserve = (data: object) => call(reserveSignUp, data);

/** What Auth hands the blocking function for an account about to exist. */
const creating = (email: string) =>
  admitAccount({
    data: {email},
    eventType: "providers/cloud.auth/eventTypes/user.beforeCreate:emailLink",
  } as unknown as AuthBlockingEvent);

async function expectRefused(promise: Promise<unknown>, marker: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).message).toContain(marker);
}

/** A founder link's invitation, stored under its token's hash (T145). */
const invitation = (token: string) => db.collection(FOUNDER_INVITATIONS).doc(hashInvitationToken(token));
const reservation = (token: string) =>
  db.collection(RESERVATIONS).doc(founderReservationId(hashInvitationToken(token))).get();

/** Every string value in a document, however deeply nested. */
const stringsIn = (value: unknown): string[] =>
  typeof value === "string" ? [value] :
    value && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];

beforeEach(() => clearProject(PROJECT));

describe("issueFounderInvitation", () => {
  it("records an unused invitation that lasts 14 days, under a token nobody can guess", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const {token, expiresAt} = await issueFounderInvitation(db, {issuedBy: "script", note: "Bree table", now});

    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(expiresAt.getTime()).toBe(now.getTime() + FOUNDER_INVITATION_LIFETIME_MS);
    expect(FOUNDER_INVITATION_LIFETIME_MS).toBe(14 * DAY);
    const stored = (await invitation(token).get()).data();
    expect(stored?.used).toBe(false);
    expect(stored?.note).toBe("Bree table");
    expect(stored?.expiresAt.toDate().getTime()).toBe(expiresAt.getTime());
  });

  it("stores it under the token's hash, and the token nowhere (T145)", async () => {
    const {token, invitationId} = await issueFounderInvitation(db, {issuedBy: "script"});

    expect(invitationId).toBe(hashInvitationToken(token));
    const all = await db.collection(FOUNDER_INVITATIONS).get();
    expect(all.docs.map((doc) => doc.id)).toEqual([invitationId]);
    expect(stringsIn(all.docs[0].data())).not.toContain(token);
  });

  it("issues a different token every time", async () => {
    const first = await issueFounderInvitation(db, {issuedBy: "script"});
    const second = await issueFounderInvitation(db, {issuedBy: "script"});
    expect(first.token).not.toBe(second.token);
  });

  it("builds the link a founder opens", () => {
    expect(founderLink("https://muninn.quest", "abc_123")).toBe("https://muninn.quest/join?founder=abc_123");
  });
});

describe("reserveSignUp with a founder invitation", () => {
  it("reserves the normalised email, and spends nothing", async () => {
    const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
    await reserve({founderToken: token, email: "  Bilbo@Shire.dev "});

    const reserved = await reservation(token);
    expect(reserved.data()?.email).toBe("bilbo@shire.dev");
    expect(reserved.data()?.kind).toBe("founder");
    expect((await invitation(token).get()).data()?.used).toBe(false);
    // The reservation names the invitation, never its token (T145).
    expect([reserved.id, ...stringsIn(reserved.data())].some((value) => value.includes(token))).toBe(false);
  });

  it("refuses a link issued before T145, stored under its token", async () => {
    const legacy = "legacy-founder-token-0123456789";
    await db.collection(FOUNDER_INVITATIONS).doc(legacy).set({used: false, createdAt: new Date(), expiresAt: new Date(Date.now() + DAY)});
    await expectHttpsError(reserve({founderToken: legacy, email: "bilbo@shire.dev"}), "not-found");
    expect((await db.collection(RESERVATIONS).get()).size).toBe(0);
  });

  it("holds one email per invitation: reserving again replaces it", async () => {
    const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
    await reserve({founderToken: token, email: "bilbo@shire.dev"});
    await reserve({founderToken: token, email: "frodo@shire.dev"});

    const all = await db.collection(RESERVATIONS).get();
    expect(all.docs.map((doc) => doc.data().email)).toEqual(["frodo@shire.dev"]);
  });

  describe("refuses", () => {
    it("an invitation's id presented as its token", async () => {
      const {invitationId} = await issueFounderInvitation(db, {issuedBy: "script"});
      await expectHttpsError(reserve({founderToken: invitationId, email: "bilbo@shire.dev"}), "not-found");
      expect((await db.collection(RESERVATIONS).get()).empty).toBe(true);
    });

    it("a founder token that does not exist", async () => {
      await expectHttpsError(reserve({founderToken: "forged", email: "bilbo@shire.dev"}), "not-found");
      expect((await db.collection(RESERVATIONS).get()).empty).toBe(true);
    });

    it("a used founder invitation", async () => {
      const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
      await invitation(token).update({used: true});
      await expectHttpsError(reserve({founderToken: token, email: "bilbo@shire.dev"}), "failed-precondition");
      expect((await reservation(token)).exists).toBe(false);
    });

    it("an expired founder invitation", async () => {
      const {token} = await issueFounderInvitation(db, {issuedBy: "script", now: new Date(Date.now() - 15 * DAY)});
      await expectHttpsError(reserve({founderToken: token, email: "bilbo@shire.dev"}), "failed-precondition");
      expect((await reservation(token)).exists).toBe(false);
    });

    it("a request carrying both kinds of invitation", async () => {
      const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
      await expectHttpsError(
        reserve({founderToken: token, groupId: "g1", token: "t1", email: "bilbo@shire.dev"}),
        "invalid-argument"
      );
    });

    it("a founder token passed off as an invitation into a group", async () => {
      const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
      await db.doc("groups/g1").set({name: "Fellowship"});
      await expectHttpsError(reserve({groupId: "g1", token, email: "bilbo@shire.dev"}), "not-found");
    });

    it("anyone once the project is at the account limit", async () => {
      const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
      for (let i = 0; i < MAX_ACCOUNTS; i++) {
        await getAuth().createUser({email: `existing${i}@test.dev`});
      }
      const error = await expectHttpsError(
        reserve({founderToken: token, email: "bilbo@shire.dev"}),
        "resource-exhausted"
      );
      expect(error.message).toContain("ACCOUNTS_FULL");
    });
  });
});

describe("admitAccount with a founder reservation", () => {
  it("admits the reserved email, and consumes the reservation", async () => {
    const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
    await reserve({founderToken: token, email: "bilbo@shire.dev"});

    await creating("Bilbo@Shire.dev");

    expect((await reservation(token)).exists).toBe(false);
    await expectRefused(creating("bilbo@shire.dev"), "INVITE_REQUIRED");
  });

  it("refuses once the founder invitation was used since", async () => {
    const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
    await reserve({founderToken: token, email: "bilbo@shire.dev"});
    await invitation(token).update({used: true});

    await expectRefused(creating("bilbo@shire.dev"), "INVITE_REQUIRED");
    expect((await reservation(token)).exists).toBe(false);
  });

  it("refuses once the founder invitation was deleted since", async () => {
    const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
    await reserve({founderToken: token, email: "bilbo@shire.dev"});
    await invitation(token).delete();

    await expectRefused(creating("bilbo@shire.dev"), "INVITE_REQUIRED");
  });
});
