import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OutreachQueue } from "./components/OutreachQueue";
import { rulingSchema, type EvidenceCard } from "./types";

const card: EvidenceCard = {
  runId: "run-cold",
  listingId: "listing:plan:L-00003",
  field: "phone",
  sources: [
    { source: "directory", value: "555-0100", receiptIds: ["rcpt-l3-directory"] },
    { source: "roster", value: "555-0144", receiptIds: ["rcpt-l3-roster"] },
  ],
  winner: null,
  confidence: 0.42,
  rationale: "Phone conflict needs a ruling.",
  critique: null,
  status: "escalated",
  memoryIds: [],
};

describe("outreach form", () => {
  it("submits a typed value as source other", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<OutreachQueue runId="run-cold" cards={[card]} memoryIds={{}} onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox", { name: "Other value" }), "555-0199");
    await user.type(screen.getByRole("textbox", { name: "Note" }), "Called the office");
    await user.click(screen.getByRole("button", { name: "Submit ruling" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const ruling = rulingSchema.parse(onSubmit.mock.calls[0][0]);
    expect(ruling).toMatchObject({
      runId: "run-cold",
      listingId: "listing:plan:L-00003",
      field: "phone",
      value: "555-0199",
      source: "other",
      analyst: "analyst",
      note: "Called the office",
    });
  });

  it("submits the picked source when the other value is empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<OutreachQueue runId="run-cold" cards={[card]} memoryIds={{}} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("radio", { name: /roster: 555-0144/ }));
    await user.click(screen.getByRole("button", { name: "Submit ruling" }));

    const ruling = rulingSchema.parse(onSubmit.mock.calls[0][0]);
    expect(ruling.source).toBe("roster");
    expect(ruling.value).toBe("555-0144");
  });
});
