# The operator page's Google Cloud setup: runbook

**T137**, [implementation plan](../../../../docs/architecture/operator/implementation-plan.md) step 4b ·
**Script** [`setup.sh`](setup.sh) · **Why each part exists**
[security architecture](../../../../docs/architecture/operator/security-architecture.md)

`setup.sh` creates everything the operator page needs in Google Cloud, up to a protected, empty
service: it serves Google's placeholder until the deploy pipeline (step 5) puts the real image
there. It is idempotent, so a second run changes nothing, and `--check` only reports. It never
deletes a service, a key or a log; it does remove a member from a policy that should hold exactly
one (the secret's readers, the service's invoker, IAP's access list), and says so as it does.

Run it once, as the project's owner, when step 0 is finished. It does not run in CI.

## Before you start

- [ ] **Step 0 is done**, items 5 to 7 included: hardware keys registered and 2-Step Verification
      enforced, the project moved into the `muninn.quest` organization, and
      `iam.allowedPolicyMemberDomains` overridden on the project to allow all. `setup.sh` refuses
      to change anything until the last two hold.
- [ ] **No deploy runs meanwhile**: nothing is merged to `main` while it runs.
- [ ] **Signed in as the owner**: `gcloud auth login` with the maintainer's account, and
      `gcloud config set project dnd-campaign-companion`.

**Where to run it.** [Cloud Shell](https://shell.cloud.google.com) has everything (`gcloud`,
`curl`, Python 3, `bash`):

```bash
git clone https://github.com/Haugenau20/Muninn.git
cd Muninn/firebase/functions/operator/infra
```

Git Bash on the maintainer's computer works too, with Python on the PATH. Run it from this folder
of an up-to-date `main`.

## Running it

1. `bash setup.sh --check`. Before the first run, every part from 1 on says `MISSING`, and part 0
   and part 8 say `ok`. Anything in part 0 or 8 that is `MISSING` means step 0 is unfinished: stop.
   One exception: while the Organization Policy API is off, which it is before the first run,
   part 0 and part 8 say the policies are *unreadable*. Go on: `bash setup.sh` enables the API
   first, then reads them.
2. `bash setup.sh`. A part that is created prints `setting`. It takes a few minutes, most of
   them in part 6.
3. `bash setup.sh --check` again. It must end with **Everything is in place.** If anything is
   still `MISSING`, run `bash setup.sh` once more and read the error it stops on.
4. Copy what it printed under **Findings** into [the record](#the-record) below, in a PR.

## What to check after each part

The script checks its own work; these are the checks only a person can make.

| Part | Check |
|---|---|
| 2 Accounts | IAM, Service accounts: four `operator-*` accounts, each with **no keys** (the organization forbids new ones) |
| 3 Registry | Artifact Registry: `operator` in `europe-west1`, with a cleanup policy |
| 4 Secret | Secret Manager, `operator-csrf-key`, Permissions: `operator-runtime@` alone holds Secret Accessor. Never open its value |
| 5 Federation | IAM, Workload Identity Federation: two pools, `operator-deploy` and `operator-verify`, each with one provider whose condition names this repository by id |
| 6 Service | Below |
| 7 Audit | Logging, Log Router: the `operator-audit` sink into the bucket of that name, 400 days, **not locked**. Monitoring, Alerting: two policies, sending to `admin@muninn.quest` |

**Part 6, the service.** Find its address with
`gcloud run services describe operator --region europe-west1 --format 'value(status.url)'`, then:

1. `curl -sI <address>` answers with a redirect to `accounts.google.com` or a 401 or 403, **never
   a 200**.
2. In a private window, open it signed in as some other Google account: IAP refuses it.
3. In the operator account's browser profile: Google asks for the passkey, then Google's
   placeholder ("It's running!") appears. The placeholder does not check who you are; the real
   service will.

## The operator's subject

`OPERATOR_SUBJECTS` is `accounts.google.com:` followed by the operator account's Google id: about
21 digits. The Admin console's address bar does not show it (its user pages carry an encoded id of letters
and digits). Read it from the Directory API instead: as the super admin, open the
reference page for `users.get` (developers.google.com, Admin SDK, Directory API), put the operator
account's address in *userKey* in its *Try this method* panel, and grant only *See info about
users on your domain*. The answer's `"id"` is the number. Remove the APIs Explorer's access from
the super admin's Google Account straight after (Security, third-party connections); it lapses by
itself after 7 days.

If it is wrong, step 6 shows it: the first visit to the real service is refused, the alert for a
refused request fires, and the refusal's line in the `operator-audit` bucket carries the `sub`
that arrived (`jsonPayload.operator.sub`).

## The GitHub side

The deploy waits for an environment only the maintainer can open, on `main` only
(security architecture, 9). From the maintainer's computer, with `gh` signed in:

```bash
# The environment, with the maintainer as its one reviewer.
gh api -X PUT repos/Haugenau20/Muninn/environments/operator --input - <<EOF
{"reviewers": [{"type": "User", "id": $(gh api user --jq .id)}],
 "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
EOF
# Deployments from main only.
gh api -X POST repos/Haugenau20/Muninn/environments/operator/deployment-branch-policies \
  -f name=main -f type=branch
```

Then run the `gh variable set` lines `setup.sh` printed last, with the subject from above. They are
repository variables, not secrets: none of them lets anyone in, and the verification workflow,
which runs without the environment, reads them too.

**In Git Bash on Windows, prefix them with `MSYS_NO_PATHCONV=1`.** Git Bash rewrites an argument
that starts with `/` into a Windows path, so `OPERATOR_IAP_AUDIENCE` was stored as
`C:/Program Files/Git/projects/…` (2026-10-15). Check with `gh variable list` afterwards.

## The pipeline (step 5)

- **Deploys:** `.github/workflows/operator-deploy.yml` runs after every successful main deploy. When
  the image's inputs changed since the last successful run, it waits for your approval in the
  `operator` environment (GitHub emails you; approve under the run, from a phone too). A run whose
  inputs did not change says so in its summary and asks nothing.
- **Deploying by hand:** after changing `OPERATOR_SUBJECTS`, the audience or the CSRF key, nothing
  in the repository changed: Actions → *Deploy the operator page* → *Run workflow* on `main`, which
  always deploys.
- **Checks:** `.github/workflows/operator-verify.yml` runs `verify.sh` beside this file after every
  deploy run and daily; a failure emails you. To run the same checks yourself, in Cloud Shell from
  this directory: `bash verify.sh`. It only reads.
- **A refused build or deploy** names the missing permission in the run's log. Add it to
  `setup.sh`, run `bash setup.sh`, and re-run the failed job; never grant it by hand.

## What setup does not settle

Two open questions from the plan's step 4a, for the deploy pipeline (step 5):

- **Whether `roles/run.developer` can switch IAP off.** It holds `run.services.update`, the
  permission `--no-iap` uses, so assume it can. The verification after every deploy fails if IAP
  is off, and the service's own identity check refuses every request either way.
- **Which roles a Cloud Build submission needs.** Settled by the first run (2026-10-16): the build
  went through with Cloud Build Editor and Service Usage Consumer on the project, Storage Object
  Creator and Legacy Bucket Reader on the source bucket, and acting as the builder. The deploy
  after it was refused `artifactregistry.repositories.downloadArtifacts` on the repository, so
  the deployer now also reads it (Artifact Registry Reader, part 3).

The first question is not settled by a deploy, which never tries `--no-iap`; it stays assumed.

## Undoing it

Nothing here holds data before go-live. In reverse order, each part's `create` has a `delete`:
the service (`gcloud run services delete operator`), the pools, the secret, the bucket, the
repository, the alerts, the sink and bucket (not once locked), the custom role and the accounts.
The audit configuration is one entry in the project's IAM policy. The plan's
[rolling back](../../../../docs/architecture/operator/implementation-plan.md#rolling-back) covers
the page after go-live.

## The record

What a run found that the documents should keep. Fill in at step 4b.

| Date | Finding |
|---|---|
| 2026-10-15 | Re-authentication method set: `SECURE_KEY` (3600 s, `MINIMUM`) |
| 2026-10-15 | Audit bucket retention not locked; lock it 30 days after go-live (plan, step 8) |
| 2026-10-15 | `iam.serviceAccountKeyExposureResponse` reads as `denyAll`: WAIT_FOR_ABUSE not chosen, so exposed keys are disabled |
| 2026-10-15 | Part 6: an anonymous request gets a 302 to `accounts.google.com` from IAP; another Google account is refused; the operator account reaches the placeholder |
| 2026-10-15 | The four `operator-*` service accounts hold no user-managed keys |
| 2026-10-16 | First pipeline run: the build went through; the deploy was refused `artifactregistry.repositories.downloadArtifacts` on the `operator` repository; the deployer now reads it (part 3) |
| 2026-10-16 | Second run deployed the image. The first verification failed both IAP policy reads: `gcloud iap web get-iam-policy` looks the project up in Resource Manager, which the verifier may not; `verify.sh` now reads them from the IAP API by project number. Every other check passed against the live service |
