# TODO

The project backlog. Everything outstanding lives here, in one shape, verified
against the tree rather than remembered.

## Overview

Each entry has a **category**, which says what kind of work it is, and sits in
one **horizon**, which says when to pick it up. The tables below are grouped by
horizon and ordered by priority inside each group; the entries further down are
grouped by category. **Update the tables whenever an entry is filed, closed,
re-sized or moves horizon.**

**Horizon**

- **Earlier rather than later**: do these before new feature work.
- **Backlog**: worth doing, picked up when convenient; no one is hurt while it waits.
- **Ideas and parked**: new capabilities nobody has committed to, and anything
  the maintainer has put off ("later, not now"). Do not scope these until asked.
- **Waiting on the maintainer**: a question to answer, or work that is blocked
  on something only the maintainer can decide or do.

**Category** · `bug` broken in the tree now · `security` access, keys, permissions, abuse · `reliability`
data loss, correctness, limits the data will reach as it grows · `performance`
speed, cost, storage and bundle size · `ops` deploys, domains, infrastructure,
tooling and docs · `ux` friction, polish and copy in what exists ·
`feature` a new capability · `question` waits on the maintainer's answer

**Priority** · `critical` a security or data-loss hole, do next · `high`
users are locked out of something or losing function · `medium` real user
friction, or a prerequisite for something that is · `low` worth doing, no one
is hurt while it waits · `nit` bookkeeping or polish

Priorities were triaged 2026-09-23, and categories and horizons set 2026-10-13,
from each entry's summary alone: a judgement, not a measurement.

### Earlier rather than later

| Priority | ID | Item | Category | Size | Status | Why here |
|---|---|---|---|---|---|---|
| medium | T146 | The functions run as an Editor of the whole project | security | M | open | Any code deployed as a function, by CI's key (T139) or a poisoned dependency, reaches every resource in the project and can act as every service account in it; the roles it needs are measured |
| medium | T139 | CI signs in to Google Cloud with long-lived keys | security | M | open | A leaked key deploys code that reads every group |
| medium | T141 | The site's contact address is a Gmail account | ops | M | open | Players see a Gmail address on replies and on Google's consent screen; the maintainer wants it soon |
| medium | T152 | Anyone can spend the site's sign-in emails for the day | security | M | open | The quota is the project's, 25,000 a day, and the browser asks Firebase directly; spent, nobody can sign in by email until the next day |
| medium | T154 | Backups of the data, inside and outside the project | reliability | M | open | A mistake that deletes data needs a way back, and the project a copy to rebuild from |
| medium | T158 | Private notes of players deleted before 2026-10-01 may still exist | security | M | needs investigation | The privacy page promises they are deleted; nobody has looked whether old ones survive |

### Backlog

| Priority | ID | Item | Category | Size | Status | Why here |
|---|---|---|---|---|---|---|
| low | T137 | An operator page: founder links, extraction limits, metrics | ops | L | open | The script and the console work meanwhile; design approved 2026-10-08 (`docs/architecture/operator/`), live since 2026-10-16 (steps 0 to 7 done); left: the overview (phase 2), locking the audit retention (step 8, from 2026-11-15) and two loose ends from go-live |
| low | T118 | Finish the move to `muninn.quest` | ops | S | open | Everything runs on `muninn.quest`; left: a leftover OAuth client to delete |
| low | T149 | Both Hosting sites keep every release | performance | S | open | About 220 MB of old releases, growing with every merge; a console setting, no one is hurt meanwhile |
| low | T159 | A player in no group is offered "Leave this group" on the profile page | bug | S | open | Confusing copy and a dead button, for players in no group only |
| low | T160 | A rumour test cannot fail | bug | S | open | Its assertion runs during the next test; no one is hurt until the code it guards breaks |
| low | T161 | Two tests fail with no defect behind them | ops | S | open | Real failures there get waved off as "the known flake" |
| low | T157 | Upgrade the `openai` SDK in the functions | ops | M | open | Removes T155's cast on `reasoning_effort`; the pinned 4.104 works meanwhile |
| nit | T156 | `verify-model-pin.js` no longer runs; delete it | ops | S | open | The functions suite covers most of it; port its two remaining checks first |
| nit | T162 | `AGENTS.md` and `database-field-alignment.md` describe a past tree | ops | S | open | Misleads an agent or a reader; nothing breaks |

### Ideas and parked

| Priority | ID | Item | Category | Size | Status | Why here |
|---|---|---|---|---|---|---|
| low | T054 | Sign in with Discord | feature | L | needs scoping | Kept for later, not now (2026-10-02); Firebase has no built-in provider |
| low | T057 | Sign in with a code from the email | feature | M | blocked | On hold by the maintainer; its sending domain exists now (`muninn.quest`); the current phone-approval flow works |
| low | T055 | Opt-in second factor | security | M | needs scoping | Kept for later, not now (2026-10-02); prefer an authenticator app over SMS |
| low | T111 | Is it worth expanding the notes feature? | feature | L | needs scoping | Kept for later, not now (2026-10-06) |
| low | T142 | One English in the site's copy, British | ux | M | open | Later, not now (2026-10-10); few spellings differ today, dates follow the browser in places |
| low | T163 | Private people, places, quests and rumours, published later | feature | L | open | Scoped 2026-10-31: author-only, one-way publish, a private space moved on publish; four PRs: quest notes, "already exists", private records, private pictures |

### Waiting on the maintainer

| Priority | ID | Item | Category | Size | Status | Waiting for |
|---|---|---|---|---|---|---|
| low | T134 | The saga in sections | reliability | M | blocked | How a sectioned saga is edited; the saga is one document that will hit 1 MiB |
| low | T135 | The index file matches production | performance | S | blocked | Production's indexes, read and pasted; cheap once they are |
| low | T075 | The header is crowded | ux | M | needs scoping | Which truncation was meant, and how much room the header gets back |
| low | T143 | The About page's coffee link and photo | ux | S | blocked | A coffee page to link to and a photo; both are built and switched off |
| low | T148 | Does the theme belong in Firestore? | question | S | open | An answer; the current design works |
| nit | T147 | Should `colour-schema.json` leave `docs/design/`? | question | S | open | An answer; nothing is wrong where it is |

The dormant `theme-contract` questions at the bottom are unranked on purpose.

## How items get here

`todo.txt` is the **inbox** — type a sentence into it whenever an idea lands, no
structure expected. Running **`/todo`** drains that inbox: each line is checked
against the code, located, sized and filed below, then removed from the inbox.
`/todo <idea>` files a single item without going through the inbox.

An entry records **a measurement, not a claim**. The raw note is a hypothesis;
the entry is what was found when somebody went and looked. This matters more
than it sounds. Three separate harvests measured it: the design drift log
described seven findings as open that were already fixed, the first inbox drain
found four more, and re-checking six of the performance review's fifteen
findings found three more — including its only Critical one. That is fourteen
items that would have been picked up and rediscovered. Anything below that says
`verified <date>` was read in the tree on that date.

