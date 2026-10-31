// functions/test/rules/firestore-rules-prod.test.ts
//
// Pins `firestore.rules.prod` -- the review copy of the PRODUCTION ruleset --
// by loading it into the emulator under a `demo-` project and acting as real
// users against it. It lives in the functions package because this is where
// the emulator harness is; nothing here exercises a Cloud Function.
//
// The emulator's own ruleset is `allow read, write: if true`, so none of this
// can be seen by running the app. This suite gates the merge, and the merge
// deploys the file it tests (T105).
//
// `RULES_FILE=<path> npx jest test/rules` runs the same checks against another
// revision. That is how each hole below was shown to be open before
// 2026-09-23: the membership and admin tests fail against the old file.
import * as fs from "fs";
import * as path from "path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {setLogLevel} from "firebase/firestore";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import {EMULATOR_HOSTS} from "../emulator";

// Every denied write is logged as a warning with a stack; here, being denied
// is the point.
setLogLevel("error");

const RULES_FILE =
  process.env.RULES_FILE || path.resolve(__dirname, "../../../firestore.rules.prod");
const [host, port] = EMULATOR_HOSTS.Firestore.split(":");
const G = "fellowship";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules-prod",
    firestore: {rules: fs.readFileSync(RULES_FILE, "utf8"), host, port: Number(port)},
  });
});

afterAll(() => env.cleanup());

/**
 * A group with an admin (gandalf), a member (frodo), a campaign with an NPC,
 * a live invitation, and a stranger (sauron) who has an account and nothing
 * else.
 */
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("users/gandalf").set({id: "gandalf", groups: [G]});
    await db.doc("users/frodo").set({id: "frodo", groups: [G], activeGroupId: G});
    await db.doc(`groups/${G}`).set({name: "Fellowship"});
    await db.doc(`groups/${G}/users/gandalf`).set({userId: "gandalf", username: "Gandalf", role: "admin"});
    await db.doc(`groups/${G}/users/frodo`).set({userId: "frodo", username: "Frodo", role: "member"});
    await db.doc(`groups/${G}/usernames/gandalf`).set({userId: "gandalf", originalUsername: "Gandalf"});
    await db.doc(`groups/${G}/usernames/frodo`).set({userId: "frodo", originalUsername: "Frodo"});
    await db.doc(`groups/${G}/campaigns/c1`).set({name: "There and back"});
    await db.doc(`groups/${G}/campaigns/c1/npcs/n1`).set({name: "Bilbo"});
    await db.doc(`groups/${G}/registrationTokens/tok`).set({token: "tok", used: false});
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

/** The server's time of the write, as the app stamps it. */
const now = () => firebase.firestore.FieldValue.serverTimestamp();
/** A new record's or note's attribution, as the app's writes stamp it (T132). */
const created = (uid: string) => ({createdBy: uid, modifiedBy: uid, createdAt: now(), modifiedAt: now()});
/** An edit's attribution (T132). */
const modified = (uid: string) => ({modifiedBy: uid, modifiedAt: now()});

describe("joining a group (T052)", () => {
  it("control: a stranger cannot read a group's campaigns", async () => {
    await assertFails(as("sauron").doc(`groups/${G}/campaigns/c1/npcs/n1`).get());
  });

  it("a stranger cannot create a profile listing the group", async () => {
    await assertFails(as("sauron").doc("users/sauron").set({id: "sauron", groups: [G]}));
  });

  it("a member cannot add another group to their own profile", async () => {
    await assertFails(as("frodo").doc("users/frodo").update({groups: [G, "mordor"]}));
  });

  it("a stranger cannot create their own member profile in the group", async () => {
    await assertFails(
      as("sauron").doc(`groups/${G}/users/sauron`).set({userId: "sauron", username: "Sauron", role: "member"})
    );
  });

  it("a stranger cannot mark an invitation as used", async () => {
    await assertFails(
      as("sauron").doc(`groups/${G}/registrationTokens/tok`).update({used: true, usedBy: "sauron", usedAt: new Date()})
    );
  });

  it("a stranger can still look an invitation up, which the join page needs", async () => {
    await assertSucceeds(env.unauthenticatedContext().firestore().doc(`groups/${G}/registrationTokens/tok`).get());
  });

  it("a stranger cannot reserve a name in the group", async () => {
    await assertFails(
      as("sauron").doc(`groups/${G}/usernames/sauron`).set({userId: "sauron", originalUsername: "Sauron"})
    );
  });
});

describe("global admin", () => {
  it("a new account cannot create its own profile as a global admin", async () => {
    await assertFails(as("sauron").doc("users/sauron").set({id: "sauron", isAdmin: true}));
  });

  it("a member cannot make themselves a global admin", async () => {
    await assertFails(as("frodo").doc("users/frodo").update({isAdmin: true}));
  });
});

// T119 (F7): `users/{uid}.isAdmin` used to open every group to its holder
// through the client. Only the maintainer holds it, and they reach the data
// through the console and the Admin SDK anyway, so in the app it did nothing
// but make their session a key to every group. It now grants nothing: its
// holder, who is in no group here, is a stranger.
describe("the global-admin flag grants nothing (T119)", () => {
  type Db = ReturnType<typeof as>;

  beforeEach(() => env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("users/saruman").set({id: "saruman", groups: [], isAdmin: true});
    await context.firestore().doc("admin/settings").set({maintenance: false});
  }));

  it.each<[string, (db: Db) => Promise<unknown>]>([
    ["the group", (db) => db.doc(`groups/${G}`).get()],
    ["a member's group profile", (db) => db.doc(`groups/${G}/users/frodo`).get()],
    ["the name reservations", (db) => db.collection(`groups/${G}/usernames`).get()],
    ["the invitations", (db) => db.collection(`groups/${G}/registrationTokens`).get()],
    ["a campaign", (db) => db.doc(`groups/${G}/campaigns/c1`).get()],
    ["a campaign's record", (db) => db.doc(`groups/${G}/campaigns/c1/npcs/n1`).get()],
    ["the admin collection", (db) => db.doc("admin/settings").get()],
  ])("reads not %s", async (_what, read) => {
    await assertFails(read(as("saruman")));
  });

  it.each<[string, (db: Db) => Promise<unknown>]>([
    ["rename the group", (db) => db.doc(`groups/${G}`).update({name: "Isengard"})],
    ["edit a member's group profile", (db) => db.doc(`groups/${G}/users/frodo`).update({characters: []})],
    ["take over a name reservation", (db) => db.doc(`groups/${G}/usernames/frodo`).update({userId: "saruman"})],
    ["release a member's name", (db) => db.doc(`groups/${G}/usernames/frodo`).delete()],
    ["create an invitation", (db) => db.doc(`groups/${G}/registrationTokens/tok2`).set({token: "tok2", used: false})],
    ["edit an invitation", (db) => db.doc(`groups/${G}/registrationTokens/tok`).update({notes: "For Wormtongue"})],
    ["revoke an invitation", (db) => db.doc(`groups/${G}/registrationTokens/tok`).delete()],
    ["edit a campaign", (db) => db.doc(`groups/${G}/campaigns/c1`).update({name: "Orthanc"})],
    ["delete a campaign", (db) => db.doc(`groups/${G}/campaigns/c1`).delete()],
    ["edit a record", (db) => db.doc(`groups/${G}/campaigns/c1/npcs/n1`).update({name: "Grima"})],
    ["delete a record", (db) => db.doc(`groups/${G}/campaigns/c1/npcs/n1`).delete()],
    ["change another account", (db) => db.doc("users/frodo").update({groups: [G, "isengard"]})],
    ["delete another account", (db) => db.doc("users/frodo").delete()],
    ["write the admin collection", (db) => db.doc("admin/settings").set({maintenance: true})],
  ])("cannot %s", async (_what, write) => {
    await assertFails(write(as("saruman")));
  });
});

// T128: a group holds at most five campaigns, which the rules cannot count,
// so `createCampaign` creates them and no client does.
describe("no client creates a campaign (T128)", () => {
  it("refuses a member, an admin and a stranger alike", async () => {
    await assertFails(as("frodo").doc(`groups/${G}/campaigns/c2`).set({name: "Rohan"}));
    await assertFails(as("gandalf").doc(`groups/${G}/campaigns/c2`).set({name: "Rohan"}));
    await assertFails(as("sauron").doc(`groups/${G}/campaigns/c2`).set({name: "Rohan"}));
  });

  it("still lets a member edit one", async () => {
    await assertSucceeds(as("frodo").doc(`groups/${G}/campaigns/c1`).update({name: "There and back again"}));
  });
});

// T119 (F4): `createGroup` writes a group with the Admin SDK (2026-07-29), and
// no client has created one since. The rule still let any signed-in account
// create group documents nobody is a member of, as many as it liked.
describe("no client creates a group (T119)", () => {
  it("refuses a member and a stranger alike", async () => {
    await assertFails(as("frodo").doc("groups/rivendell").set({name: "Rivendell"}));
    await assertFails(as("sauron").doc("groups/mordor").set({name: "Mordor"}));
  });
});

// T140: a profile without an `email` field was readable by every signed-in
// account. The seeded profiles here have none, as `redeemInvitation` writes
// when the sign-in token carries no email.
describe("only its holder reads a profile (T140)", () => {
  it("a member reads their own", async () => {
    await assertSucceeds(as("frodo").doc("users/frodo").get());
  });

  it("another member of the same group does not", async () => {
    await assertFails(as("gandalf").doc("users/frodo").get());
  });

  it("a stranger does not", async () => {
    await assertFails(as("sauron").doc("users/frodo").get());
  });

  it("nor does anyone signed out", async () => {
    await assertFails(env.unauthenticatedContext().firestore().doc("users/frodo").get());
  });

  it("a stranger cannot list the profiles", async () => {
    await assertFails(as("sauron").collection("users").get());
  });
});

