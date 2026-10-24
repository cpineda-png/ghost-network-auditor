#!/usr/bin/env bash
# Health checks for the local stack. Does not run Docker Compose.
# SAMPLE_MODE is read from .env (default true). Live mode also runs scripts/zetaris-check.sh.
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
dry_run=0

if [[ $# -gt 1 ]]; then
  echo "Usage: scripts/verify.sh [--dry-run]" >&2
  exit 2
fi
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
elif [[ $# -eq 1 ]]; then
  echo "Unknown argument: $1" >&2
  exit 2
fi

sample_mode=true
env_file="$root/.env"
if [[ -f "$env_file" ]]; then
  line=$(grep -E '^SAMPLE_MODE=' "$env_file" | tail -n 1 || true)
  line=${line%$'\r'}
  value=${line#SAMPLE_MODE=}
  value=${value#\"}
  value=${value%\"}
  value=${value#\'}
  value=${value%\'}
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ -n "$value" ]]; then
    sample_mode=$value
  fi
fi

expect_mode=sample
expect_zetaris=not_configured
shopt -s nocasematch
if [[ "$sample_mode" != "true" ]]; then
  expect_mode=live
  expect_zetaris=up
fi
shopt -u nocasematch

if [[ "$dry_run" -eq 1 ]]; then
  echo "curl -fsS http://localhost:8081/health  # mode=${expect_mode} zetaris=${expect_zetaris}"
  echo "curl -fsS http://localhost:8080/health  # ok, gateway mode=${expect_mode} zetaris=${expect_zetaris}"
  echo "curl -fsS http://localhost:5173/api/health  # ok and llmReplay"
  echo "curl -fsS http://localhost:5173/  # Ghost Network Auditor"
  if [[ "$expect_mode" == "live" ]]; then
    "$root/scripts/zetaris-check.sh" --dry-run
  fi
  exit 0
fi

fail=0

pass() { echo "PASS $1"; }
fail_check() { echo "FAIL $1"; fail=1; }

wait_for() {
  local url=$1
  local name=$2
  local i
  for i in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      pass "wait $name"
      return 0
    fi
    sleep 2
  done
  fail_check "wait $name ($url)"
  return 1
}

check_json() {
  local name=$1
  local url=$2
  local script=$3
  local body
  if ! body=$(curl -fsS "$url" 2>/dev/null); then
    fail_check "$name (curl $url)"
    return
  fi
  if printf '%s' "$body" | node -e "$script"; then
    pass "$name"
  else
    fail_check "$name ($body)"
  fi
}

wait_for "http://localhost:8081/health" "gateway"
wait_for "http://localhost:8080/health" "agents"
wait_for "http://localhost:5173/" "web"

export EXPECT_MODE="$expect_mode"
export EXPECT_ZETARIS="$expect_zetaris"

check_json "gateway /health mode=${expect_mode} zetaris=${expect_zetaris}" "http://localhost:8081/health" '
let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => {
  const b = JSON.parse(s);
  process.exit(b.mode === process.env.EXPECT_MODE && b.zetaris === process.env.EXPECT_ZETARIS ? 0 : 1);
});
'

check_json "agents /health ok and gateway mode=${expect_mode} zetaris=${expect_zetaris}" "http://localhost:8080/health" '
let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => {
  const b = JSON.parse(s);
  const g = b.gateway;
  const gatewayOk = g && g.mode === process.env.EXPECT_MODE && g.zetaris === process.env.EXPECT_ZETARIS;
  process.exit(b.ok === true && gatewayOk ? 0 : 1);
});
'

check_json "web /api/health llmReplay (REPLAY badge)" "http://localhost:5173/api/health" '
let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => {
  const b = JSON.parse(s);
  process.exit(b.ok === true && b.llmReplay === true ? 0 : 1);
});
'

page=$(curl -fsS "http://localhost:5173/" 2>/dev/null || true)
if echo "$page" | grep -q "Ghost Network Auditor"; then
  pass "web page title"
else
  fail_check "web page title"
fi

if [[ "$expect_mode" == "live" ]]; then
  if "$root/scripts/zetaris-check.sh"; then
    pass "live templates"
  else
    fail_check "live templates"
  fi
fi

if [[ $fail -eq 0 ]]; then
  echo "All checks passed"
else
  echo "One or more checks failed"
fi
exit $fail
