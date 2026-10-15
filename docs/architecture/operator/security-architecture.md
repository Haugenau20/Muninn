# The operator page: security architecture

**Status** approved by the maintainer, 2026-10-08 · **TODO** T137 · **With** [design](design.md) and
[implementation plan](implementation-plan.md)

What protects the operator page, against whom, and how each protection is checked. The design says
what the page does; this says why it is safe to have it.

## What is worth protecting

| Asset | What it gives an attacker | What bounds it |
|---|---|---|
| Issuing founder links | Accounts, and groups started with them | 10 a day ([design](design.md#founder-links)); 300 accounts, 10 members and 5 campaigns a group |
| Setting allowances | The OpenAI balance, spent | It is prepaid, $5, with no automatic top-up (onboarding plan, answer 3) |
| Account look-up | Whether an email has an account, and its usage | One exact email at a time; no listing |
| Founder tokens | One account and one group each | Shown once, at issue; 14 days |
| `operator-runtime@` | Read and write all of Firestore, read Auth | The real ceiling: [residual risk 1](#residual-risks) |
| The deploy path | Any code, run as `operator-runtime@` | Keyless, one workflow on `main`, approved by hand |
| The operator's Google account | The page and nothing else | A passkey or security key; no project role |

The page holds nothing worse than these on purpose. Deleting an account, reading campaigns, or
editing any document stay outside it ([design](design.md#scope)).

## Who it defends against

| | Threat |
|---|---|
| T1 | A stranger on the internet |
| T2 | A signed-in player, or whoever stole a player's session, including the maintainer's own player session |
| T3 | Someone who phishes or steals the operator's Google sign-in |
| T4 | Malware on the operator's device, or their phone taken while unlocked |
| T5 | A malicious page open in the operator's browser: cross-site requests, framing |
| T6 | Hostile data: a string a player controls, shown on the page (stored XSS against the operator) |
| T7 | The supply chain: a poisoned npm package or base image, a compromised GitHub Action |
| T8 | A compromised CI run, or a malicious change that reaches `main` |
| T9 | Drift: IAP switched off, a public invoker added, a wrong entry in an access list |
| T10 | The operator's own slip: 5000 typed for 50 |

## Principles

1. **Google decides who reaches the code, and the code decides again.** Two independent gates, each
   enough on its own to refuse a stranger.
2. **The operator is not an app identity.** Nothing in Firebase Auth, the Firestore rules or the
   functions knows an operator exists, so no bug in them can make someone one.
3. **Only bounded actions that can be put right.** What cannot be undone stays in scripts that need
   owner credentials.
4. **Least privilege for every identity:** the human, the runtime, the deploy, the build. The one
   exception, Firestore, is named in [residual risk 1](#residual-risks).
5. **Every action leaves a record its actor cannot erase.**
6. **Configuration is checked, not trusted**: after every deploy and every day.
7. **Fail closed.** Missing configuration refuses everything; there is no fallback that admits.

## Trust boundaries

```
 [B5 the operator's device] --HTTPS--> [B1 IAP] --signed header--> [B2 the service]
                                                                        |
                                              [B3 IAM: operator-runtime@ -> Firestore, Auth, logs]

 [GitHub: operator-deploy.yml on main] --B4 keyless, approved--> [Cloud Build, Cloud Run deploy]
```

- **B1** Google's sign-in and the IAP access list decide who passes.
- **B2** The service verifies what IAP signed, and checks the subject against its own list.
- **B3** IAM decides what the service can touch.
- **B4** Workload Identity Federation and a GitHub environment decide what can change the service.
- **B5** The operator's own device; protected by the account's security and a one-hour session.

## Controls by layer

### 1. The human identity

- **An account in the `muninn.quest` organization used only for operator work**, signed in with
  a passkey or a security key. The project moves into that organization (Cloud Identity Free;
  maintainer, 2026-10-08), so the account is the organization's own: its admin can require 2-Step
  Verification by security key only, and recovering it goes through the organization's super
  admin, not Google's consumer recovery. Cloud Identity Free offers that enforcement, as *Only
  security key or passkey* (checked 2026-10-09), and enforces it as *Only security key*
  (2026-10-13). The account signs in with either of two hardware keys, one carried and one kept
  elsewhere; no passkey syncs through a cloud account.
- **The super admin is a second account, used for nothing else**: it can reset the operator's
  sign-in, so it is guarded the same way, with the same two keys, and has its own browser
  profile. It has no recovery phone or email, and self-recovery is off: losing both keys leaves
  Google's domain-ownership recovery, through the DNS at Porkbun. It never signs in to a CLI on
  the maintainer's computer; what must run as it runs in Cloud Shell.
- **It holds no role on the project** except IAP-secured Web App User
  (`roles/iap.httpsResourceAccessor`) on the operator service. Stealing it reaches the page and
  nothing else: not the console, not the data.
- **The maintainer's owner account stays separate**, for setup and for break-glass. Today it is
  the maintainer's personal Gmail, whose second factor is weaker than the keys and which cannot
  take a hardware key; it stays an Owner only until a third key is registered, as the way back
  in if both keys are lost. Then a key-only `muninn.quest` account takes over the local `gcloud`
  and `firebase`, and the Gmail loses Owner.

### 1a. The organization

The project sits in the `muninn.quest` organization (Cloud Identity Free). Besides the operator
account and IAP's managed client, it allows policies that hold for the whole project whatever any
owner does later. The organization was created with Google's secure-by-default policies (26
active, read 2026-10-09); the ones that matter here:

- **No new service-account keys** (`iam.managed.disableServiceAccountKeyCreation`), no key
  uploads (`iam.disableServiceAccountKeyUpload`), and a key found exposed is disabled
  (`iam.serviceAccountKeyExposureResponse`): on from the start, nothing to set. Keys that exist
  keep working until T139 removes them.
- **Domain restricted sharing** (`iam.allowedPolicyMemberDomains`) is enforced on the
  organization, allowing only its own accounts. It stays there, keeping outside accounts off the
  organization's own roles. **The project overrides it to allow all**: as a blanket rule it would
  refuse the `allUsers` invoker the public callables need, and, by Google's documentation, the
  roles Google grants its own service agents automatically. Grants that exist survive the move.
- **Default service accounts and Cloud Build** (`iam.automaticIamGrantsForDefaultServiceAccounts`
  and three `cloudbuild.*` constraints) apply to accounts made later; the project's existing ones
  are unchanged. **Uniform bucket-level access** applies to new buckets only.

Step 4a's `--check` confirms these against the live project.

### 2. Identity-Aware Proxy (B1; T1, T2, T3, T4)

- **On the Cloud Run service itself**; its access list holds the operator account and nobody else.
- **Re-authentication** with method `SECURE_KEY`, `maxAge` 3600 s, policy `MINIMUM`: a session
  cookie taken from a device works for an hour at most. If `SECURE_KEY` is not offered for the
  account's type, `LOGIN` with the same hour; setup finds out which (implementation plan, step 4).
- **Cloud Run's own invoker check stays on.** `roles/run.invoker` belongs to the IAP service agent
  alone: never `allUsers`, never `allAuthenticatedUsers`.
- **IAP's Data Access audit logs are on**, so Google records every request it allowed or refused,
  apart from anything our code writes.
- **Google's own OAuth client.** In an organization, IAP uses a Google-managed OAuth client for
  the organization's own users, so there is no client secret to keep and no consent screen to
  maintain. Outside one, a custom client is required, made by hand in the console (Google's
  *Custom OAuth configuration for IAP*). This is why the project moves into the organization.
- **Not available:** context-aware access (device policy) needs Access Context Manager and a paid
  tier; an organization alone does not bring it.

Why a player's session gets nowhere (T2): IAP asks Google, not Firebase Auth. No cookie, token or
claim from the app is even read.

### 3. The service checks the identity again (B2; T1, T9)

On every request, before anything else runs:

- **The header `x-goog-iap-jwt-assertion` is present and valid:**
  - signed with `ES256`, under a `kid` from IAP's published keys (cached, refreshed as they rotate)
  - `iss` is `https://cloud.google.com/iap`
  - `aud` is `/projects/{number}/locations/europe-west1/services/operator`
  - `exp` and `iat` are within 30 seconds of now
- **Its `sub` is in `OPERATOR_SUBJECTS`.** That is Google's stable identifier for the account; an
  email address can change hands.
- **The verification is google-auth-library's IAP check**, Google's documented path, as a direct
  dependency of the functions package.
- **No configuration, no service.** An empty subject list or audience stops the process at start.
- **No switch.** The production entry point has no setting that changes the keys or the audience. The
  development entry point that does is a separate file, and `.dockerignore` keeps it out of the image.

The result: even if IAP were switched off and a public invoker added, every request would still be
refused.

### 4. In the browser (T5, T6)

- **CSRF:** a POST must pass both:
  1. `Sec-Fetch-Site: same-origin`, or, where a browser sends none, an `Origin` equal to the
     service's own
  2. a form token: an HMAC-SHA256 of the operator's subject and the hour, under a key from
     Secret Manager, accepted for the current hour and the one before
- **Headers on every response:**
  - `Content-Security-Policy: default-src 'none'; style-src 'self'; script-src 'self'; img-src
    'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
  - `X-Frame-Options: DENY`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
    `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=63072000`
  - `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and an
    empty `Permissions-Policy`
- **Stored XSS (T6):** the operator is the most valuable person to attack through the page.
  - Every value on a page passes through one escaping template. That includes an account's email,
    which its holder chose, and the operator's own notes.
  - The policy above runs no inline script, so an escaping slip still runs nothing.
  - A test renders hostile strings through every page.
- **A founder link appears once**, in the body of the response that issued it. It never appears in a
  URL, so never in history, logs or a referrer. Lists and logs carry its first six characters only.

### 5. The application (T2, T10)

- **A fixed set of actions**, and no generic write.
- **Inputs are validated against bounds** (allowances at most 50 / 150 / 500, an expiry within a
  year), and founder links have a daily budget.
- **Transactions** wherever a check comes before a write: issuing within the budget, revoking only
  an unused link.
- **No list or search of accounts.** One exact email at a time, and only the figures the action
  needs.
- **It cannot become a public function.** `src/index.ts` exports nothing from `src/operator/`, and a
  test holds it there.
- **Errors say nothing.** A failure answers with a status and a trace id; the detail is only in the
  log.

### 6. The runtime identity (B3)

`operator-runtime@`, and nothing more:

| Role | For | On |
|---|---|---|
| `roles/datastore.user` | Founder invitations, profiles | The project: Firestore's IAM cannot narrow to a collection |
| `roles/firebaseauth.viewer` | Looking up an account by email | The project |
| `roles/secretmanager.secretAccessor` | The CSRF key | That one secret |
| `roles/logging.logWriter` | Audit lines | The project; it can add entries, not delete them |

It has nothing for Storage, Functions or IAM, cannot write to Auth, and is never the default
compute account. Phase 2 adds `roles/monitoring.viewer`, read only. The exact role names are
confirmed against the live project in implementation step 4.

### 7. Audit

- **Our record:** every action and every refusal is one structured line
  ([design](design.md#audit)). A log sink routes these lines, and IAP's own log of the same
  requests, to their own bucket, `operator-audit`, kept for 400 days. Its retention is **locked** after a 30-day trial, so nobody can delete an entry
  early, including the project's owner.
- **Google's record:** IAP's Data Access logs, written whatever our code does.
- **The documents:** `issuedBy`, `revokedBy`, `setAt`, for whoever reads them in the console.
- **Being told:** a log-based alert emails the maintainer:
  - on every action that changes something
  - on every request IAP admitted that the service then refused (a misconfiguration or an attack)

  A hijacked session is seen within minutes, not at the next look.

### 8. The supply chain (T7)

- **Dependencies:** installed exactly from the lockfile (`npm ci`). What the operator loads is as
  few as possible: `node:http`, google-auth-library and firebase-admin. The image also carries the
  functions' other production dependencies, which it never loads.
- **The base image** is pinned by digest.
- **GitHub Actions** in the operator workflows are pinned by commit, not tag.
- **The image is built by Cloud Build** as `operator-builder@`, which can write to one Artifact
  Registry repository and its own logs, and nothing else. It is not the default build or compute
  account.
- **The deploy names the image by digest**, and the repository has a cleanup policy.
- **Updates:** Dependabot keeps the functions' npm packages, the base image digest and the pinned
  actions current. None is configured in the repository today
  ([implementation plan](implementation-plan.md), step 5).

### 9. The deploy path (B4; T8)

- **Its own workflow,** `operator-deploy.yml`. It runs after the main deploy succeeds, in its own
  concurrency group, so a deploy waiting for approval never holds up the site's.
- **Keyless.** Workload Identity Federation, with a provider whose condition requires:
  - this repository by `repository_id`, which survives a rename and cannot be claimed by a new
    repository of the same name
  - `ref` = `refs/heads/main`
  - `workflow_ref` = that workflow on `main`
  - `environment` = `operator`
- **Approved by hand.** The GitHub environment `operator` requires the maintainer's approval and
  admits `main` only.
- **`operator-deployer@`** holds:
  - `roles/run.developer` on the operator service only: it rolls out revisions, but cannot change
    the service's IAM policy or create services
  - `roles/iam.serviceAccountUser` on `operator-runtime@` and `operator-builder@` only
  - the right to submit a Cloud Build: Cloud Build Editor and Service Usage Consumer on the
    project, and creating objects in the bucket builds are submitted through

  It holds nothing in IAP: it cannot change the access list or the re-authentication settings.
- **The service exists before the first deploy.** The maintainer creates it, with IAP on, during
  setup. A pipeline that cannot create services can never put up an unprotected one.
- **Its ceiling:** whoever controls this path runs code as `operator-runtime@`. That is no more than
  the functions' deploy key can already do: it deploys code with full Firestore access, and T139
  replaces that key.

### 10. Checking the configuration (T9)

`operator-verify.yml` runs after every operator deploy and on a daily schedule, as
`operator-verifier@`, which can read and change nothing else: its one role is a custom one,
`operatorVerifier`, holding only the reads below, since no predefined role reads IAP's settings
without also changing them. It fails, and GitHub emails the
maintainer, unless all of these hold:

1. **A request without sign-in is turned away.** An anonymous GET is redirected to Google's sign-in
   or refused; it never gets a 200.
2. **The service is set up as designed.** IAP is on, the invoker check is on, the live revision runs
   as `operator-runtime@`, and its image comes from our repository.
3. **Only IAP may invoke it.** The invoker policy is exactly the IAP service agent.
4. **The IAP access list is exactly the expected one**, held in a repository variable.
5. **Re-authentication** is set as above.
6. **The audit trail is intact.** The sink exists, and so do the bucket and, once set, its lock.

This is the answer to T9, and to the question nobody can answer by looking at code: "is it still
set up the way the document says?"

## Threats against controls

| Threat | Stopped by | Left over |
|---|---|---|
| T1 Stranger | IAP (2), the service's own check (3), the invoker check (2) | Nothing reachable |
| T2 Player, or a stolen app session | IAP reads no app identity (principle 2) | None |
| T3 Phished Google sign-in | A passkey or security key (1), re-authentication (2), an email per action (7) | A recovery flow phished: [residual 2](#residual-risks) |
| T4 Malware, or an unlocked phone | Hour-long sessions (2), an email per action (7), bounded actions (5) | Up to an hour of bounded actions |
| T5 Malicious page | CSRF checks and framing headers (4) | None known |
| T6 Hostile strings | Escaping and the content policy (4), tests | None known |
| T7 Supply chain | Lockfile, digest and commit pins, few dependencies, a narrow build account (8) | A poisoned dependency that ships: residual 1's ceiling |
| T8 CI or `main` compromised | Keyless deploy limited to one workflow, approval by hand (9) | Code as `operator-runtime@`: residual 1 |
| T9 Drift | Checks after every deploy and daily (10); the service's own check (3) | Up to a day between checks |
| T10 A slip | Bounds and the budget (5), everything reversible, the audit trail (7) | None |

## Residual risks

Accepted, and named so they are not forgotten:

1. **Firestore access is project-wide.** IAM cannot narrow `operator-runtime@` to two collections,
   so the code is the boundary: a bug, or malicious code that got deployed, could write anywhere.
   Mitigated by the narrow code, its tests, the approval and the review. Unchanged from the
   functions, which have the same access.
2. **Two human keys.** Everything rests on the operator account and on the organization's super
   admin, which can reset it. Both sign in only with hardware keys, which sync nowhere, with a
   backup key kept apart; their recovery options are checked once a year. Until the maintainer's
   Gmail loses Owner (layer 1), the project itself is only as safe as that Gmail.
3. **An hour.** A session taken from the device works until re-authentication. The email per action
   makes it visible; every action it can take can be undone.
4. **Founder tokens were document ids.** Anyone who could read Firestore (the console, the runtime
   account) could read them. Since T145 a link is stored under its token's SHA-256, for invitations
   into groups too, and a link stored the old way is refused.
5. **The functions run as the default compute account.** No function sets `serviceAccount`
   (`firebase/functions/src`), and that account holds the project-wide Editor role (read
   2026-10-10) and a project-wide Token Creator (read 2026-10-12), which lets it act as every
   service account here, `operator-runtime@` included. The functions' deploy key (T139)
   reaches that far: T146.
6. **Google is a dependency.** If IAP fails, it fails closed: the page is down, and break-glass
   applies.

## Operations

- **Add an operator:**
  1. Set up a Google account for it, with a passkey.
  2. The maintainer adds it to IAP's access list.
  3. Add its `sub` to the `OPERATOR_SUBJECTS` variable, then deploy.
  4. Update the verification's expected list.
- **Remove an operator:** take them off IAP's list first, which works at once, then remove the
  variable entry and deploy.
- **Rotate the CSRF key:** add a new version of the secret, then deploy. Forms open at that moment
  fail once.
- **Suspected compromise:**
  1. Take the account off IAP's list.
  2. Sign the Google account out everywhere and replace its keys.
  3. Read the audit bucket and IAP's logs for the window.
  4. Revoke the founder links issued in it, and reset the allowances set in it.
  5. Check Cloud Run's revision history for a deploy nobody approved.
- **Break-glass** when IAP or the service is down: `scripts/issue-founder-invitation.js` under the
  owner's login for founder links. For allowances, the maintainer edits
  `users/{uid}.extractionAllowance` in the console ([design](design.md#extraction-allowances) has
  its fields).

## How each control is known to work

The rule CLAUDE.md sets for tests applies here too: a check that passes on its first run proves it
runs, not that it catches anything. Break each one on purpose once.

| Control | Checked by | Broken on purpose by |
|---|---|---|
| The service's identity check | HTTP suite: forged, expired, wrong `aud`, `iss` or `alg`, unknown `sub`, every route | Skipping the check in one route; the route-table test must fail |
| CSRF | HTTP suite: no token, stale token, cross-site | Accepting any token |
| Security headers | HTTP suite, on every route | Dropping one header |
| Escaping | HTTP suite, hostile strings on every page | Interpolating one value raw |
| Not a public function | A test on `src/index.ts` | Exporting the server |
| Bounds and budget | Emulator suites | Raising a bound past its limit |
| Revoked means refused | Emulator suites through `reserveSignUp`, the gate and `createGroup` | Revoking without moving `expiresAt` |
| Allowance not client-writable | Rules suite against `firestore.rules.prod` | Adding the field to the allowlist |
| IAP, invoker, access list, re-authentication, audit sink | `operator-verify.yml`, after deploys and daily | Once, at go-live: an expected list with a stranger in it must fail the run |
| Alerts | An action at go-live; the email arrives | None needed |
