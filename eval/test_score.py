"""Scorer tests. This directory is allowed to read data/sample/labels.csv."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures"))

import make_fixture_diffs
import normalize
import score

FIXTURES = Path(__file__).resolve().parent / "fixtures"
ROOT = Path(__file__).resolve().parents[1]
LABELS = ROOT / "data" / "sample" / "labels.csv"
SEED = ROOT / "data" / "sample" / "seed.sql"


def score_fixture(name: str) -> score.RunScore:
    return score.score_run(score.load_diff(FIXTURES / name), score.load_labels(LABELS), score.load_directory(SEED))


def diff_row(
    listing_id: str,
    field: str,
    *,
    new_value: str,
    status: str = "applied",
    receipt_ids: str = "rcpt-1",
    memory_ids: str = "",
) -> dict[str, str]:
    return {
        "run_id": "unit",
        "listing_id": listing_id,
        "field": field,
        "old_value": "",
        "new_value": new_value,
        "winning_source": "roster",
        "status": status,
        "confidence": "0.90" if status == "applied" else "",
        "receipt_ids": receipt_ids,
        "memory_ids": memory_ids,
    }


class NormalizeTest(unittest.TestCase):
    def test_suite_and_phone_punctuation(self) -> None:
        self.assertEqual(
            normalize.normalize("address", "340 Ledger Ave Ste 4"),
            normalize.normalize("address", "340 Ledger Ave Suite 4"),
        )
        self.assertEqual(
            normalize.normalize("address", "10 Main St Ste. 4"),
            normalize.normalize("address", "10 Main St #4"),
        )
        self.assertEqual(normalize.normalize("address", "10  Main   St"), "10 main st")
        self.assertEqual(normalize.normalize("phone", "(718) 555-0135"), "7185550135")
        self.assertEqual(
            normalize.normalize("phone", "(718) 555-0135"),
            normalize.normalize("phone", "718-555-0135"),
        )
        self.assertEqual(normalize.normalize("accepting", "Yes"), "true")
        self.assertEqual(normalize.normalize("accepting", "NO"), "false")
        self.assertEqual(normalize.normalize("status", " Terminated "), "terminated")
        self.assertEqual(normalize.normalize("address", ""), "")

    def test_normalized_values_count_as_matches(self) -> None:
        labels = [
            {
                "listing_id": "L-1",
                "field": "address",
                "error_type": "address",
                "true_value": "340 Ledger Ave Ste 4",
                "is_decoy": "false",
                "notes": "",
            },
            {
                "listing_id": "L-2",
                "field": "phone",
                "error_type": "phone",
                "true_value": "718-555-0100",
                "is_decoy": "false",
                "notes": "",
            },
        ]
        directory = {
            "L-1": {"batch": "A"},
            "L-2": {"batch": "A"},
        }
        diff = [
            diff_row("L-1", "address", new_value="340 Ledger Ave Suite 4"),
            diff_row("L-2", "phone", new_value="(718) 555-0100", receipt_ids="rcpt-2"),
        ]
        result = score.score_run(diff, labels, directory)
        self.assertEqual(result.precision, 1.0)
        self.assertEqual(result.wrong_applies, [])


class ScoreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.perfect = score_fixture("perfect_A.csv")
        cls.naive = score_fixture("naive_A.csv")
        cls.cold = score_fixture("cold_A.csv")
        cls.warm = score_fixture("warm_B.csv")

    def test_committed_fixtures_match_builder(self) -> None:
        for name, rows in make_fixture_diffs.build_all().items():
            self.assertEqual(score.load_diff(FIXTURES / name), rows, name)

    def test_perfect_is_clean(self) -> None:
        self.assertEqual(self.perfect.recall, 1.0)
        self.assertEqual(self.perfect.precision, 1.0)
        self.assertEqual(self.perfect.violations, [])
        self.assertEqual(self.perfect.decoy_applied, 0)
        self.assertEqual(self.perfect.decoy_escalated, 0)
        self.assertEqual(self.perfect.missing_receipts, [])
        self.assertEqual(
            score.format_summary(self.perfect),
            "batch=A recall=1.00 precision=1.00 escalation_rate=0.40 decoy_fp=0 ghost_violations=0 missing_receipts=0",
        )

    def test_naive_has_violations_and_decoy_false_positives(self) -> None:
        self.assertGreater(len(self.naive.violations), 0)
        self.assertGreater(self.naive.decoy_applied, 0)
        self.assertGreater(len(self.naive.wrong_applies), 0)
        self.assertEqual(self.naive.escalated, 0)
        self.assertTrue(all(row["field"] in {"status", "accepting"} for row in self.naive.violations))

    def test_missing_receipt_is_counted(self) -> None:
        labels = [
            {
                "listing_id": "L-1",
                "field": "phone",
                "error_type": "phone",
                "true_value": "718-555-0100",
                "is_decoy": "false",
                "notes": "",
            }
        ]
        directory = {"L-1": {"batch": "A"}}
        result = score.score_run(
            [diff_row("L-1", "phone", new_value="718-555-0100", receipt_ids="")],
            labels,
            directory,
        )
        self.assertEqual(len(result.missing_receipts), 1)
        self.assertEqual(result.missing_receipts[0]["listing_id"], "L-1")

    def test_applied_status_without_a_label_is_a_violation(self) -> None:
        directory = {"L-9": {"batch": "B"}}
        result = score.score_run(
            [diff_row("L-9", "status", new_value="terminated")],
            [],
            directory,
        )
        self.assertEqual(len(result.violations), 1)
        self.assertEqual(result.violations[0]["field"], "status")
        self.assertEqual(result.violations[0]["error_type"], "")
        self.assertEqual(result.batch, "B")

    def test_cold_escalates_more_than_warm(self) -> None:
        self.assertLess(self.warm.escalated, self.cold.escalated)
        self.assertEqual(self.cold.sunrise_applied_with_memory, 0)
        self.assertEqual(self.warm.sunrise_applied_with_memory, 4)
        self.assertEqual(self.cold.sunrise_escalated, 9)
        self.assertEqual(self.cold.recall, 1.0)
        self.assertEqual(self.warm.recall, 1.0)
        self.assertEqual(self.warm.precision, 1.0)
        report = score.render_report([self.cold, self.warm])
        self.assertIn("## Cold vs warm", report)
        self.assertIn("mem-sunrise-move", "".join(row["memory_ids"] for row in score.load_diff(FIXTURES / "warm_B.csv")))

    def test_touched_only_recall_ignores_listings_absent_from_the_diff(self) -> None:
        labels = [
            {
                "listing_id": "L-1",
                "field": "phone",
                "error_type": "phone",
                "true_value": "718-555-0100",
                "is_decoy": "false",
                "notes": "",
            },
            {
                "listing_id": "L-2",
                "field": "phone",
                "error_type": "phone",
                "true_value": "718-555-0101",
                "is_decoy": "false",
                "notes": "",
            },
            {
                "listing_id": "L-1",
                "field": "specialty",
                "error_type": "decoy",
                "true_value": "cardiology",
                "is_decoy": "true",
                "notes": "",
            },
        ]
        directory = {"L-1": {"batch": "A"}, "L-2": {"batch": "A"}}
        diff = [
            diff_row("L-1", "phone", new_value="718-555-0100"),
            diff_row("L-1", "specialty", new_value="cardiology", receipt_ids="rcpt-2"),
        ]
        full = score.score_run(diff, labels, directory)
        scoped = score.score_run(diff, labels, directory, touched_only=True)
        self.assertEqual(full.recall, 0.5)
        self.assertEqual(full.planted, 2)
        self.assertEqual(scoped.recall, 1.0)
        self.assertEqual(scoped.planted, 1)
        self.assertEqual(scoped.detected, 1)
        self.assertEqual(scoped.recall_by_type["phone"], (1, 1))
        self.assertEqual(full.decoy_applied, 1)
        self.assertEqual(scoped.decoy_applied, 1)
        self.assertEqual(scoped.touched_listings, 1)
        self.assertNotIn("touched-only", score.format_summary(scoped))
        self.assertNotIn("touched-only", score.render_report([full]))
        self.assertIn("touched-only (1 listings)", score.render_report([scoped]))

    def test_touched_only_counts_a_missed_field_on_a_touched_listing(self) -> None:
        labels = [
            {
                "listing_id": "L-1",
                "field": "phone",
                "error_type": "phone",
                "true_value": "718-555-0100",
                "is_decoy": "false",
                "notes": "",
            },
            {
                "listing_id": "L-1",
                "field": "address",
                "error_type": "address",
                "true_value": "10 Main St",
                "is_decoy": "false",
                "notes": "",
            },
        ]
        directory = {"L-1": {"batch": "A"}}
        result = score.score_run(
            [diff_row("L-1", "phone", new_value="718-555-0100")],
            labels,
            directory,
            touched_only=True,
        )
        self.assertEqual(result.planted, 2)
        self.assertEqual(result.detected, 1)
        self.assertEqual(result.recall, 0.5)
        self.assertEqual(result.recall_by_type["address"], (0, 1))
        self.assertIn("touched-only (1 listings)", score.render_report([result]))

    def test_touched_only_keeps_sunrise_for_listings_the_diff_missed(self) -> None:
        labels = [
            {
                "listing_id": "L-2",
                "field": "address",
                "error_type": "address",
                "true_value": "100 Harbor Sample Ave",
                "is_decoy": "false",
                "notes": "",
            }
        ]
        directory = {"L-1": {"batch": "A"}, "L-2": {"batch": "A"}}
        diff = [diff_row("L-1", "phone", new_value="718-555-0199")]
        full = score.score_run(diff, labels, directory)
        scoped = score.score_run(diff, labels, directory, touched_only=True)
        self.assertEqual(full.recall, 0.0)
        self.assertEqual(full.sunrise_ids, ["L-2"])
        self.assertEqual(scoped.planted, 0)
        self.assertEqual(scoped.recall, 1.0)
        self.assertEqual(scoped.precision, 0.0)
        self.assertEqual(scoped.sunrise_ids, ["L-2"])

    def test_touched_only_flag_writes_the_report_header(self) -> None:
        rows = score.load_diff(FIXTURES / "perfect_A.csv")
        listings = len({row["listing_id"] for row in rows})
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "report.md"
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                code = score.main(
                    ["--diff", str(FIXTURES / "perfect_A.csv"), "--touched-only", "--out", str(out)]
                )
            report = out.read_text(encoding="utf-8")
        self.assertEqual(code, 0)
        self.assertIn(f"touched-only ({listings} listings)", report)
        self.assertIn(
            "batch=A recall=1.00 precision=1.00 escalation_rate=0.40 decoy_fp=0 ghost_violations=0 missing_receipts=0",
            stdout.getvalue(),
        )


if __name__ == "__main__":
    unittest.main()