// T136: the app lists a user's groups by their group profiles, one in each
// group, rather than by `users/{uid}.groups`. The rule that allows it matches
// every `users` collection, so its reach is pinned here.
describe("listing one's own groups (T136)", () => {
  const mine = (uid: string) => as(uid).collectionGroup("users").where("userId", "==", uid);

  beforeEach(() => env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("groups/shire").set({name: "The Shire"});
    await db.doc("groups/shire/users/frodo").set({userId: "frodo", username: "Frodo", role: "admin"});
    await db.doc(`groups/${G}/users/frodo/notes/n1`).set({content: "Mine", campaignId: "c1"});
  }));

  it("a member lists their group profiles in every group", async () => {
    const found = await assertSucceeds(mine("frodo").get());
    expect(found.docs.map((doc) => doc.ref.parent.parent?.id).sort()).toEqual([G, "shire"]);
  });

  it("a stranger may ask, and finds none", async () => {
    const found = await assertSucceeds(mine("sauron").get());
    expect(found.empty).toBe(true);
  });

  it("nobody lists another person's", async () => {
    await assertFails(as("gandalf").collectionGroup("users").where("userId", "==", "frodo").get());
  });

  it("nobody lists every group profile", async () => {
    await assertFails(as("frodo").collectionGroup("users").get());
  });

  it("nor anyone signed out", async () => {
    await assertFails(
      env.unauthenticatedContext().firestore().collectionGroup("users").where("userId", "==", "frodo").get()
    );
  });

  it("top-level profiles have no userId, so the query matches none", async () => {
    const found = await assertSucceeds(as("frodo").collection("users").where("userId", "==", "frodo").get());
    expect(found.empty).toBe(true);
  });

  it("it opens no top-level profile to another reader", async () => {
    await assertFails(as("sauron").doc("users/frodo").get());
    await assertFails(as("sauron").collection("users").get());
  });

  it("a stranger lists nothing of a group's roster", async () => {
    const found = await assertSucceeds(
      as("sauron").collection(`groups/${G}/users`).where("userId", "==", "sauron").get()
    );
    expect(found.empty).toBe(true);
    await assertFails(as("sauron").collection(`groups/${G}/users`).get());
    await assertFails(as("sauron").doc(`groups/${G}/users/frodo`).get());
  });

  it("it reaches no private notes beneath a profile", async () => {
    await assertFails(as("gandalf").collection(`groups/${G}/users/frodo/notes`).get());
    await assertFails(as("gandalf").collectionGroup("notes").get());
  });
});

// T136: membership is the group profile `groups/{g}/users/{uid}`, the one
// record of it; `users/{uid}.groups` no longer decides anything.
describe("membership is the group profile (T136)", () => {
  beforeEach(() => env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // A member the array does not list.
    await db.doc("users/merry").set({id: "merry", groups: []});
    await db.doc(`groups/${G}/users/merry`).set({userId: "merry", username: "Merry", role: "member"});
    // An admin the array does not list.
    await db.doc("users/elrond").set({id: "elrond", groups: []});
    await db.doc(`groups/${G}/users/elrond`).set({userId: "elrond", username: "Elrond", role: "admin"});
    // Listed in the array, with no profile in the group.
    await db.doc("users/pippin").set({id: "pippin", groups: [G]});
  }));

  it("a member the array does not list reads the group and its campaigns", async () => {
    await assertSucceeds(as("merry").doc(`groups/${G}`).get());
    await assertSucceeds(as("merry").doc(`groups/${G}/campaigns/c1/npcs/n1`).get());
    await assertSucceeds(as("merry").doc(`groups/${G}/users/frodo`).get());
  });

  it("a member the array does not list writes an NPC", async () => {
    await assertSucceeds(
      as("merry").doc(`groups/${G}/campaigns/c1/npcs/n2`).set({name: "Fatty", ...created("merry")})
    );
  });

  it("an admin the array does not list edits the group", async () => {
    await assertSucceeds(as("elrond").doc(`groups/${G}`).update({description: "Nine walkers"}));
  });

  it("someone the array lists without a profile reads nothing of the group", async () => {
    await assertFails(as("pippin").doc(`groups/${G}`).get());
    await assertFails(as("pippin").doc(`groups/${G}/campaigns/c1/npcs/n1`).get());
    await assertFails(as("pippin").doc(`groups/${G}/users/frodo`).get());
  });

  it("someone the array lists without a profile writes nothing", async () => {
    await assertFails(
      as("pippin").doc(`groups/${G}/campaigns/c1/npcs/n2`).set({name: "Pippin", ...created("pippin")})
    );
  });

  it("someone the array lists without a profile keeps no reading progress there", async () => {
    await assertFails(as("pippin").doc(`groups/${G}/users/pippin/story-progress/c1`).set({currentChapter: "ch1"}));
  });
});

describe("server-owned profile fields (T080)", () => {
  const usage = {isUnlimited: false, daily: {count: 10}, weekly: {count: 30}, monthly: {count: 100}};

  beforeEach(async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc("users/frodo").update({entityExtractionUsage: usage})
    );
  });

  it("a member cannot grant themselves unlimited AI usage (SEC-001)", async () => {
    await assertFails(as("frodo").doc("users/frodo").update({"entityExtractionUsage.isUnlimited": true}));
  });

  it("nor reset, remove or replace their usage counters", async () => {
    const db = as("frodo");
    await assertFails(db.doc("users/frodo").update({"entityExtractionUsage.daily.count": 0}));
    await assertFails(db.doc("users/frodo").update({entityExtractionUsage: {}}));
    // A whole-document set is an update of every key it drops.
    await assertFails(db.doc("users/frodo").set({id: "frodo", groups: [G], activeGroupId: G}));
  });

  // T137: the operator sets `extractionAllowance`; its holder may see it.
  it("a member can read their own extraction allowance", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc("users/frodo").update({
        extractionAllowance: {unlimited: false, limits: {daily: 10, weekly: 40, monthly: 80}, expiresAt: null},
      })
    );

    const own = await assertSucceeds(as("frodo").doc("users/frodo").get());
    expect(own.get("extractionAllowance.limits.daily")).toBe(10);
  });

  it("nor raise, lift or remove their extraction allowance", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc("users/frodo").update({
        extractionAllowance: {unlimited: false, limits: {daily: 10, weekly: 40, monthly: 80}, expiresAt: null},
      })
    );
    const db = as("frodo");

    await assertFails(db.doc("users/frodo").update({"extractionAllowance.unlimited": true}));
    await assertFails(db.doc("users/frodo").update({"extractionAllowance.limits.daily": 50}));
    await assertFails(db.doc("users/frodo").update({extractionAllowance: firebase.firestore.FieldValue.delete()}));
  });

  it("nor give themselves an extraction allowance they do not have", async () => {
    await assertFails(as("frodo").doc("users/frodo").update({extractionAllowance: {unlimited: true}}));
  });

  it("nor add a field the client never writes", async () => {
    await assertFails(as("frodo").doc("users/frodo").update({id: "gandalf"}));
    await assertFails(as("frodo").doc("users/frodo").update({anything: true}));
  });

  it("a member cannot change the uid their group profile names (SEC-002)", async () => {
    await assertFails(as("frodo").doc(`groups/${G}/users/frodo`).update({userId: "gandalf"}));
    await assertFails(as("frodo").doc(`groups/${G}/users/frodo`).update({id: "gandalf"}));
  });

  it("nor when a legacy profile never had the field", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`groups/${G}/users/frodo`).set({username: "Frodo", role: "member"})
    );
    await assertFails(as("frodo").doc(`groups/${G}/users/frodo`).update({userId: "gandalf"}));
  });

  it("a member cannot take another member's name without its reservation (SEC-005)", async () => {
    await assertFails(as("frodo").doc(`groups/${G}/users/frodo`).update({username: "Gandalf"}));
  });

  it("nor take an unreserved name without reserving it", async () => {
    await assertFails(as("frodo").doc(`groups/${G}/users/frodo`).update({username: "MrUnderhill"}));
  });

  it("a group admin cannot rewrite another member's identity or name", async () => {
    await assertFails(as("gandalf").doc(`groups/${G}/users/frodo`).update({userId: "gandalf"}));
    await assertFails(as("gandalf").doc(`groups/${G}/users/frodo`).update({username: "Ringbearer"}));
  });

  it("a member cannot leave by deleting their group profile (SEC-004)", async () => {
    await assertFails(as("frodo").doc(`groups/${G}/users/frodo`).delete());
  });

  it("a group admin cannot remove a member by deleting their profile", async () => {
    await assertFails(as("gandalf").doc(`groups/${G}/users/frodo`).delete());
  });
});

describe("signing in from another device", () => {
  // The requests hold a hash of the secret and the code the approving device
  // must type; reading one would hand a phisher the code.
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("deviceSignIns/req").set({email: "frodo@shire.dev", code: "1234"});
    });
  });

  it("nobody reads a request from the client, signed in or not", async () => {
    await assertFails(as("frodo").doc("deviceSignIns/req").get());
    await assertFails(env.unauthenticatedContext().firestore().doc("deviceSignIns/req").get());
  });

  it("nobody approves a request from the client", async () => {
    await assertFails(as("frodo").doc("deviceSignIns/req").update({status: "approved", uid: "frodo"}));
  });
});

describe("roles (T034)", () => {
  it("a group admin cannot change a role directly -- only setMemberRole can", async () => {
    await assertFails(as("gandalf").doc(`groups/${G}/users/frodo`).update({role: "admin"}));
  });

  it("a member cannot change their own role", async () => {
    await assertFails(as("frodo").doc(`groups/${G}/users/frodo`).update({role: "admin"}));
  });
});

