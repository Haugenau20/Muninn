# TODO

The project backlog. Everything outstanding lives here, in one shape, verified
against the tree rather than remembered.

## Priority overview

Triaged 2026-09-23 from each entry's summary alone. Nothing was re-checked
against the tree for this, so a priority is a judgement, not a measurement.
**Update this table whenever an entry is filed, closed or re-sized.**

**Priority** · `critical` a security or data-loss hole, do next · `high`
users are locked out of something or losing function · `medium` real user
friction, or a prerequisite for something that is · `low` worth doing, no one
is hurt while it waits · `nit` bookkeeping or polish

**Maintainer's focus** (2026-09-24): everything touching Firebase Storage and images
on the site is `high`, ahead of anything that would otherwise rank there.

| Priority | ID | Item | Size | Status | Why this priority |
|---|---|---|---|---|---|
| medium | T139 | CI signs in to Google Cloud with long-lived keys | M | open | A leaked key deploys code that reads every group, and a PR's dependencies run beside the Hosting key |
| medium | T141 | The site's contact address is a Gmail account | M | open | Players see a Gmail address on replies and on Google's consent screen; the maintainer wants it soon |
| medium | T146 | The functions run as an Editor of the whole project | M | open | Any code deployed as a function, by CI's key (T139) or a poisoned dependency, reaches every resource in the project |
| low | T123 | Lord of the Rings screenshots in the README? | M | open | A question for the maintainer; the public home page's *Sunless Citadel* example raises the same question |
| low | T137 | An operator page: founder links, extraction limits, metrics | L | open | The script and the console work meanwhile; design approved 2026-10-08 (`docs/architecture/operator/`), steps 1 to 4a done; 4b waits on step 0 |
| low | T075 | The header is crowded | M | needs scoping | Waits on the maintainer: which truncation was meant, and how much room the header gets back |
| low | T054 | Sign in with Discord | L | needs scoping | Kept for later, not now (2026-10-02); Firebase has no built-in provider |
| low | T057 | Sign in with a code from the email | M | blocked | On hold by the maintainer; its sending domain exists now (`muninn.quest`); the current phone-approval flow works |
| low | T055 | Opt-in second factor | M | needs scoping | Kept for later, not now (2026-10-02); prefer an authenticator app over SMS |
| low | T118 | Finish the move to `muninn.quest` | S | open | Everything runs on `muninn.quest`; left: Google's branding check, and two cosmetic leftovers |
| low | T134 | The saga in sections | M | blocked | The saga is one document that will hit 1 MiB; how a sectioned saga is edited is the maintainer's call |
| low | T135 | The index file matches production | S | blocked | Waits on the maintainer reading production's indexes; cheap once they have |
| low | T136 | One membership document | L | open | Correct today; only removes a way for two copies to disagree |
| low | T116 | `firebase-admin` 13 → 14 in the functions | M | blocked | 14 would not clear the last advisory (`uuid`, via Storage), and the functions' jest cannot load its ES-module dependencies |
| low | T111 | Is it worth expanding the notes feature? | L | needs scoping | Kept for later, not now (2026-10-06) |
| low | T142 | One English in the site's copy, British | M | open | Later, not now (2026-10-10); few spellings differ today, dates follow the browser in places |
| low | T143 | The About page's coffee link and photo | S | blocked | Both built and switched off; wait on a link and a picture from the maintainer |
| low | T145 | Retire invitation links stored under their tokens | S | open | Nothing to wait for: no founder links exist and the one old group invitation may stop working (maintainer, 2026-10-11); only removes code |
| low | T149 | Both Hosting sites keep every release | S | open | About 220 MB of old releases, growing with every merge; a console setting, no one is hurt meanwhile |
| low | T148 | Does the theme belong in Firestore? | S | open | A question for the maintainer; the current design works |
| nit | T147 | Should `colour-schema.json` leave `docs/design/`? | S | open | A question for the maintainer; nothing is wrong where it is |

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

## What phase 15 learned

Recorded here because `15-0` retired the drift log and `15-8` asks for it. Three
things, all of which cost something.

**A green suite says nothing about the browser, and this phase proved it five
times.** Raw ids in `15-2`, a disclosure that never hid in `15-3`, an accessible
name polluted by a pending indicator, and then the two `15-7` found in ten
minutes of the running app: every write flashed the page to a skeleton and
unmounted what was on it, and the row's controls measured 32px
against a 44px rule. All five were invisible to jsdom by construction — no CSS,
no real auth lifecycle, no pointer. The pages built without a browser pass
(`15-4`, `15-5`, `15-6`) shipped the skeleton defect three times because nobody
could see it.

