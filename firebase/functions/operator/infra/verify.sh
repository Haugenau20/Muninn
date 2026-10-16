#!/usr/bin/env bash
# firebase/functions/operator/infra/verify.sh
#
# Checks that the operator page is still set up the way the security
# architecture says (T137; section 10, the answer to T9). Run by
# .github/workflows/operator-verify.yml as operator-verifier@, after every
# operator deploy and daily; anyone who can read the same things can run it,
# e.g. the maintainer in Cloud Shell:
#
#   bash verify.sh          reads, changes nothing, exits 1 if any check fails
#
# The six checks:
#   1  a request without sign-in is turned away, at every address the service has
#   2  the service is set up as designed: IAP on, the invoker check on, the
#      live revision running as operator-runtime@ from our repository, by digest
#   3  only IAP may invoke it, and nobody anonymous holds any role on it
#   4  the IAP access list is exactly the expected one, and the project grants
#      no access of its own through IAP
#   5  re-authentication every hour, by the method the runbook records
#   6  the audit trail: the sink, the bucket and, once set, its lock
#
# Settings come from the environment, defaulting to what setup.sh sets up:
#   EXPECTED_MEMBERS   the IAP access list, comma-separated (OPERATOR_IAP_MEMBERS)
#   PROJECT_NUMBER     read from the project when not given; the verifier
#                      cannot read it, so the workflow passes it
#   REAUTH_METHOD      SECURE_KEY, as the runbook's record has it (2026-10-15)
#   AUDIT_LOCKED       true once the bucket's retention is locked (plan, step 8)

set -euo pipefail

PROJECT="${PROJECT:-dnd-campaign-companion}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-operator}"
RUNTIME_SA="${RUNTIME_SA:-operator-runtime@${PROJECT}.iam.gserviceaccount.com}"
EXPECTED_MEMBERS="${EXPECTED_MEMBERS:-user:operator@muninn.quest}"
REAUTH_METHOD="${REAUTH_METHOD:-SECURE_KEY}"
AUDIT_LOCKED="${AUDIT_LOCKED:-false}"
AUDIT_BUCKET="operator-audit"
# The repository setup.sh made, and the image name the deploy pushes.
IMAGE_PATTERN="^${REGION}-docker\.pkg\.dev/${PROJECT}/${SERVICE}/${SERVICE}@sha256:[0-9a-f]{64}$"

