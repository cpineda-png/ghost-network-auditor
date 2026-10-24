#!/usr/bin/env bash
# POST the three live templates. Prints "<template> <mode> <rowCount>".
# Does not run Docker Compose. A worktree checkout is safe for this script.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
dry_run=0
gateway="http://localhost:8081"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    --gateway)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --gateway" >&2
        exit 2
      fi
      gateway=$2
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

gateway=${gateway%/}
if [[ ! -f "$root/docker-compose.yml" ]]; then
  echo "Repo root does not contain docker-compose.yml: $root" >&2
  exit 2
fi
fail=0

query() {
  local name=$1
  local body=$2
  if [[ "$dry_run" -eq 1 ]]; then
    echo "curl -sS --max-time 60 -X POST ${gateway}/query -H content-type:application/json --data ${body}"
    return 0
  fi
  local tmp code line
  tmp=$(mktemp)
  code=$(curl -sS --max-time 60 -o "$tmp" -w "%{http_code}" -X POST "${gateway}/query" \
    -H "content-type: application/json" \
    --data "$body" || true)
  if [[ "$code" != "200" ]]; then
    echo "$name error $code"
    fail=1
    rm -f "$tmp"
    return 0
  fi
  line=$(CHECK_NAME="$name" node -e '
    const fs = require("fs");
    const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const mode = body.receipt && body.receipt.mode;
    const count = body.receipt && body.receipt.rowCount;
    console.log(process.env.CHECK_NAME + " " + mode + " " + count);
    process.exit(mode === "live" ? 0 : 1);
  ' "$tmp") || fail=1
  printf '%s\n' "$line"
  rm -f "$tmp"
}

query directory_batch '{"templateId":"directory_batch","params":{"batch":"A","limit":5},"runId":"zetaris-check","requestedBy":"lane1"}'
query roster_by_npis '{"templateId":"roster_by_npis","params":{"npis":["8000000009"]},"runId":"zetaris-check","requestedBy":"lane1"}'
query claims_by_npis '{"templateId":"claims_by_npis","params":{"npis":["8000000009"],"fromMonth":"2025-05","toMonth":"2025-06"},"runId":"zetaris-check","requestedBy":"lane1"}'

if [[ "$dry_run" -eq 1 ]]; then
  exit 0
fi
exit "$fail"