**And a browser pass that only visits its own PR is not enough either.** The
two defects the user reported the day `15-8` opened were both of this kind:
the skeleton unmount was patched at the four call sites `15-7` happened to
touch and left live on the three index pages, and `15-4`'s location tree
became unopenable only once `15-4` itself gave every row something to open
into. Each PR verified what it changed; neither verified what its change now
implied elsewhere. A third defect — the NPC list showing the old stance after
a write — was sitting in the same three pages and had never been reported at
all. It turned out to be a second loader, and closing it took a rewrite one
directory over rather than the small patch it was filed as.

**A comment claiming a gate exists is worse than no gate.**
`location-presentation.ts` said `ladder-classes.test.ts` caught theme classes
passed as data. That file did not exist; `15-6` wrote it, and its first run
found a live instance the comment had been covering for. Claims about coverage
are checkable — check them.

**The tracker can describe an intention as if it were the code.** The entry for
the rumour bar's hatch said confirmed and disproved rumours "sit on the same ramp stop — correct", and the
code had them two stops apart, with the disproved rumour in the red a failed
quest wears. The comment above the map said the right thing too. Three
documents agreed with each other and none of them agreed with the product.

---

## Bugs

Bugs the behavioural suites find live in `docs/testing/bug-tracking/README.md`.

---

## Features and enhancements

### T054 — Sign in with Discord
**Type** feature · **Size** L · **Status** needs scoping · **Verified** 2026-09-23

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

### T055 — Opt-in second factor
**Type** feature · **Size** M · **Status** needs scoping · **Verified** 2026-09-23

Let a user who wants it add a second step to sign-in.

**Kept for later, not now** (maintainer, 2026-10-02). Do not scope it until asked.

- **Where**: Identity Platform (already enabled) supports TOTP authenticator
  apps and SMS. Enrolment would sit on the profile's `AccountCard`.
- **Catch**: **prefer TOTP.** SMS is billed per message sent, and a public SMS
  step invites SMS-pumping fraud unless the allowed regions are restricted.
  Check first that Firebase MFA applies to email-link sign-in at all -- it was
  not confirmed during T022.
- **Source**: maintainer, 2026-09-23

### T057 — Sign in with a code from the email, instead of approving from the phone
**Type** feature · **Size** M · **Status** blocked · **Verified** 2026-09-24

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

### T075 — The header is crowded
**Type** feature · **Size** M · **Status** needs scoping · **Verified** 2026-10-10

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

### T111 — Is it worth expanding the notes feature?
**Type** feature · **Size** L · **Status** needs scoping · **Verified** 2026-10-06

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

### T137 — An operator page: founder links, extraction limits, metrics
**Type** feature · **Size** L · **Status** open · **Verified** 2026-10-09

One web page for operator work, usable from a phone: issue and revoke founder
links, and set one person's extraction allowance (their own, since they pay for
OpenAI, or a player's who asks). Health and traffic figures are phase 2.

- **Design** (approved by the maintainer 2026-10-08, with every default
  decision kept):
  [`docs/architecture/operator/`](docs/architecture/operator/design.md): a
  design, a security architecture, and a plan in steps 0 to 8. Decided: its own
  Cloud Run service behind Google's Identity-Aware Proxy, outside the app and its
  sign-in; code in this repository; security over setup effort.
- **Done**: steps 1 and 2. `users/{uid}.extractionAllowance` sets all three
  limits; the old `customLimit` (daily only) and `isUnlimited` still apply
  where no allowance does, until step 7 retires them. The operator actions
  exist in `functions/src/operator/`, exported by nothing; founder links now
  record `issuedBy` and share a budget of 10 a day with the script. Step 3:
  the service (`functions/src/operator/http/`) runs locally with
  `npm run operator:dev` in `firebase/functions` (port 4700, against the dev
  emulators), behind the same identity check it will run with under IAP; its
  container files (`firebase/functions/operator/`) are first built in step 5.
- **Step 0** (maintainer): the project moves into a `muninn.quest`
  organization (Cloud Identity Free, decided 2026-10-08), so IAP uses Google's
  own OAuth client; then the operator account, in that organization. The
  steps are in the plan's step 0. Under way: the organization exists, and
  the super admin and the operator account both sign in with passkeys
  (2026-10-09). Waiting for two hardware keys; then the strict 2-Step
  Verification, then the move.
