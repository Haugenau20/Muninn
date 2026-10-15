#!/usr/bin/env bash
# firebase/functions/operator/infra/setup.sh
#
# Sets up the operator page's Google Cloud side (T137; implementation plan,
# step 4a; docs/architecture/operator/security-architecture.md). Run by the
# maintainer under the project owner's login, never by CI. The runbook beside
# it (README.md) says when, and what to check after each part.
#
#   bash setup.sh --check   reports every part, changes nothing, exits 1 if any is missing
#   bash setup.sh           sets up whatever is missing or wrong, then reports
#
# Idempotent: a second run changes nothing. It refuses to change anything
# until the project is in the organization and its domain policy is overridden
# (plan, step 0), and it never deletes a service, a key or a log.
#
# In order:
#   1  APIs
#   2  service accounts and their project roles; the verifier's read-only role
#   3  Artifact Registry: the `operator` repository, its cleanup policy, the
#      bucket builds are submitted through
#   4  Secret Manager: the CSRF key, readable by operator-runtime@ only
#   5  Workload Identity Federation: one pool per workflow, each admitting
#      that workflow on `main` of this repository only
#   6  the service, from Google's placeholder image, with IAP and the invoker
#      check on; the invoker, the IAP access list, re-authentication
#   7  audit: IAP's Data Access logs, the `operator-audit` bucket and sink,
#      the two alerts
#   8  organization policies (checked, never set: step 0 sets them)
#
# Settings can be overridden from the environment, e.g.
#   ALERT_EMAIL=someone@example.com bash setup.sh

set -euo pipefail

PROJECT="${PROJECT:-dnd-campaign-companion}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-operator}"
# The one account IAP admits (security architecture, layer 1).
OPERATOR_MEMBER="${OPERATOR_MEMBER:-user:operator@muninn.quest}"
# Where the alerts go: forwarded to the maintainer (plan, step 0).
ALERT_EMAIL="${ALERT_EMAIL:-admin@muninn.quest}"
# The repository by its id, which survives a rename and cannot be claimed by a
# new repository of the same name (`gh api repos/Haugenau20/Muninn --jq .id`).
GITHUB_REPO="${GITHUB_REPO:-Haugenau20/Muninn}"
GITHUB_REPO_ID="${GITHUB_REPO_ID:-945904005}"

PLACEHOLDER_IMAGE="us-docker.pkg.dev/cloudrun/container/hello"
CSRF_SECRET="operator-csrf-key"
AUDIT_BUCKET="operator-audit"
SOURCE_BUCKET="${PROJECT}-operator-source"
VERIFIER_ROLE="operatorVerifier"
DEPLOY_POOL="operator-deploy"
VERIFY_POOL="operator-verify"
DEPLOY_WORKFLOW=".github/workflows/operator-deploy.yml"
VERIFY_WORKFLOW=".github/workflows/operator-verify.yml"

MODE="apply"
case "${1:-}" in
  --check) MODE="check" ;;
  "") ;;
  *) echo "usage: bash setup.sh [--check]" >&2; exit 2 ;;
esac

# A Python that runs: Cloud Shell has python3; on Windows, python3 can be a
# stub that only opens the Store.
PY=""
for candidate in python3 python; do
  if "$candidate" -c "import json" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
[[ -n "$PY" ]] || { echo "setup.sh needs Python 3 for reading JSON." >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PROBLEMS=0
FINDINGS=()

step() { printf '\n%s\n' "$*"; }
ok() { printf '  ok       %s\n' "$*"; }
missing() { printf '  MISSING  %s\n' "$*"; PROBLEMS=$((PROBLEMS + 1)); }
setting() { printf '  setting  %s\n' "$*"; }

# ensure DESCRIPTION TEST...: says whether the thing is in place; returns 0
# only when it is not and this run should put it there.
ensure() {
  local what="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$what"; return 1; fi
  if [[ "$MODE" == "check" ]]; then missing "$what"; return 1; fi
  setting "$what"
  return 0
}

# Read a field from JSON on stdin: `json 'd["a"]["b"]'` prints it, or nothing.
json() {
  "$PY" -c 'import json, sys
try:
    d = json.load(sys.stdin)
    v = eval(sys.argv[1])
except Exception:
    sys.exit(0)
print(v if not isinstance(v, (dict, list)) else json.dumps(v, sort_keys=True))' "$1"
}

# A REST call as the signed-in account, for what gcloud only has in its beta
# and alpha components, which a plain install lacks.
api() {
  local method="$1" url="$2" body="${3:-}"
  local args=(-sS --fail-with-body -X "$method"
    -H "Authorization: Bearer $(gcloud auth print-access-token)"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}" "$url"
}

# has_binding ROLE MEMBER GET-IAM-POLICY-COMMAND...
# Matches the printed pairs rather than using --filter, which
# `gcloud storage buckets get-iam-policy` refuses: the bucket's bindings read
# as missing on every check, though they were there (2026-10-15).
has_binding() {
  local role="$1" member="$2"; shift 2
  "$@" --flatten="bindings[].members" --format="value(bindings.role,bindings.members)" 2>/dev/null \
    | grep -qxF "${role}"$'\t'"${member}"
}

# members ROLE GET-IAM-POLICY-COMMAND...: every member holding ROLE.
members() {
  local role="$1"; shift
  "$@" --flatten="bindings[].members" --filter="bindings.role=\"${role}\"" \
    --format="value(bindings.members)" 2>/dev/null || true
}

NUMBER="$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")"
sa() { echo "$1@${PROJECT}.iam.gserviceaccount.com"; }
RUNTIME_SA="$(sa operator-runtime)"
DEPLOYER_SA="$(sa operator-deployer)"
BUILDER_SA="$(sa operator-builder)"
VERIFIER_SA="$(sa operator-verifier)"
IAP_AGENT="service-${NUMBER}@gcp-sa-iap.iam.gserviceaccount.com"
POOLS="projects/${NUMBER}/locations/global/workloadIdentityPools"

