#!/usr/bin/env bash
# Start one agents run, save the report and diff, and print the touched-only score.
# Does not run Docker Compose. A worktree checkout is safe for this script.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
dry_run=0
batch=""
memory=""
agents_url="http://localhost:8080"
out_dir=""
timeout_min="45"
offset=""
limit=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    --batch)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --batch" >&2
        exit 2
      fi
      batch=$2
      shift 2
      ;;
    --memory)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --memory" >&2
        exit 2
      fi
      memory=$2
      shift 2
      ;;
    --agents-url)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --agents-url" >&2
        exit 2
      fi
      agents_url=$2
      shift 2
      ;;
    --out-dir)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --out-dir" >&2
        exit 2
      fi
      out_dir=$2
      shift 2
      ;;
    --timeout-min)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --timeout-min" >&2
        exit 2
      fi
      timeout_min=$2
      shift 2
      ;;
    --offset)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --offset" >&2
        exit 2
      fi
      offset=$2
      shift 2
      ;;
    --limit)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --limit" >&2
        exit 2
      fi
      limit=$2
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$batch" != "A" && "$batch" != "B" ]]; then
  echo "Expected --batch A or B" >&2
  exit 2
fi
if [[ "$memory" != "on" && "$memory" != "off" ]]; then
  echo "Expected --memory on or off" >&2
  exit 2
fi
if ! [[ "$timeout_min" =~ ^[0-9]+$ ]] || [[ "$timeout_min" -lt 1 ]]; then
  echo "Expected --timeout-min to be a positive integer" >&2
  exit 2
fi
if [[ -n "$offset" ]]; then
  if ! [[ "$offset" =~ ^[0-9]+$ ]] || [[ "$offset" -gt 1000000 ]]; then
    echo "Expected --offset to be an integer from 0 to 1000000" >&2
    exit 2
  fi
  offset=$((10#$offset))
fi
if [[ -n "$limit" ]]; then
  if ! [[ "$limit" =~ ^[0-9]+$ ]] || [[ "$limit" -lt 1 ]] || [[ "$limit" -gt 300 ]]; then
    echo "Expected --limit to be an integer from 1 to 300" >&2
    exit 2
  fi
  limit=$((10#$limit))
fi

agents_url=${agents_url%/}
if [[ -z "$out_dir" ]]; then
  out_dir="$root/eval/runs"
elif [[ "$out_dir" != /* && "$out_dir" != [A-Za-z]:* ]]; then
  out_dir="$root/$out_dir"
fi
if [[ ! -f "$root/docker-compose.yml" ]]; then
  echo "Repo root does not contain docker-compose.yml: $root" >&2
  exit 2
fi

if [[ "$memory" == "on" ]]; then
  use_memory=true
else
  use_memory=false
fi
scope="{\"batch\":\"${batch}\""
if [[ -n "$offset" ]]; then
  scope+=",\"offset\":${offset}"
fi
if [[ -n "$limit" ]]; then
  scope+=",\"limit\":${limit}"
fi
scope+="}"
body="{\"scope\":${scope},\"useMemory\":${use_memory}}"
score="$root/eval/score.py"

if [[ "$dry_run" -eq 1 ]]; then
  echo "curl -sS --max-time 60 -X POST ${agents_url}/runs -H content-type:application/json --data ${body}"
  echo "curl -sS --max-time 30 ${agents_url}/runs/<runId>/report"
  echo "curl -sS --max-time 60 -o ${out_dir}/${batch}-${memory}-<runId8>/diff.csv ${agents_url}/runs/<runId>/diff.csv"
  echo "python3 ${score} --diff ${out_dir}/${batch}-${memory}-<runId8>/diff.csv --touched-only"
  exit 0
fi

post_file=$(mktemp)
report_file=$(mktemp)
cleanup() {
  rm -f "$post_file" "$report_file"
}
trap cleanup EXIT

code=$(curl -sS --max-time 60 -o "$post_file" -w "%{http_code}" -X POST "${agents_url}/runs" \
  -H "content-type: application/json" \
  --data "$body" || true)
if [[ "$code" != "200" ]]; then
  echo "POST /runs error ${code}"
  cat "$post_file"
  exit 1
fi
run_id=$(node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!body.runId) process.exit(2);
  process.stdout.write(String(body.runId));
' "$post_file") || {
  echo "POST /runs did not return runId" >&2
  exit 1
}
printf '%s\n' "$run_id"

started=$(date +%s)
deadline=$((started + timeout_min * 60))
while true; do
  now=$(date +%s)
  if (( now >= deadline )); then
    echo "timed out after ${timeout_min} minutes" >&2
    exit 1
  fi
  echo "elapsed $((now - started))s"
  code=$(curl -sS --max-time 30 -o "$report_file" -w "%{http_code}" "${agents_url}/runs/${run_id}/report" || true)
  if [[ -z "$code" || "$code" == "000" ]]; then
    echo "report poll failed"
    sleep 10
    continue
  fi
  if [[ "$code" == "404" ]]; then
    sleep 10
    continue
  fi
  if [[ "$code" != "200" ]]; then
    echo "report error ${code}"
    cat "$report_file"
    exit 1
  fi
  break
done

if ! node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (body.status === "failed") {
    console.log(body.error || "run failed");
    process.exit(1);
  }
' "$report_file"; then
  exit 1
fi

run_id8=${run_id:0:8}
dest="${out_dir}/${batch}-${memory}-${run_id8}"
mkdir -p "$dest"
cp "$report_file" "$dest/report.json"
code=$(curl -sS --max-time 60 -o "$dest/diff.csv" -w "%{http_code}" "${agents_url}/runs/${run_id}/diff.csv" || true)
if [[ "$code" != "200" ]]; then
  echo "diff error ${code}"
  exit 1
fi

python3 "$score" --diff "$dest/diff.csv" --touched-only
exit $?
