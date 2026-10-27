import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LiveRun } from "./components/LiveRun";
import type { WmEvent } from "./types";

const events: WmEvent[] = Array.from({ length: 31 }, (_, index) => ({
  eventId: `evt-${index}`,
  runId: "run-9",
  ts: "2026-04-02T14:00:00.000Z",
  actor: "planner",
  type: "task_created",
  entityId: "run:run-9",
  payload: {},
}));

describe("live run", () => {
  it("shows the latest 30 events until the rest are requested", async () => {
    const user = userEvent.setup();
    const { container } = render(<LiveRun events={events} report={null} settled={false} running />);

    expect(container.querySelectorAll(".timeline-item")).toHaveLength(30);
    const toggle = screen.getByRole("button", { name: "Show all 31 events" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(container.querySelectorAll(".timeline-item")).toHaveLength(31);
    expect(screen.getByRole("button", { name: "Show latest 30" })).toHaveAttribute("aria-pressed", "true");
  });
});
