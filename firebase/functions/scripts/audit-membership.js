/*
 * Membership's two copies (T136): an audit, a repair and its revert.
 *
 * A user is in a group when `users/{uid}.groups` lists it -- what the rules'
 * `isGroupMember` reads today -- and when the group profile
 * `groups/{g}/users/{uid}` exists, which holds the role and the name. T136
 * makes the group profile the only record (docs/architecture/
 * membership-design.md), so before the rules switch to it this shows where the
 * two disagree:
 *
 *   noProfile    the array lists a group with no profile for them: they lose
 *                access when the rules switch
 *   wrongUserId  a profile whose `userId` is missing or is not its id: the
 *                query that lists a user's groups would miss it
 *   notInArray   a profile their array does not list: on the roster without
 *                access today, they gain it when the rules switch
 *
 * Every function that writes membership keeps the copies in step, so none of
 * each is expected. This shows it rather than assuming it.
 *
 * THE AUDIT WRITES NOTHING. Run it with your own Google account, which needs
 * read access to the project's Firestore; the Admin SDK uses the Application
 * Default Credentials gcloud stores for you:
 *
 *   gcloud auth application-default login
 *   cd firebase/functions
 *   node scripts/audit-membership.js --project dnd-campaign-companion
 *
 * It prints the three lists, by uid and group id; no name, email or content.
 *
 * APPLY repairs `wrongUserId` only, setting `userId` to the profile's id, each
 * profile in a transaction that leaves it alone if it changed meanwhile:
 *
 *   node scripts/audit-membership.js --project dnd-campaign-companion --apply --revert-file <file>
 *
 * `noProfile` and `notInArray` are the maintainer's to settle, case by case:
 * repairing them would mean inventing a name and a role, or taking someone's
 * access away. Remove the member in the app, invite them again, or accept what
 * the switch will do.
 *
 * REVERT. The revert file names every profile written and its `userId`
 * before. `--revert <file>` lists which still hold what was written; with
 * `--apply` it restores those, and leaves any changed since:
 *
 *   node scripts/audit-membership.js --project dnd-campaign-companion --revert <file> [--apply]
 *
 * Give the revert file a path outside the repo (it will not overwrite one
 * that exists). `--emulator` runs any mode against the dev emulators.
 */
const fs = require("node:fs");
const {initializeApp, getApps} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

/**
 * The group a group profile belongs to: `groups/{g}/users/{uid}` gives `g`,
 * any other `users` document (the top-level profiles) null.
 *
 * @param {string} path A document's path
 * @return {string|null} The group's id
 */
function groupOf(path) {
  const parts = path.split("/");
  return parts.length === 4 && parts[0] === "groups" && parts[2] === "users" ? parts[1] : null;
}

/**
 * Read both copies: every account's array, and every group profile.
 *
 * @param {import("firebase-admin/firestore").Firestore} db The database
 * @return {Promise<{arrays: Map<string, string[]>, profiles: Array<{path: string,
 *   groupId: string, uid: string, userId: unknown}>}>} The arrays by uid, and
 *   the group profiles
 */
async function readMembership(db) {
  const arrays = new Map();
  for await (const doc of db.collection("users").stream()) {
    const groups = doc.get("groups");
    arrays.set(doc.id, Array.isArray(groups) ? groups.filter((id) => typeof id === "string") : []);
  }
  const profiles = [];
  for await (const doc of db.collectionGroup("users").stream()) {
    const groupId = groupOf(doc.ref.path);
    if (groupId) profiles.push({path: doc.ref.path, groupId, uid: doc.id, userId: doc.get("userId")});
  }
  return {arrays, profiles};
}

/** Sorts membership pairs by uid, then group. */
const byPair = (a, b) => a.uid.localeCompare(b.uid) || a.groupId.localeCompare(b.groupId);

/**
 * The audit: where the two copies disagree.
 *
 * @param {import("firebase-admin/firestore").Firestore} db The database
 * @return {Promise<{noProfile: Array<{uid: string, groupId: string}>,
 *   wrongUserId: Array<{path: string, userId: unknown}>,
 *   notInArray: Array<{uid: string, groupId: string}>,
 *   accounts: number, profiles: number}>} The three lists, and how much was read
 */
async function auditMembership(db) {
  const {arrays, profiles} = await readMembership(db);
  const held = new Set(profiles.map(({uid, groupId}) => `${uid}/${groupId}`));

  const noProfile = [];
  for (const [uid, groups] of arrays) {
    for (const groupId of new Set(groups)) {
      if (!held.has(`${uid}/${groupId}`)) noProfile.push({uid, groupId});
    }
  }
  const wrongUserId = profiles
    .filter(({uid, userId}) => userId !== uid)
    .map(({path, userId}) => ({path, userId: userId ?? null}))
    .sort((a, b) => a.path.localeCompare(b.path));
  const notInArray = profiles
    .filter(({uid, groupId}) => !(arrays.get(uid) ?? []).includes(groupId))
    .map(({uid, groupId}) => ({uid, groupId}));

  return {
    noProfile: noProfile.sort(byPair),
    wrongUserId,
    notInArray: notInArray.sort(byPair),
    accounts: arrays.size,
    profiles: profiles.length,
  };
}

/**
 * Repair every `wrongUserId` profile, each in its own transaction. Each
 * profile's entry is added to `record.writes` as soon as it commits, so a run
 * that fails partway still leaves a revert file for what it wrote.
 *
 * @param {import("firebase-admin/firestore").Firestore} db The database
 * @param {{project: string, repairedAt: string, writes: Array<{path: string,
 *   before: unknown}>}} record The revert record, filled as profiles are written
 * @return {Promise<void>}
 */
