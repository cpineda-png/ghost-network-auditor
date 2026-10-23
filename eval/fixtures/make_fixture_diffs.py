"""Build the four committed run diffs from the seed-42 answer key.

    py -3 eval/fixtures/make_fixture_diffs.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import score
from normalize import normalize

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ROSTER_VALUE = {
    "address": "address_line1",
    "phone": "phone",
    "status": "status",
    "specialty": "specialty",
}
DIRECTORY_VALUE = {
    "address": "address_line1",
    "phone": "phone",
    "specialty": "specialty",
    "accepting": "accepting_new_patients",
    "status": "network_status",
}
SUNRISE_MEMORY = "mem-sunrise-move"


def load_roster(path: Path) -> dict[str, dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return {row["npi"]: row for row in csv.DictReader(handle)}


def is_sunrise(label: dict[str, str]) -> bool:
    return (
        label["is_decoy"] == "false"
        and label["error_type"] == "address"
        and normalize("address", label["true_value"]) == normalize("address", score.SUNRISE_ADDRESS)
    )


def in_batch(
    labels: list[dict[str, str]],
    directory: dict[str, dict[str, str]],
    batch: str,
    decoy: bool | None = None,
) -> list[dict[str, str]]:
    chosen = []
    for label in labels:
        if directory[label["listing_id"]]["batch"] != batch:
            continue
        if decoy is True and label["is_decoy"] != "true":
            continue
        if decoy is False and label["is_decoy"] != "false":
            continue
        chosen.append(label)
    return chosen


def old_value(listing: dict[str, str], field: str) -> str:
    return listing[DIRECTORY_VALUE[field]]


def receipt(run_id: str, label: dict[str, str]) -> str:
    return f"rcpt-{run_id}-{label['listing_id']}-{label['field']}"


def row(
    run_id: str,
    listing: dict[str, str],
    label: dict[str, str],
    *,
    status: str,
    new_value: str = "",
    winning_source: str = "",
    confidence: str = "",
    receipt_ids: str = "",
    memory_ids: str = "",
) -> dict[str, str]:
    return {
        "run_id": run_id,
        "listing_id": label["listing_id"],
        "field": label["field"],
        "old_value": old_value(listing, label["field"]),
        "new_value": new_value,
        "winning_source": winning_source,
        "status": status,
        "confidence": confidence,
        "receipt_ids": receipt_ids,
        "memory_ids": memory_ids,
    }


def applied(
    run_id: str,
    listing: dict[str, str],
    label: dict[str, str],
    new_value: str,
    winning_source: str,
    memory_ids: str = "",
) -> dict[str, str]:
    return row(
        run_id,
        listing,
        label,
        status="applied",
        new_value=new_value,
        winning_source=winning_source,
        confidence="0.90",
        receipt_ids=receipt(run_id, label),
        memory_ids=memory_ids,
    )


def escalated(run_id: str, listing: dict[str, str], label: dict[str, str]) -> dict[str, str]:
    return row(run_id, listing, label, status="escalated")


def needs_human(label: dict[str, str]) -> bool:
    return label["error_type"] in {"ghost", "accepting"}


def source_for(label: dict[str, str]) -> str:
    if is_sunrise(label):
        return "nppes"
    return "roster"


def perfect_like(
    run_id: str,
    labels: list[dict[str, str]],
    directory: dict[str, dict[str, str]],
    batch: str,
    *,
    escalate_sunrise: bool,
    memory_sunrise: bool,
) -> list[dict[str, str]]:
    rows = []
    for label in in_batch(labels, directory, batch, decoy=False):
        listing = directory[label["listing_id"]]
        sunrise = is_sunrise(label)
        if needs_human(label) or (sunrise and escalate_sunrise):
            rows.append(escalated(run_id, listing, label))
            continue
        memory = SUNRISE_MEMORY if sunrise and memory_sunrise else ""
        rows.append(applied(run_id, listing, label, label["true_value"], source_for(label), memory))
    return rows


def naive_rows(
    labels: list[dict[str, str]],
    directory: dict[str, dict[str, str]],
    roster: dict[str, dict[str, str]],
) -> list[dict[str, str]]:
    rows = []
    for label in in_batch(labels, directory, "A"):
        listing = directory[label["listing_id"]]
        provider = roster.get(listing["npi"])
        if provider is None:
            raise ValueError(f"roster is missing {listing['npi']}")
        if label["field"] == "accepting":
            new_value = "true"
            winning_source = "directory"
        else:
            new_value = provider[ROSTER_VALUE[label["field"]]]
            winning_source = "roster"
        rows.append(applied("naive-A", listing, label, new_value, winning_source))
    return rows


def build_all(
    labels: list[dict[str, str]] | None = None,
    directory: dict[str, dict[str, str]] | None = None,
    roster: dict[str, dict[str, str]] | None = None,
) -> dict[str, list[dict[str, str]]]:
    if labels is None or directory is None or roster is None:
        labels = score.load_labels(ROOT / "data" / "sample" / "labels.csv")
        directory = score.load_directory(ROOT / "data" / "sample" / "seed.sql")
        roster = load_roster(ROOT / "data" / "sample" / "roster.csv")
    planted_a = in_batch(labels, directory, "A", decoy=False)
    planted_b = in_batch(labels, directory, "B", decoy=False)
    decoys_a = in_batch(labels, directory, "A", decoy=True)
    decoys_b = in_batch(labels, directory, "B", decoy=True)
    if (len(planted_a), len(planted_b), len(decoys_a), len(decoys_b)) != (135, 135, 30, 30):
        raise AssertionError("planted and decoy counts drifted from seed 42")
    sunrise_a = [label for label in planted_a if is_sunrise(label)]
    sunrise_b = [label for label in planted_b if is_sunrise(label)]
    if (len(sunrise_a), len(sunrise_b)) != (9, 4):
        raise AssertionError("Sunrise address-error counts drifted from seed 42")
    built = {
        "perfect_A.csv": perfect_like("perfect-A", labels, directory, "A", escalate_sunrise=False, memory_sunrise=False),
        "naive_A.csv": naive_rows(labels, directory, roster),
        "cold_A.csv": perfect_like("cold-A", labels, directory, "A", escalate_sunrise=True, memory_sunrise=False),
        "warm_B.csv": perfect_like("warm-B", labels, directory, "B", escalate_sunrise=False, memory_sunrise=True),
    }
    _check(built, {label["listing_id"] for label in decoys_a})
    return built


def _check(built: dict[str, list[dict[str, str]]], decoy_ids: set[str]) -> None:
    perfect = built["perfect_A.csv"]
    naive = built["naive_A.csv"]
    cold = built["cold_A.csv"]
    warm = built["warm_B.csv"]
    if len(perfect) != 135 or sum(row["status"] == "escalated" for row in perfect) != 54:
        raise AssertionError("perfect_A shape drifted")
    if any(row["listing_id"] in decoy_ids for row in perfect):
        raise AssertionError("perfect_A touches a decoy")
    if any(row["status"] == "applied" and row["field"] in {"status", "accepting"} for row in perfect):
        raise AssertionError("perfect_A applies a human field")
    if len(naive) != 165 or any(row["status"] != "applied" for row in naive):
        raise AssertionError("naive_A shape drifted")
    if sum(row["listing_id"] in decoy_ids for row in naive) != 30:
        raise AssertionError("naive_A decoy count drifted")
    if sum(row["status"] == "escalated" for row in cold) != 63:
        raise AssertionError("cold_A escalation count drifted")
    if sum(row["status"] == "escalated" for row in warm) != 54:
        raise AssertionError("warm_B escalation count drifted")
    memory = [row for row in warm if row["memory_ids"] == SUNRISE_MEMORY]
    if len(memory) != 4 or any(row["status"] != "applied" or row["field"] != "address" for row in memory):
        raise AssertionError("warm_B Sunrise memory rows drifted")
    for rows in built.values():
        for item in rows:
            if item["status"] == "applied" and not item["receipt_ids"]:
                raise AssertionError("applied fixture row is missing a receipt")
            if item["status"] == "escalated" and item["confidence"]:
                raise AssertionError("escalated fixture row has a confidence")


def write_fixtures(target: Path | None = None) -> None:
    target = target or HERE
    target.mkdir(parents=True, exist_ok=True)
    for name, rows in build_all().items():
        path = target / name
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=score.DIFF_COLUMNS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)


def main() -> int:
    write_fixtures()
    return 0


if __name__ == "__main__":
    sys.exit(main())