**An entry can also describe an intention as if it were the code.** The entry
for the rumour bar's hatch said confirmed and disproved rumours "sit on the same
ramp stop — correct", and the code had them two stops apart, with the disproved
rumour in the red a failed quest wears. The comment above the map said the
right thing too. Three documents agreed with each other and none of them agreed
with the product. Before acting on what an entry says the code does, read the
code.

**Status** · `open` ready to pick up · `needs investigation` checkable, but
checking it is the first task · `needs scoping` nobody has decided what the
thing is yet · `blocked` · `in progress`

**Finished work is deleted, not marked done.** This file tracks what is left;
the PR that closed something is the record that it happened. When only part of
an entry lands, rewrite the entry to describe the remainder — do not leave the
closed half in place with a note attached.

**Size** · `S` a sitting · `M` a session or two · `L` needs its own plan first.

**Two other trackers are live and unaffected by this file**:
`docs/testing/bug-tracking/README.md` (bugs found by the behavioural suites) and
`CLAUDE.md`'s known-issues notes. Items that belong there are cross-referenced,
not copied.

---

## Bugs

Bugs the behavioural suites find live in `docs/testing/bug-tracking/README.md`.

### T159 — A player in no group is offered "Leave this group" on the profile page
**Category** bug · **Size** S · **Status** open · **Verified** 2026-10-26

A signed-in player who belongs to no group sees "Leave this group" and
"You'll lose access to 0 campaigns in this group" on `/profile`, with a Leave
group button that opens a dialog whose confirm does nothing.

- **Where**: `src/pages/profile/ProfilePage.tsx:73-77` renders
  `DangerZoneCard` with or without a group, on purpose, for the account
  deletion. The card's leave half (`DangerZoneCard.tsx:78-89`) is not guarded:
  `groupName` falls back to "this group" and `campaigns` is `[]`
  (`FirebaseContext.tsx:86`), so the sentence counts 0. The dialog's confirm
  returns early without an `activeGroup` (`LeaveGroupDialog.tsx:39`). Read in
  the code, not seen in the browser (`player9@example.com` is the seeded
  account in no group).
- **Touches**: the card and its test file.
- **Catch**: none found.
- **Source**: PR #299 ("Found on the way, not fixed here"), 2026-10-07

### T160 — A rumour test cannot fail
**Category** bug · **Size** S · **Status** open · **Verified** 2026-10-26

`useCreateRumor`'s "invents no placeholder title" returns
`act(...).then(...)`. React's `act` thenable returns nothing from `then`, so
jest does not wait. The assertion runs during the next test, and that test
takes the blame when it fails.

- **Where**:
  `src/features/campaign-entities/rumors/hooks/__tests__/useCreateRumor.test.ts:50-58`.
  **Measured**: with the expectation changed to a wrong value, the test still
  passed and "leaves the source unasked rather than defaulting it" failed with
  its message. No other test in `src/` returns `act(...).then(...)`.
- **Touches**: that one test.
- **Catch**: none found.
- **Source**: PR #215 ("worth an `await` someday"), 2026-10-04

---

## Security

### T139 — CI signs in to Google Cloud with long-lived keys
**Category** security · **Size** M · **Status** open · **Verified** 2026-10-08

Every Google Cloud sign-in in CI is a service-account JSON key kept as a
GitHub secret. A key never expires on its own, and whoever reads one holds that
account's roles from anywhere. Keyless Workload Identity Federation, restricted
to this repository by id and to the workflow and branch, removes them.

- **Where**: `FIREBASE_FUNCTIONS_DEPLOY_SA` (functions and rules,
  `firebase-hosting-merge.yml:43` and `:95`); `FIREBASE_SERVICE_ACCOUNT_DND_CAMPAIGN_COMPANION`
  (Hosting, `:143`). No PR workflow holds either key since the PR preview was
  removed (2026-10-31).
- **Catch**: `FirebaseExtended/action-hosting-deploy` takes only a JSON key (its
  README: `firebaseServiceAccount` "required", "a service account JSON key"), so
  the Hosting step moves to the CLI under `google-github-actions/auth`;
  unverified whether the action accepts anything else.
- **Then**: delete both keys in the console once nothing uses them.
- **Source**: found while designing T137's operator deploy, which uses
  Workload Identity Federation from the start, 2026-10-08

### T146 — The functions run as an Editor of the whole project
**Category** security · **Size** M · **Status** open · **Verified** 2026-10-12

No function sets `serviceAccount` (`firebase/functions/src`), so all of them
run as the default compute account, `878883683429-compute@developer.gserviceaccount.com`.
Read from the live project (read-only, 2026-10-12), that one account is four
things at once:

- **the functions' runtime**: every function in `europe-west1`;
- **their build account**: `gcloud builds get-default-service-account` names it;
- **the identity Cloud Scheduler calls the five daily functions with** (each
  `firebase-schedule-*` job's OIDC token), holding `roles/run.invoker` on each;
- **a project-wide `roles/editor` and `roles/iam.serviceAccountTokenCreator`.**
  The second lets code running as a function mint tokens for *every* service
  account in the project, the operator page's included. Device sign-in needs it
  only on the account itself. The App Engine default account holds Editor too.

**What the functions use** (read from `firebase/functions/src`, 2026-10-12;
the operator page is its own service with its own account and is left out):

| Need | Where | Role, and where it is granted |
|---|---|---|
| Firestore, read and write | almost every function | `roles/datastore.user`, project |
| Auth: `getUser`, `deleteUser`, `listUsers` | `claimDeviceSignIn`, `accountDeletion`, `accountCount` | `roles/firebaseauth.admin`, project |
| `createCustomToken` signs as the runtime account | `claimDeviceSignIn` | `roles/iam.serviceAccountTokenCreator` **on the runtime account itself** |
| Storage: list and delete objects | `imageMaintenance` (the sweeps) | `roles/storage.objectUser` on `dnd-campaign-companion.firebasestorage.app` only |
| Secrets `CONTACT_EMAIL`, `CONTACT_PASSWORD`, `OPENAI_API_KEY`, `INVITATION_LINK_KEY` | `contact`, `entityExtraction`, `invitations` | `roles/secretmanager.secretAccessor` on each secret; today granted per secret to the compute account, not through Editor |
| Logs | all | `roles/logging.logWriter`, project (as the operator page's runtime has) |

Not needed: no function is triggered by Firestore or Storage events (no
Eventarc), App Check tokens are checked against Google's public keys, and
OpenAI and Gmail are outside Google Cloud.

- **Why it matters**: the functions' deploy key (T139) and any poisoned
  dependency in `firebase/functions` reach that far. The operator page's
  security architecture names it as residual risk 5.
- **Fix, in this order**:
  1. A runtime account of the functions' own with the roles above, and
     `roles/iam.serviceAccountUser` on it for the deploy account
     (`FIREBASE_FUNCTIONS_DEPLOY_SA`), which must act as it to deploy. A setup
     script in the shape of `operator/infra/setup.sh`, with a read-only
     `--check`, would make this repeatable.
  2. Then, in its own PR, `setGlobalOptions({serviceAccount: …})` in
     `src/index.ts`. Whether the deploy also moves the scheduler jobs' OIDC
     identity to it and grants that `run.invoker` is **unverified**: read the
     jobs after the first deploy, and run one by hand
     (`gcloud scheduler jobs run`).
  3. A build account of its own (`roles/cloudbuild.builds.builder`), or the
     compute account kept for building with only that role.
  4. Only then take Editor and the project-wide Token Creator from the compute
     account. Editor on the App Engine default account goes last, once it is
     known what still runs as it.
- **Catch**: a missing role fails a function only when it is called, and no
  emulator enforces IAM, so no test catches it. After step 2, call each
  callable once and run each scheduled job.
- **Source**: the operator page's plan, filed when step 4a was picked up,
  2026-10-10; measured 2026-10-12

### T055 — Opt-in second factor
**Category** security · **Size** M · **Status** needs scoping · **Verified** 2026-09-23

Let a user who wants it add a second step to sign-in.

**Kept for later, not now** (maintainer, 2026-10-02). Do not scope it until asked.

- **Where**: Identity Platform (already enabled) supports TOTP authenticator
  apps and SMS. Enrolment would sit on the profile's `AccountCard`.
- **Catch**: **prefer TOTP.** SMS is billed per message sent, and a public SMS
  step invites SMS-pumping fraud unless the allowed regions are restricted.
  Check first that Firebase MFA applies to email-link sign-in at all -- it was
  not confirmed during T022.
- **Source**: maintainer, 2026-09-23

### T152 — Anyone can spend the site's sign-in emails for the day
**Category** security · **Size** M · **Status** open · **Verified** 2026-10-15

Sign-in links are sent by the browser calling Firebase directly
(`AuthService.sendSignInLink`, `sendSignInLinkToEmail`) with the public API
key. The client sends App Check tokens (`core/services/firebase/config/appCheck.ts`),
but whether Authentication enforces them is a console setting, **unverified**.
Firebase caps these emails for the whole project, not per address: 25,000 a
day on Blaze ([limits](https://firebase.google.com/docs/auth/limits)). A
script can spend that in an afternoon, after which nobody can sign in by email
until the quota resets (Google still works), and every one of those emails goes
to an address the script chose.

- **Measured**: the only brake in the app is the resend wait on the "Check
  your inbox" screens (`ResendLink`, one minute doubling to ten), which lives
  in the page: a reload resets it, and a direct call skips it.
  `startDeviceSignIn` caps device requests at five per address, but a link can
  be sent without one. Firebase's own per-address or per-IP throttling is
  **unverified**.
- **Ways out**: App Check enforced on Authentication (the callables already
  enforce it, `firebase/functions/src/shared/appCheck.ts`), or sending the
  link from a callable with its own per-address and per-IP budget, the way the
  contact form keeps one (`firebase/functions/src/contactThrottle.ts`). The
  callable is also where T057 would put the code. Measure first how far App
  Check alone goes.
- **Source**: review of the resend button, 2026-10-15

### T158 — Private notes of players deleted before 2026-10-01 may still exist
**Category** security · **Size** M · **Status** needs investigation · **Verified** 2026-10-26

Until #176 (bug #1405, merged 2026-10-01), deleting an account or leaving a
group deleted the group profile with a batched delete. Firestore does not cascade, so
its `notes` and `story-progress` subcollections stayed. The privacy page
promises that a player who leaves or deletes their account has "your private
notes and your place in the story" deleted (`PrivacyPolicyPage.tsx:234-237`).

- **Where**: the fix is `deleteGroupUserDocument`'s `recursiveDelete`
  (`firebase/functions/src/userManagement/accountDeletion.ts:167-172`). It
  covers new deletions only. Nothing looks for older leftovers: no script in
  `firebase/functions/scripts/` lists `groups/{g}/users` documents that are
  missing but still hold subcollections (`listDocuments()` returns those).
  Whether production has any is **unknown**; #176 said so and no audit has
  run.
- **Touches**: a new read-only operator script with an `--apply`, in the
  shape of `audit-membership.js`, and its test.
- **Catch**: a deletion has no revert file to fall back on. Make the
  read-only listing the first deliverable.
- **Source**: PR #176 ("Not done: a one-off pass for notes orphaned before
  the fix"), 2026-10-01; bug #1405's file asked for the same

---

## Reliability

### Restructuring Firestore before the site scales (T134, T135)

Decided by the maintainer on 2026-10-08: **R2**, Firestore restructured; the
site stays on Firebase. Why, and the routes set aside, are in
[`docs/architecture/backend-structure-options.md`](docs/architecture/backend-structure-options.md);
the findings (F1 to F9), the seven changes and the answers to the review's
questions are in
[`docs/architecture/data-model-review.md`](docs/architecture/data-model-review.md).
Both must land before any user scaling (maintainer, 2026-10-07). T134 is below;
T135, the index file, is under performance and cost.

**How every data change ships.** Production holds real campaigns, so each data
change is a script in `firebase/functions/scripts/` in the shape of
`audit-location-ids.js`: read-only by default, `--apply` to write, `--revert`
from a saved manifest, run by the maintainer with their own gcloud login. A
field that moves or is renamed ships in steps: the frontend reads both shapes;
the script rewrites; a later frontend drops the old shape; only then, in its own
merge, a rule refuses it. The review's read-only production checks (campaign
sizes, how often a link's two halves disagree) go into each change's audit.

### T134 — The saga in sections
**Category** reliability · **Size** M · **Status** blocked · **Verified** 2026-10-09

A chapter's text is a document of its own, `chapters/{id}/body/text`, read
where the chapter is opened (`features/storytelling/chapters/utils/chapter-body.ts`);
the chapter keeps its title, place, summary and `contentLength`, and search
reads the summary. Production's chapters were migrated, the app reads only
the body, and the rules refuse text on the chapter. The saga is still one document (`saga/sagaData`) that will
reach 1 MiB (F3).

- **Blocked on the maintainer -- the saga**: it becomes sections, as chapters
  already are, but how a player writes a sectioned saga is a design question:
  one editor per section, or one editor that splits on headings, and what the
  saga page shows while it reads them.
- **Source**: `data-model-review.md` change 4

### T154 — Backups of the data, inside and outside the project
**Category** reliability · **Size** M · **Status** open · **Verified** 2026-10-15

Firestore (`europe-north2`), the Auth accounts and the Storage images need a
way back from a mistake, and a copy to rebuild from elsewhere. Today's state
was read from the live project on 2026-10-15 and is kept with the
maintainer, not here. One manual export exists, taken before the project
moved into the organization (T137 step 0).

- **Two different needs**: recovering from a mistake inside the project
  (Firestore's point-in-time recovery, 7 days, or its scheduled backups, up
  to 14 weeks; both restore only into the same project, and delete protection
  guards the database itself), and rebuilding elsewhere if the project were
  lost: `gcloud firestore export` to a bucket of its own, `firebase
  auth:export`, and a copy of the Storage bucket, kept where the project's
  owners do not control it.
- **Catch**: the privacy page says an account deleted is gone
  (`src/pages/PrivacyPolicyPage.tsx`, "Retention and deletion"); a backup keeps
  it until the backup expires. A retention period has to be chosen and the
  page has to say it.
- **Cost**: point-in-time recovery is billed as storage of the old versions;
  at today's size, cents (estimate).
- **Source**: maintainer, 2026-10-15 ("is it possible to back up all data in
  Firestore, in case I ever have to migrate")

---

## Performance and cost

### T135 — The index file matches production
**Category** performance · **Size** S · **Status** blocked · **Verified** 2026-10-08

`firebase/firestore.indexes.json` declares 20 composite indexes for queries the
client never makes, and the deploy leaves it out (`--only
firestore:rules,storage`, `firebase-hosting-merge.yml`). What production has is
unknown; unused indexes cost storage and write time (F8).

- **Blocked on the maintainer**: `npx firebase firestore:indexes --project
  dnd-campaign-companion` from `firebase/`, output pasted. Then the file says
  exactly what is needed (probably nothing until paging brings `orderBy`), and
  whether the deploy includes it is decided.
- **Source**: `data-model-review.md` change 6 (F8)

### T149 — Both Hosting sites keep every release
**Category** performance · **Size** S · **Status** open · **Verified** 2026-10-11

Each site's `live` channel keeps every release it was ever given: its
retained-release count is unlimited. The default site, `dnd-campaign-companion`,
only redirects to `muninn.quest` (T118) and now uploads one placeholder
page (`firebase/redirect-site/`), but it still holds a copy of every build it
was sent before that.

- **Measured** (Hosting API, 2026-10-10): 40 finalised versions on the
  default site, about 110 MB, and 39 on `muninn-quest`, about 111 MB.
- **Fix** (maintainer, console): Hosting → each site → release storage
  settings, a small number of releases kept (enough to roll back a few merges).
  Outside the repo; nothing to merge.
- **Not doubled: Storage.** There is one Firebase Storage bucket,
  `dnd-campaign-companion.firebasestorage.app` (US-WEST1, 2.7 MiB, `groups/`
  only), which is what `firebaseConfig.ts:10` names. The other buckets hold
  function sources and uploads in `europe-west1`; two in `us-central1` are
  empty, and no function runs there.
- **Source**: todo.txt, 2026-10-10 ("stored double, under dnd campaign companion
  and muninn quest")

---

## Operations

### T118 — Finish the move to `muninn.quest`
**Category** ops · **Size** S · **Status** open · **Verified** 2026-10-15

The site lives on `muninn.quest` (Hosting site `muninn-quest`). The project's
default site, `dnd-campaign-companion` (`web.app`, `firebaseapp.com`), answers
every address with a 301 to the same path there; `firebase/firebase.json`
records how that was checked. Sign-in runs on `muninn.quest`
(`REACT_APP_AUTH_DOMAIN`), Firebase's mail comes from `noreply@muninn.quest`
as "Muninn", and the GitHub repo is `Haugenau20/Muninn`. The local checkout's
folder keeps its old name on purpose: Claude's memory for the project is filed
under the folder's path. **Decided (maintainer, 2026-10-06): keep the Firebase project**;
its id stays in `CLAUDE.md`, the scripts and the workflows. A new project would
have meant moving Firestore, Storage and Auth and setting up again everything
outside the repo, to hide the id only in developer tools; reconsider only if
something fixed at creation, such as the Firestore location, is wanted changed
anyway. Google verified the consent screen's branding: its sign-in window
names "Muninn" (seen 2026-10-15). What is left:

- **Cosmetic**: Google Cloud holds two OAuth web clients, one left over from
  switching the Google provider off and on; the one Firebase does not name
  (Authentication → Sign-in method → Google) can go, with a Google sign-in
  tried straight after.
- **Source**: todo.txt, 2026-10-06; the site, sign-in, mail, redirect and repo
  moved 2026-10-07

### T137 — An operator page: founder links, extraction limits, metrics
**Category** ops · **Size** L · **Status** open · **Verified** 2026-10-16

The operator page is live (2026-10-16): a Cloud Run service behind Google's
Identity-Aware Proxy that issues and revokes founder links and sets one
person's extraction allowance, from a phone too. The design, the security
architecture and the plan with what was built are in
[`docs/architecture/operator/`](docs/architecture/operator/design.md); how to
run and deploy it is in
[`firebase/functions/operator/infra/README.md`](firebase/functions/operator/infra/README.md)
and CLAUDE.md. The old `customLimit` and `isUnlimited` grant nothing any more.

What remains:

- **Phase 2, the overview**: counts, health and traffic figures on the page
  ([design, phase 2](docs/architecture/operator/design.md#phase-2-the-overview),
  a sketch, designed when picked up).
- **Step 8** (maintainer, from 2026-11-15, 30 days after go-live): lock the
  `operator-audit` bucket's retention, then set the repository variable
  `OPERATOR_AUDIT_LOCKED` to `true`.
- **The first functions build since the move into the organization** (the
  plan's step 0, item 6): the CLI skips unchanged functions, and none had
  changed since; the first merge that changes one shows whether the
  organization's default-service-account policies touch the deploy.
- **The desktop sign-in**: the page stayed blank after IAP's re-authentication
  answered 401, in a browser holding several Google accounts (`authuser=1`).
  The phone signed in. Retry in a private window.
- **Two refused allowances**: on go-live, two `allowance.set` attempts were
  refused as invalid input before the third went through. What the page said
  is not known yet; the form may need a clearer message or field.
- **Source**: todo.txt, 2026-10-08 (two inbox items, combined)

### T141 — The site's contact address is a Gmail account, not `muninn.quest`
**Category** ops · **Size** M · **Status** open · **Verified** 2026-10-15

Players who write through the contact form get replies from the project's
Gmail account, and Google's consent screen names it as the support address.
The maintainer wants a `muninn.quest` address instead. The domain only
receives mail (Porkbun forwards `admin@` and `operator@`, since 2026-10-08,
for T137 step 0); it cannot send yet.

- **Where**: `sendContactEmail` (`firebase/functions/src/contact.ts:67`)
  sends through nodemailer's `gmail` service, from and to `CONTACT_EMAIL`,
  reply-to the sender (`:342-344`); the address and its password are secrets
  (`:270`), not in the repo. The OAuth consent screen (Google Auth Platform,
  Branding) names `dndcampaigncompanion@gmail.com` as both user support email
  and developer contact (read 2026-10-15). Other places it may show
  (Firebase's public-facing support email, the Auth templates' reply-to) are
  unchecked. The support address field offers, by Google's help, only the
  editor's own address or a group they manage (unchecked here).
- **Catch**: a mail host must be chosen (Porkbun's mail, Google Workspace on
  the `muninn.quest` organization, Zoho, ...), and the apex SPF record has a
  10-lookup budget: Firebase's include takes 4, Porkbun's 6 (it sat at exactly
  10 until removed 2026-10-08), Google Workspace's 1. Add DKIM and DMARC with
  it; the domain has no DMARC record. T057's Resend would send from a
  subdomain, outside this budget. The privacy page names no processor for
  contact mail today (`PrivacyPolicyPage.tsx:318`), Gmail included.
- **Source**: maintainer, 2026-10-08, during T137 step 0

### T156 — `verify-model-pin.js` no longer runs; delete it
**Category** ops · **Size** S · **Status** open · **Verified** 2026-10-26

The hand-run check of the extraction call predates the functions jest suite,
and has been broken since `extractEntities` moved to the modular admin API.
PR #401 (T155) updated its expected model but left it broken, deferring the
deletion.

- **Where**: `firebase/functions/scripts/verify-model-pin.js:63-84` stubs
  only `firebase-admin` and `firebase-admin/app`, while
  `src/entityExtraction.ts:4` imports `getFirestore` from
  `firebase-admin/firestore`, which reaches the real SDK. Read, not run (no
  `node_modules` in this checkout). Its header (`:7-10`) still says the
  package has no jest, and its fake user grants `isUnlimited`, which grants
  nothing since T137.
- **Touches**: the script; nothing else names it.
- **Catch**: `test/extractEntities.test.ts:512-545` covers the model pin,
  `reasoning_effort`, the forced strict tool and temperature, but not two of
  the script's checks: every schema property listed in `required` (strict
  mode's rule), and no deprecated `functions` / `function_call`. Port those
  into the suite before deleting, or the deletion loses them.
- **Source**: PR #401 notes, 2026-10-26

### T157 — Upgrade the `openai` SDK in the functions
**Category** ops · **Size** M · **Status** open · **Verified** 2026-10-26

The functions pin `openai` `^4.104.0` (lockfile 4.104.0); npm's latest is
7.45.0. 4.104's `ReasoningEffort` type does not know `"none"`, which
`gpt-6-luna` requires, so T155 casts it. PR #401 left the upgrade to its own
PR.

- **Where**: `firebase/functions/src/entityExtraction.ts:64-73` holds the cast
  (`REASONING_EFFORT`); `:519-532` is the only `chat.completions.create` call
  in the package.
- **Touches**: `firebase/functions/package.json` and its lockfile, the call,
  `test/extractEntities.test.ts` (it stubs the SDK with `jest.mock("openai")`).
- **Catch**: three major versions; their breaking changes were not read. If
  the new SDK is ES-module-only, jest needs it in `ESM_PACKAGES`
  (`firebase/functions/jest.config.js`), per CLAUDE.md. The stubbed suite
  cannot show that the real API still accepts the request, so try one real
  extraction on the dev emulators after the upgrade.
- **Source**: PR #401 notes, 2026-10-26

### T161 — Two tests fail with no defect behind them
**Category** ops · **Size** S · **Status** open · **Verified** 2026-10-26

Two tests fail on loaded or cold machines, and PRs keep explaining them away
as "the known flake". Neither is tracked anywhere, so a real failure in
either would be dismissed the same way.

- **Where**: `e2e/tests/founder.spec.ts:63` waits the default 5 s for "Start
  your first campaign" after the `createGroup` callable, while the waits
  around it allow 15 s (`:58`, `:104`). It failed in #344, #356 (on `main`
  too), #374, #375 and #377. `AdminPeoplePage.test.tsx:387-397` types 205
  characters with `userEvent.type` and timed out in full runs in #377 and
  #401 (it passes alone).
- **Touches**: those two tests.
- **Catch**: `QuickAddForm.test.tsx` already has a CLAUDE.md note about
  spurious timeouts under CPU load; check it in the same pass.
- **Source**: PRs #344–#377 and #401 test notes, 2026-10-09 to 2026-10-26

### T162 — `AGENTS.md` and `database-field-alignment.md` describe a past tree
**Category** ops · **Size** S · **Status** open · **Verified** 2026-10-26

Two documents still read as current but describe a past state.

- **Where**: `AGENTS.md` (372 lines, a near-copy of an older `CLAUDE.md`)
  gives the test baseline as 4,227 passed across 185 suites (`:267`; CLAUDE.md
  has 6,049 across 315), and its status as of 2026-07-28 (`:241`). #192
  flagged it, and since then it has only had names fixed.
  `docs/architecture/migration/database-field-alignment.md:1-4` says its
  rename (`dateAdded` → `createdAt`, `dateModified` → `modifiedAt`, required
  `modifiedBy*`) is undone. T132 did it (`core/attribution/attribution.ts:28-29`).
  `data-model-review.md:245` still points to it as planned.
- **Touches**: the two files, and the one mention.
- **Catch**: whether other agents rely on `AGENTS.md` is the maintainer's
  call. Pointing it at `CLAUDE.md` or deleting it are both options.
- **Source**: PR #192 ("Not touched, worth a look"), 2026-10-03; PR #295
  (field-alignment doc "stays until the maintainer files it or drops it"),
  2026-10-07

---

## User experience

### T075 — The header is crowded
**Category** ux · **Size** M · **Status** needs scoping · **Verified** 2026-10-10

The site is called **Muninn** (maintainer, 2026-10-07) and mentions D&D nowhere
(decided 2026-10-03: "Dungeons & Dragons" and "D&D" are Wizards of the Coast
trademarks, and the Fan Content Policy grants none). Its mark is the rune ᛗ
beside the name (`public/mark.svg`, from `scripts/build-mark.js`). What is left
is the crowded header the maintainer reported (busy, some text cut off).

- **Where**: `src/app/layout/Header.tsx` — one row carries the mark and the
  name, the context switcher, the inline nav (from `lg`), search and the account
  menu. Below 400px the mark stands without the name. The campaign/group name in
  the context switcher truncates by design at `max-w-[9rem] md:max-w-[14rem]`
  (`ContextTrigger.tsx:51`). Which truncation the maintainer meant was **not**
  confirmed — that needs the running app.
- **To decide** (maintainer): how much room the header gets back.
- **The name was checked** (maintainer, TMview, 2026-10-07): Muninn ApS, a
  Danish company, holds MUNINN in Denmark (`VA 2017 00834`, classes 9, 37, 42,
  45; `VA 2022 01645`, 9, 37, 42) and the EU (`018770043`, 9, 37, 42) for
  security, video and similar software. Judged no overlap with a tabletop tool.
  Their marks do name software (class 9), so look again before the site charges
  money: EU trademark rights apply to use in the course of trade. A US
  application for MUNIN (serial `99778474`, filed 2026-04-21, software and
  cloud services) was **not** read.
- **Says D&D on purpose**: `entityExtraction.ts:454,499`, only in the prompt
  sent to OpenAI, which nobody sees. The "Dungeons" location filter
  (`LocationDirectory.tsx:54`) is the plain word, not the mark.
- **Source**: todo.txt, 2026-10-02; the trademark question was looked into and
  decided 2026-10-03; the name chosen 2026-10-07

### T142 — One English in the site's copy, British
**Category** ux · **Size** M · **Status** open · **Verified** 2026-10-10

The maintainer wants every word a player reads in one English, preferably
British. "rumour" is done (#348, everywhere a player reads it; the `/rumors`
path, collection names and identifiers keep "rumor"). Nothing else has been
gone through. **Later, not now** (maintainer, 2026-10-10).

- **Measured**: a census of string literals and JSX text in `src/` (tests
  and `__dev__` excluded) for 25 common US/UK pairs found little: "Failed to
  analyze note" (`CampaignLinksPanel.tsx:250`) and the rumour filter chip
  "Traveler" (`RumorDirectory.tsx:95`; its stored value `traveler` must
  stay), against "authorised", "colour", "grey" and "traveller" already
  British. Words outside those pairs, and phrasing, were not checked.
- **Dates**: 23 `toLocale*String` / `Intl.DateTimeFormat` calls. Some pin
  British order (`chapter-byline.ts:56`, `PrivacyLastUpdated.tsx:15`, and
  `'en-uk'` in `SagaPage.tsx:112` and `AttributionInfo.tsx:48`); the rest
  follow the browser's locale, so an American browser shows month first.
- **Also in scope**: `firebase/functions` (callable error messages), the
  Firebase Auth email templates (console, outside the repo), `index.html`'s
  meta description, and the operator page.
- **Catch**: tests pin copy, so each change moves assertions with it; a
  US spelling inside a key, a path or a stored value must stay.
- **Source**: maintainer, 2026-10-10, during the Muninn identity work

### T143 — The About page's coffee link and photo
**Category** ux · **Size** S · **Status** blocked · **Verified** 2026-10-10

`/about` has two parts built and switched off, so they are not forgotten: a
"Buy me a coffee" button beside "View the code on GitHub", and a photo
(140×168) beside "Who made it". Each is drawn once it has somewhere to point.

- **Where**: `ABOUT_EXTRAS` in `src/pages/AboutPage.tsx:16` — set `coffeeUrl`
  to the page's address and `photoSrc` to the picture's path; nothing else
  changes. `AboutPage.test.tsx` pins both as off, so it moves with them.
- **Blocked on** (maintainer): a coffee page to link to, and the photo
  (the design suggests "you, or the table mid-session").
- **Catch**: keep the coffee button a plain link. A provider's embedded
  widget loads a third-party script, which the privacy page would then have
  to name. A photo of the table needs the other players' say-so. The photo's
  alt text today is "Søren".
- **Source**: maintainer, 2026-10-10, during the Muninn identity work

---

## Features

### T054 — Sign in with Discord
**Category** feature · **Size** L · **Status** needs scoping · **Verified** 2026-09-23

Discord is where tabletop groups already talk, and the tools they use (D&D
Beyond, Roll20, Foundry) sign in with it.

**Kept for later, not now** (maintainer, 2026-10-02). Do not scope it until asked.

- **Where**: next to Google in `core/services/firebase/auth/AuthService.ts`.
- **Catch**: Firebase has no Discord provider, and Discord's OAuth2 is not
  OpenID Connect, so Identity Platform's generic OIDC provider does not fit
  either. It needs a Cloud Function that runs the OAuth code exchange and mints
  a Firebase custom token. And it must pass the invite gate: a custom-token
  sign-in that creates an account goes through `gateAccountCreation`, which
  admits by **email**, so the function has to request Discord's `email` scope
  and set it on the account before the gate can match a reservation.
- **Source**: T022 planning, 2026-09-23

### T057 — Sign in with a code from the email, instead of approving from the phone
**Category** feature · **Size** M · **Status** blocked · **Verified** 2026-09-24

**On hold by the maintainer (2026-09-24).** Its blocker was a sending domain;
`muninn.quest` is one since 2026-10-07 (T118). Reverse today's cross-device
flow: the email carries a 6-digit code, and the reader types it on the device
that wants to be signed in. The phone then only reads the email and never signs in or runs site code.
The same email can keep the magic link for signing in on the device that opens it.

- **Where**: since 2026-09-29 the flow already runs in this direction, without
  a sending domain: opening the link on the phone shows a 6-digit code
  (`EmailLinkPage.tsx`, which approves through a throwaway sign-in in
  `core/services/firebase/auth/deviceApproval.ts`), and the laptop takes it in
  six boxes (`SignInForm.tsx`, `CodeInput.tsx`) and trades it for a custom token
  (`claimDeviceSignIn`). What is left for this item is putting the code in the
  email itself, so the phone never opens the site: a callable that sends the
  mail, and `claimDeviceSignIn` checking a code made at start instead of at
  approval (keep only a hash, since it would then exist before anyone proved
  the inbox).
- **Blocker**: Firebase's own sign-in email cannot carry a custom code, so the
  function must send the mail itself. The plan is **Resend** (free tier 3,000/month,
  100/day), which needs a domain you own. `muninn.quest` already carries
  Firebase's mail records (SPF `v=spf1 include:_spf.firebasemail.com ~all` and
  two DKIM CNAMEs) and a DMARC record may follow; a domain has only one SPF
  record, so either Resend's include joins that one or Resend sends from its
  own subdomain. Firebase's sign-in mail cannot be reworded: the console's
  Templates list has no sign-in template (2026-10-07), so its own text comes
  with this item. Setup: a sending subdomain with SPF/DKIM/DMARC, region
  `eu-west-1`, **open and click tracking off** (click tracking rewrites the magic
  link), a sending-only API key in Secret Manager as `RESEND_API_KEY`. The email
  can carry the link too, built with the Admin SDK's `generateSignInWithEmailLink`.
  `contact.ts:60` already sends through Gmail via nodemailer, but Gmail's
  daily limits make it a poor fit for sign-in mail.
- **Catch**: issue tokens only for accounts that already exist. The repo
  disagrees about whether a custom-token sign-in that *creates* an account
  passes `gateAccountCreation`: `claimDeviceSignIn.ts:35` says it goes around
  it, T054 says it goes through. **Unverified.** Either way, never minting for
  a missing uid is safe. Also: give the same answer whether or not the address
  has an account, and require App Check on the send callable (it can mail any address).
- **Cost**: estimated (not measured) at about 4 emails per active user per
  month. Resend is free at today's size and about $20/month into the
  thousands; Amazon SES is the cheapest at tens of thousands of users. Keep
  the provider behind one send function so switching changes only that. Firebase
  Auth costs the same in either design (free up to 50k monthly active users).
- **Rollback**: the current approve-from-the-phone flow keeps working without
  any of this, so it stays the fallback.
- **Source**: maintainer, 2026-09-24

### T111 — Is it worth expanding the notes feature?
**Category** feature · **Size** L · **Status** needs scoping · **Verified** 2026-10-06

The maintainer asks whether notes should grow: several areas per person, quicker
ways to add things, and maybe drawing for rough drafts. Flagged as **not
important**.

**Kept for later, not now** (maintainer, 2026-10-06). Do not scope it until asked.

- **Measured**: a note today is a title, one plain-text body
  (`NoteEditor.tsx:629`, a growing textarea), tags and an active/archived
  status. It is private to its author (`groups/{g}/users/{u}/notes`), and its
  links to campaign records come from AI extraction (`CampaignLinksPanel`). Quick
  add (`shared/components/quick-add/quickAddEntity.ts:24`) creates NPCs,
  quests and locations, not notes. There is no drawing anywhere in the app.
- **Questions before sizing**: what "areas" means (notebooks, sections in one
  note, per-session pages?); whether quick add should create a note or add a line
  to an existing one; whether a drawing is stored as an image (Storage, which
  has its own quota and orphan sweep) or as vector data in Firestore.
- **Sharing a note** with the group or a campaign's members (added from
  todo.txt, 2026-10-10, low priority). Notes are owner-only on purpose
  (`firestore.rules.prod:648`, after a hole that let the whole group read
  them), and that rule's comment already says how sharing should work: copy or
  publish the note into a campaign-scoped collection rather than widen the
  owner-only rule. Open: a copy (a snapshot) or a live shared note, and to whom:
  the group, or a campaign's players.
- **Related**: `docs/architecture/migration/deep-dive-feature-enhancements.md`
  sketches session templates and collaborative editing for notes (ideas only,
  nothing built).
- **Source**: todo.txt, 2026-10-06; sharing, todo.txt, 2026-10-10

### T163 — Private people, places, quests and rumours, published later
**Category** feature · **Size** L · **Status** open · **Verified** 2026-10-31

A player who plays a one-to-one session with the DM wants to record what
happened there (a person met, a place found, a quest or rumour picked up)
without the rest of the group seeing it, and to publish it to everyone later.

- **Decided** (maintainer, 2026-10-31): private means **the author alone**;
  sharing with chosen players is out until someone asks for it. Only the author
  publishes. **Publishing cannot be undone**; deleting the record stays the way
  out. Every way of adding one of the four kinds gets a "Private" checkbox:
  quick add (`shared/components/quick-add/`), the create forms, and the "Add"
  on an extraction's suggestions (extraction itself creates nothing). Pictures
  on private records are wanted if they are not too costly (below).
  Rumours: a private rumour cannot be combined with a shared one; private
  rumours combine into a private rumour (`RumorContext.tsx`, `combineRumors`).
  Converting to a quest (`convertToQuest`) follows the same rule: private
  rumours convert into a private quest, and **private and shared rumours are
  never mixed**, in either action (maintainer: too complex for now; revisit
  only if someone asks). A conversion deletes nothing but writes into every
  rumour: `convertedToQuestId` and a note "Converted to quest: {id}"
  (`RumorContext.tsx:368`), which the rumour list shows as a mark
  (`RumorRowView.tsx:60`) and the quest's page reads back
  (`QuestDetailPage.tsx:267`). Both name the quest, and the id is its title's
  slug; "Combined into rumour: {id}" on a combined rumour's sources, and
  "Combined from rumours: {ids}" on the combined one, do the same. So
  **records joined by a conversion or a combine publish together**
  (maintainer, 2026-10-31): publishing any of them publishes the whole chain,
  followed both ways (a combined rumour later converted brings its sources and
  the quest), in one transaction, with marks and notes as they are. A
  confirmation names every record that goes before anything is written. One
  of them cannot be published alone; holding the marks and notes back
  instead was weighed and left for a request. Ordinary links do not group
  records: they are held (below). **Chapters get no private option**; maybe
  one day, but no case for it today.
- **Measured**: every campaign record is readable by any group member
  (`firestore.rules.prod:836`), and each list is one listener on the whole
  collection with no query constraints (`shared/hooks/useCampaignCollection.ts:32`,
  through `DocumentService.subscribeToCollection`, `:627`). Rules do not filter
  a query, so a "private" field on today's documents hides nothing: either the
  read rule and every listener change together, or private records live
  somewhere else (as notes do, under `groups/{g}/users/{u}/notes`, `:698`).
- **Design: a private space, moved on publish.** Private records live under
  `groups/{g}/users/{u}/private/{campaignId}/{npcs|locations|quests|rumors}/{id}`,
  owner-only like notes, with their notes beneath them. The shared rules and
  listeners stay as they are; each list adds a listener on the author's own
  private records and merges them, marked private, on screen. Publishing is
  one client transaction: create the shared record **under the same id** (the
  existing create rule checks it, so `createdAt` becomes the publish time),
  recreate its notes under it (`existsAfter` allows that in the same commit),
  write its held links (next point) onto their owners, delete the private copy.
  One-way publishing is what makes a move sound: moving back would take other
  players' notes into a space they cannot read, and their devices' offline
  caches would keep the record anyway.
  A visibility field on today's records (the other way) was weighed and
  dropped: it changes every list read and the busiest rule, needs every
  record migrated first and two PRs in deploy order. It is the better design
  only for sharing with chosen players.
- **Links.** Each link is stored once, on its owner
  (`campaign-entities/shared/links.ts:12-22`), so a private person linked to a
  shared quest would put that person's id in the quest everyone reads, and
  writes keep ids the writer cannot see (`linkActions.ts:61`). So a link whose
  owner is shared is **held on the private record** and written to the owner
  on publish. Publishing one of two linked private records moves the link the
  other way: out of the published owner, into the one still private.
- **Places.** A private place may sit under a shared one; a shared place may
  not sit under a private one, so publishing a place whose parent is still
  private publishes the parent first or is refused. A shared parent deleted
  by someone who cannot see a private child (`firestore.rules.prod:423`)
  leaves that child top-level for its author.
- **Deletion.** Leaving the group and account deletion take the private space
  with the group profile (`deleteUserSubtree.ts`, a `recursiveDelete`).
  Campaign deletion needs a line per member beside the notes it already
  deletes (`campaignDeletion.ts:71`). T158 is what a missed cascade costs.
- **Pictures, the costly part.** Storage lets any member read a record's
  picture (`storage.rules.prod:85`), so a private one needs an owner-only path
  (`groups/{g}/users/{u}/campaigns/{c}/…`), and publishing needs the file at
  the shared path. The client cannot copy it cheaply: no CORS setup is in the
  repo, so it would have to download and re-upload. A small callable would copy
  it server-side and record a `pendingUploads` entry for the new path, so the
  publish transaction passes `imageLeased` unchanged. The sweep already finds
  private records' pictures (`collectionGroup("npcs")`,
  `sweepOrphanedImages.ts:128`) but must learn the new path (`IMAGE_PATH`,
  `:18`), and account and campaign deletion must delete that prefix (account
  deletion deletes no files today). Doable, but a stacked PR of its own,
  after private records without pictures; a new callable needs a suite and
  the operator approval after merge.
- **Ids are slugs of the name** (`core/utils/entity-id.ts`: "Odile Marrow" is
  `odile-marrow`), so a private id names its record: one more reason no
  shared document may hold it. A private record takes a slug free in both
  the shared list and the author's private list. A player who cannot see it
  can still take that slug for a shared record before it is published, so the
  publish transaction creates only if absent (`createDocumentIfAbsent`). When
  the slug is taken, the published record gets the next free one (`-2`, as on
  any collision), and the same transaction rewrites the old id in the
  author's private records and held links, and in the marks and notes of the
  records published with it. All of those are the author's own,
  so nothing another player wrote needs changing; only the record's URL does.
- **"Already exists"** (maintainer, 2026-10-31), for all four kinds. Today a
  second shared "Grog" is created without a word as `grog-2`
  (`createWithUniqueEntityId`, used by the four contexts); no create path
  warns. So creating or publishing a record whose name matches one already
  shared (case and punctuation ignored, `normalizeTextForComparison`) stops
  at a dialog: "A Grog already exists", a link to open it, and three actions.
  **Add what you know to it**: lists (links, affiliations, objectives) are
  joined, fields it leaves empty are filled, a field both fill differently
  goes into a note signed by the writer, the newcomer's notes move under
  it, and nothing the existing record holds is overwritten; the dialog lists
  what will be added first. **Create (or publish) as someone else**: a name
  field, prefilled; keeping the name is allowed and gives `-2`, on purpose.
  **Cancel**. It covers quick add, the create forms, an extraction's "Add",
  and the titles a combine and a conversion give. The client checks against
  the list it holds; a write refused because the id was taken a moment ago
  opens the same dialog instead of falling to `-2`. Creating a *private*
  record whose name is shared offers opening it or going ahead, not adding
  to it, which would publish. In a publish-together group, each colliding
  record gets its own answer; adding one to an existing record points the
  group's marks at it, through the id rewrite above.
- **Quests get notes** (maintainer, 2026-10-31), like the other three kinds,
  so the merge works the same for all four and the kinds share one logic.
  Today `hasNotes` (`firestore.rules.prod:461`) covers people, places and
  rumours only. The pieces are there: `shared/recordNotes.ts` holds a
  record's notes as documents (`{kind}/{id}/notes`, T133), and the NPC
  context adds and deletes them through it (`NPCContext.tsx:173`). Quests
  need `quests` in `hasNotes` (a note's text is `text`, as a person's), the
  quest context's add and delete, and a notes section on the quest's page.
  The rule only widens, and a merge deploys rules before Hosting, so it
  ships in one PR.
- **Order**: four PRs, stacked. (1) Notes on quests. (2) "Already exists"
  for shared records, which helps without privacy and builds the merge the
  publish reuses. (3) Private records: the private space, the checkbox,
  listeners, publish with its groups, held links and id rewrite. (4) Private
  pictures.
- **Related**: T111's "sharing a note" is the same move for notes.
- **Source**: todo.txt, 2026-10-31; scoped with the maintainer, 2026-10-31

---

## Questions

### T147 — Should `colour-schema.json` leave `docs/design/`?
**Category** question · **Size** S · **Status** open · **Verified** 2026-10-10

The maintainer asks whether the colour schema's JSON belongs somewhere other
than the documentation folder.

- **Measured**: `docs/design/colour-schema.json` (25 KB) is the generated
  output of the contract in `colour-schema.md` beside it, and a test fixture:
  `src/core/themes/__tests__/schema-fixture.test.ts:20` and
  `oklch-oracle.test.ts` read it by a relative path into `docs/`. Nothing in
  the build or the scripts reads it.
- **For staying**: it is the half of a pair, and the `.md` calls the two
  together "the source of truth". It is deliberately kept apart from the code
  it checks (`colour-schema.md` §9: an implementation PR never edits either).
- **For moving**: jest reaching into `docs/` is unusual, and a docs folder is
  where people expect to edit freely.
- **Catch**: a move edits `colour-schema.md`, which §9 says no implementation
  PR touches, so the maintainer would make or approve that change.
- **Source**: todo.txt, 2026-10-10

### T148 — Does the theme belong in Firestore?
**Category** question · **Size** S · **Status** open · **Verified** 2026-10-10

The maintainer asks whether storing the theme on the account is necessary.

- **Measured**: picking a theme applies it at once and saves it in the browser
  (`ThemeContext.tsx:73`, key `medieval-companion-theme`), then, signed in,
  writes `users/{uid}.preferences.theme` (`useAccountTheme.ts:54`). At sign-in
  the account's theme wins over the browser's (`SessionManager.tsx:35`). Users
  who have none get the old per-membership theme copied up once
  (`SessionManager.tsx:89`). The rules allow `preferences` among the fields a
  user may change (`firestore.rules.prod:585`).
- **What it buys**: the theme follows the person to a new device or browser.
  There are two themes, light and dark; the default is light, and the system's
  dark-mode setting is not consulted.
- **If the answer is no**: the browser's key alone; the account write, the
  membership migration and their tests go; `preferences` stays in the rules
  until stored values are cleared or ignored.
- **Source**: todo.txt, 2026-10-10

---

## Dormant — only live if `theme-contract` happens

`theme-contract` (a theme system to share across projects) is **deferred
indefinitely** (the rollout plan's Phase 13, and the drift log's `D`/`Q` entries cited
below, are in git history at `9810644` under `docs/design/plan/`). These four were
all filed "decide before package extraction". None blocks this repository.

Do not answer them speculatively. Designing a package against a consumer that
does not exist is precisely the failure `D2` was written to avoid.

- **`Q1`** — entity palette as index-suffixed variables or one joined value?
  (Settled for the app by `D25`; the package question is what shape a manifest
  can assert over an ordered collection.)
- **`Q2`** — does the package validate enum token *values*, or only that the
  variables exist? The app already does the stronger thing (`D103`, for `scheme`),
  so this is whether the package inherits it.
- **`Q3`** — does the precedence lint (no resting background in a state class)
  live in the app or the package?
- **`Q19`** — can an ordered collection have named siblings? Recast since it was
  filed: its original instance, the knowledge ladder, was deleted in `D121`. But
  the model now spells "ordered collection" **two ways** — `valence` is a
  numeric-keyed record `{0,1,2,3}` and `entityPalette` is a `string[]`. A package
  cannot carry both.

The only existing artifact is branch `codex/theme-contract-poc-20260902`, cut
before Phase 6: two flat tokens, medieval alive, `status-*` classes. All three
are now wrong. It is a record that the idea was tried, not a starting point.
