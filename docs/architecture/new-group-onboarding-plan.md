# Plan: how a new group starts on its own (T120)

Written 2026-10-07 against `main` at `b78d72f`. The maintainer decided on it on 2026-10-08
([Answers](#answers-maintainer-2026-10-08)). Shipped: founder invitations (step 1, with step 6's
`/privacy`), the guarded `createGroup` with App Check (step 2), step 5's persistent cache and
D3's lower limits, step 3's first run (`/join?founder=…`) and step 4's caps (10 members and 5
campaigns per group, 300 accounts, counted). Every step of the [build order](#build-order) has
shipped.

**The question.** Suppose the site were sent tomorrow to 30 groups that have never used it. Can they
sign up, create a group and start playing without the maintainer? **No.** This plan covers what is
missing, the decisions that need the maintainer, and the order to build it in. Invitations into a
group that already exists are out of scope; they work.

**How this was measured.** Read in the code unless marked *run*. *Run* means the dev app in Chrome,
signed in as the seeded `player9@example.com`, who is in no group.

---

## Where things stand

### What a stranger meets, step by step

1. **They cannot get an account.** The sign-up gate (`gateAccountCreation.ts:69`) admits only an
   email that holds a reservation. Only `reserveSignUp` makes one, and only for a valid invitation
   **into an existing group** (`signUpGate.ts`, `reserveSignUp.ts:44`). There is no other way in.
2. **Even with invitations, the project holds 20 accounts in total** (`signUpGate.ts:23`, checked
   at `gateAccountCreation.ts:78` through `getAuth().listUsers(20)`). Thirty groups of five need
   about 150.
3. **A signed-in player with no group can do nothing but wait** (*run*). Home says "Join a group:
   ask whoever set up your campaign for a join link", with one button, "I have an invite link"
   (`GatedPageState.tsx:107,122,203`). `/admin/group`, the only page with a "create group" form,
   answers "No group selected. Administration belongs to a group. Choose one from the group
   switcher" (`AdminLayout.tsx:134`). There is nothing to choose.
4. **If they could reach it, `createGroup` would let them make any number of groups.** It accepts
   any signed-in caller, with no limit, no throttle and no App Check (`createGroup.ts:27`; no
   callable in `firebase/functions/src` sets `enforceAppCheck`). The creator's group name is read
   from a `username` on the global profile, which no flow writes, so every creator is named
   **"Admin"** (`createGroup.ts:69`; `redeemInvitation.ts` puts the name only on the group
   profile).
5. **A new group has no campaign, and its admin is not told how to make one.** The empty state
   says "Your first campaign will appear here as soon as it's created" (`GatedPageState.tsx:126`)
   and links nowhere. Campaigns are created on `/admin/campaigns`, which the UI shows to admins
   only, although the rules let any member create one (`firestore.rules.prod:620`).
6. **Inviting the players works** (`/admin/people`, a 14-day single-use link per person,
   `registration-token.ts:15`).

Noticed on the way (*run*): the profile page offers a player in no group "Leave this group. You'll
lose access to 0 campaigns in this group", with a **Leave group** button. Not part of this plan; it
should be filed as its own item.

### The only path today

The maintainer creates the group, invites its first player, promotes them (`setMemberRole`) and
leaves (`AdminGroupPage.tsx:279`). Every new group costs the maintainer a sitting. It uses up the
account cap, and the maintainer can read the group until they leave.

---

## What "on its own" has to mean

A founder (the first person of a new table) can, without the maintainer:

1. get an account,
2. create one group, under their own name,
3. create the first campaign,
4. invite their players, who join as today.

And the site must stay safe to run:

- No one can create unbounded accounts, groups or AI spend.
- The maintainer's cost has a ceiling they chose.
- `/privacy` stays true.

---

## Decisions

Each decision comes with options and a recommendation. The recommendations fit together, but each
can be changed on its own.

### D1. Who may start a group?

| Option | What it is | For | Against |
|---|---|---|---|
| **A. Founder invitations** | The maintainer issues a *founder link*. It admits one account that may create one group. | Keeps "accounts are created from an invitation" true (`/privacy`, Security). Growth stays at the maintainer's pace. Every group's cost is bounded by its founder link. | The maintainer hands out each link, which is minutes, not a sitting. |
| B. Request and approve | A visitor asks through a form, and the maintainer approves it to issue a founder link. | Strangers can find their own way in. | It is A plus a queue to build and watch. |
| C. Open sign-up | Anyone can create an account and a group. | No gatekeeper. | Needs every abuse control first (D3, D4). Cost is unbounded until those land. `/privacy` changes. |

**Recommendation: A now.** C becomes possible later, once D3 and D4 are proven in practice. B can
be added on top of A if the maintainer finds the handing-out tedious.

**How A fits the code.** A founder invitation is a server-only document, e.g.
`founderInvitations/{token}`, written by a maintainer-only callable or script. `reserveSignUp`
accepts either kind of token. The reservation records which kind it came from. `createGroup`
spends the founder invitation in the same transaction as the group it creates, much as
`redeemInvitation` spends a group invitation today. A founder who already has an account (someone
who plays in another group) skips the sign-up and only redeems.

### D2. The account cap

The 20-account cap is a backstop against leaked invitations, not a business limit. It cannot
stay at 20 for 30 groups.

**Recommendation.**

- **A cap per group** on members, e.g. 10, enforced in `redeemInvitation`. It bounds what one
  founder link can cost, and a table is rarely larger.
- **A project cap** raised to what the maintainer will pay for (see D3), e.g. 300, kept as a
  backstop.
- **Count accounts with a counter document**, updated by the gate and by `deleteUser`, instead of
  `listUsers`. Today's `listUsers(MAX_ACCOUNTS)` lists up to the cap on every sign-up, which is
  fine at 20 and wasteful at 300 or more. It also counts accounts the gate never admitted (seed
  accounts, ones created with the Admin SDK).

### D3. Cost at scale, and a ceiling

These are estimates, not measurements. Before relying on them, check them against the billing
console after a month of real use.

| Cost | What drives it | Today's bound | At 30 groups × 6 players |
|---|---|---|---|
| AI extraction | `gpt-4.1-mini`: a cached schema of about 1,500 tokens plus a note of up to 10,000 characters (`entityExtraction.ts:32`), so roughly 4,000 tokens in; output assumed at up to 1,000 tokens | 10 calls/day, 30/week, 100/month per user (`entityExtraction.ts:94`) | at most about **$0.30 per user per month**, so **about $54/month** if everyone spends their full quota (an estimate: about $0.003 a call) |
| Firestore reads | whole-collection listeners and no persistent cache (T119 F2) | none | grows with campaign size times page loads. Fixing T119 F2 first is the real control. |
| Storage | pictures, at most 2 MiB each after resizing (`prepare-image.ts:10`) | none per group | small per group; nothing bounds how many |
| Auth | Identity Platform | free up to 50,000 monthly active users (T057's note) | free |
| Sign-in email | Firebase's own sender | per-project daily limits, **not checked** | check before outreach |

**Recommendation.**

- A **project-wide AI budget**: a counter in `entityExtraction` that refuses calls once a monthly
  total is reached, on top of the per-user quota.
- **Billing budget alerts** in the Google Cloud console (console work for the maintainer).
- **T119 F2** (the persistent cache) before outreach, since reads are the cost that has no bound
  today.

### D4. Guarding group creation

**Recommendation**, all in `createGroup`:

- It requires an unspent founder invitation (D1), or a per-account allowance. For example, an
  account that already founded one group may create up to 2 more, for a second table.
- It takes the founder's **name in the group** as an argument, as `redeemInvitation` does, and
  stops naming them "Admin".
- **App Check enforced** (`enforceAppCheck: true`) on `createGroup`, `reserveSignUp` and
  `redeemInvitation`. App Check already guards Auth (`appCheck.ts`), but the callables accept
  calls without it. Check first that the e2e journeys and the emulator still pass App Check, or
  bypass it in the emulator the way the sign-up gate exempts seed accounts.

### D5. The first run

What the founder sees, in order, as one guided flow rather than three admin pages:

1. **Founder link → sign in** (the existing `/join` flow, given the founder token).
2. **Name your group and your name in it.** `createGroup` with both.
3. **Create the first campaign.** The empty state in `GatedPageState` gets a "Create the first
   campaign" button for whoever may create one. Whether every member may, as the rules already
   allow, or admins only, as the UI does today, is the maintainer's call. The recommendation is
   every member: the rules already allow it, and a table without its founder online can still
   start.
4. **Invite your players.** It lands on `/admin/people` with the invite button in front.

### D6. The maintainer's own access

**Answered (maintainer, 2026-10-07):** access to every group is the maintainer's alone, as project
owner, through the console and the Admin SDK. The app grants it to nobody: the global-admin flag
(`users/{uid}.isAdmin`) no longer opens anything in the rules or the functions.

**Recommendation:** issue founder invitations (step 1) with an Admin-SDK script, not a callable
behind a flag.

**Since 2026-10-16 (T137):** the operator page issues and revokes founder links from anywhere,
and sets one person's extraction allowance. It is its own Cloud Run service behind Google's
Identity-Aware Proxy, outside the app and its sign-in; not a callable behind a flag, and it still
opens no group. The script stays, for when the page is unavailable:
[`operator/design.md`](operator/design.md).

---

## Build order

Each step is a future TODO entry, sized as the backlog sizes things. Steps 1 to 3 together are the
smallest change that lets a table start on its own. 4 to 6 make it safe to hand out more than a few
links.

| Step | What | Depends on | Size |
|---|---|---|---|
| 1 | **Founder invitations**: the collection, a maintainer-only way to issue them (an Admin-SDK script like `audit-location-ids.js`), `reserveSignUp` and the gate accepting them | nothing | M |
| 2 | **`createGroup` guarded**: spends a founder invitation or an allowance; takes the founder's name; App Check on the three callables | 1 | M |
| 3 | **The first run**: the group-less home offers "I have a founder link"; the guided flow of D5; the empty-campaign call to action | 2 | M |
| 4 | **Caps and budgets**: a per-group member cap, the account counter, the project cap raised, the project-wide AI budget | 2 | M |
| 5 | **T119 F2's cache** (`persistentLocalCache`) | nothing | S |
| 6 | **`/privacy`** updated for D1 | 1 | S |

Every step that changes a flow lands with its e2e journey (`e2e/`). Step 3's journey runs the whole
path: founder link → group → campaign → invitation → second player joins. Functions changes get
suites in `firebase/functions/test/`, with the control CLAUDE.md asks for.

**Deploy order** follows the pipeline. Step 1's functions deploy before the frontend that offers
founder links. Step 2's App Check enforcement deploys only after a frontend that sends App Check
tokens to those callables. The SDK attaches them once App Check is initialised (`appCheck.ts`),
so the live frontend should already; check it, and the emulator, before merging.

The links outreach carries name `muninn.quest`, where the site has lived since 2026-10-07.

**Rollback.** Founder invitations add a path and remove none, so the manual path keeps working
throughout. Turning the feature off means issuing no more founder links.

---

## Answers (maintainer, 2026-10-08)

Where an answer departs from a recommendation above, the answer wins.

1. **D1**: founder invitations.
2. **D2**: at most **10 members** and **5 campaigns** per group. Membership belongs to the group,
   so every member reads every campaign in it; a second table with other players is a second group
   (see 5), not a larger one. The project cap is raised to **300 accounts**, counted with a counter
   document. 300 is the plan's figure; the maintainer did not object to it, and it can change.
   The campaign cap is new: campaigns are created from the browser under the rules, so it needs a
   per-group counter the rules check, or creation through a callable.
3. **D3**: **no project-wide AI counter.** Instead, the per-user limits drop from 10 / 30 / 100
   (day / week / month, `entityExtraction.ts:94`) to **3 / 5 / 10**, about $0.03 per user per month
   at full use. The ceiling is the OpenAI account itself: prepaid, $5, no automatic top-up. When it
   runs out, OpenAI refuses the call; players see a generic "Failed to extract entities" today and
   should see that extraction is paused. Billing alerts in the Google Cloud console still cover
   Firestore and Storage.
4. **D5**: every member may create a campaign, as the rules already allow.
5. **D6**: answered 2026-10-07 (the maintainer alone); the recommendation is in D6.
6. **Allowance**: a founder may start **up to 3 groups**: the first from the founder link, two
   more without asking.