echo "Project ${PROJECT} (${NUMBER}), region ${REGION}, mode: ${MODE}"

# ---------------------------------------------------------------------------
# 0  Preconditions
# ---------------------------------------------------------------------------
step "0  Preconditions (plan, step 0)"

PARENT="$(gcloud projects describe "$PROJECT" --format="value(parent.type,parent.id)")"
in_organization() { [[ "$PARENT" == organization* ]]; }

# The policies are read through the Organization Policy API. Until it is
# enabled on the project every read fails, which looked like a missing policy
# and stopped the first run here, before part 1 could enable it (2026-10-15).
orgpolicy_enabled() {
  gcloud services list --enabled --project="$PROJECT" \
    --filter="config.name=orgpolicy.googleapis.com" --format="value(config.name)" 2>/dev/null \
    | grep -q .
}
POLICIES_READABLE=false
if ensure "orgpolicy.googleapis.com, to read the policies" orgpolicy_enabled; then
  gcloud services enable orgpolicy.googleapis.com --project="$PROJECT"
fi
orgpolicy_enabled && POLICIES_READABLE=true
UNREADABLE="unreadable while orgpolicy.googleapis.com is off; \`bash setup.sh\` enables it"

domain_overridden() {
  gcloud org-policies describe iam.allowedPolicyMemberDomains --project="$PROJECT" \
    --format=json 2>/dev/null | json 'any(r.get("allowAll") for r in d["spec"]["rules"])' \
    | grep -q True
}
# An API just enabled can take a minute to answer, so a run that enabled it
# asks a few times before calling the policy missing.
domain_overridden_soon() {
  local tries=6
  until domain_overridden; do
    tries=$((tries - 1))
    [[ "$MODE" == "apply" && "$tries" -gt 0 ]] || return 1
    sleep 10
  done
}
READY=true
if in_organization; then ok "in an organization (${PARENT##*[[:space:]]})"
else missing "in an organization: the project has none yet"; READY=false; fi
if [[ "$POLICIES_READABLE" != true ]]; then
  missing "iam.allowedPolicyMemberDomains: ${UNREADABLE}"; READY=false
elif domain_overridden_soon; then ok "iam.allowedPolicyMemberDomains overridden to allow all"
else missing "iam.allowedPolicyMemberDomains overridden to allow all on the project"; READY=false; fi

if [[ "$MODE" == "apply" && "$READY" != true ]]; then
  echo
  echo "Nothing was changed. Finish step 0 first: move the project into the organization,"
  echo "then override its domain policy (README.md, before you start)."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1  APIs
# ---------------------------------------------------------------------------
step "1  APIs"

ENABLED="$(gcloud services list --enabled --project="$PROJECT" --format="value(config.name)")"
for api_name in run iap cloudbuild artifactregistry secretmanager iam iamcredentials sts \
    logging monitoring orgpolicy cloudresourcemanager; do
  name="${api_name}.googleapis.com"
  if ensure "$name" grep -qx "$name" <<<"$ENABLED"; then
    gcloud services enable "$name" --project="$PROJECT"
  fi
done

# ---------------------------------------------------------------------------
# 2  Service accounts and project roles
# ---------------------------------------------------------------------------
step "2  Service accounts and their project roles"

