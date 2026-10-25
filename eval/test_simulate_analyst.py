"""Simulated analyst tests. This directory is allowed to read data/sample/labels.csv."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import simulate_analyst


def card(listing_id: str, field: str, sources: list[dict], status: str = "escalated") -> dict:
    return {
        "runId": "run-1",
        "listingId": listing_id,
        "field": field,
        "sources": sources,
        "winner": None,
        "confidence": None,
        "rationale": "Escalated without a proposal.",
        "critique": None,
        "status": status,
        "memoryIds": [],
    }


def label(listing_id: str, field: str, true_value: str, *, decoy: bool = False) -> dict[str, str]:
    return {
        "listing_id": listing_id,
        "field": field,
        "error_type": "decoy" if decoy else field,
        "true_value": true_value,
        "is_decoy": "true" if decoy else "false",
        "notes": "",
    }


class FakeClient:
    def __init__(self) -> None:
        self.posted: list[dict] = []

    def get_cards(self, run_id: str) -> list[dict]:
        raise AssertionError(run_id)

    def post_ruling(self, ruling: dict) -> dict:
        self.posted.append(ruling)
        return {"memoryId": f"mem-{len(self.posted)}"}


class RulingTest(unittest.TestCase):
    def test_labeled_card_uses_the_non_directory_source_that_matches(self) -> None:
        cards = [
            card(
                "L-00001",
                "address",
                [
                    {"source": "directory", "value": "100 Harbor Sample Ave Ste 1", "receiptIds": ["d1"]},
                    {"source": "roster", "value": "100 Harbor Sample Ave Suite 9", "receiptIds": ["r1"]},
                    {"source": "nppes", "value": "100 Harbor Sample Ave Ste 9", "receiptIds": ["n1"]},
                ],
            )
        ]
        rulings = simulate_analyst.build_rulings(
            cards,
            [label("L-00001", "address", "100 Harbor Sample Ave Ste. 9")],
            run_id="run-1",
            max_rulings=30,
        )
        self.assertEqual(rulings, [{
            "runId": "run-1",
            "listingId": "L-00001",
            "field": "address",
            "value": "100 Harbor Sample Ave Ste. 9",
            "source": "roster",
            "analyst": "simulated-analyst",
        }])

    def test_phone_match_prefers_roster_when_directory_normalizes_the_same(self) -> None:
        cards = [
            card(
                "L-00028",
                "phone",
                [
                    {"source": "directory", "value": "7185550127", "receiptIds": ["d1"]},
                    {"source": "roster", "value": "(718) 555-0127", "receiptIds": ["r1"]},
                ],
            )
        ]
        rulings = simulate_analyst.build_rulings(
            cards,
            [label("L-00028", "phone", "718-555-0127", decoy=True)],
            run_id="run-1",
            max_rulings=30,
        )
        self.assertEqual(rulings[0]["source"], "roster")
        self.assertEqual(rulings[0]["value"], "718-555-0127")

    def test_unlabeled_card_keeps_the_directory_value(self) -> None:
        cards = [
            card(
                "L-00009",
                "accepting",
                [
                    {"source": "directory", "value": False, "receiptIds": ["d1"]},
                    {"source": "claims", "value": True, "receiptIds": ["c1"]},
                ],
            )
        ]
        rulings = simulate_analyst.build_rulings(cards, [], run_id="run-1", max_rulings=30)
        self.assertEqual(rulings[0]["value"], False)
        self.assertEqual(rulings[0]["source"], "directory")
        self.assertEqual(rulings[0]["analyst"], "simulated-analyst")

    def test_missing_directory_source_posts_null(self) -> None:
        rulings = simulate_analyst.build_rulings(
            [card("L-00009", "phone", [{"source": "roster", "value": "718-555-0100", "receiptIds": ["r1"]}])],
            [],
            run_id="run-1",
            max_rulings=30,
        )
        self.assertIsNone(rulings[0]["value"])
        self.assertEqual(rulings[0]["source"], "directory")

    def test_accepting_label_is_a_boolean(self) -> None:
        rulings = simulate_analyst.build_rulings(
            [card("L-00055", "accepting", [{"source": "claims", "value": False, "receiptIds": ["c1"]}])],
            [label("L-00055", "accepting", "false")],
            run_id="run-1",
            max_rulings=30,
        )
        self.assertIs(rulings[0]["value"], False)
        self.assertEqual(rulings[0]["source"], "claims")

    def test_no_matching_source_uses_other(self) -> None:
        rulings = simulate_analyst.build_rulings(
            [card("L-00001", "address", [{"source": "directory", "value": "9 Other Rd", "receiptIds": ["d1"]}])],
            [label("L-00001", "address", "100 Harbor Sample Ave")],
            run_id="run-1",
            max_rulings=30,
        )
        self.assertEqual(rulings[0]["source"], "other")
        self.assertEqual(rulings[0]["value"], "100 Harbor Sample Ave")

    def test_skips_applied_and_unchanged_and_caps_escalated_cards(self) -> None:
        cards = [
            card("L-1", "phone", [{"source": "directory", "value": "1", "receiptIds": []}], status="applied"),
            card("L-2", "phone", [{"source": "directory", "value": "2", "receiptIds": []}]),
            card("L-3", "phone", [{"source": "directory", "value": "3", "receiptIds": []}], status="unchanged"),
            card("L-4", "phone", [{"source": "directory", "value": "4", "receiptIds": []}]),
        ]
        rulings = simulate_analyst.build_rulings(cards, [], run_id="run-9", max_rulings=1)
        self.assertEqual([ruling["listingId"] for ruling in rulings], ["L-2"])
        self.assertEqual(rulings[0]["runId"], "run-9")

    def test_dry_run_prints_rulings_without_posting(self) -> None:
        client = FakeClient()
        ruling = {
            "runId": "run-1",
            "listingId": "L-2",
            "field": "phone",
            "value": "2",
            "source": "directory",
            "analyst": "simulated-analyst",
        }
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            simulate_analyst.apply_rulings(client, [ruling], dry_run=True)
        self.assertEqual(client.posted, [])
        self.assertEqual(json.loads(buffer.getvalue()), ruling)


class HttpAnalystTest(unittest.TestCase):
    def test_posts_a_ruling_and_dry_run_does_not(self) -> None:
        posted: list[dict] = []
        cards = [
            card(
                "L-00001",
                "address",
                [
                    {"source": "directory", "value": "9 Other Rd", "receiptIds": ["d1"]},
                    {"source": "roster", "value": "100 Harbor Sample Ave", "receiptIds": ["r1"]},
                ],
            )
        ]

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path == "/runs/run-1/cards":
                    self._send(200, cards)
                    return
                self._send(404, {"error": "run not ready"})

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                posted.append(json.loads(self.rfile.read(length)))
                self._send(200, {"memoryId": "mem-http"})

            def _send(self, status: int, payload: object) -> None:
                raw = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, fmt: str, *args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        host, port = server.server_address
        base = f"http://{host}:{port}"
        stdout = io.StringIO()
        stderr = io.StringIO()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                labels = Path(tmp) / "labels.csv"
                labels.write_text(
                    "listing_id,field,error_type,true_value,is_decoy,notes\n"
                    "L-00001,address,address,100 Harbor Sample Ave,false,\n",
                    encoding="utf-8",
                )
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    code = simulate_analyst.main([
                        "--run-id", "run-1",
                        "--agents-url", base,
                        "--labels", str(labels),
                    ])
                    dry = simulate_analyst.main([
                        "--run-id", "run-1",
                        "--agents-url", base,
                        "--labels", str(labels),
                        "--dry-run",
                    ])
                    missing = simulate_analyst.main([
                        "--run-id", "missing",
                        "--agents-url", base,
                        "--labels", str(labels),
                    ])
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(code, 0)
        self.assertEqual(dry, 0)
        self.assertEqual(missing, 1)
        self.assertIn("memoryId mem-http", stdout.getvalue())
        self.assertIn("404", stderr.getvalue())
        self.assertEqual(len(posted), 1)
        self.assertEqual(posted[0]["analyst"], "simulated-analyst")
        self.assertEqual(posted[0]["source"], "roster")
        self.assertEqual(posted[0]["value"], "100 Harbor Sample Ave")


if __name__ == "__main__":
    unittest.main()
