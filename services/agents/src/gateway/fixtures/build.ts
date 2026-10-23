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

const rows = Array.from({ length: 21 }, (_, index) => {
  const n = String(index + 1).padStart(5, "0");
  return {
    listing_id: `L-${n}`,
    batch: "A",
    npi: `100000${n}`.slice(0, 10),
    provider_name: `Provider ${n}`,
    provider_type: "individual",
    specialty: index % 2 === 0 ? "family medicine" : "cardiology",
    group_name: "North Clinic",
    address_line1: `${100 + index} Main St`,
    city: "Springfield",
    state: "IL",
    zip: "62701",
    phone: `217-555-${n}`,
    accepting_new_patients: index % 3 !== 0,
    network_status: index % 4 === 0 ? "out" : "in",
    county: "Sangamon",
  };
});

const directory = makeQueryResponse("directory_batch", { batch: "A" }, "fixture", columns, rows, {
  receiptId: "receipt-directory-fixture",
  sources: ["directory"],
});

const roster = makeQueryResponse(
  "roster_by_npis",
  { npis: [rows[0].npi] },
  "fixture",
  ["npi", "group_name", "specialty", "status"],
  [{ npi: rows[0].npi, group_name: "North Clinic", specialty: "family medicine", status: "active" }],
  { receiptId: "receipt-roster-fixture", sources: ["roster"] },
);

const claims = makeQueryResponse(
  "claims_by_npis",
  { npis: [rows[0].npi], fromMonth: "2025-01", toMonth: "2025-12" },
  "fixture",
  ["npi", "service_address_line1", "service_zip", "month", "claim_count", "new_patient_count"],
  [
    {
      npi: rows[0].npi,
      service_address_line1: "100 Main St",
      service_zip: "62701",
      month: "2025-06",
      claim_count: 12,
      new_patient_count: 2,
    },
  ],
  { receiptId: "receipt-claims-fixture", sources: ["claims"] },
);

const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, "directory_batch.json"), `${JSON.stringify(directory, null, 2)}\n`);
writeFileSync(join(dir, "roster_by_npis.json"), `${JSON.stringify(roster, null, 2)}\n`);
writeFileSync(join(dir, "claims_by_npis.json"), `${JSON.stringify(claims, null, 2)}\n`);