for account in operator-runtime operator-deployer operator-builder operator-verifier; do
  if ensure "$(sa "$account")" gcloud iam service-accounts describe "$(sa "$account")" --project="$PROJECT"; then
    gcloud iam service-accounts create "$account" --project="$PROJECT" \
      --display-name="Operator page: ${account#operator-}"
  fi
done

# The verifier reads and changes nothing else (security architecture, 10).
# No predefined role reads IAP's settings and access list without also
# changing them, so it gets a custom one.
VERIFIER_PERMISSIONS="iap.web.getIamPolicy,iap.web.getSettings,iap.webServices.getIamPolicy,\
iap.webServices.getSettings,iap.webServiceVersions.getIamPolicy,iap.webServiceVersions.getSettings,\
iap.webTypes.getIamPolicy,iap.webTypes.getSettings,logging.buckets.get,logging.sinks.get,\
run.services.get,run.services.getIamPolicy"
verifier_role_current() {
  [[ "$(gcloud iam roles describe "$VERIFIER_ROLE" --project="$PROJECT" \
    --format="value(includedPermissions)" 2>/dev/null | tr ';' '\n' | sort | paste -sd, -)" \
    == "$(tr ',' '\n' <<<"$VERIFIER_PERMISSIONS" | sort | paste -sd, -)" ]]
}
if ensure "custom role ${VERIFIER_ROLE}, exactly its read permissions" verifier_role_current; then
  if gcloud iam roles describe "$VERIFIER_ROLE" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud iam roles update "$VERIFIER_ROLE" --project="$PROJECT" --quiet \
      --permissions="$VERIFIER_PERMISSIONS"
  else
    gcloud iam roles create "$VERIFIER_ROLE" --project="$PROJECT" --quiet \
      --title="Operator page verifier" --stage=GA \
      --description="Reads the operator service, its IAP settings and access list, and the audit sink" \
      --permissions="$VERIFIER_PERMISSIONS"
  fi
fi

project_role() {
  local member="$1" role="$2"
  if ensure "${member} has ${role}" has_binding "$role" "$member" \
      gcloud projects get-iam-policy "$PROJECT"; then
    gcloud projects add-iam-policy-binding "$PROJECT" --member="$member" --role="$role" \
      --condition=None --quiet >/dev/null
  fi
}
# operator-runtime@ (security architecture, 6); its secret comes in part 4.
project_role "serviceAccount:${RUNTIME_SA}" roles/datastore.user
project_role "serviceAccount:${RUNTIME_SA}" roles/firebaseauth.viewer
project_role "serviceAccount:${RUNTIME_SA}" roles/logging.logWriter
# operator-builder@: its own logs; the repository and bucket in part 3.
project_role "serviceAccount:${BUILDER_SA}" roles/logging.logWriter
# operator-deployer@: submits builds; its role on the service comes in part 6.
project_role "serviceAccount:${DEPLOYER_SA}" roles/cloudbuild.builds.editor
project_role "serviceAccount:${DEPLOYER_SA}" roles/serviceusage.serviceUsageConsumer
project_role "serviceAccount:${VERIFIER_SA}" "projects/${PROJECT}/roles/${VERIFIER_ROLE}"

# The deployer acts as the runtime (to deploy) and the builder (to build), and
# as nothing else.
for target in "$RUNTIME_SA" "$BUILDER_SA"; do
  if ensure "${DEPLOYER_SA} may act as ${target}" has_binding roles/iam.serviceAccountUser \
      "serviceAccount:${DEPLOYER_SA}" gcloud iam service-accounts get-iam-policy "$target" \
      --project="$PROJECT"; then
    gcloud iam service-accounts add-iam-policy-binding "$target" --project="$PROJECT" \
      --member="serviceAccount:${DEPLOYER_SA}" --role=roles/iam.serviceAccountUser --quiet >/dev/null
  fi
done

# ---------------------------------------------------------------------------
# 3  Artifact Registry and the build source bucket
# ---------------------------------------------------------------------------
step "3  Artifact Registry"

if ensure "repository ${SERVICE} in ${REGION}" gcloud artifacts repositories describe "$SERVICE" \
    --location="$REGION" --project="$PROJECT"; then
  gcloud artifacts repositories create "$SERVICE" --repository-format=docker \
    --location="$REGION" --project="$PROJECT" --description="The operator page's images"
fi

