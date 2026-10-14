/*
 * Issue a founder invitation (T125).
 *
 * A founder link lets one person create an account in order to start a group
 * of their own: the way a table that has never used the site gets in without
 * you setting its group up. It works once, for 14 days. Send it to the person
 * who will run the table; they invite their players themselves.
 *
 * Run it with your own Google account, which needs owner or editor access to
 * the project; no key file is involved (Application Default Credentials):
 *
 *   gcloud auth application-default login
 *   cd firebase/functions
 *   npm run build
 *   node scripts/issue-founder-invitation.js --project dnd-campaign-companion --note "Thursday table"
 *
 * `--note` is for your own records: it is stored with the invitation and seen
 * by nobody else. `--emulator` issues one in the dev emulators, with a link to
 * the dev server.
 *
 * The operator page issues them too (T137). Both are recorded with who issued
 * them (`issuedBy`, "script" here) and share one budget: at most 10 founder
 * links in any 24 hours.
 */
const {initializeApp, getApps} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

/**
 * The site a founder link points at.
 *
 * @param {boolean} emulator Whether this runs against the dev emulators
 * @return {string} The site's origin
 */
function siteFor(emulator) {
  return emulator ? "http://localhost:3000" : "https://muninn.quest";
}

/**
 * What to tell the maintainer: the link to send, and when it stops working.
 *
 * @param {{link: string, expiresAt: Date, note?: string}} issued The invitation
 * @return {string} The report
 */
function describeIssued({link, expiresAt, note}) {
  const until = expiresAt.toISOString().slice(0, 16).replace("T", " ");
  return [
    ...(note ? [`Founder invitation for: ${note}`] : []),
    link,
    `Works once, until ${until} UTC.`,
  ].join("\n");
}

/**
 * The value after `name` on the command line, if any.
 *
 * @param {string[]} args The arguments
 * @param {string} name The flag
 * @return {string | undefined} Its value
 */
function flag(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

/** Parses the command line and issues one invitation. */
async function main() {
  const args = process.argv.slice(2);
  const projectId = flag(args, "--project");
  const note = flag(args, "--note");
  const emulator = args.includes("--emulator");
  if (!projectId) {
    console.error(
      "Usage: node scripts/issue-founder-invitation.js --project <project-id> " +
      "[--note <who it is for>] [--emulator]"
    );
    process.exit(2);
  }

  if (emulator) {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  } else {
    // Never let an environment variable left over from the emulators point a
    // production invitation somewhere else.
    delete process.env.FIRESTORE_EMULATOR_HOST;
  }
  if (!getApps().length) initializeApp({projectId});

  let founders;
  try {
    founders = require("../lib/signUp/founderInvitations");
  } catch {
    console.error("The functions are not built. Run `npm run build` in firebase/functions first.");
    process.exit(1);
  }

  const {token, expiresAt} = await founders.issueFounderInvitation(getFirestore(), {issuedBy: "script", note});
  console.log(describeIssued({link: founders.founderLink(siteFor(emulator), token), expiresAt, note}));
}

if (require.main === module) {
  main().catch((error) => {
    // A refusal (the daily budget spent) is a sentence, not a crash.
    console.error(error && error.name === "Refusal" ? error.message : error);
    process.exit(1);
  });
}

module.exports = {describeIssued, siteFor};
