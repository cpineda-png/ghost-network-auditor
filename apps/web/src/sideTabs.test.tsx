import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideTabList, type SideTab } from "./components/SideTabs";

function Harness({ count = 2 }: { count?: number }) {
  const [tab, setTab] = useState<SideTab>("memory");
  return <SideTabList tab={tab} outreachCount={count} onChange={setTab} />;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sidebar tabs", () => {
  it("starts on Memory and moves with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const memory = screen.getByRole("tab", { name: "Memory" });
    const results = screen.getByRole("tab", { name: "Results" });
    const outreach = screen.getByRole("tab", { name: "Outreach (2)" });
    expect(memory).toHaveAttribute("aria-selected", "true");
    expect(results).toHaveAttribute("aria-selected", "false");
    expect(results).toHaveAttribute("tabindex", "-1");
    expect(outreach).toHaveAttribute("aria-controls", "outreach");

    memory.focus();
    await user.keyboard("{ArrowRight}");
    expect(results).toHaveAttribute("aria-selected", "true");
    expect(results).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(memory).toHaveAttribute("aria-selected", "true");
    expect(memory).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(outreach).toHaveAttribute("aria-selected", "true");
    expect(outreach).toHaveFocus();

    await user.keyboard("{Home}");
    expect(memory).toHaveAttribute("aria-selected", "true");
    expect(memory).toHaveFocus();
  });

  it("selects the outreach tab from the jump link", async () => {
    vi.stubEnv("VITE_USE_FIXTURES", "true");
    const { default: App } = await import("./App");
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("REPLAY")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Memory" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("outreach")).toHaveAttribute("hidden");

    await user.click(screen.getByRole("link", { name: "Outreach queue" }));
    expect(screen.getByRole("tab", { name: "Outreach (0)" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("outreach")).not.toHaveAttribute("hidden");
    expect(screen.getByText(/Escalations that need a ruling/)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Results" }));
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("results")).not.toHaveAttribute("hidden");
    expect(document.getElementById("outreach")).toHaveAttribute("hidden");
  });
});