# The newest ten images stay; anything else goes after 30 days.
cat >"$TMP/cleanup.json" <<'JSON'
[
  {"name": "keep-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 10}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"olderThan": "30d"}}
]
JSON
has_cleanup_policy() {
  [[ -n "$(gcloud artifacts repositories describe "$SERVICE" --location="$REGION" \
    --project="$PROJECT" --format="value(cleanupPolicies)" 2>/dev/null)" ]]
}
if ensure "repository ${SERVICE} has a cleanup policy" has_cleanup_policy; then
  gcloud artifacts repositories set-cleanup-policies "$SERVICE" --location="$REGION" \
    --project="$PROJECT" --policy="$TMP/cleanup.json" --no-dry-run >/dev/null
fi

if ensure "${BUILDER_SA} writes to ${SERVICE}" has_binding roles/artifactregistry.writer \
    "serviceAccount:${BUILDER_SA}" gcloud artifacts repositories get-iam-policy "$SERVICE" \
    --location="$REGION" --project="$PROJECT"; then
  gcloud artifacts repositories add-iam-policy-binding "$SERVICE" --location="$REGION" \
    --project="$PROJECT" --member="serviceAccount:${BUILDER_SA}" \
    --role=roles/artifactregistry.writer --quiet >/dev/null
fi

# `gcloud builds submit` uploads the source first. A bucket of its own keeps
# the deployer off the project's default one; uploads go after a week.
if ensure "bucket gs://${SOURCE_BUCKET}" gcloud storage buckets describe "gs://${SOURCE_BUCKET}" \
    --project="$PROJECT"; then
  gcloud storage buckets create "gs://${SOURCE_BUCKET}" --project="$PROJECT" \
    --location="$REGION" --uniform-bucket-level-access --public-access-prevention
  echo '{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 7}}]}' >"$TMP/lifecycle.json"
  gcloud storage buckets update "gs://${SOURCE_BUCKET}" --lifecycle-file="$TMP/lifecycle.json" >/dev/null
fi
bucket_role() {
  local member="$1" role="$2"
  if ensure "${member} has ${role} on gs://${SOURCE_BUCKET}" has_binding "$role" "$member" \
      gcloud storage buckets get-iam-policy "gs://${SOURCE_BUCKET}"; then
    gcloud storage buckets add-iam-policy-binding "gs://${SOURCE_BUCKET}" \
      --member="$member" --role="$role" >/dev/null
  fi
}
bucket_role "serviceAccount:${DEPLOYER_SA}" roles/storage.objectCreator
bucket_role "serviceAccount:${DEPLOYER_SA}" roles/storage.legacyBucketReader
bucket_role "serviceAccount:${BUILDER_SA}" roles/storage.objectViewer

# ---------------------------------------------------------------------------
# 4  The CSRF key
# ---------------------------------------------------------------------------
step "4  Secret Manager"

if ensure "secret ${CSRF_SECRET}" gcloud secrets describe "$CSRF_SECRET" --project="$PROJECT"; then
  # 48 random bytes, base64: the service wants 32 or more. Never printed.
  head -c 48 /dev/urandom | base64 | tr -d '\n' | gcloud secrets create "$CSRF_SECRET" \
    --project="$PROJECT" --replication-policy=user-managed --locations="$REGION" --data-file=- >/dev/null
fi
SECRET_READERS="$(members roles/secretmanager.secretAccessor \
  gcloud secrets get-iam-policy "$CSRF_SECRET" --project="$PROJECT")"
if ensure "only ${RUNTIME_SA} reads ${CSRF_SECRET}" \
    test "$SECRET_READERS" == "serviceAccount:${RUNTIME_SA}"; then
  gcloud secrets add-iam-policy-binding "$CSRF_SECRET" --project="$PROJECT" \
    --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
  while read -r member; do
    [[ -z "$member" || "$member" == "serviceAccount:${RUNTIME_SA}" ]] && continue
    echo "           removing ${member}"
    gcloud secrets remove-iam-policy-binding "$CSRF_SECRET" --project="$PROJECT" \
      --member="$member" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
  done <<<"$SECRET_READERS"
fi

# ---------------------------------------------------------------------------
# 5  Workload Identity Federation
# ---------------------------------------------------------------------------
step "5  Workload Identity Federation"

# One pool per workflow, so a token one workflow gets can never act as the
# other's account. The deploy also needs the `operator` environment, which
# only the maintainer's approval opens (security architecture, 9).
condition_for() {
  local workflow="$1" extra="${2:-}"
  printf "assertion.repository_id == '%s' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '%s/%s@refs/heads/main'%s" \
    "$GITHUB_REPO_ID" "$GITHUB_REPO" "$workflow" "$extra"
}
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref,attribute.environment=assertion.environment"

federate() {
  local pool="$1" account="$2" condition="$3"
  if ensure "pool ${pool}" gcloud iam workload-identity-pools describe "$pool" \
      --location=global --project="$PROJECT"; then
    gcloud iam workload-identity-pools create "$pool" --location=global --project="$PROJECT" \
      --display-name="GitHub: ${pool}" >/dev/null
  fi
  local current
  current="$(gcloud iam workload-identity-pools providers describe github --location=global \
    --workload-identity-pool="$pool" --project="$PROJECT" --format="value(attributeCondition)" 2>/dev/null || true)"
  if ensure "pool ${pool}: provider github, admitting only its workflow" test "$current" == "$condition"; then
    if [[ -z "$current" ]]; then
      gcloud iam workload-identity-pools providers create-oidc github --location=global \
        --workload-identity-pool="$pool" --project="$PROJECT" \
        --issuer-uri="https://token.actions.githubusercontent.com" \
        --attribute-mapping="$MAPPING" --attribute-condition="$condition" >/dev/null
    else
      gcloud iam workload-identity-pools providers update-oidc github --location=global \
        --workload-identity-pool="$pool" --project="$PROJECT" \
        --attribute-mapping="$MAPPING" --attribute-condition="$condition" >/dev/null
    fi
  fi
  local principal="principalSet://iam.googleapis.com/${POOLS}/${pool}/*"
  if ensure "pool ${pool} may act as ${account}" has_binding roles/iam.workloadIdentityUser \
      "$principal" gcloud iam service-accounts get-iam-policy "$account" --project="$PROJECT"; then
    gcloud iam service-accounts add-iam-policy-binding "$account" --project="$PROJECT" \
      --member="$principal" --role=roles/iam.workloadIdentityUser --quiet >/dev/null
  fi
}
federate "$DEPLOY_POOL" "$DEPLOYER_SA" \
  "$(condition_for "$DEPLOY_WORKFLOW" " && assertion.environment == 'operator'")"
federate "$VERIFY_POOL" "$VERIFIER_SA" "$(condition_for "$VERIFY_WORKFLOW")"

# ---------------------------------------------------------------------------
# 6  The service
# ---------------------------------------------------------------------------
step "6  The service"

service_json() {
  gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" --format=json 2>/dev/null
}
# Created once, from Google's placeholder, so it exists, protected, before
# any pipeline can deploy to it (security architecture, 9). Never redeployed
# here: from step 5 on, it runs the real image.
if ensure "service ${SERVICE} exists" service_json; then
  gcloud run deploy "$SERVICE" --image="$PLACEHOLDER_IMAGE" --region="$REGION" --project="$PROJECT" \
    --service-account="$RUNTIME_SA" --no-allow-unauthenticated --iap --invoker-iam-check \
    --ingress=all --min-instances=0 --max-instances=1 --concurrency=20 --timeout=30 --quiet
fi

iap_on() {
  service_json | json 'd["metadata"]["annotations"].get("run.googleapis.com/iap-enabled")' | grep -qx true
}
invoker_check_on() {
  ! service_json | json 'd["metadata"]["annotations"].get("run.googleapis.com/invoker-iam-disabled")' \
    | grep -qx true
}
runs_as_runtime() {
  service_json | json 'd["spec"]["template"]["spec"]["serviceAccountName"]' | grep -qx "$RUNTIME_SA"
}
if service_json >/dev/null; then
  if ensure "IAP is on" iap_on; then
    gcloud run services update "$SERVICE" --region="$REGION" --project="$PROJECT" --iap --quiet
  fi
  if ensure "the invoker check is on" invoker_check_on; then
    gcloud run services update "$SERVICE" --region="$REGION" --project="$PROJECT" \
      --invoker-iam-check --quiet
  fi
  # Reported, never changed here: the deploy pipeline (step 5) sets it.
  if runs_as_runtime; then ok "runs as ${RUNTIME_SA}"
  else missing "runs as ${RUNTIME_SA}: the next deploy must set it"; fi

  if [[ "$MODE" == "apply" ]]; then
    # Makes sure IAP's service agent exists; does nothing when it does.
    api POST "https://serviceusage.googleapis.com/v1beta1/projects/${NUMBER}/services/iap.googleapis.com:generateServiceIdentity" >/dev/null
  fi

  # Only IAP may invoke it: never allUsers, never allAuthenticatedUsers.
  exactly() {
    local role="$1" want="$2" what="$3"; shift 3
    local have
    have="$(members "$role" "$@")"
    if ensure "${what}: exactly ${want}" test "$have" == "$want"; then
      "${@/get-iam-policy/add-iam-policy-binding}" --member="$want" --role="$role" --quiet >/dev/null
      while read -r member; do
        [[ -z "$member" || "$member" == "$want" ]] && continue
        echo "           removing ${member}"
        "${@/get-iam-policy/remove-iam-policy-binding}" --member="$member" --role="$role" --quiet >/dev/null
      done <<<"$have"
    fi
  }
  exactly roles/run.invoker "serviceAccount:${IAP_AGENT}" "invoker" \
    gcloud run services get-iam-policy "$SERVICE" --region="$REGION" --project="$PROJECT"
  exactly roles/iap.httpsResourceAccessor "$OPERATOR_MEMBER" "IAP access list" \
    gcloud iap web get-iam-policy --resource-type=cloud-run --service="$SERVICE" \
    --region="$REGION" --project="$PROJECT"

  # The deployer rolls out revisions of this one service: it cannot create
  # services or change who may reach this one.
  if ensure "${DEPLOYER_SA} is a developer of ${SERVICE}" has_binding roles/run.developer \
      "serviceAccount:${DEPLOYER_SA}" gcloud run services get-iam-policy "$SERVICE" \
      --region="$REGION" --project="$PROJECT"; then
    gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" --project="$PROJECT" \
      --member="serviceAccount:${DEPLOYER_SA}" --role=roles/run.developer --quiet >/dev/null
  fi

  # Re-authentication every hour, by security key if IAP offers it for this
  # account type, by sign-in otherwise (security architecture, 2).
  iap_settings() {
    gcloud iap settings get --resource-type=cloud-run --service="$SERVICE" --region="$REGION" \
      --project="$PROJECT" --format=json 2>/dev/null
  }
  REAUTH="$(iap_settings | json '"%s %s %s" % tuple(d["accessSettings"]["reauthSettings"].get(k) for k in ("method", "maxAge", "policyType"))')"
  reauth_set() { [[ "$REAUTH" == "SECURE_KEY 3600s MINIMUM" || "$REAUTH" == "LOGIN 3600s MINIMUM" ]]; }
  if ensure "re-authentication every hour (${REAUTH:-none})" reauth_set; then
    for method in SECURE_KEY LOGIN; do
      printf 'accessSettings:\n  reauthSettings:\n    method: %s\n    maxAge: 3600s\n    policyType: MINIMUM\n' \
        "$method" >"$TMP/iap.yaml"
      if gcloud iap settings set "$TMP/iap.yaml" --resource-type=cloud-run --service="$SERVICE" \
          --region="$REGION" --project="$PROJECT" >/dev/null 2>"$TMP/iap.err"; then
        FINDINGS+=("Re-authentication: ${method}$([[ $method == LOGIN ]] && echo " (SECURE_KEY was refused: $(head -c 300 "$TMP/iap.err"))")")
        break
      fi
      [[ "$method" == LOGIN ]] && { cat "$TMP/iap.err" >&2; exit 1; }
    done
  elif [[ -n "$REAUTH" ]]; then
    FINDINGS+=("Re-authentication: ${REAUTH%% *}")
  fi
fi

# ---------------------------------------------------------------------------
# 7  Audit
# ---------------------------------------------------------------------------
step "7  Audit"

# IAP's Data Access logs: Google's record of every request it let through or
# turned away, whatever our code does.
iap_audit_on() {
  gcloud projects get-iam-policy "$PROJECT" --format=json \
    | json '[t["logType"] for c in d.get("auditConfigs", []) if c["service"] == "iap.googleapis.com" for t in c["auditLogConfigs"]]' \
    | grep -q DATA_READ
}
if ensure "IAP Data Access logs" iap_audit_on; then
  # Read, change only the audit configuration, write back under the same
  # etag: a policy changed meanwhile makes the write fail, not vanish.
  gcloud projects get-iam-policy "$PROJECT" --format=json >"$TMP/policy.json"
  "$PY" - "$TMP/policy.json" <<'PYTHON'
import json, sys
path = sys.argv[1]
policy = json.load(open(path))
configs = policy.setdefault("auditConfigs", [])
iap = next((c for c in configs if c["service"] == "iap.googleapis.com"), None)
if iap is None:
    iap = {"service": "iap.googleapis.com", "auditLogConfigs": []}
    configs.append(iap)
types = {t["logType"] for t in iap["auditLogConfigs"]}
for log_type in ("ADMIN_READ", "DATA_READ"):
    if log_type not in types:
        iap["auditLogConfigs"].append({"logType": log_type})
json.dump(policy, open(path, "w"))
PYTHON
  gcloud projects set-iam-policy "$PROJECT" "$TMP/policy.json" --quiet >/dev/null
fi

# Kept 400 days. Locked only after a 30-day trial (plan, step 8): a lock
# cannot be undone, by anyone.
bucket_ok() {
  gcloud logging buckets describe "$AUDIT_BUCKET" --location="$REGION" --project="$PROJECT" \
    --format="value(retentionDays)" 2>/dev/null | grep -qx 400
}
if ensure "log bucket ${AUDIT_BUCKET}, 400 days" bucket_ok; then
  if gcloud logging buckets describe "$AUDIT_BUCKET" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud logging buckets update "$AUDIT_BUCKET" --location="$REGION" --project="$PROJECT" \
      --retention-days=400 >/dev/null
  else
    gcloud logging buckets create "$AUDIT_BUCKET" --location="$REGION" --project="$PROJECT" \
      --retention-days=400 --description="The operator page's audit trail, and IAP's" >/dev/null
  fi
fi
LOCKED="$(gcloud logging buckets describe "$AUDIT_BUCKET" --location="$REGION" --project="$PROJECT" \
  --format="value(locked)" 2>/dev/null || true)"
FINDINGS+=("Audit bucket retention locked: ${LOCKED:-no} (lock it 30 days after go-live, plan step 8)")

# Our audit lines, and IAP's own record of the same requests.
AUDIT_LINES="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND jsonPayload.type=\"operator_audit\""
SINK_FILTER="(${AUDIT_LINES}) OR protoPayload.serviceName=\"iap.googleapis.com\""
SINK_DESTINATION="logging.googleapis.com/projects/${PROJECT}/locations/${REGION}/buckets/${AUDIT_BUCKET}"
sink_ok() {
  [[ "$(gcloud logging sinks describe "$AUDIT_BUCKET" --project="$PROJECT" \
    --format="value(destination,filter)" 2>/dev/null)" == "${SINK_DESTINATION}"$'\t'"${SINK_FILTER}" ]]
}
if ensure "sink ${AUDIT_BUCKET} into the bucket" sink_ok; then
  if gcloud logging sinks describe "$AUDIT_BUCKET" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud logging sinks update "$AUDIT_BUCKET" "$SINK_DESTINATION" --project="$PROJECT" \
      --log-filter="$SINK_FILTER" --quiet >/dev/null
  else
    gcloud logging sinks create "$AUDIT_BUCKET" "$SINK_DESTINATION" --project="$PROJECT" \
      --log-filter="$SINK_FILTER" --quiet >/dev/null
  fi
fi

# The alerts email the maintainer (security architecture, 7).
CHANNELS_URL="https://monitoring.googleapis.com/v3/projects/${PROJECT}/notificationChannels"
# The channel that emails ALERT_EMAIL, if there is one.
channel() {
  api GET "${CHANNELS_URL}?filter=type%3D%22email%22" 2>/dev/null | ALERT_EMAIL="$ALERT_EMAIL" "$PY" -c '
import json, os, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for c in d.get("notificationChannels", []):
    if c.get("labels", {}).get("email_address") == os.environ["ALERT_EMAIL"]:
        print(c["name"]); break'
}
CHANNEL="$(channel)"
if ensure "email channel to ${ALERT_EMAIL}" test -n "$CHANNEL"; then
  api POST "$CHANNELS_URL" \
    "{\"type\": \"email\", \"displayName\": \"Operator page\", \"labels\": {\"email_address\": \"${ALERT_EMAIL}\"}}" >/dev/null
  CHANNEL="$(channel)"
fi

alert() {
  local name="$1" filter="$2" what="$3"
  local existing
  existing="$(gcloud monitoring policies list --project="$PROJECT" \
    --filter="displayName=\"${name}\"" --format="value(name)" 2>/dev/null | head -1)"
  local current=""
  [[ -n "$existing" ]] && current="$(gcloud monitoring policies describe "$existing" --format=json \
    | json 'd["conditions"][0]["conditionMatchedLog"]["filter"]')"
  if ensure "alert \"${name}\"" test "$current" == "$filter"; then
    FILTER="$filter" NAME="$name" WHAT="$what" CHANNEL="$CHANNEL" "$PY" -c '
import json, os
print(json.dumps({
    "displayName": os.environ["NAME"],
    "combiner": "OR",
    "conditions": [{
        "displayName": os.environ["NAME"],
        "conditionMatchedLog": {
            "filter": os.environ["FILTER"],
            "labelExtractors": {
                "action": "EXTRACT(jsonPayload.action)",
                "operator": "EXTRACT(jsonPayload.operator.email)",
                "reason": "EXTRACT(jsonPayload.reason)",
            },
        },
    }],
    "alertStrategy": {"notificationRateLimit": {"period": "300s"}, "autoClose": "1800s"},
    "notificationChannels": [os.environ["CHANNEL"]] if os.environ["CHANNEL"] else [],
    "documentation": {"mimeType": "text/markdown", "content": os.environ["WHAT"]},
    "severity": "WARNING",
}))' >"$TMP/alert.json"
    if [[ -n "$existing" ]]; then
      gcloud monitoring policies update "$existing" --policy-from-file="$TMP/alert.json" --quiet >/dev/null
    else
      gcloud monitoring policies create --project="$PROJECT" --policy-from-file="$TMP/alert.json" >/dev/null
    fi
  fi
}
alert "Operator page: an action changed something" \
  "${AUDIT_LINES} AND jsonPayload.outcome=\"ok\" AND jsonPayload.action=(\"founder_link.issue\" OR \"founder_link.revoke\" OR \"allowance.set\" OR \"allowance.clear\")" \
  "The operator page changed something. If it was not you, follow *Suspected compromise* in docs/architecture/operator/security-architecture.md."
