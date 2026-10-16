# The operator page: implementation plan

**Status** approved by the maintainer, 2026-10-08 · **TODO** T137 · **With** [design](design.md) and
[security architecture](security-architecture.md)

A high-level plan: what lands in which order, who does it, and how each step is checked. Each code
step gets a detailed plan of its own when it is picked up, written against the tree as it is then.

## Order

| Step | What | Who | Needs | Size | Goes live |
|---|---|---|---|---|---|
| 0 | Preparation: the operator account, the project's questions | Maintainer | Nothing | S | Nothing |
| 1 | Allowances on the server | PR | Nothing | M | Functions; the app sees no difference |
| 2 | The operator actions | PR | 1 | M | Functions; the founder script records `issuedBy` and has the daily budget |
| 3 | The service, run locally | PR | 2 | L | Nothing new: the server is built but not deployed |
| 4a | The setup script and its runbook | PR | 3 | M | Nothing |
| 4b | Running the setup | Maintainer | 4a, 0 | M | A protected, empty service |
| 5 | The pipeline and the checks | PR | 4b | M | The operator page, after approval |
| 6 | Go-live checks | Maintainer, with Claude | 5 | S | Nothing |
| 7 | Cleanup and documentation | PR | 6 | S | Functions and app; T137 rewritten to phase 2 |
| 8 | Lock the audit retention | Maintainer | 6, plus 30 days | S | Nothing |

Steps 1 to 3 can go up as one stack, and 4a and 5 as another. Step 5 must not merge before 4b: its
workflow needs the identities 4b creates, and the service must already exist, protected, before any
pipeline deploys to it.

## Step 0: preparation (maintainer)

