#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$root/services/agents/vendor"

echo "Vendoring Meterless engines into $vendor"
npx --yes degit meterless/meterless/engines/hmem "$vendor/hmem"
npx --yes degit meterless/meterless/engines/world-model "$vendor/world-model"

echo
echo "Kept LICENSE files:"
find "$vendor/hmem" "$vendor/world-model" -iname "LICENSE*" -print

echo
echo "Found docs:"
find "$vendor/hmem" "$vendor/world-model" \( -iname "AGENTS.md" -o -iname "README*" \) -print
