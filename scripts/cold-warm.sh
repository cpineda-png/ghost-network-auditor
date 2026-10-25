#!/usr/bin/env bash
# Cold batch A, simulated analyst, warm batch B. Optional cold batch B control.
# Does not start or restart the agents server. Memory stays in that process.
# Does not run Docker Compose. A worktree checkout is safe for this script.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
dry_run=0
with_control=0
agents_url="http://localhost:8080"
out_dir=""
timeout_min="45"
max_rulings="30"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    --with-control) with_control=1; shift ;;
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
    --max)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --max" >&2
        exit 2
      fi
      max_rulings=$2
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if ! [[ "$timeout_min" =~ ^[0-9]+$ ]] || [[ "$timeout_min" -lt 1 ]]; then
  echo "Expected --timeout-min to be a positive integer" >&2
  exit 2
fi
if ! [[ "$max_rulings" =~ ^[0-9]+$ ]] || [[ "$max_rulings" -lt 1 ]]; then
  echo "Expected --max to be a positive integer" >&2
  exit 2
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

eval_run="$root/scripts/eval-run.sh"
analyst="$root/eval/simulate_analyst.py"
score="$root/eval/score.py"
last_run_id=""
last_diff=""

run_eval() {
  local batch=$1
  local memory=$2
  local offset=$3
  local limit=$4
  local args=(
    --batch "$batch"
    --memory "$memory"
    --offset "$offset"
    --limit "$limit"
    --agents-url "$agents_url"
    --timeout-min "$timeout_min"
    --out-dir "$out_dir"
  )
  if [[ "$dry_run" -eq 1 ]]; then
    bash "$eval_run" --dry-run "${args[@]}" || exit $?
    return
  fi
  local output status run_id run_id8
  output=$(bash "$eval_run" "${args[@]}")
  status=$?
  printf '%s\n' "$output"
  if [[ "$status" -ne 0 ]]; then
    exit "$status"
  fi
  run_id=$(printf '%s\n' "$output" | grep -E -m1 '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' || true)
  if [[ -z "$run_id" ]]; then
    echo "eval-run did not print a runId" >&2
    exit 1
  fi
  run_id8=${run_id:0:8}
  last_run_id=$run_id
  last_diff="${out_dir}/${batch}-${memory}-${run_id8}/diff.csv"
  if [[ ! -f "$last_diff" ]]; then
    echo "Missing diff ${last_diff}" >&2
    exit 1
  fi
}

write_score() {
  local cold_diff=$1
  local warm_diff=$2
  local out_name=$3
  local out="${root}/eval/reports/${out_name}"
  echo "python3 ${score} --diff ${cold_diff} --diff ${warm_diff} --touched-only --out ${out}"
  if [[ "$dry_run" -eq 1 ]]; then
    return
  fi
  python3 "$score" --diff "$cold_diff" --diff "$warm_diff" --touched-only --out "$out" || exit $?
}

cold_diff="${out_dir}/A-off-<runId8>/diff.csv"
warm_diff="${out_dir}/B-on-<runId8>/diff.csv"
control_diff="${out_dir}/B-off-<runId8>/diff.csv"

run_eval A off 0 30
if [[ "$dry_run" -eq 1 ]]; then
  echo "python3 ${analyst} --run-id <runId> --agents-url ${agents_url} --max ${max_rulings} --dry-run"
else
  cold_diff=$last_diff
  python3 "$analyst" --run-id "$last_run_id" --agents-url "$agents_url" --max "$max_rulings" || exit $?
fi

run_eval B on 160 30
if [[ "$dry_run" -ne 1 ]]; then
  warm_diff=$last_diff
fi

if [[ "$with_control" -eq 1 ]]; then
  run_eval B off 160 30
  if [[ "$dry_run" -ne 1 ]]; then
    control_diff=$last_diff
  fi
fi

write_score "$cold_diff" "$warm_diff" "cold_vs_warm.md"
if [[ "$with_control" -eq 1 ]]; then
  write_score "$control_diff" "$warm_diff" "batch_b_control.md"
fi