describe("what members still do from the client", () => {
  it("a member reads the group's campaigns and writes an NPC", async () => {
    await assertSucceeds(as("frodo").doc(`groups/${G}/campaigns/c1/npcs/n1`).get());
    await assertSucceeds(as("frodo").doc(`groups/${G}/campaigns/c1/npcs/n2`).set({name: "Sam", ...created("frodo")}));
  });

  it("a member updates lastLogin, activeGroupId and preferences on their profile", async () => {
    await assertSucceeds(as("frodo").doc("users/frodo").update({
      lastLogin: new Date(),
      activeGroupId: G,
      preferences: {theme: "dark"},
    }));
  });

  it("a member updates their own group profile", async () => {
    await assertSucceeds(as("frodo").doc(`groups/${G}/users/frodo`).update({activeCampaignId: "c1"}));
  });

  it("a member edits their characters and picks one, as the roster does", async () => {
    await assertSucceeds(as("frodo").doc(`groups/${G}/users/frodo`).update({
      characters: [{id: "ch1", name: "Mr Underhill"}],
      activeCharacterId: "ch1",
    }));
  });

  it("a member renames to a name with æ/ø/å, whose reservation is lower-cased", async () => {
    const db = as("frodo");
    await assertSucceeds(db.runTransaction(async (transaction) => {
      const next = db.doc(`groups/${G}/usernames/æowyn`);
      await transaction.get(next);
      transaction.update(db.doc(`groups/${G}/users/frodo`), {username: "Æowyn"});
      transaction.set(next, {userId: "frodo", originalUsername: "Æowyn", createdAt: new Date()});
      transaction.delete(db.doc(`groups/${G}/usernames/frodo`));
    }));
  });

  it("a member renamed before T080, whose name was never reserved, can rename again", async () => {
    // The profile editor used to write `username` alone.
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`groups/${G}/users/frodo`).update({username: "Ringbearer"})
    );
    const db = as("frodo");
    const rename = (releaseOld: boolean) => db.runTransaction(async (transaction) => {
      const next = db.doc(`groups/${G}/usernames/mrunderhill`);
      const old = db.doc(`groups/${G}/usernames/ringbearer`);
      await transaction.get(next);
      await transaction.get(old);
      transaction.update(db.doc(`groups/${G}/users/frodo`), {username: "MrUnderhill"});
      transaction.set(next, {userId: "frodo", originalUsername: "MrUnderhill", createdAt: new Date()});
      if (releaseOld) transaction.delete(old);
    });
    // Releasing the missing reservation is what changeGroupUsername used to
    // do, and is refused; so it now skips the release.
    await assertFails(rename(true));
    await assertSucceeds(rename(false));
  });

  it("a member changes only the case of their name, keeping its reservation", async () => {
    await assertSucceeds(as("frodo").doc(`groups/${G}/users/frodo`).update({username: "FRODO"}));
  });

  it("a member renames themselves, exactly as changeGroupUsername does", async () => {
    const db = as("frodo");
    await assertSucceeds(db.runTransaction(async (transaction) => {
      const next = db.doc(`groups/${G}/usernames/mrunderhill`);
      await transaction.get(next);
      transaction.update(db.doc(`groups/${G}/users/frodo`), {username: "MrUnderhill"});
      transaction.set(next, {userId: "frodo", originalUsername: "MrUnderhill", createdAt: new Date()});
      transaction.delete(db.doc(`groups/${G}/usernames/frodo`));
    }));
  });

  it("a member cannot release someone else's name", async () => {
    await assertFails(as("frodo").doc(`groups/${G}/usernames/gandalf`).delete());
  });

  it("a group admin still edits an invitation's note", async () => {
    await assertSucceeds(as("gandalf").doc(`groups/${G}/registrationTokens/tok`).update({notes: "For Sam"}));
  });
});

// T145: invitations are made by `createInvitation`, under their token's hash
// with the token sealed beside it. A browser-made one would sit under a
// token anyone listing the collection could read.
describe("invitations are made by a function (T145)", () => {
  it("not even a group admin creates one", async () => {
    await assertFails(as("gandalf").doc(`groups/${G}/registrationTokens/tok2`).set({token: "tok2", used: false}));
  });

  it.each<[string, object]>([
    ["bring a spent one back", {used: false, usedBy: null}],
    ["spend one", {used: true}],
    ["change its sealed token", {sealed: "v1.forged"}],
    ["change its scheme", {scheme: "none"}],
    ["move its expiry", {expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)}],
    ["give it a note that is not text", {notes: 42}],
    ["give it a note over 200 characters", {notes: "x".repeat(201)}],
  ])("a group admin cannot %s", async (_what, change) => {
    await assertFails(as("gandalf").doc(`groups/${G}/registrationTokens/tok`).update(change));
  });

  it("a group admin still names one, lists them and revokes one", async () => {
    await assertSucceeds(as("gandalf").doc(`groups/${G}/registrationTokens/tok`).update({notes: "x".repeat(200)}));
    await assertSucceeds(as("gandalf").collection(`groups/${G}/registrationTokens`).get());
    await assertSucceeds(as("gandalf").doc(`groups/${G}/registrationTokens/tok`).delete());
  });
});

describe("reading progress (T073)", () => {
  const progress = (uid: string) => `groups/${G}/users/${uid}/story-progress/c1`;
  const place = {currentChapter: "chapter-02", lastRead: new Date(), chapterProgress: {}};

  it("a member saves and reads back their own place in a campaign", async () => {
    await assertSucceeds(as("frodo").doc(progress("frodo")).set(place));
    await assertSucceeds(as("frodo").doc(progress("frodo")).get());
  });

  it("another member cannot read or overwrite it", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(progress("frodo")).set(place)
    );
    await assertFails(as("gandalf").doc(progress("frodo")).get());
    await assertFails(as("gandalf").doc(progress("frodo")).set(place));
  });

  it("nor can a stranger write one into the group", async () => {
    await assertFails(as("sauron").doc(progress("sauron")).set(place));
  });
});

// T084 (IMG-003): an upload records itself before the file is written, so the
// daily sweep can tell an upload whose document write is still queued from an
// orphan. The entry is the lease, so its time must be the server's.
describe("pending uploads (T084)", () => {
  const ID = "7d3e2b1c.webp";
  const entry = (id = ID) => `groups/${G}/pendingUploads/${id}`;
  const FILE = `groups/${G}/campaigns/c1/npcs/n1/${ID}`;
  const now = () => firebase.firestore.FieldValue.serverTimestamp();
  const record = (over: Record<string, unknown> = {}) => ({path: FILE, uid: "frodo", createdAt: now(), ...over});

  it("a member records their own upload, stamped by the server", async () => {
    await assertSucceeds(as("frodo").doc(entry()).set(record()));
  });

  it("and removes it once the document is written", async () => {
    await assertSucceeds(as("frodo").doc(entry()).set(record()));
    await assertSucceeds(as("frodo").doc(entry()).delete());
  });

  it("cannot record one in another member's name", async () => {
    await assertFails(as("frodo").doc(entry()).set(record({uid: "gandalf"})));
  });

  it("cannot choose its time, which would stretch the lease", async () => {
    await assertFails(as("frodo").doc(entry()).set(record({createdAt: new Date(Date.now() + 365 * 86400000)})));
  });

  it("must name a file in this group, under the entry's own id", async () => {
    await assertFails(as("frodo").doc(entry()).set(record({path: `groups/mordor/campaigns/c9/npcs/n9/${ID}`})));
    await assertFails(as("frodo").doc(entry()).set(record({path: `groups/${G}/campaigns/c1/npcs/n1/other.webp`})));
  });

  it("holds nothing but the three fields", async () => {
    await assertFails(as("frodo").doc(entry()).set(record({note: "hello"})));
  });

  it("is not changed after the fact, nor removed or read by anyone else", async () => {
    await assertSucceeds(as("frodo").doc(entry()).set(record()));
    await assertFails(as("frodo").doc(entry()).update({path: `groups/${G}/crest/${ID}`}));
    await assertFails(as("gandalf").doc(entry()).delete());
    await assertFails(as("gandalf").doc(entry()).get());
  });

  it("a stranger cannot record one in the group", async () => {
    await assertFails(as("sauron").doc(entry()).set(record({uid: "sauron"})));
  });
});

// T084: the sweep's second ledger. A member records a file before the write
// that stops a document pointing at it, so the daily sweep reads these entries
// rather than every document. The same shape and rules as `pendingUploads`.
describe("released images (T084)", () => {
  const ID = "9a8b7c6d.webp";
  const entry = (id = ID) => `groups/${G}/releasedImages/${id}`;
  const FILE = `groups/${G}/campaigns/c1/npcs/n1/${ID}`;
  const now = () => firebase.firestore.FieldValue.serverTimestamp();
  const record = (over: Record<string, unknown> = {}) => ({path: FILE, uid: "frodo", createdAt: now(), ...over});

  it("a member records a file they are about to drop, stamped by the server", async () => {
    await assertSucceeds(as("frodo").doc(entry()).set(record()));
  });

  it("and removes it once the file is deleted", async () => {
    await assertSucceeds(as("frodo").doc(entry()).set(record()));
    await assertSucceeds(as("frodo").doc(entry()).delete());
  });

  it("covers a banner and a crest as well as an entity's picture", async () => {
    await assertSucceeds(as("frodo").doc(entry("b.webp")).set(record({path: `groups/${G}/campaigns/c1/banner/b.webp`})));
    await assertSucceeds(as("frodo").doc(entry("c.webp")).set(record({path: `groups/${G}/crest/c.webp`})));
  });

  it("cannot record one in another member's name", async () => {
    await assertFails(as("frodo").doc(entry()).set(record({uid: "gandalf"})));
  });

  it("cannot choose its time", async () => {
    await assertFails(as("frodo").doc(entry()).set(record({createdAt: new Date(Date.now() - 365 * 86400000)})));
  });

  it("must name a file in this group, under the entry's own id", async () => {
    await assertFails(as("frodo").doc(entry()).set(record({path: `groups/mordor/campaigns/c9/npcs/n9/${ID}`})));
    await assertFails(as("frodo").doc(entry()).set(record({path: `groups/${G}/campaigns/c1/npcs/n1/other.webp`})));
  });

  it("holds nothing but the three fields", async () => {
    await assertFails(as("frodo").doc(entry()).set(record({note: "hello"})));
  });

  it("is not changed after the fact, nor removed or read by anyone else", async () => {
    await assertSucceeds(as("frodo").doc(entry()).set(record()));
    await assertFails(as("frodo").doc(entry()).update({path: `groups/${G}/crest/${ID}`}));
    await assertFails(as("gandalf").doc(entry()).delete());
    await assertFails(as("gandalf").doc(entry()).get());
  });

  it("a stranger cannot record one in the group", async () => {
    await assertFails(as("sauron").doc(entry()).set(record({uid: "sauron"})));
  });
});

