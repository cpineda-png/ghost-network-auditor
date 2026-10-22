import { useEffect, useState } from "react";

type Badge = "LIVE" | "REPLAY" | "UNKNOWN";

const panels = [
  "Run launcher",
  "Live run",
  "Evidence card",
  "Outreach queue",
  "Memory and results",
] as const;

export default function App() {
  const [badge, setBadge] = useState<Badge>("UNKNOWN");

  useEffect(() => {
    fetch("/api/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error("health failed");
        }
        return response.json() as Promise<{ llmReplay?: boolean }>;
      })
      .then((body) => setBadge(body.llmReplay ? "REPLAY" : "LIVE"))
      .catch(() => setBadge("UNKNOWN"));
  }, []);

  return (
    <main>
      <header>
        <h1>Ghost Network Auditor</h1>
        <span className={`badge badge-${badge.toLowerCase()}`}>{badge}</span>
      </header>
      <div className="panels">
        {panels.map((title) => (
          <section key={title} className="panel">
            <h2>{title}</h2>
            <p>Placeholder</p>
          </section>
        ))}
      </div>
    </main>
  );
}