[[ $# -eq 0 ]] || { echo "usage: bash verify.sh" >&2; exit 2; }

# A Python that runs, as in setup.sh.
PY=""
for candidate in python3 python; do
  if "$candidate" -c "import json" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
[[ -n "$PY" ]] || { echo "verify.sh needs Python 3 for reading JSON." >&2; exit 2; }

FAILURES=0
report() {
  printf '%s\n' "$*"
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"
  return 0
}
step() { report ""; report "$*"; }
ok() { report "  ok      $*"; }
fail() { report "  FAILED  $*"; FAILURES=$((FAILURES + 1)); }
# expect DESCRIPTION ACTUAL WANTED
expect() {
  if [[ "$2" == "$3" ]]; then ok "$1"; else fail "$1: is '${2}', should be '${3}'"; fi
}

# Read a field from JSON on stdin: `json 'd["a"]["b"]'` prints it, or nothing.
json() {
  "$PY" -c 'import json, sys
try:
    d = json.load(sys.stdin)
    v = eval(sys.argv[1])
except Exception:
    sys.exit(0)
if v is None:
    sys.exit(0)
print(v if not isinstance(v, (dict, list)) else json.dumps(v, sort_keys=True))' "$1"
}

# A comma-separated list, sorted and without blanks, so lists compare as sets.
sorted_list() { tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | sort -u | paste -sd, - || true; }

# The members holding ROLE in the policy on stdin, as a sorted list.
holders() {
  json "\",\".join(m for b in d.get(\"bindings\", []) if b[\"role\"] == \"$1\" for m in b.get(\"members\", []))" \
    | sorted_list
}

if [[ -z "${PROJECT_NUMBER:-}" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")"
fi
IAP_AGENT="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com"

report "Project ${PROJECT} (${PROJECT_NUMBER}), service ${SERVICE} in ${REGION}"

SERVICE_JSON="$(gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" \
  --format=json 2>/dev/null || true)"
field() { json "$1" <<<"$SERVICE_JSON"; }

# ---------------------------------------------------------------------------
# 1  Anonymous requests
# ---------------------------------------------------------------------------
step "1  A request without sign-in is turned away"

# Every address: the one status.url gives, and the others Cloud Run lists.
URLS="$( { field 'd["status"]["url"]'
  field '"\n".join(json.loads(d["metadata"]["annotations"].get("run.googleapis.com/urls", "[]")))'; } \
  | grep -v '^$' | sort -u || true)"
if [[ -z "$URLS" ]]; then
  fail "the service has no address to try (is it there?)"
fi
while read -r url; do
  [[ -z "$url" ]] && continue
  answer="$(curl -sS -o /dev/null --max-time 20 -w '%{http_code} %{redirect_url}' "${url}/" 2>/dev/null || echo "000 ")"
  code="${answer%% *}" location="${answer#* }"
  case "$code" in
    401|403) ok "${url}: refused (${code})" ;;
    30[1278])
      if [[ "$location" =~ ^https://accounts\.google\.com/ ]]; then ok "${url}: sent to Google's sign-in (${code})"
      else fail "${url}: redirected to ${location:-nowhere} (${code}), not to Google's sign-in"; fi ;;
    *) fail "${url}: answered ${code}" ;;
  esac
done <<<"$URLS"

# ---------------------------------------------------------------------------
# 2  The service
# ---------------------------------------------------------------------------
step "2  The service is set up as designed"

if [[ -z "$SERVICE_JSON" ]]; then
  fail "service ${SERVICE} could not be read"
else
  expect "IAP" "$(field '"on" if d["metadata"]["annotations"].get("run.googleapis.com/iap-enabled") == "true" else "off"')" "on"
  expect "the invoker check" \
    "$(field '"off" if d["metadata"]["annotations"].get("run.googleapis.com/invoker-iam-disabled") == "true" else "on"')" "on"
  expect "runs as" "$(field 'd["spec"]["template"]["spec"]["serviceAccountName"]')" "$RUNTIME_SA"
  image="$(field 'd["spec"]["template"]["spec"]["containers"][0]["image"]')"
  if [[ "$image" =~ $IMAGE_PATTERN ]]; then ok "image from our repository, by digest"
  else fail "image is '${image}', not ${REGION}-docker.pkg.dev/${PROJECT}/${SERVICE}/${SERVICE}@sha256:…"; fi
  # The template is what runs only if the traffic follows it.
  expect "the newest revision is ready" \
    "$(field 'd["status"]["latestReadyRevisionName"] == d["status"]["latestCreatedRevisionName"]')" "True"
  expect "all traffic goes to the newest revision" \
    "$(field 'all(t.get("latestRevision") for t in d["status"]["traffic"] if t.get("percent"))')" "True"
fi

# ---------------------------------------------------------------------------
# 3  The invoker
# ---------------------------------------------------------------------------
step "3  Only IAP may invoke it"

RUN_POLICY="$(gcloud run services get-iam-policy "$SERVICE" --region="$REGION" --project="$PROJECT" \
  --format=json 2>/dev/null || true)"
if [[ -z "$RUN_POLICY" ]]; then
  fail "the service's IAM policy could not be read"
else
  expect "invoker" "$(holders roles/run.invoker <<<"$RUN_POLICY")" "$IAP_AGENT"
  expect "nobody anonymous holds a role" \
    "$(json '",".join(sorted({m for b in d.get("bindings", []) for m in b.get("members", []) if m in ("allUsers", "allAuthenticatedUsers")}))' <<<"$RUN_POLICY")" ""
fi

# ---------------------------------------------------------------------------
# 4  The IAP access list
# ---------------------------------------------------------------------------
step "4  The IAP access list is exactly the expected one"

# IAP's policy on RESOURCE, from its API by project number. `gcloud iap web
# get-iam-policy` first looks the project up in Resource Manager, which the
# verifier may not: both reads failed in its first run (2026-10-16). Prints
# the policy, or fails printing the API's error.
iap_policy() {
  local body message
  if body="$(curl -sS --fail-with-body --max-time 20 -X POST \
      -H "Authorization: Bearer $(gcloud auth print-access-token)" \
      -H "Content-Type: application/json" --data '{"options": {"requestedPolicyVersion": 3}}' \
      "https://iap.googleapis.com/v1/$1:getIamPolicy" 2>/dev/null)"; then
    printf '%s' "$body"
  else
    message="$(json 'd["error"]["message"]' <<<"$body")"
    printf '%s' "${message:-${body:-no answer from the IAP API}}" | head -c 300
    return 1
  fi
}

IAP_WEB="projects/${PROJECT_NUMBER}/iap_web"
if IAP_POLICY="$(iap_policy "${IAP_WEB}/cloud_run-${REGION}/services/${SERVICE}")"; then
  expect "access list" "$(holders roles/iap.httpsResourceAccessor <<<"$IAP_POLICY")" \
    "$(sorted_list <<<"$EXPECTED_MEMBERS")"
else
  fail "the service's IAP policy could not be read: ${IAP_POLICY}"
fi
# Access granted at the project's IAP level reaches every service under it.
if PROJECT_IAP_POLICY="$(iap_policy "$IAP_WEB")"; then
  expect "no access granted for the whole project" \
    "$(holders roles/iap.httpsResourceAccessor <<<"$PROJECT_IAP_POLICY")" ""
else
  fail "the project's IAP policy could not be read: ${PROJECT_IAP_POLICY}"
fi

# ---------------------------------------------------------------------------
# 5  Re-authentication
# ---------------------------------------------------------------------------
step "5  Re-authentication"

IAP_SETTINGS="$(gcloud iap settings get --resource-type=cloud-run --service="$SERVICE" \
  --region="$REGION" --project="$PROJECT" --format=json 2>/dev/null || true)"
expect "every hour, by ${REAUTH_METHOD}" \
  "$(json '"%s %s %s" % tuple(d["accessSettings"]["reauthSettings"].get(k) for k in ("method", "maxAge", "policyType"))' <<<"$IAP_SETTINGS")" \
  "${REAUTH_METHOD} 3600s MINIMUM"

# ---------------------------------------------------------------------------
# 6  Audit
# ---------------------------------------------------------------------------
step "6  The audit trail is intact"

SINK="$(gcloud logging sinks describe "$AUDIT_BUCKET" --project="$PROJECT" --format=json 2>/dev/null || true)"
if [[ -z "$SINK" ]]; then
  fail "sink ${AUDIT_BUCKET} could not be read"
else
  expect "sink ${AUDIT_BUCKET} writes to the bucket" "$(json 'd["destination"]' <<<"$SINK")" \
    "logging.googleapis.com/projects/${PROJECT}/locations/${REGION}/buckets/${AUDIT_BUCKET}"
  expect "sink ${AUDIT_BUCKET} is enabled" "$(json 'd.get("disabled", False)' <<<"$SINK")" "False"
  # The two halves setup.sh writes: our audit lines and IAP's own record.
  expect "sink ${AUDIT_BUCKET} takes our audit lines and IAP's" \
    "$(json '"jsonPayload.type=\"operator_audit\"" in d["filter"] and "protoPayload.serviceName=\"iap.googleapis.com\"" in d["filter"]' <<<"$SINK")" \
    "True"
fi
BUCKET="$(gcloud logging buckets describe "$AUDIT_BUCKET" --location="$REGION" --project="$PROJECT" \
  --format=json 2>/dev/null || true)"
if [[ -z "$BUCKET" ]]; then
  fail "log bucket ${AUDIT_BUCKET} could not be read"
else
  expect "bucket ${AUDIT_BUCKET} is active" "$(json 'd["lifecycleState"]' <<<"$BUCKET")" "ACTIVE"
  expect "bucket ${AUDIT_BUCKET} keeps 400 days" "$(json 'd.get("retentionDays")' <<<"$BUCKET")" "400"
  if [[ "$AUDIT_LOCKED" == "true" ]]; then
    expect "bucket ${AUDIT_BUCKET} is locked" "$(json 'd.get("locked", False)' <<<"$BUCKET")" "True"
  else
    report "  note    the lock is not checked until AUDIT_LOCKED=true (plan, step 8)"
  fi
fi

report ""
if [[ "$FAILURES" -eq 0 ]]; then
  report "Everything is as designed."
else
  report "${FAILURES} failed."
  exit 1
fi