// T084 (IMG-003), second half: the sweep deletes a file once its entry's lease
// is over, so a document write that arrives after that would point at a
// deleted file. The rules refuse it: pointing a document at a different file
// needs that file's entry, still within its lease.
describe("an image path needs its upload's live entry (T084)", () => {
  const LEASE_MS = 30 * 24 * 60 * 60 * 1000;
  const ID = "9a8b7c6d.webp";
  const NPC = `groups/${G}/campaigns/c1/npcs/n1`;
  const entry = (id = ID) => `groups/${G}/pendingUploads/${id}`;
  const image = (path: string) => ({
    path,
    url: `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(path)}?alt=media&token=t`,
    width: 600,
    height: 800,
    uploadedBy: "frodo",
    uploadedAt: "2026-10-04T12:00:00.000Z",
  });
  const npcFile = (id = ID) => `${NPC}/${id}`;
  const OLD = npcFile("0ld0ld.webp");

  /** Record `path` the way `ImageStorageService.upload` does. */
  const record = (uid: string, path: string) =>
    as(uid).doc(entry(path.split("/").pop())).set({
      path,
      uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(NPC).set({name: "Bilbo", image: image(OLD)});
    });
  });

  it("a member points an NPC at a file whose upload is recorded", async () => {
    await assertSucceeds(record("frodo", npcFile()));
    await assertSucceeds(as("frodo").doc(NPC).update({image: image(npcFile()), ...modified("frodo")}));
  });

  it("cannot point it at a file with no entry", async () => {
    await assertFails(as("frodo").doc(NPC).update({image: image(npcFile()), ...modified("frodo")}));
  });

  it("nor once the entry's lease is over, when the sweep may have deleted the file", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(entry()).set({
        path: npcFile(),
        uid: "frodo",
        createdAt: new Date(Date.now() - LEASE_MS - 60_000),
      });
    });
    await assertFails(as("frodo").doc(NPC).update({image: image(npcFile()), ...modified("frodo")}));
  });

  it("nor at a file other than the one the entry names", async () => {
    await assertSucceeds(record("frodo", `groups/${G}/crest/${ID}`));
    await assertFails(as("frodo").doc(NPC).update({image: image(npcFile()), ...modified("frodo")}));
  });

  it("nor put back a picture that has since been replaced, whose entry is gone", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(NPC).update({image: image(npcFile())});
    });
    await assertFails(as("frodo").doc(NPC).set({name: "Bilbo", image: image(OLD), ...modified("frodo")}));
  });

  it("an edit that leaves the picture alone needs no entry, patch or whole record", async () => {
    await assertSucceeds(as("frodo").doc(NPC).update({name: "Bilbo Baggins", ...modified("frodo")}));
    await assertSucceeds(as("frodo").doc(NPC).set({name: "Mr Baggins", image: image(OLD), ...modified("frodo")}));
  });

  it("so does one on a legacy picture with no path", async () => {
    const legacy = {url: "https://example.com/bilbo.png"};
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(NPC).set({name: "Bilbo", image: legacy});
    });
    await assertSucceeds(as("frodo").doc(NPC).set({name: "Mr Baggins", image: legacy, ...modified("frodo")}));
  });

  it("removing the picture needs no entry", async () => {
    await assertSucceeds(as("frodo").doc(NPC).update({image: null, ...modified("frodo")}));
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(NPC).update({image: image(OLD)});
    });
    await assertSucceeds(as("frodo").doc(NPC).update({image: firebase.firestore.FieldValue.delete(), ...modified("frodo")}));
  });

  it("holds for a location, created or updated", async () => {
    const place = `groups/${G}/campaigns/c1/locations/l1`;
    const file = `${place}/${ID}`;
    await assertFails(as("frodo").doc(place).set({name: "Bag End", image: image(file), ...created("frodo")}));
    await assertSucceeds(record("frodo", file));
    await assertSucceeds(as("frodo").doc(place).set({name: "Bag End", image: image(file), ...created("frodo")}));
  });

  it("holds for a campaign's banner", async () => {
    const campaign = `groups/${G}/campaigns/c1`;
    const file = `${campaign}/banner/${ID}`;
    await assertFails(as("frodo").doc(campaign).update({banner: image(file)}));
    await assertSucceeds(record("frodo", file));
    await assertSucceeds(as("frodo").doc(campaign).update({banner: image(file)}));
  });

  it("holds for a group's crest", async () => {
    const file = `groups/${G}/crest/${ID}`;
    await assertFails(as("gandalf").doc(`groups/${G}`).update({crest: image(file)}));
    await assertSucceeds(record("gandalf", file));
    await assertSucceeds(as("gandalf").doc(`groups/${G}`).update({crest: image(file)}));
  });
});

// T037 (DATA-010): `deleteCampaign` marks the campaign `deleting` before its
// cleanup, which reads each member's notes once. A note, reading progress or
// content written after that would survive the deletion under a campaign
// nobody can open, so the rules refuse it -- and refuse it too once the
// campaign document is gone, which covers writes queued offline.
describe("the contact form's budgets (T099)", () => {
  // Only `sendContactEmail` writes them, through the Admin SDK. A client that
  // could would reset its own budget, or exhaust everyone else's.
  it("no client reads, writes or deletes one, signed in or not", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc("contactThrottle/anonymous").set({sent: []})
    );
    for (const db of [as("frodo"), env.unauthenticatedContext().firestore()]) {
      await assertFails(db.doc("contactThrottle/anonymous").get());
      await assertFails(db.doc("contactThrottle/anonymous").set({sent: []}));
      await assertFails(db.doc("contactThrottle/account_frodo").set({sent: []}));
      await assertFails(db.doc("contactThrottle/anonymous").delete());
    }
  });
});

describe("founder invitations (T125)", () => {
  // Only the maintainer's script issues them and only the functions read
  // them, through the Admin SDK. A client that could read one would hold a
  // link to start a group; one that could write one would mint its own.
  it("no client lists, reads, writes or deletes one, signed in or not", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc("founderInvitations/tok").set({used: false})
    );
    for (const db of [as("frodo"), env.unauthenticatedContext().firestore()]) {
      await assertFails(db.collection("founderInvitations").get());
      await assertFails(db.doc("founderInvitations/tok").get());
      await assertFails(db.doc("founderInvitations/mine").set({used: false}));
      await assertFails(db.doc("founderInvitations/tok").update({used: false}));
      await assertFails(db.doc("founderInvitations/tok").delete());
    }
  });
});

describe("turning rumours into a quest is one transaction (T088)", () => {
  const C = `groups/${G}/campaigns/c1`;

  /**
   * What `DocumentService.createDocumentWithUpdates` sends: the quest's id is
   * read and found free, every rumour is read, then the quest is set, each
   * rumour marked, and a note saying so written under it (a document of its
   * own since T133), in one commit.
   */
  const convert = (uid: string, rumourIds: string[]) => {
    const db = as(uid);
    return db.runTransaction(async (transaction) => {
      const quest = db.doc(`${C}/quests/find-the-fire`);
      if ((await transaction.get(quest)).exists) throw new Error("taken");
      const rumours = await Promise.all(rumourIds.map((id) => transaction.get(db.doc(`${C}/rumors/${id}`))));
      transaction.set(quest, {title: "Find the fire", ...created(uid)});
      rumours.forEach((rumour) => {
        transaction.update(rumour.ref, {convertedToQuestId: "find-the-fire", ...modified(uid)});
        transaction.set(rumour.ref.collection("notes").doc(`converted-${rumour.id}`), {
          content: "Converted to quest: find-the-fire",
          ...created(uid),
        });
      });
    });
  };

  const seedRumours = (count: number) => env.withSecurityRulesDisabled(async (context) => {
    const batch = context.firestore().batch();
    for (let i = 0; i < count; i++) {
      batch.set(context.firestore().doc(`${C}/rumors/r${i}`), {title: `Rumour ${i}`, notes: []});
    }
    await batch.commit();
  });
  const ids = (count: number) => Array.from({length: count}, (_, i) => `r${i}`);

  it("a member converts three rumours", async () => {
    await seedRumours(3);
    await assertSucceeds(convert("frodo", ids(3)));
  });

  // Every write's rules read the member's profile and the campaign, but a
  // request may make only so many reads; identical ones count once. The
  // client allows 249 rumours per conversion, two writes each
  // (`MAX_RUMOURS_PER_COMMIT`).
  it("and the largest selection the client allows, 249", async () => {
    await seedRumours(249);
    await assertSucceeds(convert("frodo", ids(249)));
  });

  it("a stranger converts none, and nothing is created", async () => {
    await seedRumours(3);
    await assertFails(convert("sauron", ids(3)));
    let created = true;
    await env.withSecurityRulesDisabled(async (context) => {
      created = (await context.firestore().doc(`${C}/quests/find-the-fire`).get()).exists;
    });
    expect(created).toBe(false);
  });
});

