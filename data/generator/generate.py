"""Deterministic synthetic provider data for Ghost Network Auditor.

Standard library only. `python data/generator/generate.py --seed 42` overwrites
the sample files under data/sample. Labels are an answer key for eval/.
"""

from __future__ import annotations

import argparse
import calendar
import csv
import json
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

SEED_DEFAULT = 42
PROVIDER_COUNT = 184
LISTINGS_PER_BATCH = 300
ERRORS_PER_TYPE = 27
DECOYS_PER_SUBTYPE = 10
BH_PROVIDER_COUNT = 110
GHOSTS_OMITTED = 18
SUNRISE_GROUP = "Sunrise Behavioral Group"
SUNRISE_TRUE_ADDRESS = "100 Harbor Sample Ave"
SUNRISE_STALE_ADDRESS = "900 Old Pier St"
SUNRISE_ZIP = "11201"
CITY = "Brooklyn"
STATE = "NY"
COUNTY = "Kings"

# code, specialty name, individual|organization, behavioral health
TAXONOMIES = (
    ("2084P0800X", "Psychiatry", "individual", True),
    ("103T00000X", "Psychologist", "individual", True),
    ("363LP0808X", "Nurse Practitioner, Psychiatric/Mental Health", "individual", True),
    ("101YM0800X", "Counselor, Mental Health", "individual", True),
    ("261QM0801X", "Clinic/Center, Mental Health", "organization", True),
    ("251S00000X", "Community/Behavioral Health Agency", "organization", True),
    ("207Q00000X", "Family Medicine", "individual", False),
    ("207R00000X", "Internal Medicine", "individual", False),
    ("208000000X", "Pediatrics", "individual", False),
    ("207V00000X", "Obstetrics & Gynecology", "individual", False),
    ("207P00000X", "Emergency Medicine", "individual", False),
    ("207X00000X", "Orthopaedic Surgery", "individual", False),
    ("363L00000X", "Nurse Practitioner", "individual", False),
    ("363A00000X", "Physician Assistant", "individual", False),
    ("225100000X", "Physical Therapist", "individual", False),
    ("1223G0001X", "Dentist, General Practice", "individual", False),
    ("261QP2300X", "Clinic/Center, Primary Care", "organization", False),
    ("261QM1300X", "Clinic/Center, Multi-Specialty", "organization", False),
    ("261QC1500X", "Clinic/Center, Community Health", "organization", False),
)

BH_CODES = {code for code, _name, _kind, behavioral in TAXONOMIES if behavioral}
CREDENTIALS = {
    "2084P0800X": "MD",
    "103T00000X": "PhD",
    "363LP0808X": "NP",
    "101YM0800X": "LCSW",
    "363L00000X": "NP",
    "363A00000X": "PA",
    "225100000X": "PT",
    "1223G0001X": "DDS",
    "207Q00000X": "MD",
    "207R00000X": "MD",
    "208000000X": "MD",
    "207V00000X": "MD",
    "207P00000X": "MD",
    "207X00000X": "MD",
}

FIRST_NAMES = (
    "Avery", "Blake", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper",
    "Jules", "Kendall", "Logan", "Marlow", "Nolan", "Parker", "Quinn", "Reese",
    "Sawyer", "Taylor", "Winter", "Eden",
)
LAST_NAMES = (
    "Brook", "Calder", "Dunn", "Ellis", "Finch", "Grove", "Hale", "Iver",
    "Joyce", "Keene", "Lane", "Moss", "North", "Oak", "Penn", "Quill",
    "Rowe", "Shore", "Vale", "West",
)
ORG_NAMES = (
    "Sunrise Behavioral Group",
    "North Ledger Clinic",
    "Harbor Sample Practice",
    "Kings Placeholder Clinic",
    "Audit Row Health",
    "Demo Court Clinic",
    "Fictional Blvd Practice",
    "Mock Lane Clinic",
    "Sample Shore Health",
    "West Index Practice",
    "Brook Calder Clinic",
    "Grove Hale Health",
    "Lane Moss Practice",
    "Penn Quill Clinic",
    "Rowe Shore Health",
    "Vale West Clinic",
    "Finch Oak Practice",
    "Ellis Dunn Health",
    "Joyce Keene Clinic",
    "Indigo North Practice",
    "Winter Vale Clinic",
    "Calder Grove Health",
    "Hale Penn Practice",
    "Moss Lane Clinic",
    "Oak Shore Health",
    "Quill Rowe Practice",
    "Sample Index Clinic",
    "Ledger Pier Health",
    "Placeholder Kings Clinic",
    "Demo Mock Practice",
)
ORG_INDEXES = (
    0, 12, 15, 18, 24, 30, 33, 42, 48, 55, 60, 66, 70, 78, 85, 90, 99, 102,
    110, 116, 122, 128, 136, 146, 152, 162, 168, 172, 176, 178,
)
ZIPS = (
    "11201", "11203", "11204", "11205", "11206", "11207", "11208", "11209",
    "11210", "11211", "11212", "11213", "11214", "11215", "11216", "11217",
    "11218", "11219", "11220", "11221", "11222", "11223", "11224", "11225",
    "11226", "11228", "11229", "11230", "11231", "11232", "11233", "11234",
    "11235", "11236", "11237", "11238", "11239",
)

