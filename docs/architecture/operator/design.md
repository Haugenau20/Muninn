# The operator page: design

**Status** approved by the maintainer, 2026-10-08 · **TODO** T137 · **With** [security architecture](security-architecture.md)
and [implementation plan](implementation-plan.md)

## Purpose

The maintainer runs the site and pays for it, and some of that work has no screen. Founder links
come from a script run under the maintainer's own gcloud login
(`firebase/functions/scripts/issue-founder-invitation.js`). Raising one person's extraction
allowance means editing their profile in the Firebase console, where `customLimit` raises the
daily limit and nothing else (below). The operator page is one web page for that work, usable from
a desk or a phone at the table, and safe to leave running for years.

**Success means:**

1. From any device, the maintainer issues a founder link, sees which links are open, used, expired
   or revoked, and revokes one.
2. They look up an account by its email and set its extraction allowance: limits per period, or
   unlimited, optionally until a date; or put it back to the defaults.
3. Nobody else can do either. A stranger never reaches the page's code, a hole in the app's own
   sign-in grants nothing here, and every action leaves a record the page cannot erase.
4. The page shows no campaign content and opens no group. Access to groups stays the maintainer's
   alone, through the console (onboarding plan, D6).

**Decided (maintainer, 2026-10-08):** hosted and reachable from anywhere, behind Google's
Identity-Aware Proxy (IAP), as its own Cloud Run service; the operator code stays in this
repository; the most secure and longest-lived design wins over setup effort.

## Scope

**Version 1:**

| Area | Actions |
|---|---|
| Founder links | Issue one, with a private note; list them, newest first, paged; revoke an unused one |
| Extraction allowances | Find an account by exact email; see its usage and limits; set limits per period or unlimited, optionally until a date; reset to the defaults |

