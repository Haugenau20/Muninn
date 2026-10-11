// functions/test/operator/founderLinks.test.ts
//
// T137: the operator page issues, lists and revokes founder links. Issuing has
// a budget shared with the script; a revoked link is refused everywhere a
// link is accepted; and outside the response that issues it, a link is named
// by its first six characters only.
import {AuthBlockingEvent, HttpsError} from "firebase-functions/v2/identity";
import {call, clearProject, expectHttpsError, useEmulatorProject} from "../emulator";
import {createGroup} from "../../src/groupManagement/createGroup";
import {admitAccount} from "../../src/signUp/gateAccountCreation";
import {reserveSignUp} from "../../src/signUp/reserveSignUp";
import {
  FOUNDER_INVITATIONS,
  FOUNDER_LINK_DAILY_BUDGET,
  issueFounderInvitation,
} from "../../src/signUp/founderInvitations";
import {
  FOUNDER_LINK_NOTE_MAX,
  FOUNDER_LINK_PAGE_SIZE,
  issueFounderLink,
  listFounderLinks,
  refOf,
  revokeFounderLink,
} from "../../src/operator/founderLinks";
import {Refusal} from "../../src/shared/refusal";
import {hashInvitationToken} from "../../src/shared/invitationToken";

const PROJECT = "demo-operator-founder-links";
const db = useEmulatorProject(PROJECT);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OPERATOR = "operator@muninn.quest";

/** An issued link's invitation, stored under its token's hash (T145). */
const invitation = (token: string) => db.collection(FOUNDER_INVITATIONS).doc(hashInvitationToken(token));
/** An invitation by its document id, for links stored here directly. */
const byId = (id: string) => db.collection(FOUNDER_INVITATIONS).doc(id);

/** Asserts `promise` is refused for `reason`, and returns the refusal. */
async function expectRefusal(promise: Promise<unknown>, reason: string): Promise<Refusal> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Refusal);
  expect((caught as Refusal).reason).toBe(reason);
  return caught as Refusal;
}

/** Issue `count` links at `now`, the way the operator does. */
async function issueMany(count: number, now = new Date()) {
  const issued = [];
  for (let i = 0; i < count; i++) {
    issued.push(await issueFounderLink(db, {issuedBy: OPERATOR, now}));
  }
  return issued;
}

beforeEach(() => clearProject(PROJECT));

describe("issuing a founder link", () => {
  it("records who issued it and the trimmed note, and names it by its id's first six characters", async () => {
    const {token, ref, expiresAt} = await issueFounderLink(db, {issuedBy: OPERATOR, note: "  Bree table "});

    // The id is the token's hash, so the ref says nothing about the token.
    expect(ref).toBe(hashInvitationToken(token).slice(0, 6));
    const stored = (await invitation(token).get()).data();
    expect(stored?.issuedBy).toBe(OPERATOR);
    expect(stored?.note).toBe("Bree table");
    expect(stored?.used).toBe(false);
    expect(stored?.expiresAt.toDate().getTime()).toBe(expiresAt.getTime());
  });

  it("stores no note when given only spaces", async () => {
    const {token} = await issueFounderLink(db, {issuedBy: OPERATOR, note: "   "});
    expect((await invitation(token).get()).data()).not.toHaveProperty("note");
  });

  it("refuses a note that is too long, and issues nothing", async () => {
    await expectRefusal(
      issueFounderLink(db, {issuedBy: OPERATOR, note: "x".repeat(FOUNDER_LINK_NOTE_MAX + 1)}),
      "invalid_input"
    );
    expect((await db.collection(FOUNDER_INVITATIONS).get()).empty).toBe(true);
  });

  it("records the script as the issuer when the script issues one", async () => {
    const {token} = await issueFounderInvitation(db, {issuedBy: "script"});
    expect((await invitation(token).get()).data()?.issuedBy).toBe("script");
  });
});

