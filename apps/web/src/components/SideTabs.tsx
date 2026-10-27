import type { KeyboardEvent } from "react";

export type SideTab = "memory" | "results" | "outreach";

const TABS: { id: SideTab; label: string; controls: string }[] = [
  { id: "memory", label: "Memory", controls: "panel-memory" },
  { id: "results", label: "Results", controls: "results" },
  { id: "outreach", label: "Outreach", controls: "outreach" },
];

type Props = {
  tab: SideTab;
  outreachCount: number;
  onChange: (tab: SideTab) => void;
};

export function SideTabList({ tab, outreachCount, onChange }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const ids = TABS.map((item) => item.id);
    const index = ids.indexOf(tab);
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % ids.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    else return;
    event.preventDefault();
    const id = ids[next];
    if (!id) return;
    onChange(id);
    document.getElementById(`tab-${id}`)?.focus();
  }

  return (
    <div className="side-tablist" role="tablist" aria-label="Memory, results, and outreach" onKeyDown={onKeyDown}>
      {TABS.map((item) => {
        const selected = tab === item.id;
        const label = item.id === "outreach" ? `Outreach (${outreachCount})` : item.label;
        return (
          <button
            key={item.id}
            type="button"
            id={`tab-${item.id}`}
            className="side-tab"
            role="tab"
            aria-selected={selected}
            aria-controls={item.controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
