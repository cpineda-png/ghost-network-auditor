"""Spot-check generated NPIs against the public NPI Registry.

Reads roster.csv, requests 20 evenly spaced NPIs, and exits 1 if any number is
already registered. This script calls the network. The generator tests do not
run it.

    python data/generator/check_npis_absent.py
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROSTER = ROOT / "data" / "sample" / "roster.csv"
API = "https://npiregistry.cms.hhs.gov/api/?version=2.1&number={npi}"


def select_npis(npis: list[str], k: int = 20) -> list[str]:
    if len(npis) <= k:
        return list(npis)
    chosen = []
    used: set[int] = set()
    for index in range(k):
        pos = min(int(index * len(npis) / k), len(npis) - 1)
        while pos in used:
            pos += 1
        used.add(pos)
        chosen.append(npis[pos])
    return chosen


def is_hit(payload: dict) -> bool:
    try:
        return int(payload.get("result_count") or 0) > 0
    except (TypeError, ValueError):
        return False


def read_npis(path: Path) -> list[str]:
    with path.open(encoding="utf-8", newline="") as handle:
        return [row["npi"] for row in csv.DictReader(handle)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Spot-check synthetic NPIs against the NPI Registry.")
    parser.add_argument("--roster", type=Path, default=DEFAULT_ROSTER)
    parser.add_argument("--count", type=int, default=20)
    args = parser.parse_args()
    sample = select_npis(read_npis(args.roster), args.count)
    hits = []
    for npi in sample:
        request = urllib.request.Request(API.format(npi=npi), headers={"User-Agent": "ghost-network-auditor"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            print(f"error {npi}: {exc}", file=sys.stderr)
            return 2
        if is_hit(payload):
            hits.append(npi)
            print(f"HIT {npi}")
        else:
            print(f"absent {npi}")
    if hits:
        print(f"{len(hits)} NPI(s) are in the registry")
        return 1
    print(f"all {len(sample)} NPIs absent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