**Later, with its own design pass:** an overview of counts and health figures
([phase 2](#phase-2-the-overview)).

**Out, on purpose:**

- **Campaign content, group names, member lists.** The page shows an account's email and its
  extraction figures, and nothing of what anyone wrote.
- **Deleting an account.** It cannot be undone, so it stays `scripts/delete-account.js`, run with
  owner credentials. The page holds only actions whose damage is bounded and can be put right
  ([security architecture](security-architecture.md#principles), principle 3).
- **A generic document editor.** That is what made the global admin a key to everything
  (`firestore.rules.prod`, note 15).
- **`audit-location-ids.js`.** A one-off migration, not operator work.

## Architecture

```
 operator's browser: a Google account used for nothing else, signed in with a passkey
      |  HTTPS, https://operator-....europe-west1.run.app
      v
 +------------------------------------+
 | Identity-Aware Proxy, on the       |  Google signs the operator in, checks its access
 | Cloud Run service itself           |  list, asks for the security key again every hour,
 +------------------------------------+  and refuses everyone else before our code runs
      |  x-goog-iap-jwt-assertion: a header Google signs, naming who passed
      v
 +------------------------------------+
 | Cloud Run service `operator`       |  europe-west1, runs as operator-runtime@
 |  1 security headers                |
 |  2 verify the identity, again      |
 |  3 POST: CSRF check                |
 |  4 the action                      |---> Firestore: founderInvitations, users/{uid}
 |  5 one audit line                  |---> Auth: look-up by email, read only
 +------------------------------------+---> Cloud Logging -> locked audit bucket
```

The security reasoning behind each box is in the [security architecture](security-architecture.md).

### Where the code lives

All of it in `firebase/functions`, the package whose functions read what the operator writes:

| Path | What |
|---|---|
| `src/extractionAllowance.ts` | The allowance type and `effectiveLimits()`, used by `entityExtraction.ts` and by the operator |
| `src/extractionUsage.ts` | The usage counters, apart from `entityExtraction.ts` so the operator never loads OpenAI or the callables |
| `src/shared/refusal.ts` | `Refusal`: an action refused for a reason the operator is told, not a failure |
| `src/operator/founderLinks.ts` | Issue, list, revoke; a link is named by its first six characters (its ref) everywhere but at issue |
| `src/operator/accounts.ts` | Look up one account by email: profile, usage, allowance |
| `src/operator/allowances.ts` | Validate, set and clear an allowance |
| `src/operator/audit.ts` | The one function that writes an audit line |
| `src/operator/http/` | Identity check, CSRF, HTML, security headers, routes, the server |
| `src/operator/main.ts` | Production entry point |
| `src/operator/dev.ts` | Local entry point against the emulators; never in the image |
| `operator/Dockerfile`, `operator/cloudbuild.yaml` | The container and its build, under `firebase/functions/` |

**One package, not two.** The operator writes documents the functions read: founder invitations,
and the new `extractionAllowance`. One package means one type, one Firestore client, one test suite
against the emulators, and one PR when the shape changes. Two would drift apart. `customLimit` shows
how easily that happens even within one file: a raised limit that only the daily check reads.

**`src/index.ts` exports nothing from `src/operator/`.** An export there would deploy it as a public
Cloud Function, outside IAP. A test pins it.

**The container** is built from a Dockerfile under `firebase/functions/operator/`, with a base
image pinned by digest, by Cloud Build from CI. It is the repository's first Dockerfile, and nothing
local runs Docker. Buildpacks, the alternative, take their settings (`Procfile`, `project.toml`, a
`gcp-build` script) from files in the directory they build, which is the directory the Cloud
Functions build reads too. Nothing would show whether a setting meant for one had changed the other.
The image carries the functions' production dependencies; only the operator's modules load.

### The service

| Setting | Value | Why |
|---|---|---|
| Region | `europe-west1` | Where the functions run |
| IAP | On, directly on the service | No load balancer; generally available since March 2026 |
| Invoker | The IAP service agent only | Cloud Run's own IAM check stays on, as a second gate |
| Ingress | All | The `run.app` URL is the one IAP protects |
| Instances | 0 to 1 | Operator traffic is one person; caps cost and abuse |
| Concurrency, timeout | 20, 30 s | Every action is one or two Firestore calls |
| Runtime account | `operator-runtime@` | Least privilege; never the default compute account |
| Configuration | `OPERATOR_SUBJECTS`, `IAP_AUDIENCE`, `SITE_ORIGIN`; CSRF key from Secret Manager | Missing values stop the process at start |

There is no custom domain. The `run.app` address is what IAP on the service is documented to
protect; a custom domain needs a load balancer or Cloud Run's domain mappings, and neither has been
checked with IAP on the service. The address is bookmarked once.

### The HTTP layer

Node's own `node:http`, no web framework. There are six routes and two static files, and every
dependency is one more thing running with the runtime account's access to Firestore.

| Method | Path | Does |
|---|---|---|
| GET | `/` | Home: the two areas, the operator's email, "times are UTC" |
| GET | `/founder-links` | The issue form and the newest 50 links; `?before=` pages back |
| POST | `/founder-links` | Issue one; the response is the only place the link is ever shown |
| POST | `/founder-links/revoke` | Revoke the link named by `id` |
| GET | `/accounts?email=` | The look-up form, and the account it finds |
| POST | `/accounts/allowance` | Set or clear the allowance of `uid` |
| GET | `/assets/operator.css`, `/assets/copy.js` | Static files |

- **Every route requires the identity check.** There is no health endpoint and no unauthenticated
  path: Cloud Run's default startup probe is a TCP check.
- **Order per request:** security headers, identity, CSRF on a POST, the handler, the audit line.
  A failure before the handler answers with a status and nothing more.
- **Pages are rendered on the server** and work without JavaScript; `copy.js` only adds a copy
  button. Every interpolated value passes through one escaping `html` template.
- **POST, redirect, GET** after every action except issuing a link: that response shows the link
  once, with `Cache-Control: no-store`.
- **Usable on a phone:** works at 320 px, controls at least 44 px, labels on every field. Its own
  stylesheet with its own CSS custom properties; it does not load the React app or its theme.

### Founder links

**The lifecycle today** (T125, T126):

1. **Issued:** `founderInvitations/{sha256(token)}` (T145) with `used: false` and a 14-day `expiresAt`.
2. **Reserved:** `reserveSignUp` writes `reservations/founder_{invitationId}` with the founder's email.
3. **Admitted:** the sign-up gate creates the account only while that reservation is live
   (`findLiveReservation`, `signUpGate.ts:97`).
4. **Spent:** `createGroup` sets `used`, `usedAt`, `usedBy` and `groupId` (`createGroup.ts:157`).

**Changes:**

- **Issue.** `issueFounderInvitation` gains `issuedBy` (the operator's email, or `"script"`) and runs
  in a transaction. That transaction counts the links issued in the last 24 hours and refuses
  past `FOUNDER_LINK_DAILY_BUDGET` (10), the way `createGroup` counts groups in its transaction.
  The script keeps working through the same function.
- **List.** Newest first by `createdAt`, 50 to a page, a `before` cursor for older ones. Each row
  shows the note, when it was issued and by whom, when it expires, and its status: *open*, *used*
  (with when), *expired* or *revoked*. A row never shows the reserved email, the group, or the full
  token, only its first six characters to tell rows apart. A lost link is revoked and replaced, the
  way a lost API key is.
- **Revoke.** In a transaction, it refuses a used link and otherwise sets `expiresAt` to now,
  `revokedAt` and `revokedBy`. Everything that accepts a link already refuses an expired one
  through `registrationTokenProblem` (`shared/registrationToken.ts`): `reserveSignUp` refuses it, the
  gate deletes its reservation and refuses the account, and `createGroup` refuses it. None of them
  changes. A founder who already has an account but no group keeps the account, cannot start a group
  with it, and can still be invited into one.

**Data:** `founderInvitations/{token}` gains `issuedBy`, `revokedAt` and `revokedBy`. Rules
unchanged: no client reaches the collection (the catch-all, `firestore.rules.prod:741`).

### Extraction allowances

**Today**, `users/{uid}.entityExtractionUsage` holds both the counters and two policy fields:
`isUnlimited`, which works (`entityExtraction.ts:266`, `:297`), and `customLimit`, which raises
the daily limit only (`exhaustedPeriod`, `:226`), because `readUsage` (`:241`) puts weekly and
monthly back to 5 and 10 on every read. The app reads `customLimit` for its daily row
(`UsageMeter.tsx:115`, `useEntityExtractor.ts:113`).

**New:** the policy moves to a field of its own on the profile, apart from the counters the
extraction transaction rewrites.

```ts
users/{uid}.extractionAllowance = {
  unlimited: boolean;
  limits: {daily: number; weekly: number; monthly: number} | null; // null when unlimited
  expiresAt: Timestamp | null; // null: until changed
  setAt: Timestamp;
};
```

- **On the profile**, because the extraction transaction reads that document already (no extra
  read per call), and deleting the account deletes it with the profile (`accountDeletion.ts:162`).
  The player can read it (the rules let anyone read their own profile): it holds their own
  limits and nothing private. The operator's reason, if given, goes to the audit log only.
- **No client can write it.** The profile's update rule is an allowlist (`firestore.rules.prod:507`):
  a field nobody listed is server-owned. No rules change; a rules test pins it.
- **Only on an existing profile.** The operator uses `update`, never `set`, so it cannot create a
  half-made profile that `createGroup` or `redeemInvitation` would later find. An account without a
  profile is in no group and cannot extract anything; the page says so.
- **Bounds:** whole numbers, daily at most 50, weekly at most 150, monthly at most 500 (about $1.50
  at about $0.003 a call). Unlimited is a separate choice. An expiry lies in the future and within
  a year; the form fills in the end of the current month (UTC) and can be cleared.

**`effectiveLimits(profile, now)`** in `src/extractionAllowance.ts` decides which limits apply:

1. An allowance that has not expired: its limits, or unlimited.
2. Otherwise the defaults, 3 / 5 / 10 (`DEFAULT_USAGE_LIMITS`).

Until the cleanup step (step 7, 2026-10-16) the old fields came between the two: `isUnlimited`
meant unlimited, and `customLimit` replaced the daily limit only. No profile in production
carried them by then, and they now grant nothing.

`readUsage` writes the effective limits into each period's `limit`, sets `isUnlimited`, and adds
`raisedUntil` when an expiring allowance applies. The app shows each period's `limit` as sent, and
the date from `raisedUntil` ("Your allowance applies until 31 October."). An expired allowance stays on the profile, ignored and shown as expired, until it is
reset or replaced. Lowering a limit below what someone has already used leaves them out of calls
until the period resets.

### Account look-up

An exact email goes to `getAuth().getUserByEmail`, which returns the uid, when the account was made
and when it last signed in. The page adds whether a profile exists, the three counters, the
effective limits and the allowance. Nothing else: no groups, names or usernames.

There is no list or search of accounts. A page that lists every account is a page that leaks every
account, and does not scale either.

### Audit

Every action, and every refusal, writes one structured line through `audit.ts`:

```json
{"type": "operator_audit", "action": "founder_link.revoke",
 "operator": {"email": "...", "sub": "accounts.google.com:..."},
 "target": {"link": "Xy3kQ9"}, "outcome": "ok", "trace": "..."}
```

- Actions: `founder_link.issue|revoke`, `allowance.set|clear`, `account.lookup`, and
  `identity.refused` / `csrf.refused` for refusals.
- `outcome` is `ok`, `refused` or `error`; a refusal carries a `reason`.
- A founder link is named by its first six characters, never in full.
- Cloud Logging receives it, and a sink routes it to a bucket whose retention is locked
  ([security architecture](security-architecture.md#7-audit)).
- The documents carry the same story for the console: `issuedBy`, `revokedBy`, `setAt`.

### Errors

| Case | Answer |
|---|---|
| Invalid input | 400, the form again with the message |
| Refused by a rule (link used, budget spent) | 409 or 429, a plain sentence |
| Identity or CSRF failure | 401 or 403, no detail; logged |
| Anything else | 500 with the trace id; the detail only in the log |

### Local development

`npm run operator:dev` in `firebase/functions` runs the real server against the dev emulators, on
port 4700 (the dev server has 3000, the emulators 4000, 4400, 4500 and their own ports, the
journeys 4300 and up). The dev entry makes a throwaway key pair and signs an identity header onto
each request in-process. The real verifier then runs with only its keys and audience swapped. It
refuses to start unless `FIRESTORE_EMULATOR_HOST` is set and `K_SERVICE` (which Cloud Run sets) is
not, and `.dockerignore` keeps it out of the image.

### Testing

- **Actions:** emulator suites in `firebase/functions/test/` for founder links, allowances, look-up,
  and `effectiveLimits` inside `extractEntities`. That includes `isUnlimited` and `customLimit`,
  which no suite tests today. Each gets the control CLAUDE.md asks for: break it on purpose once and
  watch the right tests fail.
- **Rules:** `firestore-rules-prod.test.ts`: a player can read but not write their
  `extractionAllowance`.
- **HTTP:** the server runs in-process with test keys. Every route in the route table is refused
  without an identity: the test walks the table, so a new route is covered when it is added. So
  are forged, expired, wrong-audience, wrong-issuer and wrong-algorithm headers, unknown subjects,
  missing and stale CSRF tokens, cross-site requests, and missing security headers. Hostile
  strings must render escaped.
- **Wiring:** `src/index.ts` exports nothing from `src/operator/`.
- **Browser journey:** Playwright against `operator:dev` and the e2e emulators: issue, list,
  revoke; set an allowance, reset it.
- **Live:** after every deploy, and daily, the configuration checks in the
  [security architecture](security-architecture.md#10-checking-the-configuration-t9).

### Phase 2: the overview

A sketch, to be designed when it is picked up:

- **Counts:** groups and open founder links from aggregation queries, and accounts from the sign-up
  gate's count (`signUpCounters/accounts`).
- **Health:** Cloud Monitoring's figures for the functions (errors, latency, calls), and a
  log-based metric for OpenAI refusing for lack of credit, which `isOutOfCredit`
  (`entityExtraction.ts:359`) already detects.
- **Access:** the runtime account gains `roles/monitoring.viewer`, read only, its one addition.
- **Traffic:** from Google Analytics, which runs only for visitors who agreed to it (decided
  2026-10-10), so it counts fewer visits than there are.

## Alternatives considered

| Option | Why not |
|---|---|
| A local page under the maintainer's gcloud login | Desk only; every action runs with owner credentials; its security is one laptop's |
| In the app: an operator claim, a TOTP second factor, a recent sign-in | The operator callables are public endpoints guarded only by our code; the operator is an account in the players' sign-in system, so every sign-in path (device sign-in's custom tokens today, Discord's later) has to be checked against it, indefinitely |
| IAP on a 2nd-gen Cloud Function, which is a Cloud Run service underneath | Firebase's deploy owns the service's settings, and nothing promises a redeploy keeps IAP on |
| IAP on a load balancer | A load balancer to pay for and keep; it does not cover the `run.app` URL unless ingress is closed as well |
| A separate private repository | The functions' deploy key already runs code with full Firestore access, so it lowers no ceiling; it adds drift between what writes a document and what reads it |
| Terraform | CI applying it would need the IAM rights this design keeps away from CI; a setup script the maintainer runs, plus CI checking the result, gives the drift detection without them |
| Buildpacks | See *The container*, above |

## Decisions with defaults

Each is the design's choice. The maintainer kept all eight (2026-10-08), the emails
included, and may still overturn any of them.

1. **Founder links:** at most 10 in any 24 hours.
2. **Allowances:** at most 50 / 150 / 500, an expiry within a year, the form defaulting to the end
   of the month.
3. **IAP** asks for the security key again every hour.
4. **The audit bucket** keeps 400 days, its retention locked after a 30-day trial.
5. **An account in the `muninn.quest` organization used only for operator work**, holding no role
   on the project. The project moves into that organization (maintainer, 2026-10-08).
6. **Every operator deploy waits for the maintainer's approval** in GitHub.
7. **The container is built from a Dockerfile** by Cloud Build.
8. **An email to the maintainer for every action that changes something**, so a hijacked session is
   seen within minutes.