describe("a campaign being deleted takes no writes (T037)", () => {
  const NOTE = `groups/${G}/users/frodo/notes/n1`;
  const PROGRESS = `groups/${G}/users/frodo/story-progress/c1`;
  const NPC = `groups/${G}/campaigns/c1/npcs/n1`;
  const note = {campaignId: "c1", title: "Bree", content: "The Prancing Pony"};
  const place = {currentChapter: "chapter-02", lastRead: new Date(), chapterProgress: {}};

  const markDeleting = () => env.withSecurityRulesDisabled((context) =>
    context.firestore().doc(`groups/${G}/campaigns/c1`).update({deleting: true})
  );
  const removeCampaignDocument = () => env.withSecurityRulesDisabled((context) =>
    context.firestore().doc(`groups/${G}/campaigns/c1`).delete()
  );
  const seedNoteAndProgress = () => env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(NOTE).set(note);
    await context.firestore().doc(PROGRESS).set(place);
  });

  it("control: an open campaign takes all of them", async () => {
    const db = as("frodo");
    await assertSucceeds(db.doc(NOTE).set(note));
    await assertSucceeds(db.doc(NOTE).update({content: "Strider"}));
    await assertSucceeds(db.doc(PROGRESS).set(place));
    await assertSucceeds(db.doc(NPC).update({name: "Bilbo Baggins", ...modified("frodo")}));
    await assertSucceeds(db.doc(`groups/${G}/campaigns/c1/npcs/n2`).set({name: "Sam", ...created("frodo")}));
  });

  describe.each([
    ["marked deleting", markDeleting],
    ["whose document is gone", removeCampaignDocument],
  ])("a campaign %s", (_label, makeUnavailable) => {
    beforeEach(async () => {
      await seedNoteAndProgress();
      await makeUnavailable();
    });

    it("refuses a new note and an edit to an existing one", async () => {
      const db = as("frodo");
      await assertFails(db.doc(`groups/${G}/users/frodo/notes/n2`).set(note));
      await assertFails(db.doc(NOTE).update({content: "Strider"}));
    });

    it("refuses reading progress", async () => {
      await assertFails(as("frodo").doc(PROGRESS).set(place));
    });

    it("refuses new content and edits", async () => {
      await assertFails(as("frodo").doc(`groups/${G}/campaigns/c1/npcs/n2`).set({name: "Sam", ...created("frodo")}));
      await assertFails(as("frodo").doc(NPC).update({name: "Bilbo Baggins", ...modified("frodo")}));
    });

    it("still lets the owner delete their note and progress, and a member delete content", async () => {
      const db = as("frodo");
      await assertSucceeds(db.doc(NOTE).delete());
      await assertSucceeds(db.doc(PROGRESS).delete());
      await assertSucceeds(db.doc(NPC).delete());
    });
  });

  it("refuses an edit to the campaign itself once it is marked", async () => {
    await markDeleting();
    await assertFails(as("gandalf").doc(`groups/${G}/campaigns/c1`).update({name: "Renamed"}));
  });

  it("never lets a client write the mark", async () => {
    await assertFails(as("gandalf").doc(`groups/${G}/campaigns/c1`).update({deleting: true}));
    await assertFails(as("frodo").doc(`groups/${G}/campaigns/c2`).set({name: "New", deleting: false}));
    await markDeleting();
    await assertFails(as("gandalf").doc(`groups/${G}/campaigns/c1`).update({deleting: false}));
  });

  it("keeps other campaigns open", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`groups/${G}/campaigns/c2`).set({name: "Rohan"})
    );
    await markDeleting();
    await assertSucceeds(as("frodo").doc(`groups/${G}/users/frodo/notes/n3`)
      .set({...note, campaignId: "c2"}));
    await assertSucceeds(as("frodo").doc(`groups/${G}/campaigns/c2/npcs/n3`).set({name: "Eowyn", ...created("frodo")}));
  });

  it("refuses a note that names no campaign", async () => {
    await assertFails(as("frodo").doc(`groups/${G}/users/frodo/notes/n4`)
      .set({title: "Loose", content: "no campaign"}));
  });
});

describe("deleting a group is the deleteGroup function's (T037)", () => {
  const markDeleting = () => env.withSecurityRulesDisabled((context) =>
    context.firestore().doc(`groups/${G}`).update({deleting: true})
  );

  it("control: an admin can still rename the group", async () => {
    await assertSucceeds(as("gandalf").doc(`groups/${G}`).update({name: "The Nine Walkers"}));
  });

  it("refuses a client deleting the group document, which would orphan all beneath it", async () => {
    await assertFails(as("gandalf").doc(`groups/${G}`).delete());
  });

  it("never lets a client write the mark", async () => {
    await assertFails(as("gandalf").doc(`groups/${G}`).update({deleting: true}));
    await assertFails(as("sauron").doc("groups/mordor").set({name: "Mordor", deleting: false}));
    await markDeleting();
    await assertFails(as("gandalf").doc(`groups/${G}`).update({deleting: false}));
  });

  it("refuses an edit to a group once it is marked", async () => {
    await markDeleting();
    await assertFails(as("gandalf").doc(`groups/${G}`).update({name: "Renamed"}));
  });
});

describe("a location being deleted takes no new places (T088)", () => {
  const LOC = `groups/${G}/campaigns/c1/locations`;
  const place = (name: string, parentId = "") => ({name, parentId, type: "poi", status: "known"});

  beforeEach(() => env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`${LOC}/beleriand`).set(place("Beleriand"));
    await db.doc(`${LOC}/gondolin`).set(place("Gondolin", "beleriand"));
    await db.doc(`${LOC}/kings-square`).set(place("King's square", "gondolin"));
    await db.doc(`${LOC}/doriath`).set(place("Doriath", "beleriand"));
  }));

  const mark = () => env.withSecurityRulesDisabled((context) =>
    context.firestore().doc(`${LOC}/gondolin`).update({deleting: "delete-subtree"})
  );

  it("control: an unmarked place takes a new place, a moved one and an edit", async () => {
    const db = as("frodo");
    await assertSucceeds(db.doc(`${LOC}/fountain`).set({...place("Fountain", "gondolin"), ...created("frodo")}));
    await assertSucceeds(db.doc(`${LOC}/doriath`).update({parentId: "gondolin", ...modified("frodo")}));
    await assertSucceeds(db.doc(`${LOC}/gondolin`).update({name: "Ondolindë", ...modified("frodo")}));
  });

  it("lets a member mark a place, with either way of deleting it", async () => {
    await assertSucceeds(as("frodo").doc(`${LOC}/gondolin`).update({deleting: "delete-subtree", ...modified("frodo")}));
    await assertSucceeds(as("frodo").doc(`${LOC}/doriath`).update({deleting: "promote-to-grandparent", ...modified("frodo")}));
  });

  it("refuses any other mark, and a place created marked", async () => {
    await assertFails(as("frodo").doc(`${LOC}/gondolin`).update({deleting: true, ...modified("frodo")}));
    await assertFails(as("frodo").doc(`${LOC}/fountain`).set({...place("Fountain"), deleting: "delete-subtree", ...created("frodo")}));
  });

  describe("once marked", () => {
    beforeEach(mark);

    it("refuses a new place inside it", async () => {
      await assertFails(as("frodo").doc(`${LOC}/fountain`).set({...place("Fountain", "gondolin"), ...created("frodo")}));
    });

    it("refuses a place moved into it", async () => {
      await assertFails(as("frodo").doc(`${LOC}/doriath`).update({parentId: "gondolin", ...modified("frodo")}));
    });

    it("refuses an edit to it, and clearing the mark", async () => {
      await assertFails(as("frodo").doc(`${LOC}/gondolin`).update({name: "Ondolindë", ...modified("frodo")}));
      await assertFails(as("frodo").doc(`${LOC}/gondolin`).update({deleting: firebase.firestore.FieldValue.delete(), ...modified("frodo")}));
    });

    it("still lets a place inside it move out, and edits to it, so its children can be kept", async () => {
      await assertSucceeds(as("frodo").doc(`${LOC}/kings-square`).update({name: "Square of the King", ...modified("frodo")}));
      await assertSucceeds(as("frodo").doc(`${LOC}/kings-square`).update({parentId: "beleriand", ...modified("frodo")}));
    });

    it("still lets it be deleted", async () => {
      await assertSucceeds(as("frodo").doc(`${LOC}/gondolin`).delete());
    });

    it("leaves other places, and other kinds of record, alone", async () => {
      await assertSucceeds(as("frodo").doc(`${LOC}/fountain`).set({...place("Fountain", "doriath"), ...created("frodo")}));
      await assertSucceeds(as("frodo").doc(`groups/${G}/campaigns/c1/npcs/n1`).update({name: "Bilbo Baggins", ...modified("frodo")}));
    });
  });
});

