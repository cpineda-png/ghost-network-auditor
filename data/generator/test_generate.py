"""Output checks for the synthetic generator. Reads only files it just wrote."""

from __future__ import annotations

import csv
import filecmp
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_npis_absent
import generate

LAST_6 = ("2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10")
LAST_14 = (
    "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04",
    "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
)
BH_CODES = {
    "2084P0800X",
    "103T00000X",
    "363LP0808X",
    "101YM0800X",
    "261QM0801X",
    "251S00000X",
}
HYPHEN = re.compile(r"^718-555-01\d\d$")
PAREN = re.compile(r"^\(718\) 555-01\d\d$")
OUTPUTS = (
    "seed.sql",
    "roster.csv",
    "claims.csv",
    "labels.csv",
    "nppes_snapshot.json",
    "generation_report.md",
)


def digits(value: str) -> str:
    return "".join(char for char in value if char.isdigit())


def split_sql_values(body: str) -> list[str]:
    values: list[str] = []
    buf: list[str] = []
    in_quote = False
    index = 0
    while index < len(body):
        char = body[index]
        if in_quote:
            if char == "'":
                if index + 1 < len(body) and body[index + 1] == "'":
                    buf.append("'")
                    index += 2
                    continue
                in_quote = False
            else:
                buf.append(char)
            index += 1
            continue
        if char == "'":
            in_quote = True
            index += 1
            continue
        if char == ",":
            values.append("".join(buf).strip())
            buf = []
            index += 1
            continue
        buf.append(char)
        index += 1
    values.append("".join(buf).strip())
    return values