A_SUITE = frozenset(range(140, 150))
B_SUITE = frozenset(range(150, 160))
B_SUNRISE = frozenset(range(180, 184))
PENDING = frozenset(range(175, 180))
SUNRISE_BOTH = frozenset(range(0, 9))
BH_INDEXES = frozenset(list(range(0, 106)) + list(range(180, 184)))

ROLE_ERROR = {
    "address": "address",
    "phone": "phone",
    "accepting": "accepting",
    "ghost": "ghost",
    "specialty": "specialty",
    "decoy_suite": "decoy",
    "decoy_phone": "decoy",
    "decoy_mail": "decoy",
}
ROLE_FIELD = {
    "address": "address",
    "phone": "phone",
    "accepting": "accepting",
    "ghost": "status",
    "specialty": "specialty",
    "decoy_suite": "address",
    "decoy_phone": "phone",
    "decoy_mail": "address",
}
REAL_ERRORS = ("address", "phone", "accepting", "ghost", "specialty")
INSERT_COLUMNS = (
    "listing_id", "batch", "npi", "provider_name", "provider_type", "specialty",
    "group_name", "address_line1", "city", "state", "zip", "phone",
    "accepting_new_patients", "network_status", "last_verified_date", "county",
)
ROSTER_COLUMNS = (
    "npi", "provider_name", "provider_type", "group_name", "taxonomy_code",
    "specialty", "status", "effective_date", "term_date", "address_line1",
    "city", "state", "zip", "phone",
)
CLAIMS_COLUMNS = (
    "npi", "service_address_line1", "service_zip", "month", "claim_count",
    "new_patient_count",
)
LABEL_COLUMNS = ("listing_id", "field", "error_type", "true_value", "is_decoy", "notes")
DECOY_NOTES = {
    "decoy_suite": "suite",
    "decoy_phone": "phone_punctuation",
    "decoy_mail": "mailing",
}

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "data" / "sample"


def month_sequence() -> list[str]:
    months = []
    year, month = 2025, 5
    for _ in range(18):
        months.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            month = 1
            year += 1
    return months


MONTHS = tuple(month_sequence())
GHOST_MONTHS = MONTHS[:4]
LAST_14 = MONTHS[-14:]
LAST_6 = MONTHS[-6:]


def npi_check_digit(npi9: str) -> str:
    """CMS Luhn check digit. The 9-digit body is prefixed with 80840."""
    payload = "80840" + npi9
    total = 0
    for index, char in enumerate(reversed(payload)):
        digit = int(char)
        if index % 2 == 0:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return str((10 - (total % 10)) % 10)


def make_npi(index: int) -> str:
    body = f"{800000000 + index:09d}"
    return body + npi_check_digit(body)


def is_valid_npi(npi: str) -> bool:
    return len(npi) == 10 and npi.isdigit() and npi_check_digit(npi[:9]) == npi[9]


def hyphen_phone(slot: int) -> str:
    return f"718-555-01{slot % 100:02d}"


def paren_phone(slot: int) -> str:
    return f"(718) 555-01{slot % 100:02d}"


def epoch(iso_day: str) -> int:
    year, month, day = (int(part) for part in iso_day.split("-"))
    return calendar.timegm((year, month, day, 0, 0, 0))