// T119 (F4): a member could write into any collection under a campaign, and a
// record with no name at all. A campaign holds six kinds of record, each named
// by one field; anything else is junk that no page shows and nobody can tidy.
describe("a campaign holds the app's records, each with its name (T119)", () => {
  const C = `groups/${G}/campaigns/c1`;

  it("control: each kind of record is created the way the app creates it", async () => {
    const db = as("frodo");
    await assertSucceeds(db.doc(`${C}/npcs/sam`).set({name: "Sam", ...created("frodo")}));
    await assertSucceeds(db.doc(`${C}/locations/bree`).set({name: "Bree", parentId: "", ...created("frodo")}));
    await assertSucceeds(db.doc(`${C}/quests/the-ring`).set({title: "Destroy the ring", ...created("frodo")}));
    // The header's "New rumour" starts a blank one (`useCreateRumor`).
    await assertSucceeds(db.doc(`${C}/rumors/r1`).set({title: "", content: "", ...created("frodo")}));
    await assertSucceeds(db.doc(`${C}/chapters/chapter-1`).set({title: "A long-expected party", order: 1, ...created("frodo")}));
    await assertSucceeds(db.doc(`${C}/saga/sagaData`).set({title: "The Campaign Saga", content: "", ...created("frodo")}));
  });

  it("refuses a record of a kind the app does not have", async () => {
    await assertFails(as("frodo").doc(`${C}/anything/x`).set({name: "Junk"}));
  });

  it("including the campaign-wide reading progress T073 moved to each player", async () => {
    await assertFails(as("frodo").doc(`${C}/story-progress/current-progress`).set({currentChapter: "chapter-1"}));
  });

  it("and shows nobody one written before", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`${C}/anything/x`).set({name: "Junk"})
    );
    await assertFails(as("frodo").doc(`${C}/anything/x`).get());
    await assertFails(as("frodo").collection(`${C}/anything`).get());
  });

  it.each([
    ["an NPC with no name", "npcs/sam", {description: "A gardener"}],
    ["an NPC whose name is not text", "npcs/sam", {name: 7}],
    ["a location with no name", "locations/bree", {parentId: ""}],
    ["a quest named in the wrong field", "quests/the-ring", {name: "Destroy the ring"}],
    ["a rumour with no title", "rumors/r1", {content: "Black riders on the road"}],
    ["a chapter with no title", "chapters/chapter-1", {order: 1}],
    ["a saga with no title", "saga/sagaData", {content: "Once"}],
  ])("refuses %s", async (_what, path, data) => {
    await assertFails(as("frodo").doc(`${C}/${path}`).set({...data, ...created("frodo")}));
  });

  it("refuses an edit that removes a record's name", async () => {
    await assertFails(as("frodo").doc(`${C}/npcs/n1`).update({name: firebase.firestore.FieldValue.delete(), ...modified("frodo")}));
  });

  it("or turns it into something other than text", async () => {
    await assertFails(as("frodo").doc(`${C}/npcs/n1`).update({name: {first: "Bilbo"}, ...modified("frodo")}));
  });

  it("or replaces the whole record without it", async () => {
    await assertFails(as("frodo").doc(`${C}/npcs/n1`).set({description: "A hobbit", ...modified("frodo")}));
  });

  it("still lets a record written before, with no name, be edited", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`${C}/npcs/legacy`).set({description: "Old"})
    );
    await assertSucceeds(as("frodo").doc(`${C}/npcs/legacy`).update({description: "Older", ...modified("frodo")}));
  });
});

// T133: a person's, a place's and a rumour's notes are documents of their
// own, `{record}/{id}/notes/{noteId}`, each capped alone (F3, F4); a quest's
// too since T163.
describe("a record's notes are documents of their own (T133)", () => {
  const C = `groups/${G}/campaigns/c1`;

  beforeEach(() => env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`${C}/locations/bree`).set({name: "Bree", parentId: ""});
    await context.firestore().doc(`${C}/rumors/r1`).set({title: "Smoke", content: ""});
    await context.firestore().doc(`${C}/quests/q1`).set({title: "The ring", objectives: []});
  }));

  it.each([
    ["an NPC's", "npcs/n1", {date: "2026-10-09", text: "Owes us a sword"}],
    ["a location's", "locations/bree", {date: "2026-10-09", text: "The Prancing Pony"}],
    ["a quest's", "quests/q1", {date: "2026-10-31", text: "Took the long road"}],
    ["a rumour's", "rumors/r1", {content: "Rangers about"}],
  ])("control: a member adds, reads, edits and deletes %s note", async (_whose, record, note) => {
    const db = as("frodo");
    const path = `${C}/${record}/notes/x1`;
    await assertSucceeds(db.doc(path).set({...note, ...created("frodo")}));
    await assertSucceeds(db.doc(path).get());
    await assertSucceeds(db.collection(`${C}/${record}/notes`).get());
    await assertSucceeds(db.doc(path).update({[Object.keys(note).pop()!]: "Changed", ...modified("frodo")}));
    await assertSucceeds(db.doc(path).delete());
  });

  it("shows a stranger nothing and takes nothing from one", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`${C}/npcs/n1/notes/x1`).set({text: "Owes us a sword"})
    );
    const db = as("sauron");
    await assertFails(db.doc(`${C}/npcs/n1/notes/x1`).get());
    await assertFails(db.collection(`${C}/npcs/n1/notes`).get());
    await assertFails(db.doc(`${C}/npcs/n1/notes/x2`).set({text: "Mine", ...created("sauron")}));
    await assertFails(db.doc(`${C}/npcs/n1/notes/x1`).delete());
  });

  it("refuses notes under a record of a kind that keeps none", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`${C}/chapters/ch1`).set({title: "Chapter one", order: 1})
    );
    await assertFails(as("frodo").doc(`${C}/chapters/ch1/notes/x1`).set({text: "Junk", ...created("frodo")}));
    await assertFails(as("frodo").doc(`${C}/anything/a1/notes/x1`).set({text: "Junk"}));
  });

  it("refuses a note under a record that does not exist", async () => {
    await assertFails(as("frodo").doc(`${C}/npcs/nobody/notes/x1`).set({text: "Junk"}));
  });

  it("takes a note on a record created in the same commit, as a combined rumour's is", async () => {
    const db = as("frodo");
    const batch = db.batch();
    batch.set(db.doc(`${C}/rumors/combined`), {title: "Smoke and ash", content: "Both", ...created("frodo")});
    batch.set(db.doc(`${C}/rumors/combined/notes/x1`), {content: "Combined from rumors: r1", ...created("frodo")});
    await assertSucceeds(batch.commit());
  });

  it.each([
    ["text", 10_000],
    ["content", 10_000],
    ["date", 200],
    ["author", 200],
  ])("a note's %s takes %d characters and refuses one more", async (field, limit) => {
    const db = as("frodo");
    const path = `${C}/npcs/n1/notes/x1`;
    await assertFails(db.doc(path).set({[field]: "x".repeat(limit + 1), ...created("frodo")}));
    await assertSucceeds(db.doc(path).set({[field]: "x".repeat(limit), ...created("frodo")}));
    await assertFails(db.doc(path).update({[field]: "x".repeat(limit + 1), ...modified("frodo")}));
  });

  it("refuses a note's text that is not text", async () => {
    await assertFails(as("frodo").doc(`${C}/npcs/n1/notes/x1`).set({text: ["x".repeat(20_000)], ...created("frodo")}));
  });

  it("takes no note while the campaign is being deleted, but lets one be deleted", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`${C}/npcs/n1/notes/x1`).set({text: "Owes us a sword"});
      await context.firestore().doc(C).update({deleting: true});
    });
    const db = as("frodo");
    await assertFails(db.doc(`${C}/npcs/n1/notes/x2`).set({text: "Late", ...created("frodo")}));
    await assertFails(db.doc(`${C}/npcs/n1/notes/x1`).update({text: "Late", ...modified("frodo")}));
    await assertSucceeds(db.doc(`${C}/npcs/n1/notes/x1`).delete());
  });
});

// T134: a chapter's text is a document of its own beside the chapter,
// `chapters/{id}/body/text`, so the story's listener no longer downloads it.
describe("a chapter's text is a document of its own (T134)", () => {
  const C = `groups/${G}/campaigns/c1`;
  const BODY = `${C}/chapters/ch-1/body/text`;

  beforeEach(() => env.withSecurityRulesDisabled((context) =>
    context.firestore().doc(`${C}/chapters/ch-1`).set({title: "A long-expected party", order: 1})
  ));

  it("control: a member writes, reads, rewrites and deletes it", async () => {
    const db = as("frodo");
    await assertSucceeds(db.doc(BODY).set({content: "In a hole in the ground"}));
    await assertSucceeds(db.doc(BODY).get());
    await assertSucceeds(db.doc(BODY).set({content: "In a hole in the ground there lived a hobbit"}));
    await assertSucceeds(db.doc(BODY).delete());
  });

  it("is written with a new chapter in one commit, and the chapter keeps no text", async () => {
    const db = as("frodo");
    const batch = db.batch();
    batch.set(db.doc(`${C}/chapters/ch-2`), {title: "The shadow of the past", order: 2, contentLength: 5, ...created("frodo")});
    batch.set(db.doc(`${C}/chapters/ch-2/body/text`), {content: "Gandalf"});
    await assertSucceeds(batch.commit());
    await assertSucceeds(db.doc(`${C}/chapters/ch-1`).update({content: null, contentLength: 3, ...modified("frodo")}));
  });

  it("shows a stranger nothing and takes nothing from one", async () => {
    await env.withSecurityRulesDisabled((context) => context.firestore().doc(BODY).set({content: "Mine"}));
    const db = as("sauron");
    await assertFails(db.doc(BODY).get());
    await assertFails(db.doc(BODY).set({content: "Yours"}));
    await assertFails(db.doc(BODY).delete());
  });

  it("takes 200,000 characters and refuses one more", async () => {
    const db = as("frodo");
    await assertFails(db.doc(BODY).set({content: "x".repeat(200_001)}));
    await assertSucceeds(db.doc(BODY).set({content: "x".repeat(200_000)}));
    await assertFails(db.doc(BODY).update({content: "x".repeat(200_001)}));
  });

  it("holds the text and nothing else, under the one id", async () => {
    const db = as("frodo");
    await assertFails(db.doc(BODY).set({content: "Short", extra: "x".repeat(900_000)}));
    await assertFails(db.doc(`${C}/chapters/ch-1/body/other`).set({content: "Short"}));
  });

  it("refuses a body under a chapter that does not exist, or under another kind of record", async () => {
    await assertFails(as("frodo").doc(`${C}/chapters/nowhere/body/text`).set({content: "Junk"}));
    await assertFails(as("frodo").doc(`${C}/npcs/n1/body/text`).set({content: "Junk"}));
  });

  it("takes no text while the campaign is being deleted, but lets it be deleted", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(BODY).set({content: "Before"});
      await context.firestore().doc(C).update({deleting: true});
    });
    const db = as("frodo");
    await assertFails(db.doc(BODY).set({content: "Late"}));
    await assertSucceeds(db.doc(BODY).delete());
  });
});