describe("the daily budget", () => {
  it("is ten links in any 24 hours, and the eleventh is refused", async () => {
    expect(FOUNDER_LINK_DAILY_BUDGET).toBe(10);
    await issueMany(10);

    const refusal = await expectRefusal(issueFounderLink(db, {issuedBy: OPERATOR}), "budget_spent");
    expect(refusal.message).toMatch(/24 hours/);
    expect((await db.collection(FOUNDER_INVITATIONS).get()).size).toBe(10);
  });

  it("is shared with the script", async () => {
    await issueMany(9);
    await issueFounderInvitation(db, {issuedBy: "script"});

    await expectRefusal(issueFounderInvitation(db, {issuedBy: "script"}), "budget_spent");
    await expectRefusal(issueFounderLink(db, {issuedBy: OPERATOR}), "budget_spent");
  });

  it("frees up as links pass 24 hours old", async () => {
    await issueMany(10, new Date(Date.now() - DAY - HOUR));

    await issueFounderLink(db, {issuedBy: OPERATOR});
  });

  it("counts a revoked link: revoking does not buy another", async () => {
    const issued = await issueMany(10);
    await revokeFounderLink(db, {ref: issued[0].ref, revokedBy: OPERATOR});

    await expectRefusal(issueFounderLink(db, {issuedBy: OPERATOR}), "budget_spent");
  });

  it("holds when several issues race for the last slots", async () => {
    await issueMany(8);

    const outcomes = await Promise.allSettled(
      Array.from({length: 5}, () => issueFounderLink(db, {issuedBy: OPERATOR}))
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(2);
    for (const o of outcomes.filter((o) => o.status === "rejected")) {
      expect((o as PromiseRejectedResult).reason.reason).toBe("budget_spent");
    }
    expect((await db.collection(FOUNDER_INVITATIONS).get()).size).toBe(10);
  });
});

describe("listing founder links", () => {
  /** A link stored directly, so a test can hold more than the budget. */
  async function stored(id: string, createdAt: Date, extra: object = {}) {
    await byId(id).set({
      used: false,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 14 * DAY),
      issuedBy: OPERATOR,
      ...extra,
    });
  }

  it("shows each link's status, newest first", async () => {
    const now = new Date();
    await stored("openAAAAAAAAAA", new Date(now.getTime() - 1 * HOUR), {note: "Bree"});
    await stored("usedAAAAAAAAAA", new Date(now.getTime() - 2 * HOUR), {used: true, usedAt: now});
    await stored("goneAAAAAAAAAA", new Date(now.getTime() - 20 * DAY));
    await stored("revkAAAAAAAAAA", new Date(now.getTime() - 3 * HOUR), {revokedAt: now, revokedBy: OPERATOR});

    const {rows, next} = await listFounderLinks(db, {now});

    expect(rows.map((row) => [row.ref, row.status])).toEqual([
      ["openAA", "open"],
      ["usedAA", "used"],
      ["revkAA", "revoked"],
      ["goneAA", "expired"],
    ]);
    expect(rows[0].note).toBe("Bree");
    expect(rows[0].issuedBy).toBe(OPERATOR);
    expect(rows[1].usedAt?.getTime()).toBe(now.getTime());
    expect(rows[2].revokedBy).toBe(OPERATOR);
    expect(next).toBeNull();
  });

  it("never carries a token", async () => {
    const {token} = await issueFounderLink(db, {issuedBy: OPERATOR, note: "Bree"});

    const page = await listFounderLinks(db);

    expect(JSON.stringify(page)).not.toContain(token);
    expect(JSON.stringify(page)).not.toContain(token.slice(0, 7));
  });

  it("pages back through every link once, in order", async () => {
    const start = Date.now() - 10 * DAY;
    const total = FOUNDER_LINK_PAGE_SIZE + 7;
    const tokens = Array.from({length: total}, (_, i) => `t${String(i).padStart(3, "0")}xxxxxxxxxx`);
    // Two pairs share a millisecond. Newest first, link 7 is the last row of
    // the first page and link 6 the first of the second.
    const times = tokens.map((_, i) => start + i * 1000);
    times[7] = times[6];
    times[31] = times[30];
    await Promise.all(tokens.map((token, i) => stored(token, new Date(times[i]))));

    const first = await listFounderLinks(db);
    expect(first.rows).toHaveLength(FOUNDER_LINK_PAGE_SIZE);
    expect(first.next).not.toBeNull();
    const second = await listFounderLinks(db, {before: first.next ?? undefined});
    expect(second.next).toBeNull();

    const refs = [...first.rows, ...second.rows].map((row) => row.ref);
    expect(new Set(refs).size).toBe(total);
    expect(refs).toEqual(
      tokens
        .map((token, i) => ({ref: refOf(token), at: times[i]}))
        .sort((a, b) => b.at - a.at || (a.ref < b.ref ? 1 : -1))
        .map((link) => link.ref)
    );
  });

  it("refuses a cursor it did not make", async () => {
    await expectRefusal(listFounderLinks(db, {before: "yesterday"}), "invalid_input");
    await expectRefusal(listFounderLinks(db, {before: "123.abc"}), "invalid_input");
  });
});