- **Step 4a**: `firebase/functions/operator/infra/setup.sh` and its runbook
  (`README.md` beside it). Its `--check` ran read-only against the live
  project on 2026-10-10: everything missing, as expected before the move.
- **Next**: step 4b, the maintainer running it, once step 0 is finished;
  then step 5, the pipeline.
- **Source**: todo.txt, 2026-10-08 (two inbox items, combined)

### T143 — The About page's coffee link and photo
**Type** feature · **Size** S · **Status** blocked · **Verified** 2026-10-10

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

### T145 — Retire invitation links stored under their tokens
**Type** debt · **Size** S · **Status** open · **Verified** 2026-10-11

Every invitation is now made by a function and stored under its token's
SHA-256 (`firebase/functions/src/shared/invitationToken.ts`), and the rules
let no browser create one. Links made before that sit under the token itself,
carry no `scheme`, and are still honoured.

- **The legacy paths**: `pickInvitation`'s second branch, the client's
  `validateRegistrationToken`, `revealInvitation`'s branch for an invitation
  with no `scheme`, and the `token` field `findLiveReservation` falls back to.
- **What is left** (maintainer, 2026-10-11): no founder link was ever
  issued, so `founderInvitations` holds none. One group invitation made before
  T145 is still out, and the maintainer does not mind it stopping working. No
  audit script is needed.
- **Fix**: the maintainer revokes that invitation (Admin → People → Revoke)
  before the change merges, so no document without a `scheme` is left behind;
  then drop the four paths, each with a test that an old-format link is now
  refused.
- **Source**: the operator page's plan, filed when step 4a was picked up, 2026-10-10

### T146 — The functions run as an Editor of the whole project
**Type** debt · **Size** M · **Status** open · **Verified** 2026-10-10

No function sets `serviceAccount` (`firebase/functions/src`), so all of them
run as the default compute account, and that account holds `roles/editor` on
the project, as does the App Engine default account (read from the project's
IAM policy, 2026-10-10). Whatever code runs as a function can therefore change
almost anything in the project, not only the Firestore and Auth the functions
need.

- **Why it matters**: the functions' deploy key (T139) and any poisoned
  dependency in `firebase/functions` reach that far. The operator page's
  security architecture names it as residual risk 5.
- **Fix**: a service account of their own, with the roles the functions use
  (Firestore, Auth admin for sign-up and account deletion, Storage for the
  image sweeps, Secret Manager for the contact form and OpenAI keys, token
  creation for device sign-in), set through `setGlobalOptions`; then take
  Editor from the default accounts.
- **Catch**: the exact list must come from the code and a deploy to a test, not
  from memory; a missing role fails a function only when it is called. The
  device sign-in grant (CLAUDE.md, Service Account Token Creator) moves with
  it. Removing Editor from the defaults may touch other Google services that
  rely on it; check before.
- **Source**: the operator page's plan, filed when step 4a was picked up, 2026-10-10

---

## Tech debt and platform

### T116 — `firebase-admin` 13 → 14 in the functions
**Type** debt · **Size** M · **Status** blocked · **Verified** 2026-10-06

The functions run `firebase-functions` 7 on `firebase-admin` 13, through the
modular API only, so the code itself is ready for 14. Two things hold the bump.

- **It clears nothing yet.** The one advisory left, `uuid` below 11.1.1
  (bounds check in v3/v5/v6 with a buffer; nothing here calls those), stays on
  14: it arrives through `@google-cloud/storage` 8.2.0 → `gaxios` 6.7.1, which
  pins `uuid` ^9, and 8.2.0 was the latest on 2026-10-06. Wait for a Storage
  release on `gaxios` 7.
- **The functions' jest cannot load 14's dependencies** (tried 2026-10-06; Node
  22 itself loads them fine). `jwks-rsa` 4 `require()`s `jose` 6, which is ES
  modules only: every suite that imports Auth fails to run, and transpiling
  `jose` through ts-jest fixes that. But `teeny-request` (under Storage) loads
  `node-fetch` 3 with a dynamic `import()`, which jest allows only under
  `--experimental-vm-modules` -- and with that flag jest treats `jose` as ESM
  again, so the 91 tests that touch Storage fail one way or the other. The way
  through is a jest that loads real ES modules, or transpiling that whole chain.
