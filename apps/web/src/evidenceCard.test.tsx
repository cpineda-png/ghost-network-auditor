import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EvidenceCards, EvidenceCardView } from "./components/EvidenceCards";
import type { EvidenceCard } from "./types";

const card: EvidenceCard = {
  runId: "run-cold",
  listingId: "listing:plan:L-00009",
  field: "status",
  sources: [
    { source: "directory", value: "active", receiptIds: ["rcpt-l9-directory"] },
    { source: "claims", value: "inactive", receiptIds: ["rcpt-l9-claims"] },
  ],
  winner: null,
  confidence: 0.42,
  rationale: "Confidence is under 0.50.",
  critique: null,
  status: "unchanged",
  memoryIds: [],
};

const phone: EvidenceCard = {
  ...card,
  listingId: "listing:plan:L-00010",
  field: "phone",
  rationale: "Phone differs from the directory.",
  sources: [
    { source: "directory", value: "555-0100", receiptIds: ["rcpt-phone-directory"] },
    { source: "roster", value: "555-0144", receiptIds: ["rcpt-phone-roster"] },
  ],
};

describe("evidence card", () => {
  it("shows the escalated state when confidence is under 0.50", () => {
    render(<EvidenceCardView card={card} onOpenReceipt={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent(/escalated/i);
  });

  it("opens one card at a time and keeps receipts in the details", async () => {
    const user = userEvent.setup();
    render(
      <EvidenceCards
        cards={[card, phone]}
        runId="run-cold"
        loading={false}
        error={null}
        settled
        memoryIds={{}}
        onOpenReceipt={() => undefined}
        onSubmitRuling={async () => "mem-1"}
      />,
    );

    const toggles = screen.getAllByRole("button", { name: "Show evidence" });
    const statusDetails = document.getElementById("evidence-details-listing-plan-L-00009-status");
    const phoneDetails = document.getElementById("evidence-details-listing-plan-L-00010-phone");
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(toggles[0]).toHaveAttribute("aria-controls", "evidence-details-listing-plan-L-00009-status");
    expect(statusDetails).toHaveAttribute("hidden");
    expect(phoneDetails).toHaveAttribute("hidden");
    expect(screen.getAllByRole("status").every((item) => /escalated/i.test(item.textContent ?? ""))).toBe(true);
    expect(screen.getAllByText("Critic").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Risk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("active").length).toBeGreaterThan(0);

    await user.click(toggles[0]!);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(statusDetails).not.toHaveAttribute("hidden");
    expect(phoneDetails).toHaveAttribute("hidden");
    expect(screen.getByText("Confidence is under 0.50.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "rcpt-l9-directory" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show evidence" }));
    expect(phoneDetails).not.toHaveAttribute("hidden");
    expect(statusDetails).toHaveAttribute("hidden");
    expect(screen.getByText("Phone differs from the directory.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide evidence" })).toHaveAttribute("aria-expanded", "true");
  });
});
