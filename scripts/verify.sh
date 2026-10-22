#!/usr/bin/env bash
set -u

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
  if echo "$body" | node -e "$script"; then
    pass "$name"
  else
    fail_check "$name ($body)"
  fi
}

wait_for "http://localhost:8081/health" "gateway"
wait_for "http://localhost:8080/health" "agents"
wait_for "http://localhost:5173/" "web"

check_json "gateway /health sample and zetaris not_configured" "http://localhost:8081/health" '
let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => {
  const b = JSON.parse(s);
  process.exit(b.mode === "sample" && b.zetaris === "not_configured" ? 0 : 1);
});
'

check_json "agents /health ok and includes gateway" "http://localhost:8080/health" '
let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => {
  const b = JSON.parse(s);
  const g = b.gateway;
  const gatewayOk = g && g.mode === "sample" && g.zetaris === "not_configured";
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

if [[ $fail -eq 0 ]]; then
  echo "All checks passed"
else
  echo "One or more checks failed"
fi
exit $fail