- **Source**: todo.txt (`npm ci` warnings), 2026-10-06; `firebase-functions` 7,
  `firebase-admin` 13 and the modular API landed first

### T118 — Finish the move to `muninn.quest`
**Type** debt · **Size** S · **Status** open · **Verified** 2026-10-07

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
anyway. What is left:

- **Google's branding check** (maintainer): Google's sign-in window shows the
  name "Muninn" only once Google verifies the consent screen's branding. Search
  Console verified `muninn.quest` on 2026-10-07; retry no earlier than 24 hours
  later. A first check, run while `muninn.quest` served nothing, listed nine
  issues. Besides the unreachable pages, several fit a checker that does not run
  JavaScript, since every path serves the same `index.html`: the privacy page
  "the same as the home page", "insufficient content", "home page behind a
  login", "does not explain the purpose". If they recur with the site live,
  serve real HTML for `/` and `/privacy`. The consent screen's support address,
  `dndcampaigncompanion@gmail.com`, is shown to users once verified.
- **Cosmetic**: Google Cloud holds two OAuth web clients, one left over from
  switching the Google provider off and on; the one Firebase does not name
  (Authentication → Sign-in method → Google) can go, with a Google sign-in
  tried straight after.
- **Source**: todo.txt, 2026-10-06; the site, sign-in, mail, redirect and repo
  moved 2026-10-07

### Restructuring Firestore before the site scales (T134 to T136)

Decided by the maintainer on 2026-10-08: **R2**, Firestore restructured; the
site stays on Firebase. Why, and the routes set aside, are in
[`docs/architecture/backend-structure-options.md`](docs/architecture/backend-structure-options.md);
the findings (F1 to F9), the seven changes and the answers to the review's
questions are in
[`docs/architecture/data-model-review.md`](docs/architecture/data-model-review.md).
Both must land before any user scaling (maintainer, 2026-10-07).

**How every data change ships.** Production holds real campaigns, so each data
change is a script in `firebase/functions/scripts/` in the shape of
`audit-location-ids.js`: read-only by default, `--apply` to write, `--revert`
from a saved manifest, run by the maintainer with their own gcloud login. A
field that moves or is renamed ships in steps: the frontend reads both shapes;
the script rewrites; a later frontend drops the old shape; only then, in its own
merge, a rule refuses it. The review's read-only production checks (campaign
sizes, how often a link's two halves disagree) go into each change's audit.

### T134 — The saga in sections
**Type** debt · **Size** M · **Status** blocked · **Verified** 2026-10-09

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

### T135 — The index file matches production
**Type** debt · **Size** S · **Status** blocked · **Verified** 2026-10-08

`firebase/firestore.indexes.json` declares 20 composite indexes for queries the
client never makes, and the deploy leaves it out (`--only
firestore:rules,storage`, `firebase-hosting-merge.yml`). What production has is
unknown; unused indexes cost storage and write time (F8).

- **Blocked on the maintainer**: `npx firebase firestore:indexes --project
  dnd-campaign-companion` from `firebase/`, output pasted. Then the file says
  exactly what is needed (probably nothing until paging brings `orderBy`), and
  whether the deploy includes it is decided.
- **Source**: `data-model-review.md` change 6 (F8)

### T136 — One membership document
**Type** debt · **Size** L · **Status** open · **Verified** 2026-10-08

Membership is stored twice: `users/{uid}.groups` (what every rule reads, so each
check reads the whole global profile) and `groups/{g}/users/{uid}` (the roster,
with the role). Only functions write either, so they agree while every function
is correct, and once they did not (F7).

- **Change**: `groups/{g}/members/{uid}` with the role, checked with
  `exists()`; copy first, then switch the rules, in separate merges.
- **Not urgent**: correct today.
- **Source**: `data-model-review.md` change 7 (F7)

### T139 — CI signs in to Google Cloud with long-lived keys
**Type** debt · **Size** M · **Status** open · **Verified** 2026-10-08

Every Google Cloud sign-in in CI is a service-account JSON key kept as a
GitHub secret. A key never expires on its own, and whoever reads one holds that
account's roles from anywhere. Keyless Workload Identity Federation, restricted
to this repository by id and to the workflow and branch, removes them.

