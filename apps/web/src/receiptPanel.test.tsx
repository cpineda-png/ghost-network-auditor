import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
  it("renders the SQL and preview rows", async () => {
    const user = userEvent.setup();
    render(<ReceiptPanel receipt={receipt} onClose={() => undefined} />);
    expect(screen.getByText(receipt.sql)).toBeInTheDocument();
    expect(screen.queryByText("400 Harbor Ave")).not.toBeInTheDocument();
    await user.click(screen.getByRole("row", { name: /Show fields/ }));
    expect(screen.getByText("400 Harbor Ave")).toBeInTheDocument();
    expect(screen.getByText("Springfield")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
  });

  it("calls onReplay when a loaded receipt is replayed", async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    render(<ReceiptPanel receipt={receipt} onClose={() => undefined} onReplay={onReplay} />);

    await user.click(screen.getByRole("button", { name: "Replay" }));

    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it("labels a shown match Replay again", () => {
    render(<ReceiptPanel receipt={receipt} match onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: "Replay again" })).toBeEnabled();
  });

  it("disables replay while replayLoading", () => {
    render(<ReceiptPanel receipt={receipt} replayLoading onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: "Replaying…" })).toBeDisabled();
  });

  it("shows key columns until all columns are requested", async () => {
    const user = userEvent.setup();
    const wide: Receipt = {
      ...receipt,
      rowsPreview: [
        {
          listing_id: "L-1",
          provider_name: "Ada Lovelace",
          specialty: "cardiology",
          address_line1: "1 Main",
          phone: "555-0100",
          accepting_new_patients: true,
          network_status: "in",
          npi: "1234567890",
          city: "Springfield",
        },
      ],
    };
    render(<ReceiptPanel receipt={wide} onClose={() => undefined} />);

    expect(screen.getByRole("columnheader", { name: "listing_id" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "network_status" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "npi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all columns" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show SQL" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("cell", { name: "Ada Lovelace" })).toHaveAttribute("title", "Ada Lovelace");

    await user.click(screen.getByRole("row", { name: /Ada Lovelace/ }));
    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(screen.getByText("Springfield")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "npi" })).not.toBeInTheDocument();
  });

  it("closes from the backdrop or Escape and returns focus to the receipt button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Harness() {
      const [shown, setShown] = useState(false);
      return (
        <>
          <button type="button" className="receipt-id" onClick={() => setShown(true)}>
            rcpt-l1-claims
          </button>
          {shown ? (
            <ReceiptPanel
              receipt={receipt}
              onClose={() => {
                onClose();
                setShown(false);
              }}
            />
          ) : null}
        </>
      );
    }
    const { container } = render(<Harness />);
    const opener = screen.getByRole("button", { name: "rcpt-l1-claims" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");

    await user.click(container.querySelector(".receipt-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(opener).toHaveFocus();
  });
});
