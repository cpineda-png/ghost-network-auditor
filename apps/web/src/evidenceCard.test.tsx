import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceCardView } from "./components/EvidenceCards";
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

describe("evidence card", () => {
  it("shows the escalated state when confidence is under 0.50", () => {
    render(<EvidenceCardView card={card} onOpenReceipt={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent(/escalated/i);
  });
});