alert "Operator page: IAP admitted a request the service refused" \
  "${AUDIT_LINES} AND jsonPayload.action=(\"identity.refused\" OR \"csrf.refused\")" \
  "Identity-Aware Proxy let a request through and the service turned it away: a misconfiguration, or an attack. Read the audit bucket for the window."

# ---------------------------------------------------------------------------
# 8  Organization policies: checked, never set here
# ---------------------------------------------------------------------------
step "8  Organization policies (security architecture, 1a)"

enforced() {
  gcloud org-policies describe "$1" --project="$PROJECT" --effective --format=json 2>/dev/null \
    | json 'any(r.get("enforce") for r in d["spec"]["rules"])' | grep -q True
}
# Google disables an exposed key unless WAIT_FOR_ABUSE is chosen (its
# announcement, June 2024). The organization's default reads as `denyAll`,
# which chooses nothing and so disables; allowing WAIT_FOR_ABUSE, or all
# values, does not.
disables_exposed_keys() {
  gcloud org-policies describe iam.serviceAccountKeyExposureResponse --project="$PROJECT" \
    --effective --format=json 2>/dev/null \
    | json 'not any(r.get("allowAll") or "WAIT_FOR_ABUSE" in r.get("values", {}).get("allowedValues", []) for r in d["spec"]["rules"])' \
    | grep -q True
}
if [[ "$POLICIES_READABLE" != true ]]; then
  missing "the organization policies: ${UNREADABLE}"
