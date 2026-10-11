// functions/test/auditMembership.test.ts
//
// scripts/audit-membership.js (T136): where `users/{uid}.groups` and the
// group profiles disagree, a repair of profiles whose `userId` is not their
// id, and its revert.
import {useEmulatorProject, clearProject} from "./emulator";

const PROJECT = "demo-audit-membership";
const db = useEmulatorProject(PROJECT);

type Pair = {uid: string; groupId: string};
type Audit = {
  noProfile: Pair[];
  wrongUserId: Array<{path: string; userId: unknown}>;
  notInArray: Pair[];
  accounts: number;
  profiles: number;
};
type RevertRecord = {
  project: string; kind?: string; repairedAt: string; writes: Array<{path: string; before: unknown}>;
};

// A plain-JS operator script, so required rather than imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const script = require("../scripts/audit-membership.js") as {
  groupOf: (path: string) => string | null;
  auditMembership: (db: unknown) => Promise<Audit>;
  repairMembership: (db: unknown, record: RevertRecord) => Promise<void>;
  revertMembership: (db: unknown, record: RevertRecord, apply: boolean) =>
    Promise<{unchanged: string[]; changed: string[]}>;
  arrayHolders: (db: unknown) => Promise<string[]>;
  removeArrays: (db: unknown, record: RevertRecord) => Promise<void>;
  revertRecord: (db: unknown, record: RevertRecord & {kind?: string}, apply: boolean) =>
    Promise<{unchanged: string[]; changed: string[]}>;
  formatAudit: (audit: Audit) => string;
};

/**
 * Ann is in g1 and g2, both copies agreeing. Bob's array lists g2, where he
 * has no profile (noProfile). Cat's profile in g1 has no `userId`, and Dan's
 * in g2 names someone else (wrongUserId). Eve has a profile in g1 her array
 * does not list, and Fay one in g2 with no account at all (notInArray).
 */
async function seed(): Promise<void> {
  await clearProject(PROJECT);
  const batch = db.batch();
  const account = (uid: string, groups: string[]) =>
    batch.set(db.doc(`users/${uid}`), {id: uid, groups, activeGroupId: groups[0] ?? null});
  const profile = (groupId: string, uid: string, fields: object = {userId: uid}) =>
    batch.set(db.doc(`groups/${groupId}/users/${uid}`), {username: uid, role: "member", ...fields});
  account("ann", ["g1", "g2"]);
  profile("g1", "ann");
  profile("g2", "ann");
  account("bob", ["g1", "g2"]);
  profile("g1", "bob");
  account("cat", ["g1"]);
  profile("g1", "cat", {});
  account("dan", ["g2"]);
  profile("g2", "dan", {userId: "ann"});
  account("eve", []);
  profile("g1", "eve");
  profile("g2", "fay");
  // Not a group profile: a private note beneath one.
  batch.set(db.doc("groups/g1/users/ann/notes/n1"), {content: "Mine"});
  await batch.commit();
}

const userIdOf = async (path: string) => (await db.doc(path).get()).get("userId");
const fresh = (): RevertRecord => ({project: PROJECT, repairedAt: new Date().toISOString(), writes: []});

