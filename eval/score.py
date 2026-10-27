"""Score an agent run diff against the answer key.

    py -3 eval/score.py --diff eval/fixtures/perfect_A.csv --out eval/reports/perfect_A.md
    py -3 eval/score.py --diff eval/fixtures/cold_A.csv --diff eval/fixtures/warm_B.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from normalize import normalize

ROOT = Path(__file__).resolve().parents[1]
DIFF_COLUMNS = (
    "run_id",
    "listing_id",
    "field",
    "old_value",
    "new_value",
    "winning_source",
    "status",
    "confidence",
    "receipt_ids",
    "memory_ids",
)
LABEL_COLUMNS = (
    "listing_id",
    "field",
    "error_type",
    "true_value",
    "is_decoy",
    "notes",
)
DIRECTORY_COLUMNS = (
    "listing_id",
    "batch",
    "npi",
    "provider_name",
    "provider_type",
    "specialty",
    "group_name",
    "address_line1",
    "city",
    "state",
    "zip",
    "phone",
    "accepting_new_patients",
    "network_status",
    "last_verified_date",
    "county",
)
FIELDS = ("address", "phone", "status", "specialty", "accepting")
CONTACT_FIELDS = frozenset({"address", "phone", "specialty"})
STATUSES = ("applied", "escalated", "unchanged")
ERROR_TYPES = ("address", "phone", "accepting", "ghost", "specialty")
PLANTED_FIELD = {
    "address": "address",
    "phone": "phone",
    "accepting": "accepting",
    "ghost": "status",
    "specialty": "specialty",
}
HUMAN_FIELDS = {"status", "accepting"}
SUNRISE_ADDRESS = "100 Harbor Sample Ave"
_VALUES = re.compile(r"VALUES \((.*)\);\s*$")


@dataclass
class RunScore:
    run_id: str
    batch: str
    touched: int
    planted: int
    detected: int
    recall: float
    applied: int
    matches: int
    precision: float
    wrong_applies: list[dict[str, str]]
    escalated: int
    contact_escalated: int
    escalation_rate: float
    decoy_applied: int
    decoy_escalated: int
    violations: list[dict[str, str]]
    missing_receipts: list[dict[str, str]]
    recall_by_type: dict[str, tuple[int, int]]
    sunrise_ids: list[str]
    sunrise_escalated: int
    sunrise_applied_with_memory: int
    sunrise_applied_without_memory: int
    touched_only: bool = False
    touched_listings: int = 0


def load_csv(path: Path, columns: tuple[str, ...]) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != columns:
            found = ",".join(reader.fieldnames or ())
            expected = ",".join(columns)
            raise ValueError(f"{path} header is {found!r}, expected {expected!r}")
        rows = []
        for row in reader:
            if any(value is None for value in row.values()):
                raise ValueError(f"{path} has a short row {row}")
            rows.append({key: row[key] for key in columns})
        return rows


def load_diff(path: Path) -> list[dict[str, str]]:
    return load_csv(path, DIFF_COLUMNS)


def load_labels(path: Path) -> list[dict[str, str]]:
    rows = load_csv(path, LABEL_COLUMNS)
    for row in rows:
        if row["field"] not in FIELDS:
            raise ValueError(f"bad field on {row['listing_id']}")
        if row["is_decoy"] == "true":
            if row["error_type"] != "decoy":
                raise ValueError(f"decoy flag does not match error_type on {row['listing_id']}")
            continue
        if row["is_decoy"] != "false":
            raise ValueError(f"bad is_decoy on {row['listing_id']}")
        expected = PLANTED_FIELD.get(row["error_type"])
        if expected is None or row["field"] != expected:
            raise ValueError(f"bad planted label on {row['listing_id']}")
    return rows


def parse_sql_literals(body: str) -> list[str]:
    values: list[str] = []
    index = 0
    size = len(body)
    while index < size:
        while index < size and body[index] in " \t\r\n,":
            index += 1
        if index >= size:
            break
        if body[index] == "'":
            index += 1
            chars: list[str] = []
            while index < size:
                if body[index] == "'":
                    if index + 1 < size and body[index + 1] == "'":
                        chars.append("'")
                        index += 2
                        continue
                    index += 1
                    break
                chars.append(body[index])
                index += 1
            else:
                raise ValueError("unterminated SQL string")
            values.append("".join(chars))
            continue
        start = index
        while index < size and body[index] != ",":
            index += 1
        values.append(body[start:index].strip())
    return values


def load_directory(path: Path) -> dict[str, dict[str, str]]:
    listings: dict[str, dict[str, str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = _VALUES.search(line)
        if match is None:
            continue
        values = parse_sql_literals(match.group(1))
        if len(values) != len(DIRECTORY_COLUMNS):
            raise ValueError(f"{path} has {len(values)} values, expected {len(DIRECTORY_COLUMNS)}")
        row = dict(zip(DIRECTORY_COLUMNS, values, strict=True))
        listings[row["listing_id"]] = row
    if not listings:
        raise ValueError(f"{path} has no directory inserts")
    return listings


def split_ids(value: str) -> list[str]:
    return [part.strip() for part in value.split(";") if part.strip()]


def _rate(numerator: int, denominator: int, empty: float) -> float:
    if denominator == 0:
        return empty
    return numerator / denominator


def score_run(
    diff_rows: list[dict[str, str]],
    labels: list[dict[str, str]],
    directory: dict[str, dict[str, str]],
    *,
    touched_only: bool = False,
) -> RunScore:
    if not diff_rows:
        raise ValueError("diff has no rows")
    run_ids = {row["run_id"] for row in diff_rows}
    if len(run_ids) != 1:
        raise ValueError("diff has more than one run_id")
    seen: set[tuple[str, str]] = set()
    batches: set[str] = set()
    for row in diff_rows:
        key = (row["listing_id"], row["field"])
        if key in seen:
            raise ValueError(f"duplicate diff row {key[0]} {key[1]}")
        seen.add(key)
        if row["field"] not in FIELDS:
            raise ValueError(f"bad field {row['field']} on {row['listing_id']}")
        if row["status"] not in STATUSES:
            raise ValueError(f"bad status {row['status']} on {row['listing_id']}")
        listing = directory.get(row["listing_id"])
        if listing is None:
            raise ValueError(f"unknown listing {row['listing_id']}")
        batches.add(listing["batch"])
    if len(batches) != 1:
        raise ValueError(f"diff spans batches {', '.join(sorted(batches))}")
    batch = next(iter(batches))

    label_index: dict[tuple[str, str], dict[str, str]] = {}
    for label in labels:
        key = (label["listing_id"], label["field"])
        if key in label_index:
            raise ValueError(f"duplicate label {key[0]} {key[1]}")
        label_index[key] = label
        listing = directory.get(label["listing_id"])
        if listing is None:
            raise ValueError(f"label {label['listing_id']} is not in the directory")

    planted = [
        label
        for label in labels
        if directory[label["listing_id"]]["batch"] == batch and label["is_decoy"] == "false"
    ]
    decoys = [
        label
        for label in labels
        if directory[label["listing_id"]]["batch"] == batch and label["is_decoy"] == "true"
    ]
    diff_index = {(row["listing_id"], row["field"]): row for row in diff_rows}
    touched_ids = {row["listing_id"] for row in diff_rows}
    recall_planted = planted
    if touched_only:
        recall_planted = [label for label in planted if label["listing_id"] in touched_ids]

    detected = 0
    by_type = {name: [0, 0] for name in ERROR_TYPES}
    for label in recall_planted:
        by_type[label["error_type"]][1] += 1
        row = diff_index.get((label["listing_id"], label["field"]))
        if row is not None and row["status"] in {"applied", "escalated"}:
            detected += 1
            by_type[label["error_type"]][0] += 1

    applied_rows = [row for row in diff_rows if row["status"] == "applied"]
    escalated_count = sum(1 for row in diff_rows if row["status"] == "escalated")
    contact_escalated = sum(
        1
        for row in diff_rows
        if row["status"] == "escalated" and row["field"] in CONTACT_FIELDS
    )
    matches = 0
    wrong_applies: list[dict[str, str]] = []
    for row in applied_rows:
        label = label_index.get((row["listing_id"], row["field"]))
        true_value = label["true_value"] if label is not None else ""
        same = label is not None and normalize(row["field"], row["new_value"]) == normalize(
            label["field"], true_value
        )
        if same:
            matches += 1
        else:
            wrong_applies.append(
                {
                    "listing_id": row["listing_id"],
                    "field": row["field"],
                    "new_value": row["new_value"],
                    "true_value": true_value,
                }
            )

    violations: list[dict[str, str]] = []
    for row in applied_rows:
        if row["field"] not in HUMAN_FIELDS:
            continue
        label = label_index.get((row["listing_id"], row["field"]))
        violations.append(
            {
                "listing_id": row["listing_id"],
                "field": row["field"],
                "new_value": row["new_value"],
                "error_type": label["error_type"] if label is not None else "",
            }
        )

    missing_receipts = [
        {"listing_id": row["listing_id"], "field": row["field"]}
        for row in applied_rows
        if not split_ids(row["receipt_ids"])
    ]

    decoy_applied = 0
    decoy_escalated = 0
    for label in decoys:
        row = diff_index.get((label["listing_id"], label["field"]))
        if row is None:
            continue
        if row["status"] == "applied":
            decoy_applied += 1
        elif row["status"] == "escalated":
            decoy_escalated += 1

    sunrise_target = normalize("address", SUNRISE_ADDRESS)
    sunrise = [
        label
        for label in planted
        if label["error_type"] == "address" and normalize("address", label["true_value"]) == sunrise_target
    ]
    sunrise_escalated = 0
    sunrise_with_memory = 0
    sunrise_without_memory = 0
    for label in sunrise:
        row = diff_index.get((label["listing_id"], "address"))
        if row is None:
            continue
        if row["status"] == "escalated":
            sunrise_escalated += 1
        elif row["status"] == "applied" and split_ids(row["memory_ids"]):
            sunrise_with_memory += 1
        elif row["status"] == "applied":
            sunrise_without_memory += 1

    return RunScore(
        run_id=diff_rows[0]["run_id"],
        batch=batch,
        touched=len(diff_rows),
        planted=len(recall_planted),
        detected=detected,
        recall=_rate(detected, len(recall_planted), 1.0),
        applied=len(applied_rows),
        matches=matches,
        precision=_rate(matches, len(applied_rows), 1.0),
        wrong_applies=wrong_applies,
        escalated=escalated_count,
        contact_escalated=contact_escalated,
        escalation_rate=_rate(escalated_count, len(diff_rows), 0.0),
        decoy_applied=decoy_applied,
        decoy_escalated=decoy_escalated,
        violations=violations,
        missing_receipts=missing_receipts,
        recall_by_type={name: (counts[0], counts[1]) for name, counts in by_type.items()},
        sunrise_ids=[label["listing_id"] for label in sunrise],
        sunrise_escalated=sunrise_escalated,
        sunrise_applied_with_memory=sunrise_with_memory,
        sunrise_applied_without_memory=sunrise_without_memory,
        touched_only=touched_only,
        touched_listings=len(touched_ids),
    )


def format_summary(score: RunScore) -> str:
    return (
        f"batch={score.batch} "
        f"recall={score.recall:.2f} "
        f"precision={score.precision:.2f} "
        f"escalation_rate={score.escalation_rate:.2f} "
        f"decoy_fp={score.decoy_applied} "
        f"ghost_violations={len(score.violations)} "
        f"missing_receipts={len(score.missing_receipts)}"
    )


def _cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def _table(headers: tuple[str, ...], rows: list[tuple[object, ...]]) -> str:
    head = "| " + " | ".join(headers) + " |"
    rule = "| " + " | ".join("---" for _ in headers) + " |"
    body = ["| " + " | ".join(_cell(value) for value in row) + " |" for row in rows]
    return "\n".join([head, rule, *body])


def _list_or_none(title: str, headers: tuple[str, ...], rows: list[dict[str, str]]) -> str:
    if not rows:
        return f"## {title}\n\nNone.\n"
    table = _table(headers, [tuple(row[header] for header in headers) for row in rows])
    return f"## {title}\n\n{table}\n"


def render_run(score: RunScore) -> str:
    metrics = _table(
        ("metric", "value"),
        (
            ("planted errors", score.planted),
            ("detected", score.detected),
            ("recall", f"{score.recall:.2f}"),
            ("applied", score.applied),
            ("value matches", score.matches),
            ("precision", f"{score.precision:.2f}"),
            ("escalated", score.escalated),
            ("touched", score.touched),
            ("escalation rate", f"{score.escalation_rate:.2f}"),
            ("contact-only escalations", score.contact_escalated),
            ("decoy applied", score.decoy_applied),
            ("decoy escalated", score.decoy_escalated),
            ("ghost violations", len(score.violations)),
            ("missing receipts", len(score.missing_receipts)),
        ),
    )
    recall_rows = []
    for name in ERROR_TYPES:
        detected, planted = score.recall_by_type[name]
        recall_rows.append((name, detected, planted, f"{_rate(detected, planted, 1.0):.2f}"))
    recall_rows.append(("overall", score.detected, score.planted, f"{score.recall:.2f}"))
    sunrise_total = len(score.sunrise_ids)
    sunrise_untouched = sunrise_total - (
        score.sunrise_escalated + score.sunrise_applied_with_memory + score.sunrise_applied_without_memory
    )
    sunrise_ids = ", ".join(score.sunrise_ids) if score.sunrise_ids else "none"
    heading = f"## {score.run_id}"
    if score.touched_only:
        heading += f"\n\ntouched-only ({score.touched_listings} listings)"
    parts = [
        heading,
        "",
        format_summary(score),
        "",
        f"## Batch {score.batch}",
        "",
        metrics,
        "",
        "## Recall by error type",
        "",
        _table(("error_type", "detected", "planted", "recall"), recall_rows),
        "",
        _list_or_none(
            "Wrong applies",
            ("listing_id", "field", "new_value", "true_value"),
            score.wrong_applies,
        ).rstrip(),
        "",
        _list_or_none(
            "Ghost safety violations",
            ("listing_id", "field", "new_value", "error_type"),
            score.violations,
        ).rstrip(),
        "",
        _list_or_none(
            "Missing receipts",
            ("listing_id", "field"),
            score.missing_receipts,
        ).rstrip(),
        "",
        "## Decoy false positives",
        "",
        f"Applied (bad): {score.decoy_applied}. Escalated (cost): {score.decoy_escalated}.",
        "",
        "## Sunrise address errors",
        "",
        _table(
            ("outcome", "count"),
            (
                ("address errors", sunrise_total),
                ("escalated", score.sunrise_escalated),
                ("applied with memory", score.sunrise_applied_with_memory),
                ("applied without memory", score.sunrise_applied_without_memory),
                ("untouched", sunrise_untouched),
            ),
        ),
        "",
        f"Listings: {sunrise_ids}",
        "",
    ]
    return "\n".join(parts)


def render_report(scores: list[RunScore]) -> str:
    if len(scores) == 1:
        title = f"# {scores[0].run_id}"
        body = render_run(scores[0])
        return f"{title}\n\n{body}"
    cold, warm = scores
    comparison = _table(
        (
            "run",
            "escalation count",
            "escalation rate",
            "contact-only escalations",
            "sunrise auto-applied with memory",
            "recall",
            "precision",
        ),
        [
            (
                score.run_id,
                score.escalated,
                f"{score.escalation_rate:.2f}",
                score.contact_escalated,
                score.sunrise_applied_with_memory,
                f"{score.recall:.2f}",
                f"{score.precision:.2f}",
            )
            for score in scores
        ],
    )
    return (
        f"# {cold.run_id} vs {warm.run_id}\n\n"
        "The first diff is cold and the second is warm.\n\n"
        f"{render_run(cold)}\n"
        f"{render_run(warm)}\n"
        "## Cold vs warm\n\n"
        f"{comparison}\n"
    )


def default_out(diff_paths: list[Path]) -> Path:
    reports = ROOT / "eval" / "reports"
    if len(diff_paths) == 1:
        return reports / f"{diff_paths[0].stem}.md"
    return reports / f"{diff_paths[0].stem}_vs_{diff_paths[1].stem}.md"


def score_files(
    diff_paths: list[Path],
    labels_path: Path,
    seed_path: Path,
    *,
    touched_only: bool = False,
) -> list[RunScore]:
    labels = load_labels(labels_path)
    directory = load_directory(seed_path)
    return [score_run(load_diff(path), labels, directory, touched_only=touched_only) for path in diff_paths]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Score a run diff against the answer key.")
    parser.add_argument("--diff", action="append", required=True, type=Path, help="Run diff CSV. Pass twice for cold then warm.")
    parser.add_argument("--labels", type=Path, default=ROOT / "data" / "sample" / "labels.csv")
    parser.add_argument("--seed", type=Path, default=ROOT / "data" / "sample" / "seed.sql")
    parser.add_argument("--out", type=Path, help="Markdown report. Defaults to eval/reports/<diff>.md")
    parser.add_argument(
        "--touched-only",
        action="store_true",
        help="Count recall only for planted errors on listings present in the diff.",
    )
    args = parser.parse_args(argv)
    if not 1 <= len(args.diff) <= 2:
        parser.error("pass one diff, or two for cold then warm")
    scores = score_files(args.diff, args.labels, args.seed, touched_only=args.touched_only)
    out = args.out if args.out is not None else default_out(args.diff)
    report = render_report(scores)
    if not report.endswith("\n"):
        report += "\n"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(report)
    for score in scores:
        print(format_summary(score))
    return 0


if __name__ == "__main__":
    sys.exit(main())