else
  for constraint in iam.managed.disableServiceAccountKeyCreation iam.disableServiceAccountKeyUpload; do
    if enforced "$constraint"; then ok "${constraint} enforced"; else missing "${constraint} enforced"; fi
  done
  if disables_exposed_keys; then ok "iam.serviceAccountKeyExposureResponse disables an exposed key"
  else missing "iam.serviceAccountKeyExposureResponse disables an exposed key"; fi
  # Checked in part 0; repeated here so --check lists every policy together.
  if domain_overridden; then ok "iam.allowedPolicyMemberDomains allows all on the project"
  else missing "iam.allowedPolicyMemberDomains allows all on the project"; fi
fi

# ---------------------------------------------------------------------------
# What to record
# ---------------------------------------------------------------------------
step "Findings (write them into the runbook's record)"
for finding in "${FINDINGS[@]}"; do echo "  ${finding}"; done

step "GitHub variables (README.md, the GitHub side)"
cat <<EOF
  gh variable set OPERATOR_PROJECT --body "${PROJECT}"
  gh variable set OPERATOR_REGION --body "${REGION}"
  gh variable set OPERATOR_IAP_AUDIENCE --body "/projects/${NUMBER}/locations/${REGION}/services/${SERVICE}"
  gh variable set OPERATOR_DEPLOY_PROVIDER --body "${POOLS}/${DEPLOY_POOL}/providers/github"
  gh variable set OPERATOR_VERIFY_PROVIDER --body "${POOLS}/${VERIFY_POOL}/providers/github"
  gh variable set OPERATOR_DEPLOYER --body "${DEPLOYER_SA}"
  gh variable set OPERATOR_BUILDER --body "${BUILDER_SA}"
  gh variable set OPERATOR_RUNTIME --body "${RUNTIME_SA}"
  gh variable set OPERATOR_VERIFIER --body "${VERIFIER_SA}"
  gh variable set OPERATOR_SOURCE_BUCKET --body "${SOURCE_BUCKET}"
  gh variable set OPERATOR_IAP_MEMBERS --body "${OPERATOR_MEMBER}"
  gh variable set OPERATOR_SUBJECTS --body "accounts.google.com:<the operator account's id>"
EOF

echo
if [[ "$PROBLEMS" -eq 0 ]]; then
  echo "Everything is in place."
else
  echo "${PROBLEMS} missing."
  [[ "$MODE" == "check" ]] && exit 1
fi
