import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReceiptPanel } from "./components/ReceiptPanel";
import type { Receipt } from "./types";

const receipt: Receipt = {
  receiptId: "rcpt-l1-claims",
  runId: "run-cold",
  templateId: "claims_locations_by_npi",
  sql: "SELECT practice_address, city FROM claims_header WHERE listing_id = $listing_id",
  params: { listing_id: "listing:plan:L-00001" },
  sources: ["claims"],
  rowCount: 6,
  rowsHash: "hash-rcpt-l1-claims",
  rowsPreview: [{ practice_address: "400 Harbor Ave", city: "Springfield" }],
  executedAt: "2026-04-02T14:00:00.000Z",
  mode: "replayed",
  durationMs: 40,
};

describe("receipt panel", () => {
  it("renders the SQL and preview rows", () => {
    render(<ReceiptPanel receipt={receipt} onClose={() => undefined} />);
    expect(screen.getByText(receipt.sql)).toBeInTheDocument();
    expect(screen.getByText("400 Harbor Ave")).toBeInTheDocument();
    expect(screen.getByText("Springfield")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
  });
});