describe("revoking a founder link", () => {
  it("ends it now, and records who and when", async () => {
    const {token, ref} = await issueFounderLink(db, {issuedBy: OPERATOR});
    const now = new Date();

    const result = await revokeFounderLink(db, {ref, revokedBy: OPERATOR, now});

    expect(result.alreadyRevoked).toBe(false);
    const data = (await invitation(token).get()).data();
    expect(data?.expiresAt.toDate().getTime()).toBe(now.getTime());
    expect(data?.revokedAt.toDate().getTime()).toBe(now.getTime());
    expect(data?.revokedBy).toBe(OPERATOR);
    expect(data?.used).toBe(false);
  });

  it("changes nothing the second time", async () => {
    const {token, ref} = await issueFounderLink(db, {issuedBy: OPERATOR});
    await revokeFounderLink(db, {ref, revokedBy: OPERATOR, now: new Date(Date.now() - HOUR)});
    const before = (await invitation(token).get()).data();

    const result = await revokeFounderLink(db, {ref, revokedBy: "someone@else.dev"});

    expect(result.alreadyRevoked).toBe(true);
    expect((await invitation(token).get()).data()).toEqual(before);
  });

  it("leaves an expired link's expiry where it was", async () => {
    const {token, ref, expiresAt} =
      await issueFounderLink(db, {issuedBy: OPERATOR, now: new Date(Date.now() - 20 * DAY)});

    await revokeFounderLink(db, {ref, revokedBy: OPERATOR});

    expect((await invitation(token).get()).data()?.expiresAt.toDate().getTime()).toBe(expiresAt.getTime());
  });

  it("refuses a link already used to start a group", async () => {
    const {token, ref} = await issueFounderLink(db, {issuedBy: OPERATOR});
    await invitation(token).update({used: true});

    await expectRefusal(revokeFounderLink(db, {ref, revokedBy: OPERATOR}), "link_used");
    expect((await invitation(token).get()).data()).not.toHaveProperty("revokedAt");
  });

  it("refuses a link that does not exist", async () => {
    await expectRefusal(revokeFounderLink(db, {ref: "nosuch", revokedBy: OPERATOR}), "link_not_found");
  });

  it("refuses two links that start alike, rather than guess", async () => {
    await byId("sameABxxxxxxxxx1").set({used: false, createdAt: new Date()});
    await byId("sameABxxxxxxxxx2").set({used: false, createdAt: new Date()});

    await expectRefusal(revokeFounderLink(db, {ref: "sameAB", revokedBy: OPERATOR}), "link_ambiguous");
  });

  it("refuses anything that is not a link's first six characters", async () => {
    for (const ref of ["", "short", "toolong7", "a/b/cd", "ab cd!"]) {
      await expectRefusal(revokeFounderLink(db, {ref, revokedBy: OPERATOR}), "invalid_input");
    }
  });

  describe("is refused everywhere a link is accepted", () => {
    const creating = (email: string) =>
      admitAccount({
        data: {email},
        eventType: "providers/cloud.auth/eventTypes/user.beforeCreate:emailLink",
      } as unknown as AuthBlockingEvent);

    it("by sign-up", async () => {
      const {token, ref} = await issueFounderLink(db, {issuedBy: OPERATOR});
      await revokeFounderLink(db, {ref, revokedBy: OPERATOR});

      await expectHttpsError(call(reserveSignUp, {founderToken: token, email: "bilbo@shire.dev"}), "failed-precondition");
    });

    it("by the gate, for a founder who had already reserved", async () => {
      const {token, ref} = await issueFounderLink(db, {issuedBy: OPERATOR});
      await call(reserveSignUp, {founderToken: token, email: "bilbo@shire.dev"});
      await revokeFounderLink(db, {ref, revokedBy: OPERATOR});

      let caught: unknown;
      try {
        await creating("bilbo@shire.dev");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HttpsError);
      expect((caught as HttpsError).message).toContain("INVITE_REQUIRED");
    });

    it("by starting a group, for a founder who already has an account", async () => {
      const {token, ref} = await issueFounderLink(db, {issuedBy: OPERATOR});
      await revokeFounderLink(db, {ref, revokedBy: OPERATOR});

      await expectHttpsError(
        call(createGroup, {name: "Fellowship", username: "Gandalf", founderToken: token}, "gandalf", "gandalf@example.com"),
        "failed-precondition"
      );
      expect((await db.collection("groups").get()).empty).toBe(true);
    });
  });
});