async function repairMembership(db, record) {
  const {wrongUserId} = await auditMembership(db);
  for (const {path} of wrongUserId) {
    const before = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(db.doc(path));
      if (!doc.exists || doc.get("userId") === doc.id) return undefined;
      transaction.update(doc.ref, {userId: doc.id});
      return doc.get("userId") ?? null;
    });
    if (before !== undefined) record.writes.push({path, before});
  }
}

/**
 * Revert: put back the `userId` each recorded profile had, where it still
 * holds what the repair wrote. Without `apply`, only sorts them.
 *
 * @param {import("firebase-admin/firestore").Firestore} db The database
 * @param {{writes: Array<{path: string, before: unknown}>}} record The revert file
 * @param {boolean} apply Whether to write
 * @return {Promise<{unchanged: string[], changed: string[]}>} The profiles as
 *   the repair left them, and those changed or gone since
 */
async function revertMembership(db, record, apply) {
  const unchanged = [];
  const changed = [];
  for (const write of record.writes) {
    const asLeft = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(db.doc(write.path));
      if (!doc.exists || doc.get("userId") !== doc.id) return false;
      if (apply) {
        transaction.update(doc.ref, {userId: write.before === null ? FieldValue.delete() : write.before});
      }
      return true;
    }, apply ? {} : {readOnly: true});
    (asLeft ? unchanged : changed).push(write.path);
  }
  return {unchanged: unchanged.sort(), changed: changed.sort()};
}

/**
 * The audit as text.
 *
 * @param {Awaited<ReturnType<typeof auditMembership>>} audit The audit
 * @return {string} What the script prints
 */
function formatAudit(audit) {
  const lines = [`Read ${audit.accounts} account(s) and ${audit.profiles} group profile(s).`];
  const list = (title, rows, line) => {
    lines.push("", `${title}: ${rows.length}`);
    for (const row of rows) lines.push(`  ${line(row)}`);
  };
  list("noProfile -- listed in the array, no group profile; lose access at the switch",
    audit.noProfile, ({uid, groupId}) => `${uid} in ${groupId}`);
  list("wrongUserId -- `userId` missing or not the profile's id; --apply sets it",
    audit.wrongUserId, ({path, userId}) => `${path} (userId ${JSON.stringify(userId)})`);
  list("notInArray -- group profile the array does not list; gain access at the switch",
    audit.notInArray, ({uid, groupId}) => `${uid} in ${groupId}`);
  return lines.join("\n");
}

/**
 * Parse the arguments, connect, then audit, repair or revert.
 *
 * @return {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const valueOf = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const emulator = args.includes("--emulator");
  const apply = args.includes("--apply");
  const projectId = valueOf("--project");
  const revertFrom = valueOf("--revert");
  const revertFile = valueOf("--revert-file");
  const valued = ["--project", "--revert", "--revert-file"];
  const unknown = args.filter((arg, i) =>
    !valued.includes(args[i - 1]) && ![...valued, "--emulator", "--apply"].includes(arg));
  if (unknown.length) console.error(`Unknown argument(s): ${unknown.join(" ")}`);
  if (unknown.length || !projectId || (apply && !revertFrom && !revertFile) || (revertFrom && revertFile)) {
    console.error(
      "Usage: node scripts/audit-membership.js --project <project-id> [--emulator]\n" +
      "         [--apply --revert-file <file> | --revert <file> [--apply]]"
    );
    process.exitCode = 2;
    return;
  }
  if (emulator) {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  } else {
    delete process.env.FIRESTORE_EMULATOR_HOST;
  }
  const where = `${projectId}${emulator ? " (emulator)" : ""}`;
  const db = getFirestore(getApps()[0] ?? initializeApp({projectId}));

  if (revertFrom) {
    const record = JSON.parse(fs.readFileSync(revertFrom, "utf8"));
    if (record.project !== projectId) {
      console.error(`${revertFrom} records a repair of ${record.project}, not ${projectId}.`);
      process.exitCode = 2;
      return;
    }
    console.error(`Reverting the repair of ${record.repairedAt} on ${where}${apply ? "" : ", read-only"}...`);
    const {unchanged, changed} = await revertMembership(db, record, apply);
    console.log(`${unchanged.length} profile(s) still as the repair left them${apply ? ", restored" : ", to be restored"}.`);
    if (changed.length) {
      console.log(`${changed.length} changed since, or gone; left as they are:`);
      for (const path of changed) console.log(`  ${path}`);
    }
    if (!apply) console.log("Nothing has been changed. Run again with --apply to restore them.");
    return;
  }

  if (apply) {
    // Claim the revert file before writing anything.
    const out = fs.openSync(revertFile, "wx");
    console.error(`Repairing ${where}...`);
    const record = {project: projectId, repairedAt: new Date().toISOString(), writes: []};
    try {
      await repairMembership(db, record);
    } finally {
      fs.writeFileSync(out, JSON.stringify(record, null, 2));
      fs.closeSync(out);
    }
    console.log(`Set userId on ${record.writes.length} profile(s); the revert file is ${revertFile}.`);
    console.log("noProfile and notInArray are left for you: run the audit again to list them.");
    return;
  }

  console.error(`Auditing ${where}, read-only...`);
  console.log(formatAudit(await auditMembership(db)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  groupOf,
  auditMembership,
  repairMembership,
  revertMembership,
  formatAudit,
};