- **An organization for the project** (decided 2026-10-08: the project had none, and without one
  IAP needs a hand-made OAuth client). In this order:
  1. ✅ Mail to the two accounts' `muninn.quest` addresses is forwarded to the maintainer (Porkbun
     forwarding, 2026-10-08). Porkbun added its servers to the SPF record, which took it to 10 DNS
     lookups, the most SPF allows; that include was removed, and forwarding works without it.
  2. ✅ Cloud Identity Free signed up with `muninn.quest`, creating the super admin, used from its
     own browser profile and for nothing else (2026-10-08).
  3. ✅ Domain verified with a second `google-site-verification` TXT record; keep it, Google
     re-checks it. The organization appeared once the super admin first opened the Cloud console
     (2026-10-09).
  4. ✅ The operator account created in the Admin console, with no admin role (2026-10-09).
  5. ✅ Hardware keys registered on both accounts (2026-10-13), one carried and one kept
     elsewhere. 2-Step Verification is enforced with *Only security key*, with trusted devices and
     security codes off; account recovery was reviewed (2026-10-15).
  6. ✅ **Moved** into the organization (2026-10-15), after the data was exported. The move cannot
     be undone without Google's support; the billing account stayed.
     - Google's guide names `roles/resourcemanager.projectIamAdmin` on the project and Project
       Creator on the organization, but the console's *Migrate* also wants
       `resourcemanager.projects.update`: grant Project Mover
       (`roles/resourcemanager.projectMover`) on the project as well.
     - `resourcemanager.allowedImportSources` does not apply: it governs moves between
       organizations, not into one from none.
     - Straight after, `iam.allowedPolicyMemberDomains` was overridden on the project to allow all
       ([layer 1a](security-architecture.md#1a-the-organization)). Check it with
       `gcloud resource-manager org-policies describe iam.allowedPolicyMemberDomains --project=dnd-campaign-companion --effective`
       (`allValues: ALLOW`); the newer `gcloud org-policies` needs an API the project has not
       enabled.
     - **Open:** the first functions deploy afterwards shows whether the default-service-account
       policies touch anything; each can be overridden on the project.
  7. ✅ **Cleanup** (2026-10-15): the roles granted for the move and the domain-wide Project Creator
     and Billing Account Creator grants are removed, and the project's owners reviewed. Google
     sign-in was tried straight after.
  [Security architecture](security-architecture.md#1-the-human-identity), layers 1 and 1a.
- **The defaults** in the design's [decisions](design.md#decisions-with-defaults): keep or change.

## Step 1: allowances on the server (PR)

- **`src/extractionAllowance.ts`:** the type, its bounds, and `effectiveLimits(profile, now)`, which
  covers the allowance, then the old `isUnlimited` and `customLimit`, then the defaults.
- **`entityExtraction.ts`:**
  - `readUsage` takes its limits from `effectiveLimits`
  - `getUsageStatus` and the extraction transaction return the effective limits and `isUnlimited`,
    plus `raisedUntil` when an expiring allowance applies
  - `customLimit` is no longer sent
- **Tests:**
  - `extractEntities.test.ts` covers each branch of `effectiveLimits`: unlimited, raised, expired,
    the two old fields, the defaults. `isUnlimited` and `customLimit` have no test today.
  - A rules test: a player can read their own `extractionAllowance` but not write it.
- **Live effect:** nothing writes the new field yet, and the console edit still works. The app keeps
  working unchanged, because it reads `customLimit ?? daily.limit`.
- **Gates:** `npm --prefix firebase run test:functions`, with the control (break `effectiveLimits`
  once and watch the right tests fail); the functions' lint compared against its baseline.

## Step 2: the operator actions (PR)

- **`src/operator/founderLinks.ts`:**
  - `issueFounderLink`: `issuedBy`, and the 24-hour budget counted in the same transaction
  - `listFounderLinks`: newest first, paged by `createdAt`
  - `revokeFounderLink`: refuses a used link; otherwise sets `expiresAt` to now, plus `revokedAt`
    and `revokedBy`
- **`issueFounderInvitation`** becomes the issuing core of the above. `issue-founder-invitation.js`
  passes `issuedBy: "script"`, and its suite still passes.
- **`src/operator/accounts.ts`:** look up one account by exact email: the Auth record, whether a
  profile exists, its usage, its allowance.
- **`src/operator/allowances.ts`:** validate against the bounds, then set or clear with `update`.
  Setting deletes the old `customLimit` and `isUnlimited` in the same write; a missing profile is
  refused with a plain message.
- **`src/operator/audit.ts`:** the one function that writes an audit line, in the shape the design
  gives.
- **Tests:**
  - every action against the emulators
  - a revoked link is refused by `reserveSignUp`, by the gate and by `createGroup`
  - the budget holds under two issues racing for the last slot
  - the bounds hold
- **Live effect:** the script records `issuedBy` and has the daily budget. Nothing else is
  reachable: nothing in `src/operator/` is exported.

## Step 3: the service, run locally (PR)

**Done** 2026-10-09. The HTTP suite is `test/operator/http.test.ts`; each control in the
[security architecture's table](security-architecture.md#how-each-control-is-known-to-work) was
broken once and its tests failed. The journey is `e2e/tests/operator.spec.ts`.

- **`src/operator/http/`:**
  - the identity check (google-auth-library's IAP verification; keys and audience passed in)
  - CSRF
  - the escaping `html` template and the pages
  - the security headers
  - the route table and the `node:http` server
- **`src/operator/main.ts`:** production configuration only: Google's keys, the audience and the
  subjects from the environment, and it exits when any is missing.
- **`src/operator/dev.ts` and `npm run operator:dev`:** port 4700, against the dev emulators, with a
  throwaway key pair. It refuses to start outside the emulators.
- **The container files:** `firebase/functions/operator/Dockerfile` (base image pinned by digest,
  production dependencies only, runs as a non-root user), `cloudbuild.yaml` and `.dockerignore`
  (which keeps `dev.js` out). They are first built for real in step 5.
- **Tests:** the HTTP suite the [security architecture](security-architecture.md#how-each-control-is-known-to-work)
  lists, and a test that `src/index.ts` exports nothing from `src/operator/`.
- **A browser journey** in `e2e/`: the operator page against `operator:dev` and the e2e emulators.
  It issues a link, sees it listed, and revokes it; then finds a seeded account, raises its
  allowance and resets it. It is located by role and accessible name, as the other journeys are.
- **Gates:** the functions suite; `npm --prefix firebase run test:e2e`; a look at the pages at
  320 px.

## Step 4a: the setup script (PR)

`firebase/functions/operator/infra/setup.sh` is idempotent `gcloud`, run by the maintainer under the
owner's login, never by CI. Its header lists the steps, as the other operator scripts' do, and
`--check` only reports. It sets up, in order:

1. **APIs:** Cloud Run, IAP, Cloud Build, Artifact Registry, Secret Manager, IAM, IAM
   Credentials, Security Token Service, Logging, Monitoring, Org Policy, Resource Manager.
2. **Service accounts and roles:**
   - `operator-runtime@`, `operator-deployer@`, `operator-builder@` and `operator-verifier@`
   - each with exactly the roles in the [security architecture](security-architecture.md#6-the-runtime-identity-b3)
   - the role names confirmed against Google's role list (2026-10-10). No predefined role reads
     IAP's settings and access list without also changing them, so the verifier holds a custom
     read-only role, `operatorVerifier`
3. **Artifact Registry:** the `operator` repository, with a cleanup policy (the newest ten images
   kept, others deleted after 30 days); and a bucket of its own for submitted build sources.
4. **Secret Manager:** the CSRF key, readable by `operator-runtime@` only.
5. **Workload Identity Federation:** a pool per workflow, `operator-deploy` and `operator-verify`,
   so one workflow's token can never act as the other's account; each a GitHub provider with the
   attribute condition on `repository_id`, `ref` and `workflow_ref`, and the deploy's on
   `environment` too.
6. **The service:**
   - created from Google's placeholder image, with IAP on, the invoker check on, and the IAP
     service agent as the only invoker
   - then the IAP access list (the operator account) and the re-authentication settings
   - with Google's managed OAuth client, the operator account being one of the organization's
     own users
7. **Audit:**
   - IAP's Data Access logs
   - the `operator-audit` bucket (400 days, unlocked) and its sink, which also carries IAP's own
     log of the same requests
   - the two log-based alerts, emailing the maintainer
8. **Organization policies:** `--check` confirms that the key policies are still enforced and that
   the project's override of `iam.allowedPolicyMemberDomains` is in place (both from step 0).
9. **Open questions:**
   - whether `SECURE_KEY` is offered for the account's type: the run tries it, falls back to
     `LOGIN`, and prints which it set
   - whether `roles/run.developer` can switch IAP off: it holds `run.services.update`, so assume
     it can; the verification in step 5 catches it and the service's own check still refuses
   - which roles a Cloud Build submission needs: the script grants the fewest that should do,
     and step 5's first build confirms them

The runbook beside it says what to check after each part. The GitHub side is set up in the same
step: the `operator` environment (the maintainer's approval, `main` only), and the variables
`OPERATOR_SUBJECTS`, the providers and the account names, which the script prints.

## Step 4b: running the setup (maintainer)

The maintainer runs `setup.sh`, then `setup.sh --check`, and reports what it printed. At the end
the service exists, protected, serving Google's placeholder, and an anonymous request to it is
turned away.

✅ Done 2026-10-15, in Cloud Shell. The first runs found three faults in the script, fixed on the
way (#386, #387); the runbook's record has the findings.

## Step 5: the pipeline and the checks (PR)

- **`operator-deploy.yml`:**
  - runs after a successful run of the main deploy workflow
  - has its own concurrency group, and actions pinned by commit
  - signs in without a key, as `operator-deployer@`
  - builds with Cloud Build as `operator-builder@`
  - deploys by digest, with the environment's approval
  - skips when nothing the image is built from has changed
- **`operator-verify.yml`:** the six checks of the
  [security architecture](security-architecture.md#10-checking-the-configuration-t9), as
  `operator-verifier@`, after every operator deploy and daily.
- **Dependabot:** npm in `firebase/functions`, the base image's digest, and the GitHub Actions.
  It is new to the repository, so its scope is the maintainer's call when the PR is reviewed.
- **Live effect:** the first merge asks for approval, then puts the operator page up behind IAP.

As built (2026-10-16):

- **What "changed" means:** each run is named after the commit it builds (`Operator page @ <sha>`),
  and the last successful run, deployed or skipped, names the commit the live image came from. The
  deploy runs, and asks for approval, only when the image's inputs differ from that commit: the
  functions' `src/`, manifests and `tsconfig.json`, `.dockerignore`, the Dockerfile, the build
  config, and the workflow itself. A change to a variable or a new CSRF key version changes no file,
  so it is deployed by running the workflow by hand on `main`, which always deploys.
- **The build** is submitted and then polled, not streamed: it logs to Cloud Logging only, which
  the deployer cannot read.
- **The checks** live in `firebase/functions/operator/infra/verify.sh`, so the maintainer can run
  them in Cloud Shell too. Beyond the six, it tries every address the service has, and refuses
  access granted at the project's IAP level. Each check was broken on purpose against a stand-in
  gcloud before the PR (a stranger expected, IAP off, the invoker check off, another account, an
  image by tag, traffic pinned to an old revision, `allUsers`, a disabled sink, a weaker
  re-authentication); the go-live run with a stranger (step 6) is still the real one.
- **Dependabot:** weekly and grouped, one PR per ecosystem: npm in `firebase/functions`, digest
  updates for the Dockerfile's two base images (no new majors), and the actions in every workflow
  and the toolchain action. The Cloud Build step image is renewed by hand; Dependabot does not read
  `cloudbuild.yaml`.

## Step 6: go-live checks (maintainer, with Claude)

1. Sign in as the operator on a desktop and on a phone; IAP asks for the key.
2. Issue a link, see it listed, revoke it; starting a sign-up with it is refused as expired.
3. Look up the maintainer's own account and make it unlimited. That moves it off the console's
   `isUnlimited`.
4. Confirm both actions' audit lines are in `operator-audit`, and that both alert emails arrived.
5. A Google account not on the list is refused by IAP. An anonymous request is turned away.
6. Run `operator-verify.yml` once with a stranger added to the expected list. It must fail.
7. Search production for profiles that still carry `customLimit` or `isUnlimited`, and set them on
   the page.

## Step 7: cleanup and documentation (PR)

- **Retire the old fields:**
  - `effectiveLimits` stops reading `customLimit` and `isUnlimited`, once step 6 found none left
  - the app's `customLimit` reads go (`UsageMeter.tsx:115`, `useEntityExtractor.ts:113`, `:125`,
    `hasCustomLimit` in `UsageContext.tsx:185`)
  - `UsageMeter` may say "raised until …" from `raisedUntil`
- **The privacy page:** `EXTRACTION_FACTS.caps` says what the caps are. Decide whether it adds
  "unless raised on request".
- **CLAUDE.md:** a short operator section covering `operator:dev`, the deploy and its approval, the
  verification, and break-glass.
- **The onboarding plan's D6:** its pointer to this design changes from "proposed" to what was built.
- **TODO.md:** T137 rewritten to what remains, which is phase 2, the overview.

As built (2026-10-16):

- **The old fields grant nothing.** `effectiveLimits` reads only the allowance, and the operator
  page no longer deletes `customLimit` and `isUnlimited` when it writes one: step 6 found none
  left, so there is nothing to move over.
- **The usage meter** shows each period's limit as the server sends it, and the last day of an
  allowance that ends ("Your allowance applies until 31 October."; "Unlimited scans until …"). The
  day is read in UTC, where the server ends it, and written in British English. "Raised" was not
  used, because an allowance can lower a limit too.
- **The privacy page** adds "unless raised for you on request" to the caps, dated 2026-10-16. Its
  changelog lines now carry their dates, so the older ones are not read as this revision's.
- **CLAUDE.md:** a paragraph in "Verifying a change": the deploy, its approval (any change under
  `firebase/functions/src` asks for one), the verification and break-glass. `operator:dev` was
  already in its testing section.

## Step 8: lock the audit retention (maintainer)

After 30 days of the bucket in use, lock its retention. It cannot be unlocked: from then on no
entry can be deleted before its 400 days are up, including by the owner. Then set the repository
variable `OPERATOR_AUDIT_LOCKED` to `true`, so the verification checks the lock from then on.

## Rolling back

Every step adds and removes nothing, so the scripts and the console keep working throughout.

- **Turn the page off at once:** empty IAP's access list.
- **Take it down:** delete the Cloud Run service.
- **Steps 1 and 2** can each be reverted alone. A profile that already carries an allowance then
  falls back to the defaults, until step 1 is back.

## Related

- **T139** replaces the rest of CI's keys with the keyless sign-in this plan uses from the start.
- **The caps** (10 members and 5 campaigns per group, 300 accounts) bound what founder links can
  cost.
- **A founder link leads somewhere**: account, group, first campaign, invitations.
- **Traffic** in the overview can come from Google Analytics, kept with consent; it counts
  only visitors who agreed.
- **T145** stores only hashes of invitation tokens, and **T146** gives the functions an account
  of their own ([residual risks](security-architecture.md#residual-risks) 4 and 5).