// T119 (F4): every text field of a record has a limit, the app's
// `RECORD_TEXT_LIMITS` (src/core/constants/textLimits.ts). The app stops
// there; the rules refuse a client that does not.
describe("a record's text has a limit (T119)", () => {
  const C = `groups/${G}/campaigns/c1`;
  const NAMED_BY: Record<string, string> = {
    npcs: "name", locations: "name", quests: "title", rumors: "title", chapters: "title", saga: "title",
  };
  /** A record of `collection` whose `field` holds `length` characters. */
  const record = (collection: string, field: string, length: number) =>
    ({[NAMED_BY[collection]]: "N", [field]: "x".repeat(length)});
  const id = (collection: string) => (collection === "saga" ? "sagaData" : "r1");

  it.each([
    ["npcs", "name", 200],
    ["npcs", "title", 200],
    ["npcs", "race", 200],
    ["npcs", "occupation", 200],
    ["npcs", "location", 200],
    ["npcs", "description", 10_000],
    ["npcs", "appearance", 10_000],
    ["npcs", "personality", 10_000],
    ["npcs", "background", 10_000],
    ["locations", "name", 200],
    ["locations", "description", 10_000],
    ["quests", "title", 200],
    ["quests", "location", 200],
    ["quests", "levelRange", 200],
    ["quests", "description", 10_000],
    ["quests", "background", 10_000],
    ["rumors", "title", 200],
    ["rumors", "sourceName", 200],
    ["rumors", "location", 200],
    ["rumors", "content", 10_000],
    ["chapters", "title", 200],
    ["chapters", "summary", 10_000],
    ["saga", "title", 200],
    ["saga", "content", 500_000],
  ])("%s.%s takes %d characters and refuses one more", async (collection, field, limit) => {
    const path = `${C}/${collection}/${id(collection)}`;
    await assertFails(as("frodo").doc(path).set({...record(collection, field, limit + 1), ...created("frodo")}));
    await assertSucceeds(as("frodo").doc(path).set({...record(collection, field, limit), ...created("frodo")}));
    await assertFails(as("frodo").doc(path).update({[field]: "x".repeat(limit + 1), ...modified("frodo")}));
  });

  it("counts as the app does: an emoji is two", async () => {
    await assertSucceeds(as("frodo").doc(`${C}/npcs/n2`).set({name: "😀".repeat(100), ...created("frodo")}));
    await assertFails(as("frodo").doc(`${C}/npcs/n3`).set({name: "😀".repeat(100) + "x", ...created("frodo")}));
  });

  it("refuses text that is not text", async () => {
    await assertFails(as("frodo").doc(`${C}/npcs/n1`).update({description: {page: "x".repeat(20_000)}, ...modified("frodo")}));
    await assertFails(as("frodo").doc(`${C}/rumors/r1`).set({title: "Smoke", content: ["x".repeat(20_000)], ...created("frodo")}));
  });

  it("lets a field be cleared or removed", async () => {
    await assertSucceeds(as("frodo").doc(`${C}/npcs/n1`).update({description: null, ...modified("frodo")}));
    await assertSucceeds(as("frodo").doc(`${C}/npcs/n1`).update({race: firebase.firestore.FieldValue.delete(), ...modified("frodo")}));
  });

  it("still lets a record stored over a limit be edited, as long as the edit leaves that field", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`${C}/npcs/n1`).update({description: "x".repeat(20_000)})
    );
    await assertSucceeds(as("frodo").doc(`${C}/npcs/n1`).update({race: "Hobbit", ...modified("frodo")}));
    await assertFails(as("frodo").doc(`${C}/npcs/n1`).update({description: "x".repeat(20_001), ...modified("frodo")}));
  });

  // Created only by `createCampaign` since T128, which checks both itself.
  it("caps a campaign's name and description when it is edited", async () => {
    const db = as("frodo");
    await assertFails(db.doc(`groups/${G}/campaigns/c1`).update({name: "x".repeat(201)}));
    await assertFails(db.doc(`groups/${G}/campaigns/c1`).update({description: "x".repeat(10_001)}));
    await assertSucceeds(db.doc(`groups/${G}/campaigns/c1`).update({name: "x".repeat(200), description: "x".repeat(10_000)}));
  });

  it("caps a group's name and description when its admin edits them", async () => {
    const db = as("gandalf");
    await assertFails(db.doc(`groups/${G}`).update({name: "x".repeat(201)}));
    await assertFails(db.doc(`groups/${G}`).update({description: "x".repeat(10_001)}));
    await assertSucceeds(db.doc(`groups/${G}`).update({name: "x".repeat(200), description: "x".repeat(10_000)}));
  });

  it("leaves the lists inside a record alone, which no rule can look into", async () => {
    await assertSucceeds(as("frodo").doc(`${C}/npcs/n1`).update({tags: ["x".repeat(20_000)], ...modified("frodo")}));
  });
});

// T132 (F5, F6): who wrote a record or a note, and when, were built in the
// browser and believed: any member could credit a record to someone else, or
// rewrite who created one. The ids and the server's time are checked now.
describe("a record says truly who wrote it, and when (T132)", () => {
  const C = `groups/${G}/campaigns/c1`;
  const NPC = `${C}/npcs/n1`;
  const NOTE = `${NPC}/notes/x1`;

  beforeEach(() => env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const at = firebase.firestore.Timestamp.fromDate(new Date("2026-10-01T12:00:00Z"));
    const byGandalf = {createdBy: "gandalf", modifiedBy: "gandalf", createdAt: at, modifiedAt: at};
    await db.doc(NPC).set({name: "Bilbo", ...byGandalf});
    await db.doc(NOTE).set({text: "Owes us a sword", ...byGandalf});
    await db.doc(`${C}/chapters/ch-1`).set({title: "A long-expected party", order: 1, ...byGandalf});
  }));

  it("control: a member creates and edits a record and a note as themselves, now", async () => {
    const db = as("frodo");
    await assertSucceeds(db.doc(`${C}/npcs/sam`).set({name: "Sam", ...created("frodo")}));
    await assertSucceeds(db.doc(NPC).update({name: "Bilbo Baggins", ...modified("frodo")}));
    await assertSucceeds(db.doc(`${NPC}/notes/x2`).set({text: "Left the Shire", ...created("frodo")}));
    await assertSucceeds(db.doc(NOTE).update({text: "Owes us two swords", ...modified("frodo")}));
  });

  it.each([
    ["credited to someone else", {createdBy: "gandalf"}],
    ["last changed by someone else", {modifiedBy: "gandalf"}],
    ["dated by the browser's clock", {createdAt: new Date()}],
    ["changed at the browser's time", {modifiedAt: new Date()}],
  ])("refuses a new record %s", async (_what, forged) => {
    await assertFails(as("frodo").doc(`${C}/npcs/sam`).set({name: "Sam", ...created("frodo"), ...forged}));
  });

  it.each(["createdBy", "modifiedBy", "createdAt", "modifiedAt"])("refuses a new record without %s", async (field) => {
    const stamps: Record<string, unknown> = created("frodo");
    delete stamps[field];
    await assertFails(as("frodo").doc(`${C}/npcs/sam`).set({name: "Sam", ...stamps}));
  });

  it.each([
    ["rewrites who created it", {createdBy: "frodo"}],
    ["rewrites when it was created", {createdAt: now()}],
    ["credits the change to someone else", {modifiedBy: "gandalf"}],
    ["dates the change by the browser's clock", {modifiedAt: new Date()}],
  ])("refuses an edit that %s", async (_what, forged) => {
    await assertFails(as("frodo").doc(NPC).update({name: "Bilbo Baggins", ...modified("frodo"), ...forged}));
  });

  it("refuses an edit that does not say who made it, and when", async () => {
    await assertFails(as("frodo").doc(NPC).update({name: "Bilbo Baggins"}));
    await assertFails(as("frodo").doc(NPC).update({name: "Bilbo Baggins", modifiedBy: "frodo"}));
  });

  it("refuses a whole record rewritten without who created it", async () => {
    await assertFails(as("frodo").doc(NPC).set({name: "Bilbo Baggins", ...modified("frodo")}));
  });

  it("holds for a note: created and edited as the writer, now", async () => {
    const db = as("frodo");
    await assertFails(db.doc(`${NPC}/notes/x2`).set({text: "Forged", ...created("frodo"), createdBy: "gandalf"}));
    await assertFails(db.doc(NOTE).update({text: "Mine now", ...modified("frodo"), createdBy: "frodo"}));
    await assertFails(db.doc(NOTE).update({text: "Unsigned"}));
  });

  // #1203: renumbering the chapters around a moved or deleted one changes
  // each one's place alone, and keeps its author's attribution.
  it("lets a chapter be renumbered without taking it over", async () => {
    await assertSucceeds(as("frodo").doc(`${C}/chapters/ch-1`).update({order: 2}));
  });

  it("but not edited otherwise without saying who and when", async () => {
    await assertFails(as("frodo").doc(`${C}/chapters/ch-1`).update({order: 2, title: "A party"}));
    await assertFails(as("frodo").doc(NPC).update({order: 2}));
  });
});