def sql_quote(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return "'" + str(value).replace("'", "''") + "'"


def in_batch(index: int, batch: str) -> bool:
    if batch == "A":
        return index < 180 and index not in B_SUITE
    return index not in A_SUITE and index < PROVIDER_COUNT


def assign_roles(seed: int) -> tuple[dict[int, str], dict[int, str], set[int]]:
    """Batch B reassigns batch A. The seed shuffles only the split blocks."""
    a_role: dict[int, str] = {}
    b_role: dict[int, str] = {}

    def put(table: dict[int, str], index: int, role: str) -> None:
        if index in table:
            raise RuntimeError(f"index {index} already has role {table[index]}")
        table[index] = role

    for index in range(0, 27):
        put(a_role, index, "address")
    for index in range(27, 54):
        put(a_role, index, "phone")
    for index in range(54, 81):
        put(a_role, index, "accepting")
    for index in range(81, 108):
        put(a_role, index, "ghost")
    for index in range(108, 135):
        put(a_role, index, "specialty")
    for index in list(range(135, 140)) + list(range(160, 165)):
        put(a_role, index, "decoy_phone")
    for index in range(165, 175):
        put(a_role, index, "decoy_mail")
    for index in sorted(A_SUITE):
        put(a_role, index, "decoy_suite")

    rng = random.Random(seed)
    ghosts = list(range(81, 108))
    rng.shuffle(ghosts)
    for index in ghosts[:10]:
        put(b_role, index, "decoy_phone")
    for index in ghosts[10:20]:
        put(b_role, index, "decoy_mail")
    for index in ghosts[20:]:
        put(b_role, index, "address")

    specs = list(range(108, 135))
    rng.shuffle(specs)
    for index in specs[:6]:
        put(b_role, index, "address")
    for index in specs[6:23]:
        put(b_role, index, "accepting")

    for index in range(0, 27):
        put(b_role, index, "phone")
    for index in range(27, 54):
        put(b_role, index, "ghost")
    for index in range(54, 81):
        put(b_role, index, "specialty")
    for index in list(range(135, 140)) + list(range(160, 165)):
        put(b_role, index, "address")
    for index in range(165, 175):
        put(b_role, index, "accepting")
    for index in sorted(B_SUITE):
        put(b_role, index, "decoy_suite")
    for index in sorted(B_SUNRISE):
        put(b_role, index, "address")

    decoy_roles = {"decoy_suite", "decoy_phone", "decoy_mail"}
    protected = {
        index
        for table in (a_role, b_role)
        for index, role in table.items()
        if role in decoy_roles
    }
    ghost_indexes = [
        index
        for index in range(PROVIDER_COUNT)
        if a_role.get(index) == "ghost" or b_role.get(index) == "ghost"
    ]
    eligible = [index for index in ghost_indexes if index not in protected]
    rng.shuffle(eligible)
    if len(eligible) < GHOSTS_OMITTED:
        raise RuntimeError("not enough ghost NPIs to omit from NPPES")
    omitted = set(eligible[:GHOSTS_OMITTED])
    return a_role, b_role, omitted


def taxonomy_for(index: int, is_org: bool, is_bh: bool, is_sunrise: bool) -> tuple[str, str]:
    if is_sunrise and is_org:
        return "261QM0801X", "Clinic/Center, Mental Health"
    kind = "organization" if is_org else "individual"
    pool = [row for row in TAXONOMIES if row[2] == kind and row[3] is is_bh]
    code, name, _kind, _bh = pool[index % len(pool)]
    return code, name


def other_specialty(index: int, code: str, is_org: bool) -> str:
    kind = "organization" if is_org else "individual"
    pool = [row[1] for row in TAXONOMIES if row[2] == kind and row[0] != code]
    return pool[index % len(pool)]


def build(seed: int) -> dict:
    org_set = set(ORG_INDEXES)
    if len(org_set) != 30 or len(ORG_NAMES) != 30 or len(BH_INDEXES) != BH_PROVIDER_COUNT:
        raise RuntimeError("provider constants drifted")
    org_name = {index: ORG_NAMES[pos] for pos, index in enumerate(sorted(org_set))}
    a_role, b_role, omitted = assign_roles(seed)
    providers = []
    for index in range(PROVIDER_COUNT):
        is_org = index in org_set
        is_sunrise = index in SUNRISE_BOTH or index in B_SUNRISE
        is_bh = index in BH_INDEXES
        code, specialty = taxonomy_for(index, is_org, is_bh, is_sunrise)
        slot = index % 100
        is_suite = a_role.get(index) == "decoy_suite" or b_role.get(index) == "decoy_suite"
        if is_sunrise:
            # Credentialing still has the old street. Claims and NPPES have the new one.
            true_address = SUNRISE_TRUE_ADDRESS
            roster_address = SUNRISE_STALE_ADDRESS
            stale = SUNRISE_STALE_ADDRESS
            zip_code = SUNRISE_ZIP
        elif is_suite:
            true_address = f"{200 + index} Ledger Ave Ste 4"
            roster_address = true_address.replace(" Ste ", " Suite ")
            stale = f"{300 + index} Stale Sample St"
            zip_code = ZIPS[index % len(ZIPS)]
        else:
            true_address = f"{100 + index} Harbor Sample Ave"
            roster_address = true_address
            stale = f"{300 + index} Stale Sample St"
            zip_code = ZIPS[index % len(ZIPS)]
        if is_org:
            provider_name = org_name[index]
            first = ""
            last = ""
            provider_type = "organization"
        else:
            first = FIRST_NAMES[index % len(FIRST_NAMES)]
            last = LAST_NAMES[(index // len(FIRST_NAMES)) % len(LAST_NAMES)]
            provider_name = f"{first} {last}"
            provider_type = "individual"
        group_name = SUNRISE_GROUP if is_sunrise else (provider_name if is_org else "Kings Sample Group")
        is_ghost = a_role.get(index) == "ghost" or b_role.get(index) == "ghost"
        is_accepting_error = a_role.get(index) == "accepting" or b_role.get(index) == "accepting"
        is_mail = a_role.get(index) == "decoy_mail" or b_role.get(index) == "decoy_mail"
        if index in PENDING:
            status = "pending"
        elif is_ghost:
            status = "terminated"
        else:
            status = "active"
        effective = (date(2016, 1, 1) + timedelta(days=index * 11)).isoformat()
        providers.append(
            {
                "index": index,
                "npi": make_npi(index),
                "provider_type": provider_type,
                "provider_name": provider_name,
                "first": first,
                "last": last,
                "group_name": group_name,
                "taxonomy_code": code,
                "specialty": specialty,
                "wrong_specialty": other_specialty(index, code, is_org),
                "status": status,
                "effective_date": effective,
                "term_date": "2025-08-31" if status == "terminated" else "",
                "true_address": true_address,
                "roster_address": roster_address,
                "stale_address": stale,
                "mail_address": f"{400 + index} Mailbox Sample Rd",
                "zip": zip_code,
                "phone_slot": slot,
                "phone": hyphen_phone(slot),
                "wrong_phone": hyphen_phone(slot + 17),
                "is_ghost": is_ghost,
                "is_accepting_error": is_accepting_error,
                "is_mail": is_mail,
                "is_suite": is_suite,
                "is_sunrise": is_sunrise,
                "is_bh": code in BH_CODES,
                "is_org": is_org,
                "a_role": a_role.get(index),
                "b_role": b_role.get(index),
                "omitted": index in omitted,
                "credential": CREDENTIALS.get(code, "MD"),
                "sex": "F" if index % 2 == 0 else "M",
            }
        )

    satellite_plan = satellite_counts(providers)
    listings = []
    for batch in ("A", "B"):
        verified = "2026-04-15" if batch == "A" else "2026-09-15"
        primaries = [provider for provider in providers if in_batch(provider["index"], batch)]
        for provider in primaries:
            role = provider["a_role"] if batch == "A" else provider["b_role"]
            listings.append(make_primary(provider, batch, role, verified))
        for provider in primaries:
            count = satellite_plan.get((batch, provider["index"]), 0)
            for number in range(count):
                listings.append(make_satellite(provider, batch, number, verified))

    for number, listing in enumerate(listings, start=1):
        listing["listing_id"] = f"L-{number:05d}"

    by_index = {provider["index"]: provider for provider in providers}
    labels = []
    for listing in listings:
        role = listing["role"]
        if listing["satellite"] or role is None:
            continue
        provider = by_index[listing["index"]]
        error_type = ROLE_ERROR[role]
        labels.append(
            {
                "listing_id": listing["listing_id"],
                "field": ROLE_FIELD[role],
                "error_type": error_type,
                "true_value": truth_value(provider, role),
                "is_decoy": "true" if error_type == "decoy" else "false",
                "notes": DECOY_NOTES.get(role, ""),
            }
        )

    claims = []
    for provider in providers:
        claims.extend(claims_for(provider, satellite_plan))
    claims.sort(key=lambda row: (row["npi"], row["service_address_line1"], row["month"]))

    world = {
        "seed": seed,
        "providers": providers,
        "listings": listings,
        "labels": labels,
        "claims": claims,
        "nppes": nppes_document(providers),
        "omitted": omitted,
    }
    world["report"] = render_report(world)
    validate(world)
    return world


def satellite_counts(providers: list[dict]) -> dict[tuple[str, int], int]:
    plan: dict[tuple[str, int], int] = {}
    for batch in ("A", "B"):
        hosts = sorted(
            provider["index"]
            for provider in providers
            if in_batch(provider["index"], batch)
            and provider["index"] not in PENDING
            and not provider["is_ghost"]
        )
        primary_count = sum(1 for provider in providers if in_batch(provider["index"], batch))
        needed = LISTINGS_PER_BATCH - primary_count
        if needed < 0 or (needed and not hosts):
            raise RuntimeError(f"batch {batch} cannot place {needed} satellites")
        base, extra = divmod(needed, len(hosts)) if hosts else (0, 0)
        for rank, index in enumerate(hosts):
            plan[(batch, index)] = base + (1 if rank < extra else 0)
    return plan


def make_primary(provider: dict, batch: str, role: str | None, verified: str) -> dict:
    if role == "address":
        address = provider["stale_address"]
    else:
        address = provider["true_address"]
    if role == "decoy_phone":
        phone = paren_phone(provider["phone_slot"])
    elif role == "phone":
        phone = provider["wrong_phone"]
    else:
        phone = provider["phone"]
    specialty = provider["wrong_specialty"] if role == "specialty" else provider["specialty"]
    return {
        "index": provider["index"],
        "npi": provider["npi"],
        "batch": batch,
        "role": role,
        "satellite": False,
        "provider_name": provider["provider_name"],
        "provider_type": provider["provider_type"],
        "specialty": specialty,
        "group_name": provider["group_name"],
        "address_line1": address,
        "city": CITY,
        "state": STATE,
        "zip": provider["zip"],
        "phone": phone,
        "accepting_new_patients": accepting_flag(provider, role),
        "network_status": network_flag(provider, role),
        "last_verified_date": verified,
        "county": COUNTY,
    }


def make_satellite(provider: dict, batch: str, number: int, verified: str) -> dict:
    return {
        "index": provider["index"],
        "npi": provider["npi"],
        "batch": batch,
        "role": None,
        "satellite": True,
        "provider_name": provider["provider_name"],
        "provider_type": provider["provider_type"],
        "specialty": provider["specialty"],
        "group_name": provider["group_name"],
        "address_line1": f"Annex {provider['index'] + 1}-{number + 1} Sample Rd",
        "city": CITY,
        "state": STATE,
        "zip": provider["zip"],
        "phone": provider["phone"],
        "accepting_new_patients": accepting_flag(provider, None),
        "network_status": network_flag(provider, None),
        "last_verified_date": verified,
        "county": COUNTY,
    }


def accepting_flag(provider: dict, role: str | None) -> bool:
    if provider["index"] in PENDING:
        return False
    if role in ("ghost", "accepting"):
        return True
    if provider["is_ghost"] or provider["is_accepting_error"]:
        return False
    return True


def network_flag(provider: dict, role: str | None) -> str:
    if provider["index"] in PENDING:
        return "out"
    if provider["is_ghost"] and role != "ghost":
        return "out"
    return "in"


def truth_value(provider: dict, role: str) -> str:
    if role == "address":
        return provider["true_address"]
    if role == "phone":
        return provider["phone"]
    if role == "accepting":
        return "false"
    if role == "ghost":
        return "terminated"
    if role == "specialty":
        return provider["specialty"]
    if role == "decoy_phone":
        return paren_phone(provider["phone_slot"])
    return provider["true_address"]


def claims_for(provider: dict, satellite_plan: dict[tuple[str, int], int]) -> list[dict]:
    if provider["index"] in PENDING:
        return []
    rows = []
    if provider["is_ghost"]:
        months = GHOST_MONTHS
        new_patients: int | None = 1
    else:
        months = MONTHS
        new_patients = 0 if provider["is_accepting_error"] else None
    for offset, month in enumerate(months):
        new_count = new_patients if new_patients is not None else 1 + (provider["index"] + offset) % 3
        rows.append(
            claim_row(
                provider,
                provider["true_address"],
                provider["zip"],
                month,
                5 + (provider["index"] + offset) % 12,
                new_count,
            )
        )
    if provider["is_ghost"]:
        return rows
    seen = set()
    for batch in ("A", "B"):
        count = satellite_plan.get((batch, provider["index"]), 0)
        for number in range(count):
            address = f"Annex {provider['index'] + 1}-{number + 1} Sample Rd"
            if address in seen:
                continue
            seen.add(address)
            for month in LAST_6:
                new_count = 0 if provider["is_accepting_error"] else 1
                rows.append(claim_row(provider, address, provider["zip"], month, 4 + (number % 5), new_count))
    return rows


def claim_row(provider: dict, address: str, zip_code: str, month: str, claim_count: int, new_count: int) -> dict:
    return {
        "npi": provider["npi"],
        "service_address_line1": address,
        "service_zip": zip_code,
        "month": month,
        "claim_count": str(claim_count),
        "new_patient_count": str(new_count),
    }


def nppes_document(providers: list[dict]) -> dict:
    results = []
    for provider in providers:
        if provider["omitted"]:
            continue
        location = address_block("LOCATION", provider["true_address"], provider)
        mailing_street = provider["mail_address"] if provider["is_mail"] else provider["true_address"]
        mailing = address_block("MAILING", mailing_street, provider)
        if provider["is_org"]:
            basic = {
                "organization_name": provider["provider_name"].upper(),
                "organizational_subpart": "NO",
                "enumeration_date": provider["effective_date"],
                "last_updated": "2026-01-15",
                "status": "A",
                "authorized_official_first_name": "CASEY",
                "authorized_official_last_name": "SAMPLE",
                "authorized_official_telephone_number": provider["phone"],
                "authorized_official_title_or_position": "DIRECTOR",
                "name": provider["provider_name"].upper(),
            }
            enumeration = "NPI-2"
        else:
            basic = {
                "first_name": provider["first"].upper(),
                "last_name": provider["last"].upper(),
                "credential": provider["credential"],
                "sole_proprietor": "NO",
                "sex": provider["sex"],
                "enumeration_date": provider["effective_date"],
                "last_updated": "2026-01-15",
                "status": "A",
                "name": f"{provider['last'].upper()} {provider['first'].upper()}",
            }
            enumeration = "NPI-1"
        results.append(
            {
                "number": provider["npi"],
                "enumeration_type": enumeration,
                "basic": basic,
                "addresses": [location, mailing],
                "taxonomies": [
                    {
                        "code": provider["taxonomy_code"],
                        "desc": provider["specialty"],
                        "primary": True,
                        "state": STATE,
                        "license": f"SYN{provider['index']:05d}",
                    }
                ],
                "created_epoch": epoch(provider["effective_date"]),
                "last_updated_epoch": epoch("2026-01-15"),
            }
        )
    results.sort(key=lambda row: row["number"])
    return {"result_count": len(results), "results": results}


def address_block(purpose: str, street: str, provider: dict) -> dict:
    return {
        "country_code": "US",
        "country_name": "United States",
        "address_purpose": purpose,
        "address_type": "DOM",
        "address_1": street,
        "city": CITY.upper(),
        "state": STATE,
        "postal_code": provider["zip"],
        "telephone_number": provider["phone"],
    }


def render_report(world: dict) -> str:
    providers = world["providers"]
    listings = world["listings"]
    labels = world["labels"]
    by_id = {row["listing_id"]: row for row in listings}
    lines = [
        "# Generation report",
        "",
        f"Seed: {world['seed']}",
        "",
        "## Counts",
        f"- Roster providers: {len(providers)}",
        f"- Individuals: {sum(1 for row in providers if row['provider_type'] == 'individual')}",
        f"- Organizations: {sum(1 for row in providers if row['provider_type'] == 'organization')}",
        f"- Claims rows: {len(world['claims'])}",
        f"- NPPES results: {world['nppes']['result_count']}",
        f"- Ghost NPIs omitted from NPPES: {len(world['omitted'])} of {sum(1 for row in providers if row['is_ghost'])}",
    ]
    for batch in ("A", "B"):
        batch_rows = [row for row in listings if row["batch"] == batch]
        primaries = sum(1 for row in batch_rows if not row["satellite"])
        satellites = len(batch_rows) - primaries
        lines.append(f"- Listings batch {batch}: {len(batch_rows)} ({primaries} primary, {satellites} satellite)")
    lines.extend(["", "## Error rate", ""])
    for batch in ("A", "B"):
        batch_labels = [row for row in labels if by_id[row["listing_id"]]["batch"] == batch]
        errors = [row for row in batch_labels if row["error_type"] != "decoy"]
        lines.append(f"- Batch {batch}: {len(errors)}/{LISTINGS_PER_BATCH} ({len(errors) / LISTINGS_PER_BATCH:.1%})")
    lines.extend(["", "## Error types", ""])
    for error_type in REAL_ERRORS:
        counts = []
        for batch in ("A", "B"):
            count = sum(
                1
                for row in labels
                if row["error_type"] == error_type and by_id[row["listing_id"]]["batch"] == batch
            )
            counts.append(f"{batch} {count}")
        lines.append(f"- {error_type}: {', '.join(counts)}")
    lines.extend(["", "## Decoys", ""])
    for batch in ("A", "B"):
        suite = phone = mail = 0
        for row in labels:
            if row["error_type"] != "decoy" or by_id[row["listing_id"]]["batch"] != batch:
                continue
            if row["notes"] == "phone_punctuation":
                phone += 1
            elif row["notes"] == "suite":
                suite += 1
            elif row["notes"] == "mailing":
                mail += 1
        lines.append(f"- Batch {batch}: {suite + phone + mail} ({suite} suite, {phone} phone punctuation, {mail} mailing)")
    bh = sum(1 for row in providers if row["is_bh"])
    sunrise = [row for row in providers if row["is_sunrise"]]
    sunrise_npis = {row["npi"] for row in sunrise}
    sunrise_listings = [row for row in listings if row["npi"] in sunrise_npis]
    labeled_address = [
        by_id[row["listing_id"]]
        for row in labels
        if row["error_type"] == "address" and by_id[row["listing_id"]]["npi"] in sunrise_npis
    ]
    only_b = [
        row["npi"]
        for row in sunrise
        if any(item["batch"] == "B" and item["npi"] == row["npi"] for item in listings)
        and not any(item["batch"] == "A" and item["npi"] == row["npi"] for item in listings)
    ]
    lines.extend(
        [
            "",
            "## Behavioral health",
            f"- {bh}/{len(providers)} ({bh / len(providers):.1%})",
            "",
            "## Sunrise Behavioral Group",
            f"- Roster NPIs: {len(sunrise)}",
            f"- Directory rows: {len(sunrise_listings)}",
            f"- Address-error listings: {len(labeled_address)}",
            f"- Batch A address-error listings: {sum(1 for row in labeled_address if row['batch'] == 'A')}",
            f"- Batch B address-error listings: {sum(1 for row in labeled_address if row['batch'] == 'B')}",
            f"- Clinicians only in batch B: {len(only_b)}",
            f"- Roster practice address (`address_line1`): {SUNRISE_STALE_ADDRESS} for all {len(sunrise)} NPIs. Credentialing was not updated after the move.",
            f"- Claims service address and NPPES LOCATION: {SUNRISE_TRUE_ADDRESS}.",
            "- Directory address-error rows use 900 Old Pier St and are labeled `address` with true_value 100 Harbor Sample Ave. That is 9 listings in batch A and 4 listings in batch B.",
            "- The 9 returning NPIs keep a phone error in batch B. Their batch B directory address is 100 Harbor Sample Ave, and those listings have no address label.",
            "- On the address-error rows the conflict is two sources against two: directory and roster at 900 Old Pier St, claims and NPPES at 100 Harbor Sample Ave.",
            "",
            "## Taxonomy codes",
            "",
        ]
    )
    for code, name, kind, behavioral in TAXONOMIES:
        flag = "behavioral health" if behavioral else "other"
        lines.append(f"- `{code}` {name} ({kind}, {flag})")
    lines.append("")
    return "\n".join(lines)


def validate(world: dict) -> None:
    problems: list[str] = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            problems.append(message)

    providers = world["providers"]
    listings = world["listings"]
    labels = world["labels"]
    claims = world["claims"]
    by_id = {row["listing_id"]: row for row in listings}
    by_npi = {row["npi"]: row for row in providers}
    check(len(providers) == PROVIDER_COUNT, f"roster {len(providers)}")
    check(sum(1 for row in providers if row["is_bh"]) == BH_PROVIDER_COUNT, "behavioral health count")
    check(all(is_valid_npi(row["npi"]) for row in providers), "luhn")
    check(len({row["npi"] for row in providers}) == len(providers), "duplicate npi")
    for batch in ("A", "B"):
        batch_rows = [row for row in listings if row["batch"] == batch]
        check(len(batch_rows) == LISTINGS_PER_BATCH, f"batch {batch} size {len(batch_rows)}")
        batch_labels = [row for row in labels if by_id[row["listing_id"]]["batch"] == batch]
        errors = [row for row in batch_labels if row["error_type"] != "decoy"]
        check(len(errors) == ERRORS_PER_TYPE * len(REAL_ERRORS), f"batch {batch} errors {len(errors)}")
        for error_type in REAL_ERRORS:
            count = sum(1 for row in batch_labels if row["error_type"] == error_type)
            check(count == ERRORS_PER_TYPE, f"batch {batch} {error_type} {count}")
        decoys = [row for row in batch_labels if row["error_type"] == "decoy"]
        check(len(decoys) == DECOYS_PER_SUBTYPE * 3, f"batch {batch} decoys {len(decoys)}")
    for provider in providers:
        types = [ROLE_ERROR[provider[key]] for key in ("a_role", "b_role") if provider[key] is not None]
        if len(types) == 2:
            check(types[0] != types[1], f"{provider['npi']} repeats {types[0]}")
        if provider["is_sunrise"]:
            check(provider["roster_address"] == SUNRISE_STALE_ADDRESS, "sunrise roster street")
            check(provider["true_address"] == SUNRISE_TRUE_ADDRESS, "sunrise true street")
        elif provider["is_suite"]:
            check(provider["roster_address"] == provider["true_address"].replace(" Ste ", " Suite "), "suite roster")
        else:
            check(provider["roster_address"] == provider["true_address"], "roster street drifted")
    ghost_npis = {row["npi"] for row in providers if row["is_ghost"]}
    omitted_npis = {row["npi"] for row in providers if row["omitted"]}
    check(len(omitted_npis) == GHOSTS_OMITTED, "omitted count")
    check(omitted_npis <= ghost_npis, "omitted non-ghost")
    check(
        all(
            not row["omitted"] or row["a_role"] not in {"decoy_suite", "decoy_phone", "decoy_mail"}
            and row["b_role"] not in {"decoy_suite", "decoy_phone", "decoy_mail"}
            for row in providers
        ),
        "omitted decoy",
    )
    snapshot = {row["number"] for row in world["nppes"]["results"]}
    check(snapshot == {row["npi"] for row in providers} - omitted_npis, "nppes membership")
    claims_by_npi: dict[str, list[dict]] = defaultdict(list)
    for row in claims:
        claims_by_npi[row["npi"]].append(row)
        check(row["service_address_line1"] != SUNRISE_STALE_ADDRESS, "stale sunrise street in claims")
        check(int(row["claim_count"]) > 0, "zero claim row")
    for provider in providers:
        rows = claims_by_npi.get(provider["npi"], [])
        recent = [row for row in rows if row["month"] in LAST_14]
        if provider["is_ghost"]:
            check(not recent, f"ghost {provider['npi']} has recent claims")
            check(provider["status"] == "terminated" and provider["term_date"] != "", "ghost roster")
        elif provider["index"] in PENDING:
            check(not rows, "pending claims")
            check(provider["status"] == "pending" and provider["term_date"] == "", "pending roster")
        elif provider["is_accepting_error"]:
            check(recent, "accepting error lacks recent claims")
            check(all(row["new_patient_count"] == "0" for row in rows), "accepting error has new patients")
            check(provider["status"] == "active", "accepting error roster")
        else:
            check(any(row["new_patient_count"] != "0" for row in rows), f"{provider['npi']} has no new patients")
        if provider["is_sunrise"]:
            check(any(row["service_address_line1"] == SUNRISE_TRUE_ADDRESS for row in rows), "sunrise claims street")
    both_sunrise = [row for row in providers if row["index"] in SUNRISE_BOTH]
    b_only = [row for row in providers if row["index"] in B_SUNRISE]
    check(len(both_sunrise) == 9 and len(b_only) == 4, "sunrise cohort size")
    check(all(row["a_role"] == "address" and row["b_role"] == "phone" for row in both_sunrise), "returning sunrise roles")
    check(all(row["a_role"] is None and row["b_role"] == "address" and not row["is_org"] for row in b_only), "new sunrise roles")
    for listing in listings:
        provider = by_npi[listing["npi"]]
        if listing["satellite"]:
            matched = [
                row
                for row in claims_by_npi[listing["npi"]]
                if row["service_address_line1"] == listing["address_line1"] and row["month"] in LAST_6
            ]
            check(len({row["month"] for row in matched}) >= 3, f"satellite claims {listing['listing_id']}")
            continue
        if listing["role"] == "address":
            check(listing["address_line1"] == provider["stale_address"], "address error street")
        if provider["is_sunrise"] and listing["role"] == "address":
            check(listing["address_line1"] == SUNRISE_STALE_ADDRESS, "sunrise directory stale")
        if provider["is_sunrise"] and listing["role"] != "address":
            check(listing["address_line1"] == SUNRISE_TRUE_ADDRESS, "sunrise directory updated")
    for label in labels:
        listing = by_id[label["listing_id"]]
        provider = by_npi[listing["npi"]]
        if provider["is_sunrise"] and label["error_type"] == "address":
            check(label["true_value"] == SUNRISE_TRUE_ADDRESS, "sunrise truth")
            check(label["is_decoy"] == "false", "sunrise decoy flag")
            check(label["field"] == "address", "sunrise field")
    for row in world["nppes"]["results"]:
        provider = by_npi[row["number"]]
        expected = "NPI-2" if provider["is_org"] else "NPI-1"
        check(row["enumeration_type"] == expected, f"enumeration {row['number']}")
        location = next(item for item in row["addresses"] if item["address_purpose"] == "LOCATION")
        mailing = next(item for item in row["addresses"] if item["address_purpose"] == "MAILING")
        check(location["address_1"] == provider["true_address"], "nppes location")
        if provider["is_mail"]:
            check(mailing["address_1"] != location["address_1"], "mailing decoy matches location")
        else:
            check(mailing["address_1"] == location["address_1"], "mailing drifted")
    if problems:
        raise AssertionError("\n".join(problems))


def write_outputs(world: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    write_sql(out_dir / "seed.sql", world)
    write_csv(out_dir / "roster.csv", ROSTER_COLUMNS, roster_rows(world))
    write_csv(out_dir / "claims.csv", CLAIMS_COLUMNS, world["claims"])
    write_csv(out_dir / "labels.csv", LABEL_COLUMNS, world["labels"])
    write_text(out_dir / "nppes_snapshot.json", json.dumps(world["nppes"], indent=2) + "\n")
    write_text(out_dir / "generation_report.md", world["report"])


def roster_rows(world: dict) -> list[dict]:
    rows = []
    for provider in world["providers"]:
        rows.append(
            {
                "npi": provider["npi"],
                "provider_name": provider["provider_name"],
                "provider_type": provider["provider_type"],
                "group_name": provider["group_name"],
                "taxonomy_code": provider["taxonomy_code"],
                "specialty": provider["specialty"],
                "status": provider["status"],
                "effective_date": provider["effective_date"],
                "term_date": provider["term_date"],
                "address_line1": provider["roster_address"],
                "city": CITY,
                "state": STATE,
                "zip": provider["zip"],
                "phone": provider["phone"],
            }
        )
    return rows


def write_text(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def write_csv(path: Path, columns: tuple[str, ...], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def write_sql(path: Path, world: dict) -> None:
    lines = [
        f"-- Synthetic directory listings. Generated by data/generator/generate.py --seed {world['seed']}.",
        "-- Do not edit by hand.",
        "",
    ]
    column_list = ", ".join(INSERT_COLUMNS)
    for listing in world["listings"]:
        values = ", ".join(sql_quote(listing[column]) for column in INSERT_COLUMNS)
        lines.append(f"INSERT INTO directory_listing ({column_list}) VALUES ({values});")
    write_text(path, "\n".join(lines) + "\n")


def generate(seed: int = SEED_DEFAULT, out_dir: Path | None = None) -> dict:
    destination = DEFAULT_OUT if out_dir is None else Path(out_dir)
    world = build(seed)
    write_outputs(world, destination)
    return world


def main() -> None:
    parser = argparse.ArgumentParser(description="Write synthetic Ghost Network Auditor sample data.")
    parser.add_argument("--seed", type=int, default=SEED_DEFAULT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    world = generate(args.seed, args.out_dir)
    print(world["report"])


if __name__ == "__main__":
    main()