def load_listings(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        if not line.startswith("INSERT INTO directory_listing"):
            continue
        columns_part, values_part = line.split(") VALUES (", 1)
        columns = [part.strip() for part in columns_part.split("(", 1)[1].split(",")]
        values = split_sql_values(values_part[:-2])
        row = dict(zip(columns, values))
        row["accepting_new_patients"] = row["accepting_new_patients"] == "true"
        rows.append(row)
    return rows


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def write_pair(root: Path, seed: int) -> Path:
    destination = root / f"seed-{seed}"
    generate.generate(seed, destination)
    return destination


class GeneratorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.out = write_pair(cls.root, 42)
        cls.listings = load_listings((cls.out / "seed.sql").read_text(encoding="utf-8"))
        cls.roster = read_csv(cls.out / "roster.csv")
        cls.claims = read_csv(cls.out / "claims.csv")
        cls.labels = read_csv(cls.out / "labels.csv")
        cls.nppes = json.loads((cls.out / "nppes_snapshot.json").read_text(encoding="utf-8"))
        cls.report = (cls.out / "generation_report.md").read_text(encoding="utf-8")
        cls.by_id = {row["listing_id"]: row for row in cls.listings}
        cls.roster_by_npi = {row["npi"]: row for row in cls.roster}
        cls.nppes_by_npi = {row["number"]: row for row in cls.nppes["results"]}

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_same_seed_is_byte_identical(self):
        other = write_pair(self.root, 42)
        for name in OUTPUTS:
            self.assertTrue(filecmp.cmp(self.out / name, other / name, shallow=False), name)
            self.assertNotIn(b"\r", (self.out / name).read_bytes(), name)

    def test_different_seed_changes_output(self):
        other = write_pair(self.root, 99)
        self.assertFalse(filecmp.cmp(self.out / "seed.sql", other / "seed.sql", shallow=False))

    def test_luhn(self):
        self.assertEqual(generate.npi_check_digit("123456789"), "3")
        seen = set()
        for row in self.roster:
            seen.add(row["npi"])
        for row in self.claims:
            seen.add(row["npi"])
        for row in self.listings:
            seen.add(row["npi"])
        for row in self.nppes["results"]:
            seen.add(row["number"])
        self.assertTrue(all(generate.is_valid_npi(npi) for npi in seen))

    def test_headers_and_geography(self):
        self.assertEqual(list(self.roster[0]), list(generate.ROSTER_COLUMNS))
        self.assertEqual(
            list(self.claims[0]),
            ["npi", "service_address_line1", "service_zip", "month", "claim_count", "new_patient_count"],
        )
        self.assertEqual(
            list(self.labels[0]),
            ["listing_id", "field", "error_type", "true_value", "is_decoy", "notes"],
        )
        self.assertEqual(len(self.roster), 184)
        self.assertEqual({row["batch"] for row in self.listings}, {"A", "B"})
        for batch in ("A", "B"):
            self.assertEqual(sum(1 for row in self.listings if row["batch"] == batch), 300)
        for row in self.listings:
            self.assertRegex(row["listing_id"], r"^L-\d{5}$")
            self.assertEqual(row["state"], "NY")
            self.assertEqual(row["county"], "Kings")
            self.assertEqual(row["city"], "Brooklyn")
            self.assertTrue(row["zip"].startswith("112"))
        self.assertEqual(len({row["listing_id"] for row in self.listings}), len(self.listings))

    def test_phones(self):
        for row in self.roster:
            self.assertRegex(row["phone"], HYPHEN)
            self.assertEqual(len(digits(row["phone"])), 10)
        for row in self.listings:
            self.assertTrue(HYPHEN.match(row["phone"]) or PAREN.match(row["phone"]), row["phone"])
            self.assertEqual(len(digits(row["phone"])), 10)

    def test_term_dates(self):
        for row in self.roster:
            if row["status"] == "terminated":
                self.assertNotEqual(row["term_date"], "")
            else:
                self.assertEqual(row["term_date"], "")
                self.assertIn(row["status"], {"active", "pending"})

    def test_error_rates_and_decoy_split(self):
        for batch in ("A", "B"):
            batch_labels = [row for row in self.labels if self.by_id[row["listing_id"]]["batch"] == batch]
            errors = [row for row in batch_labels if row["error_type"] != "decoy"]
            self.assertGreaterEqual(len(errors) / 300, 0.40)
            self.assertLessEqual(len(errors) / 300, 0.50)
            for error_type in ("address", "phone", "accepting", "ghost", "specialty"):
                self.assertEqual(sum(1 for row in batch_labels if row["error_type"] == error_type), 27)
            decoys = [row for row in batch_labels if row["error_type"] == "decoy"]
            self.assertEqual(len(decoys), 30)
            phone = [row for row in decoys if row["notes"] == "phone_punctuation"]
            suite = [row for row in decoys if row["notes"] == "suite"]
            mail = [row for row in decoys if row["notes"] == "mailing"]
            self.assertEqual(len(phone), 10)
            self.assertEqual(len(suite), 10)
            self.assertEqual(len(mail), 10)
            self.assertTrue(all(row["is_decoy"] == "true" for row in decoys))
            self.assertTrue(all(row["is_decoy"] == "false" and row["notes"] == "" for row in errors))
            for row in decoys:
                listing = self.by_id[row["listing_id"]]
                directory_value = listing["phone"] if row["field"] == "phone" else listing["address_line1"]
                self.assertEqual(row["true_value"], directory_value)
            for row in phone:
                roster = self.roster_by_npi[self.by_id[row["listing_id"]]["npi"]]
                record = self.nppes_by_npi[roster["npi"]]
                self.assertRegex(row["true_value"], PAREN)
                self.assertEqual(digits(row["true_value"]), digits(roster["phone"]))
                self.assertEqual(record["addresses"][0]["telephone_number"], roster["phone"])
                self.assertRegex(roster["phone"], HYPHEN)
            for row in suite:
                listing = self.by_id[row["listing_id"]]
                roster = self.roster_by_npi[listing["npi"]]
                self.assertEqual(roster["address_line1"], row["true_value"].replace(" Ste ", " Suite "))
                self.assertIn(row["true_value"], {item["service_address_line1"] for item in self.claims if item["npi"] == listing["npi"]})
            for row in mail:
                listing = self.by_id[row["listing_id"]]
                record = self.nppes_by_npi[listing["npi"]]
                location = next(item for item in record["addresses"] if item["address_purpose"] == "LOCATION")
                mailing = next(item for item in record["addresses"] if item["address_purpose"] == "MAILING")
                self.assertEqual(location["address_1"], row["true_value"])
                self.assertNotEqual(mailing["address_1"], location["address_1"])
                self.assertEqual(self.roster_by_npi[listing["npi"]]["address_line1"], row["true_value"])
        grouped: dict[str, list[dict]] = {}
        for row in self.labels:
            grouped.setdefault(row["listing_id"], []).append(row)
        for listing_id, rows in grouped.items():
            decoy_rows = [row for row in rows if row["is_decoy"] == "true"]
            planted_rows = [row for row in rows if row["error_type"] != "decoy"]
            self.assertFalse(decoy_rows and planted_rows, listing_id)
            if any(row["error_type"] == "decoy" for row in rows):
                self.assertEqual(len(decoy_rows), 1, listing_id)

    def test_no_repeated_error_type(self):
        by_npi: dict[str, dict[str, str]] = {}
        for row in self.labels:
            listing = self.by_id[row["listing_id"]]
            by_npi.setdefault(listing["npi"], {})[listing["batch"]] = row["error_type"]
        for npi, batches in by_npi.items():
            if "A" in batches and "B" in batches:
                self.assertNotEqual(batches["A"], batches["B"], npi)

    def test_ghosts(self):
        ghost_rows = [row for row in self.labels if row["error_type"] == "ghost"]
        ghost_npis = set()
        for row in ghost_rows:
            self.assertEqual(row["field"], "status")
            self.assertEqual(row["true_value"], "terminated")
            listing = self.by_id[row["listing_id"]]
            ghost_npis.add(listing["npi"])
            self.assertTrue(listing["accepting_new_patients"])
            roster = self.roster_by_npi[listing["npi"]]
            self.assertEqual(roster["status"], "terminated")
            self.assertNotEqual(roster["term_date"], "")
            recent = [
                item for item in self.claims
                if item["npi"] == listing["npi"] and item["month"] in LAST_14
            ]
            self.assertEqual(recent, [])
        self.assertEqual(len(ghost_npis), 54)
        for npi in ghost_npis:
            accepting = [
                row["listing_id"]
                for row in self.listings
                if row["npi"] == npi and row["accepting_new_patients"]
            ]
            labeled = [
                row["listing_id"]
                for row in ghost_rows
                if self.by_id[row["listing_id"]]["npi"] == npi
            ]
            self.assertEqual(sorted(accepting), sorted(labeled))

    def test_every_label_id_exists(self):
        ids = {row["listing_id"] for row in self.listings}
        for row in self.labels:
            self.assertIn(row["listing_id"], ids)
            self.assertNotIn("Annex", self.by_id[row["listing_id"]]["address_line1"])

    def test_satellites_have_recent_claims(self):
        for listing in self.listings:
            if "Annex" not in listing["address_line1"]:
                continue
            months = {
                row["month"]
                for row in self.claims
                if row["npi"] == listing["npi"]
                and row["service_address_line1"] == listing["address_line1"]
                and row["month"] in LAST_6
                and int(row["claim_count"]) > 0
            }
            self.assertGreaterEqual(len(months), 3, listing["listing_id"])

    def test_sunrise_two_against_two(self):
        sunrise = [row for row in self.roster if row["group_name"] == "Sunrise Behavioral Group"]
        self.assertEqual(len(sunrise), 13)
        sunrise_npis = {row["npi"] for row in sunrise}
        for row in sunrise:
            self.assertEqual(row["address_line1"], "900 Old Pier St")
            self.assertEqual(row["zip"], "11201")
            record = self.nppes_by_npi[row["npi"]]
            location = next(item for item in record["addresses"] if item["address_purpose"] == "LOCATION")
            self.assertEqual(location["address_1"], "100 Harbor Sample Ave")
            self.assertTrue(any(
                item["npi"] == row["npi"] and item["service_address_line1"] == "100 Harbor Sample Ave"
                for item in self.claims
            ))
        stale_claims = [
            row for row in self.claims
            if row["service_address_line1"] == "900 Old Pier St"
        ]
        self.assertEqual(stale_claims, [])

        primaries = [
            row for row in self.listings
            if row["npi"] in sunrise_npis and "Annex" not in row["address_line1"]
        ]
        by_npi_batch: dict[tuple[str, str], dict] = {(row["npi"], row["batch"]): row for row in primaries}
        both = [npi for npi in sunrise_npis if (npi, "A") in by_npi_batch and (npi, "B") in by_npi_batch]
        only_b = [npi for npi in sunrise_npis if (npi, "B") in by_npi_batch and (npi, "A") not in by_npi_batch]
        self.assertEqual(len(both), 9)
        self.assertEqual(len(only_b), 4)
        self.assertEqual(sum(1 for row in sunrise if row["provider_type"] == "organization"), 1)
        self.assertTrue(all(self.roster_by_npi[npi]["provider_type"] == "individual" for npi in only_b))

        labels_by_id = {row["listing_id"]: row for row in self.labels}
        for npi in both:
            batch_a = by_npi_batch[(npi, "A")]
            batch_b = by_npi_batch[(npi, "B")]
            self.assertEqual(batch_a["address_line1"], "900 Old Pier St")
            label_a = labels_by_id[batch_a["listing_id"]]
            self.assertEqual(label_a["error_type"], "address")
            self.assertEqual(label_a["field"], "address")
            self.assertEqual(label_a["true_value"], "100 Harbor Sample Ave")
            self.assertEqual(batch_b["address_line1"], "100 Harbor Sample Ave")
            label_b = labels_by_id[batch_b["listing_id"]]
            self.assertEqual(label_b["error_type"], "phone")
            self.assertEqual(label_b["field"], "phone")
            self.assertNotEqual(batch_b["phone"], self.roster_by_npi[npi]["phone"])
            self.assertNotIn(
                batch_b["listing_id"],
                {row["listing_id"] for row in self.labels if row["error_type"] == "address"},
            )
        for npi in only_b:
            listing = by_npi_batch[(npi, "B")]
            self.assertEqual(listing["address_line1"], "900 Old Pier St")
            label = labels_by_id[listing["listing_id"]]
            self.assertEqual((label["field"], label["error_type"], label["true_value"]), ("address", "address", "100 Harbor Sample Ave"))

        self.assertIn("Roster practice address (`address_line1`): 900 Old Pier St", self.report)
        self.assertIn("Claims service address and NPPES LOCATION: 100 Harbor Sample Ave.", self.report)
        self.assertIn("directory and roster at 900 Old Pier St, claims and NPPES at 100 Harbor Sample Ave", self.report)
        self.assertIn("Batch A address-error listings: 9", self.report)
        self.assertIn("Batch B address-error listings: 4", self.report)
        self.assertIn("Clinicians only in batch B: 4", self.report)
        self.assertIn("no address label", self.report)

    def test_nppes_coverage(self):
        self.assertEqual(self.nppes["result_count"], len(self.nppes["results"]))
        roster_npis = {row["npi"] for row in self.roster}
        snapshot = set(self.nppes_by_npi)
        missing = roster_npis - snapshot
        ghost_npis = {self.by_id[row["listing_id"]]["npi"] for row in self.labels if row["error_type"] == "ghost"}
        self.assertEqual(snapshot - roster_npis, set())
        self.assertEqual(len(missing), 18)
        self.assertTrue(missing <= ghost_npis)
        self.assertGreaterEqual(len(missing) / len(ghost_npis), 0.30)
        self.assertLessEqual(len(missing) / len(ghost_npis), 0.40)
        mail_npis = {
            self.by_id[row["listing_id"]]["npi"]
            for row in self.labels
            if row["error_type"] == "decoy" and row["notes"] == "mailing"
        }
        self.assertTrue(mail_npis.isdisjoint(missing))
        for row in self.roster:
            if row["npi"] in missing:
                self.assertEqual(row["status"], "terminated")
                continue
            record = self.nppes_by_npi[row["npi"]]
            if row["provider_type"] == "organization":
                self.assertEqual(record["enumeration_type"], "NPI-2")
                self.assertIn("organization_name", record["basic"])
            else:
                self.assertEqual(record["enumeration_type"], "NPI-1")
                self.assertIn("first_name", record["basic"])
                self.assertIn("last_name", record["basic"])
            self.assertEqual(record["taxonomies"][0]["code"], row["taxonomy_code"])
            self.assertEqual(record["taxonomies"][0]["desc"], row["specialty"])

    def test_behavioral_health_share(self):
        bh = [row for row in self.roster if row["taxonomy_code"] in BH_CODES]
        self.assertEqual(len(bh), 110)
        self.assertGreaterEqual(len(bh) / len(self.roster), 0.55)
        self.assertLessEqual(len(bh) / len(self.roster), 0.65)
        known = {code for code, _name, _kind, _bh in generate.TAXONOMIES}
        self.assertTrue(all(row["taxonomy_code"] in known for row in self.roster))

    def test_windows(self):
        self.assertEqual(generate.MONTHS[0], "2025-05")
        self.assertEqual(generate.MONTHS[-1], "2026-10")
        self.assertEqual(len(generate.MONTHS), 18)
        self.assertEqual(generate.LAST_14, LAST_14)
        self.assertEqual(generate.LAST_6, LAST_6)
        months = {row["month"] for row in self.claims}
        self.assertTrue(months <= set(generate.MONTHS))


class NpiCheckTest(unittest.TestCase):
    def test_selects_twenty_unique(self):
        chosen = check_npis_absent.select_npis([f"{index:010d}" for index in range(184)], 20)
        self.assertEqual(len(chosen), 20)
        self.assertEqual(len(set(chosen)), 20)

    def test_hit_detection_does_not_call_network(self):
        self.assertTrue(check_npis_absent.is_hit({"result_count": 1, "results": [{}]}))
        self.assertFalse(check_npis_absent.is_hit({"result_count": 0, "results": []}))
        self.assertFalse(check_npis_absent.is_hit({"Errors": [{"description": "not found"}]}))


if __name__ == "__main__":
    unittest.main()