- **Where**: `FIREBASE_FUNCTIONS_DEPLOY_SA` (functions and rules,
  `firebase-hosting-merge.yml:43` and `:95`); `FIREBASE_SERVICE_ACCOUNT_DND_CAMPAIGN_COMPANION`
  (Hosting, `:141`; PR previews, `firebase-hosting-pull-request.yml:58`;
  channel cleanup, `firebase-hosting-pull-request-cleanup.yml:45`).
- **Catch**: the preview job runs an unmerged branch's `npm ci` and build
  (`firebase-hosting-pull-request.yml:26-31`) on the runner that then holds the
  Hosting key, so a poisoned dependency in a PR can wait for that step and take it.
  `FirebaseExtended/action-hosting-deploy` takes only a JSON key (its README:
  `firebaseServiceAccount` "required", "a service account JSON key"), so those
  steps move to the CLI under `google-github-actions/auth`; unverified whether
  the action accepts anything else.
- **Then**: delete both keys in the console once nothing uses them.
- **Source**: found while designing T137's operator deploy, which uses
  Workload Identity Federation from the start, 2026-10-08

### T141 — The site's contact address is a Gmail account, not `muninn.quest`
**Type** debt · **Size** M · **Status** open · **Verified** 2026-10-08

Players who write through the contact form get replies from the project's
Gmail account, and Google's consent screen names it as the support address.
The maintainer wants a `muninn.quest` address instead. The domain only
receives mail (Porkbun forwards `admin@` and `operator@`, since 2026-10-08,
for T137 step 0); it cannot send yet.

- **Where**: `sendContactEmail` (`firebase/functions/src/contact.ts:67`)
  sends through nodemailer's `gmail` service, from and to `CONTACT_EMAIL`,
  reply-to the sender (`:342-344`); the address and its password are secrets
  (`:270`), not in the repo. The consent screen's support address is in T118.
- **Address unverified**: the maintainer gave `dnd-campaign-companion@gmail.com`,
  T118 records `dndcampaigncompanion@gmail.com`; Gmail allows no hyphens, so
  likely the latter. Other places it shows (Firebase's public-facing support
  email, the Auth templates' reply-to) are unchecked.
- **Catch**: a mail host must be chosen (Porkbun's mail, Google Workspace on
  the `muninn.quest` organization, Zoho, ...), and the apex SPF record has a
  10-lookup budget: Firebase's include takes 4, Porkbun's 6 (it sat at exactly
  10 until removed 2026-10-08), Google Workspace's 1. Add DKIM and DMARC with
  it; the domain has no DMARC record. T057's Resend would send from a
  subdomain, outside this budget. The privacy page names no processor for
  contact mail today (`PrivacyPolicyPage.tsx:318`), Gmail included.
- **Source**: maintainer, 2026-10-08, during T137 step 0

### T142 — One English in the site's copy, British
**Type** debt · **Size** M · **Status** open · **Verified** 2026-10-10

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

### T149 — Both Hosting sites keep every release
**Type** debt · **Size** S · **Status** open · **Verified** 2026-10-11

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

## Decisions

Open questions that block work until the maintainer answers them.

### T123 — Are Lord of the Rings screenshots in the README a problem?
**Type** decision · **Size** M · **Status** open · **Verified** 2026-10-08

The README's pictures show a Tolkien campaign. Is that a rights or trademark
risk for a public repo and site? A question for the maintainer, not settled here.

- **Measured**: all four images in `README.md` (`:12`, `:30`, files in
  `docs/images/`) show the sample campaign "The Lord of the Rings" with its names
  (Gandalf, Aragorn, Mordor, "destroy the One Ring"). They come from the dev
  sample data, which is Tolkien throughout (`utils/__dev__/generators/`). The home
  screenshot's banner painting and crest were uploaded images; where they came
  from was **not** traced.
- **Same question, on the live site**: the public signed-out home shows Wizards
  of the Coast's published adventure *The Sunless Citadel*, with its NPC and places
  (`pages/home/signed-out-example.ts:46`). T075's 2026-10-03 decision covered
  only the words "D&D".
- **If the answer is yes**: invented sample data, new screenshots, and a new
  example on the home page. That is the M.
- **Source**: todo.txt, 2026-10-08

### T147 — Should `colour-schema.json` leave `docs/design/`?
**Type** decision · **Size** S · **Status** open · **Verified** 2026-10-10

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
**Type** decision · **Size** S · **Status** open · **Verified** 2026-10-10

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