// T131, T133, T134: links' old second halves, records' notes arrays and a
// chapter's own text were moved out in production, and nothing reads them. A
// value written there, by a browser still on the app from before, would
// vanish from every page; the rules refuse it instead.
describe("the shapes records were moved out of stay empty (T131, T133, T134)", () => {
  const C = `groups/${G}/campaigns/c1`;

  beforeEach(() => env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // As the migration left them: empty, and one person's place since deleted.
    await db.doc(`${C}/npcs/n1`).set({name: "Bilbo", locationId: "rivendell-gone", notes: [],
      connections: {relatedNPCs: [], affiliations: [], relatedQuests: []}});
    await db.doc(`${C}/locations/bree`).set({name: "Bree", notes: [], relatedQuests: []});
    await db.doc(`${C}/rumors/r1`).set({title: "Smoke", content: "", notes: []});
    await db.doc(`${C}/chapters/ch-1`).set({title: "A long-expected party", order: 1, content: null});
  }));

  it("control: the app's own writes, with the old fields empty or as they were", async () => {
    const db = as("frodo");
    // Quick add writes `locationId: ""` and `notes: []`; a new rumour `notes: []`.
    await assertSucceeds(db.doc(`${C}/npcs/sam`).set({name: "Sam", locationId: "", notes: [],
      connections: {relatedNPCs: [], affiliations: []}, ...created("frodo")}));
    await assertSucceeds(db.doc(`${C}/rumors/r2`).set({title: "Ash", content: "", notes: [], ...created("frodo")}));
    // A link added between two people rewrites `connections` as it was.
    await assertSucceeds(db.doc(`${C}/npcs/n1`).update({
      connections: {relatedNPCs: ["sam"], affiliations: [], relatedQuests: []}, ...modified("frodo")}));
    // An edit leaves the place since deleted as it was; saving a chapter empties its text.
    await assertSucceeds(db.doc(`${C}/npcs/n1`).update({name: "Bilbo Baggins", ...modified("frodo")}));
    await assertSucceeds(db.doc(`${C}/chapters/ch-1`).update({content: null, contentLength: 9, ...modified("frodo")}));
  });

  it.each([
    ["a person's old place", "npcs/n1", {locationId: "bree"}],
    ["a person's old quest list", "npcs/n1", {connections: {relatedNPCs: [], affiliations: [], relatedQuests: ["q1"]}}],
    ["a person's notes array", "npcs/n1", {notes: [{date: "2026-10-09", text: "Lost"}]}],
    ["a place's old quest list", "locations/bree", {relatedQuests: ["q1"]}],
    ["a place's notes array", "locations/bree", {notes: [{date: "2026-10-09", text: "Lost"}]}],
    ["a rumour's notes array", "rumors/r1", {notes: [{content: "Lost"}]}],
    ["a chapter's own text", "chapters/ch-1", {content: "Lost"}],
  ])("refuses %s, written again", async (_what, path, data) => {
    await assertFails(as("frodo").doc(`${C}/${path}`).update({...data, ...modified("frodo")}));
  });

  it("refuses a new record written in an old shape", async () => {
    const db = as("frodo");
    await assertFails(db.doc(`${C}/npcs/sam`).set({name: "Sam", locationId: "bree", ...created("frodo")}));
    await assertFails(db.doc(`${C}/rumors/r2`).set({title: "Ash", content: "", notes: [{content: "Lost"}], ...created("frodo")}));
    await assertFails(db.doc(`${C}/chapters/ch-2`).set({title: "The shadow of the past", order: 2, content: "Lost", ...created("frodo")}));
  });

  it("leaves a rumour's own content and the saga's text alone", async () => {
    const db = as("frodo");
    await assertSucceeds(db.doc(`${C}/rumors/r1`).update({content: "Black riders on the road", ...modified("frodo")}));
    await assertSucceeds(db.doc(`${C}/saga/sagaData`).set({title: "The saga", content: "Once", ...created("frodo")}));
  });
});

// T163: a player's private records, under their own group profile, read and
// written by them alone until published.
describe("private records are their author's alone (T163)", () => {
  const P = `groups/${G}/users/frodo/private/c1`;

  it.each([
    ["person", "npcs", {name: "Gollum"}],
    ["place", "locations", {name: "The cave", parentId: ""}],
    ["quest", "quests", {title: "Follow the fish", objectives: []}],
    ["rumour", "rumors", {title: "Riddles in the dark", content: ""}],
  ])("control: the author adds, reads, lists, edits and deletes a private %s", async (_what, kind, record) => {
    const db = as("frodo");
    const path = `${P}/${kind}/r1`;
    await assertSucceeds(db.doc(path).set({...record, ...created("frodo")}));
    await assertSucceeds(db.doc(path).get());
    await assertSucceeds(db.collection(`${P}/${kind}`).get());
    await assertSucceeds(db.doc(path).update({description: "Changed", ...modified("frodo")}));
    await assertSucceeds(db.doc(path).delete());
  });

  it("shows another member nothing, not even an admin, and takes nothing from one", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`${P}/npcs/gollum`).set({name: "Gollum"})
    );
    for (const uid of ["gandalf", "sauron"]) {
      const db = as(uid);
      await assertFails(db.doc(`${P}/npcs/gollum`).get());
      await assertFails(db.collection(`${P}/npcs`).get());
      await assertFails(db.doc(`${P}/npcs/gollum`).update({name: "Sméagol", ...modified(uid)}));
      await assertFails(db.doc(`${P}/npcs/gollum`).delete());
      await assertFails(db.doc(`${P}/npcs/new`).set({name: "Planted", ...created(uid)}));
    }
    await assertFails(as("gandalf").collectionGroup("npcs").get());
  });

  it("takes nothing from someone who has left the group, even under their own uid", async () => {
    await env.withSecurityRulesDisabled((context) => context.firestore().doc(`groups/${G}/users/frodo`).delete());
    await assertFails(as("frodo").doc(`${P}/npcs/r1`).set({name: "Gollum", ...created("frodo")}));
  });

  it("refuses a kind of record that is never private, and a chapter above all", async () => {
    const db = as("frodo");
    await assertFails(db.doc(`${P}/chapters/ch1`).set({title: "Chapter", ...created("frodo")}));
    await assertFails(db.doc(`${P}/anything/a1`).set({name: "Junk", ...created("frodo")}));
  });

  it("caps a private record's text as a shared one's, and checks who wrote it", async () => {
    const db = as("frodo");
    await assertFails(db.doc(`${P}/npcs/r1`).set({name: "x".repeat(201), ...created("frodo")}));
    await assertFails(db.doc(`${P}/npcs/r1`).set({name: "Gollum", ...created("frodo"), createdBy: "gandalf"}));
    await assertSucceeds(db.doc(`${P}/npcs/r1`).set({name: "x".repeat(200), ...created("frodo")}));
  });

  // A private record's picture is its author's own, leased as any upload is,
  // in their folder for this campaign, which only they read (T163).
  describe("a private record's picture", () => {
    const leased = async (uid: string, path: string) =>
      as(uid).doc(`groups/${G}/pendingUploads/${path.split("/").pop()}`).set({
        path,
        uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    const image = (path: string) => ({path, url: "https://example.com/a.webp", width: 1, height: 1});
    const mine = `groups/${G}/users/frodo/campaigns/c1/npcs/r1/0a1b2c3d.webp`;

    it("control: takes the author's own upload, leased, in their folder", async () => {
      await assertSucceeds(leased("frodo", mine));
      await assertSucceeds(as("frodo").doc(`${P}/npcs/r1`).set({name: "Gollum", image: image(mine), ...created("frodo")}));
    });

    it("refuses one whose upload was never recorded", async () => {
      await assertFails(as("frodo").doc(`${P}/npcs/r1`).set({name: "Gollum", image: image(mine), ...created("frodo")}));
    });

    it("refuses one in the campaign's folder, or in another member's, leased or not", async () => {
      for (const path of [
        `groups/${G}/campaigns/c1/npcs/r1/0a1b2c3e.webp`,
        `groups/${G}/users/gandalf/campaigns/c1/npcs/r1/0a1b2c3f.webp`,
        `groups/${G}/users/frodo/campaigns/c2/npcs/r1/0a1b2c40.webp`,
      ]) {
        await assertSucceeds(leased("frodo", path));
        await assertFails(as("frodo").doc(`${P}/npcs/r1`).set({name: "Gollum", image: image(path), ...created("frodo")}));
      }
    });

    it("keeps a shared record from pointing at one, even leased", async () => {
      await assertSucceeds(leased("frodo", mine));
      await assertFails(as("frodo").doc(`groups/${G}/campaigns/c1/npcs/n1`).update({image: image(mine), ...modified("frodo")}));
    });
  });

  it("takes nothing while the campaign is being deleted, but lets a record go", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`${P}/npcs/gollum`).set({name: "Gollum"});
      await context.firestore().doc(`groups/${G}/campaigns/c1`).update({deleting: true});
    });
    const db = as("frodo");
    await assertFails(db.doc(`${P}/npcs/r2`).set({name: "Late", ...created("frodo")}));
    await assertSucceeds(db.doc(`${P}/npcs/gollum`).delete());
  });

  it("keeps a private record's notes to its author, under a record that exists", async () => {
    await env.withSecurityRulesDisabled((context) =>
      context.firestore().doc(`${P}/npcs/gollum`).set({name: "Gollum"})
    );
    const note = {date: "2026-10-31", text: "Lost a ring", ...created("frodo")};
    await assertSucceeds(as("frodo").doc(`${P}/npcs/gollum/notes/x1`).set(note));
    await assertSucceeds(as("frodo").collection(`${P}/npcs/gollum/notes`).get());
    await assertFails(as("gandalf").doc(`${P}/npcs/gollum/notes/x1`).get());
    await assertFails(as("gandalf").collectionGroup("notes").get());
    await assertFails(as("frodo").doc(`${P}/npcs/nobody/notes/x1`).set(note));
    await assertFails(as("frodo").doc(`${P}/npcs/gollum/notes/x2`).set({...note, text: "x".repeat(10_001)}));
  });

  it("holds a link as its two ends and nothing else, for its author alone", async () => {
    const link = {from: {kind: "npc", id: "gollum"}, to: {kind: "quest", id: "the-ring"}, createdAt: now()};
    await assertSucceeds(as("frodo").doc(`${P}/links/l1`).set(link));
    await assertSucceeds(as("frodo").collection(`${P}/links`).get());
    await assertFails(as("gandalf").collection(`${P}/links`).get());
    await assertFails(as("frodo").doc(`${P}/links/l2`).set({...link, note: "extra"}));
    await assertFails(as("frodo").doc(`${P}/links/l2`).set({...link, to: {kind: "chapter", id: "c"}}));
    await assertFails(as("frodo").doc(`${P}/links/l1`).update({to: {kind: "quest", id: "other"}}));
    await assertSucceeds(as("frodo").doc(`${P}/links/l1`).delete());
  });
});