describe("audit-membership", () => {
  beforeEach(seed);

  it("reads only group profiles as group profiles", () => {
    expect(script.groupOf("groups/g1/users/ann")).toBe("g1");
    expect(script.groupOf("users/ann")).toBeNull();
    expect(script.groupOf("groups/g1/users/ann/notes/n1")).toBeNull();
  });

  it("lists each kind of disagreement, and nothing where the copies agree", async () => {
    const audit = await script.auditMembership(db);

    expect(audit.noProfile).toEqual([{uid: "bob", groupId: "g2"}]);
    expect(audit.wrongUserId).toEqual([
      {path: "groups/g1/users/cat", userId: null},
      {path: "groups/g2/users/dan", userId: "ann"},
    ]);
    expect(audit.notInArray).toEqual([
      {uid: "eve", groupId: "g1"},
      {uid: "fay", groupId: "g2"},
    ]);
    expect(audit.accounts).toBe(5);
    expect(audit.profiles).toBe(7);
  });

  it("prints every case by uid, group and path", async () => {
    const text = script.formatAudit(await script.auditMembership(db));

    expect(text).toContain("noProfile -- listed in the array, no group profile; lose access at the switch: 1");
    expect(text).toContain("  bob in g2");
    expect(text).toContain("  groups/g2/users/dan (userId \"ann\")");
    expect(text).toContain("  fay in g2");
  });

  it("repairs only wrongUserId, and records what each held", async () => {
    const record = fresh();
    await script.repairMembership(db, record);

    expect(await userIdOf("groups/g1/users/cat")).toBe("cat");
    expect(await userIdOf("groups/g2/users/dan")).toBe("dan");
    expect(record.writes).toEqual([
      {path: "groups/g1/users/cat", before: null},
      {path: "groups/g2/users/dan", before: "ann"},
    ]);
    const after = await script.auditMembership(db);
    expect(after.wrongUserId).toEqual([]);
    // The other two are the maintainer's: untouched.
    expect(after.noProfile).toEqual([{uid: "bob", groupId: "g2"}]);
    expect(after.notInArray).toHaveLength(2);
    expect((await db.doc("users/eve").get()).get("groups")).toEqual([]);
  });

  it("reverts what is as the repair left it, and leaves what changed since", async () => {
    const record = fresh();
    await script.repairMembership(db, record);
    await db.doc("groups/g2/users/dan").update({userId: "someone"});

    const dryRun = await script.revertMembership(db, record, false);
    expect(dryRun).toEqual({unchanged: ["groups/g1/users/cat"], changed: ["groups/g2/users/dan"]});
    expect(await userIdOf("groups/g1/users/cat")).toBe("cat");

    await script.revertMembership(db, record, true);
    const cat = await db.doc("groups/g1/users/cat").get();
    expect(cat.exists).toBe(true);
    expect(cat.data()).not.toHaveProperty("userId");
    expect(await userIdOf("groups/g2/users/dan")).toBe("someone");
  });
});

// Step 4: once nothing reads or writes the array, the script removes it.
describe("audit-membership --remove-array", () => {
  beforeEach(seed);

  it("removes the array from every account carrying it, and records what each held", async () => {
    const record = {...fresh(), kind: "removeArray"};
    await script.removeArrays(db, record);

    expect(await script.arrayHolders(db)).toEqual([]);
    expect(record.writes).toEqual(expect.arrayContaining([
      {path: "users/ann", before: ["g1", "g2"]},
      {path: "users/eve", before: []},
    ]));
    expect(record.writes).toHaveLength(5);
    // Nothing else on the account changes.
    expect((await db.doc("users/ann").get()).data()).toEqual({id: "ann", activeGroupId: "g1"});
  });

  it("leaves the audit quiet: an account without the array is not compared", async () => {
    await script.removeArrays(db, {...fresh(), kind: "removeArray"});
    const audit = await script.auditMembership(db);

    expect(audit.noProfile).toEqual([]);
    // Fay has no account at all, which is still worth knowing.
    expect(audit.notInArray).toEqual([{uid: "fay", groupId: "g2"}]);
  });

  it("puts the arrays back, except on an account given one since", async () => {
    const record = {...fresh(), kind: "removeArray"};
    await script.removeArrays(db, record);
    await db.doc("users/eve").update({groups: ["g9"]});

    const result = await script.revertRecord(db, record, true);

    expect(result.changed).toEqual(["users/eve"]);
    expect((await db.doc("users/ann").get()).get("groups")).toEqual(["g1", "g2"]);
    expect((await db.doc("users/eve").get()).get("groups")).toEqual(["g9"]);
  });
});
