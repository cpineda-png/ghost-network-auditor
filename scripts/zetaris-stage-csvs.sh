#!/usr/bin/env bash
# Copy roster.csv and claims.csv into the Zetaris shared folder, then print the five file-store statements.
# Never reads .env and never prints a password.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
dry_run=0
compose=""
main_checkout='C:\Users\mysti\Projects\ghost-network-auditor'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
    *)
      if [[ -n "$compose" ]]; then
        echo "Unexpected argument: $1" >&2
        exit 2
      fi
      compose=$1
      shift
      ;;
  esac
done

in_worktree() {
  case "$1" in
    */.cursor/worktrees | */.cursor/worktrees/*) return 0 ;;
    *) return 1 ;;
  esac
}

if in_worktree "$root"; then
  if [[ "$dry_run" -eq 1 ]]; then
    echo "Dry-run from a Cursor worktree. Docker is not run. Run this script from ${main_checkout} to use Docker."
  else
    echo "Refusing to run Docker from a Cursor worktree ($root)." >&2
    echo "Run this script from ${main_checkout} so Compose does not start a second project on ports 5432 and 8081." >&2
    exit 1
  fi
fi

if [[ -z "$compose" ]]; then
  echo "Usage: scripts/zetaris-stage-csvs.sh [--dry-run] <zetaris-compose-folder>" >&2
  exit 2
fi

show() {
  if [[ "$dry_run" -eq 1 ]]; then
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

show docker compose --project-directory "$compose" exec driver mkdir -p /home/zetaris/customer-data/shared
show docker compose --project-directory "$compose" cp "$root/data/sample/roster.csv" driver:/home/zetaris/customer-data/shared/roster.csv
show docker compose --project-directory "$compose" cp "$root/data/sample/claims.csv" driver:/home/zetaris/customer-data/shared/claims.csv

cat <<'EOF'
CREATE LIGHTNING DATABASE GNA_FILES DESCRIBE BY "roster and claims extracts";
CREATE LIGHTNING FILESTORE TABLE roster FROM GNA_FILES FORMAT CSV OPTIONS (PATH "/home/zetaris/customer-data/shared/roster.csv", header "true", inferSchema "false");
CACHE TABLE GNA_FILES.roster;
CREATE LIGHTNING FILESTORE TABLE claims FROM GNA_FILES FORMAT CSV OPTIONS (PATH "/home/zetaris/customer-data/shared/claims.csv", header "true", inferSchema "false");
CACHE TABLE GNA_FILES.claims;
EOF
