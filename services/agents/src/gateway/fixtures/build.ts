import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeQueryResponse } from "../receipt.js";

const columns = [
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
  "county",
];

const sunrise = {
  batch: "A",
  city: "Brooklyn",
  state: "NY",
  zip: "11201",
  address_line1: "900 Old Pier St",
  county: "Kings",
  accepting_new_patients: true,
  network_status: "in",
  group_name: "Sunrise Behavioral Group",
};

const seed = [
  { listing_id: "L-00001", npi: "8000000009", provider_name: "Sunrise Behavioral Group", provider_type: "organization", specialty: "Clinic/Center, Mental Health", phone: "718-555-0100", ...sunrise },
  { listing_id: "L-00002", npi: "8000000017", provider_name: "Blake Brook", provider_type: "individual", specialty: "Psychologist", phone: "718-555-0101", ...sunrise },
  { listing_id: "L-00003", npi: "8000000025", provider_name: "Casey Brook", provider_type: "individual", specialty: "Nurse Practitioner, Psychiatric/Mental Health", phone: "718-555-0102", ...sunrise },
  { listing_id: "L-00004", npi: "8000000033", provider_name: "Drew Brook", provider_type: "individual", specialty: "Counselor, Mental Health", phone: "718-555-0103", ...sunrise },
  { listing_id: "L-00005", npi: "8000000041", provider_name: "Emery Brook", provider_type: "individual", specialty: "Psychiatry", phone: "718-555-0104", ...sunrise },
  { listing_id: "L-00006", npi: "8000000058", provider_name: "Finley Brook", provider_type: "individual", specialty: "Psychologist", phone: "718-555-0105", ...sunrise },
  { listing_id: "L-00007", npi: "8000000066", provider_name: "Gray Brook", provider_type: "individual", specialty: "Nurse Practitioner, Psychiatric/Mental Health", phone: "718-555-0106", ...sunrise },
  { listing_id: "L-00008", npi: "8000000074", provider_name: "Harper Brook", provider_type: "individual", specialty: "Counselor, Mental Health", phone: "718-555-0107", ...sunrise },
  { listing_id: "L-00009", npi: "8000000082", provider_name: "Jules Brook", provider_type: "individual", specialty: "Psychiatry", phone: "718-555-0108", ...sunrise },
  { listing_id: "L-00010", npi: "8000000090", provider_name: "Kendall Brook", provider_type: "individual", specialty: "Psychologist", phone: "718-555-0109", ...sunrise, group_name: "Kings Sample Group", address_line1: "309 Stale Sample St", zip: "11211" },
];

const rows = [
  ...seed,
  ...Array.from({ length: 11 }, (_, index) => {
    const n = String(index + 11).padStart(5, "0");
    return {
      listing_id: `L-${n}`,
      batch: "A",
      npi: `900000${n}`.slice(0, 10),
      provider_name: `Provider ${n}`,
      provider_type: "individual",
      specialty: "family medicine",
      group_name: "North Clinic",
      address_line1: `${100 + index} Main St`,
      city: "Springfield",
      state: "IL",
      zip: "62701",
      phone: `217-555-${n}`,
      accepting_new_patients: true,
      network_status: "in",
      county: "Sangamon",
    };
  }),
];

const directory = makeQueryResponse("directory_batch", { batch: "A" }, "fixture", columns, rows, {
  receiptId: "receipt-directory-fixture",
  sources: ["directory"],
});

const roster = makeQueryResponse(
  "roster_by_npis",
  { npis: seed.map((row) => row.npi) },
  "fixture",
  ["npi", "group_name", "specialty", "status", "address_line1", "zip", "phone"],
  seed.map((row) => ({
    npi: row.npi,
    group_name: row.group_name,
    specialty: row.specialty,
    status: "active",
    address_line1: row.listing_id === "L-00010" ? row.address_line1 : "100 Harbor Sample Ave",
    zip: row.zip,
    phone: row.listing_id === "L-00010" ? "718-555-0199" : row.phone,
  })),
  { receiptId: "receipt-roster-fixture", sources: ["roster"] },
);

const claims = makeQueryResponse(
  "claims_by_npis",
  { npis: seed.map((row) => row.npi), fromMonth: "2025-09", toMonth: "2026-10" },
  "fixture",
  ["npi", "service_address_line1", "service_zip", "month", "claim_count", "new_patient_count"],
  seed.map((row) => ({
    npi: row.npi,
    service_address_line1: row.listing_id === "L-00010" ? row.address_line1 : "100 Harbor Sample Ave",
    service_zip: row.zip,
    month: "2026-06",
    claim_count: 4,
    new_patient_count: 1,
  })),
  { receiptId: "receipt-claims-fixture", sources: ["claims"] },
);

const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, "directory_batch.json"), `${JSON.stringify(directory, null, 2)}\n`);
writeFileSync(join(dir, "roster_by_npis.json"), `${JSON.stringify(roster, null, 2)}\n`);
writeFileSync(join(dir, "claims_by_npis.json"), `${JSON.stringify(claims, null, 2)}\n`);
