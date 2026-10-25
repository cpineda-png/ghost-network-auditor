"""Post rulings for escalated cards.

This is a simulated analyst using the answer key in data/sample/labels.csv.
Only eval/ reads that file.

    py -3 eval/simulate_analyst.py --run-id <runId> --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from normalize import normalize

ROOT = Path(__file__).resolve().parents[1]
ANALYST = "simulated-analyst"
LABEL_COLUMNS = (
    "listing_id",
    "field",
    "error_type",
    "true_value",
    "is_decoy",
    "notes",
)


class AnalystClient(Protocol):
    def get_cards(self, run_id: str) -> list[dict]: ...

    def post_ruling(self, ruling: dict) -> dict: ...


class HttpClient:
    def __init__(self, base_url: str, timeout: float = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get_cards(self, run_id: str) -> list[dict]:
        url = f"{self.base_url}/runs/{quote(run_id, safe='')}/cards"
        payload = _read_json(url, self.timeout)
        if not isinstance(payload, list):
            raise RuntimeError(f"{url} did not return a list")
        return payload

    def post_ruling(self, ruling: dict) -> dict:
        url = f"{self.base_url}/rulings"
        body = json.dumps(ruling).encode("utf-8")
        request = Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        payload = _read_json(url, self.timeout, request)
        if not isinstance(payload, dict):
            raise RuntimeError(f"{url} did not return an object")
        return payload


def load_labels(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != LABEL_COLUMNS:
            found = ",".join(reader.fieldnames or ())
            expected = ",".join(LABEL_COLUMNS)
            raise ValueError(f"{path} header is {found!r}, expected {expected!r}")
        rows: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for row in reader:
            if any(row[key] is None for key in LABEL_COLUMNS):
                raise ValueError(f"{path} has a short row {row}")
            item = {key: row[key] for key in LABEL_COLUMNS}
            key = (item["listing_id"], item["field"])
            if key in seen:
                raise ValueError(f"duplicate label {key[0]} {key[1]}")
            seen.add(key)
            rows.append(item)
        return rows


def build_rulings(
    cards: list[dict],
    labels: list[dict[str, str]],
    *,
    run_id: str,
    max_rulings: int,
) -> list[dict]:
    if max_rulings < 1:
        raise ValueError("--max must be a positive integer")
    index = {(row["listing_id"], row["field"]): row for row in labels}
    escalated = [card for card in cards if card.get("status") == "escalated"]
    return [
        ruling_for(card, index.get((str(card.get("listingId")), str(card.get("field")))), run_id)
        for card in escalated[:max_rulings]
    ]


def ruling_for(card: dict, label: dict[str, str] | None, run_id: str) -> dict:
    listing_id = card.get("listingId")
    field = card.get("field")
    if not isinstance(listing_id, str) or not isinstance(field, str):
        raise ValueError("escalated card is missing listingId or field")
    if label is None:
        value, source = directory_value(card)
    else:
        value = label_value(field, label["true_value"])
        source = source_holding(card, field, label["true_value"])
    return {
        "runId": run_id,
        "listingId": listing_id,
        "field": field,
        "value": value,
        "source": source,
        "analyst": ANALYST,
    }


def label_value(field: str, true_value: str) -> str | bool:
    if field != "accepting":
        return true_value
    token = normalize(field, true_value)
    if token == "true":
        return True
    if token == "false":
        return False
    return true_value


def source_holding(card: dict, field: str, true_value: str) -> str:
    target = normalize(field, true_value)
    matches: list[str] = []
    for source in card.get("sources") or []:
        if not isinstance(source, dict):
            continue
        name = source.get("source")
        if not isinstance(name, str):
            continue
        if normalize(field, source.get("value")) == target:
            matches.append(name)
    for name in matches:
        if name != "directory":
            return name
    if matches:
        return matches[0]
    return "other"


def directory_value(card: dict) -> tuple[object, str]:
    for source in card.get("sources") or []:
        if isinstance(source, dict) and source.get("source") == "directory":
            return source.get("value"), "directory"
    return None, "directory"


def apply_rulings(client: AnalystClient, rulings: list[dict], *, dry_run: bool) -> None:
    for ruling in rulings:
        print(json.dumps(ruling), flush=True)
        if dry_run:
            continue
        stored = client.post_ruling(ruling)
        print(f"memoryId {stored.get('memoryId', '')}", flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Simulated analyst using the answer key.")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--agents-url", default="http://localhost:8080")
    parser.add_argument("--labels", type=Path, default=ROOT / "data" / "sample" / "labels.csv")
    parser.add_argument("--max", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.max < 1:
        parser.error("--max must be a positive integer")
    try:
        labels = load_labels(args.labels)
        client = HttpClient(args.agents_url)
        cards = client.get_cards(args.run_id)
        rulings = build_rulings(cards, labels, run_id=args.run_id, max_rulings=args.max)
        apply_rulings(client, rulings, dry_run=args.dry_run)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


def _read_json(url: str, timeout: float, request: Request | None = None) -> object:
    try:
        with urlopen(request or url, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        try:
            detail = error.read().decode("utf-8", "replace")
        finally:
            error.close()
        raise RuntimeError(f"{error.code} {url} {detail}") from error
    except URLError as error:
        raise RuntimeError(f"{url} {error.reason}") from error
    if raw == "":
        raise RuntimeError(f"{url} returned an empty body")
    return json.loads(raw)


if __name__ == "__main__":
    sys.exit(main())
