import { useEffect, useRef, useState } from "react";
import {
  COLD_RUN_ID,
  WARM_RUN_ID,
  createRun,
  getCards,
  getHealth,
  getReceipt,
  getReport,
  getTrust,
  postRuling,
  streamEvents,
} from "./api";
import { EvidenceCards } from "./components/EvidenceCards";
import { LiveRun } from "./components/LiveRun";
import { MemoryResults } from "./components/MemoryResults";
import { OutreachQueue } from "./components/OutreachQueue";
import { ReceiptPanel } from "./components/ReceiptPanel";
import { RunLauncher } from "./components/RunLauncher";
import type { EvidenceCard, Receipt, RunReport, RunRequest, TrustRow, WmEvent } from "./types";

type Badge = "LIVE" | "REPLAY" | "UNKNOWN";

export default function App() {
  const [badge, setBadge] = useState<Badge>("UNKNOWN");
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<WmEvent[]>([]);
  const [cards, setCards] = useState<EvidenceCard[]>([]);
  const [report, setReport] = useState<RunReport | null>(null);
  const [coldReport, setColdReport] = useState<RunReport | null>(null);
  const [warmReport, setWarmReport] = useState<RunReport | null>(null);
  const [trust, setTrust] = useState<TrustRow[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [running, setRunning] = useState(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    getHealth()
      .then((body) => setBadge(body.llmReplay ? "REPLAY" : "LIVE"))
      .catch(() => setBadge("UNKNOWN"));
  }, []);

  useEffect(() => {
    getTrust()
      .then(setTrust)
      .catch(() => setTrust([]));
    getReport(COLD_RUN_ID)
      .then(setColdReport)
      .catch(() => undefined);
    getReport(WARM_RUN_ID)
      .then(setWarmReport)
      .catch(() => undefined);
    return () => stopRef.current?.();
  }, []);

  function start(request: RunRequest) {
    stopRef.current?.();
    setRunning(true);
    setSettled(false);
    setEvents([]);
    setCards([]);
    setReport(null);
    setError(null);
    void createRun(request)
      .then(async ({ runId: nextId }) => {
        setRunId(nextId);
        const [nextCards, nextReport, nextTrust] = await Promise.all([
          getCards(nextId),
          getReport(nextId),
          getTrust(),
        ]);
        setCards(nextCards);
        setReport(nextReport);
        setTrust(nextTrust);
        if (nextReport.useMemory) setWarmReport(nextReport);
        else setColdReport(nextReport);
        stopRef.current = streamEvents(
          nextId,
          (event) => setEvents((current) => [...current, event]),
          () => {
            setRunning(false);
            setSettled(true);
          },
        );
      })
      .catch((reason: unknown) => {
        setRunning(false);
        setError(reason instanceof Error ? reason.message : "Run failed");
      });
  }

  return (
    <main>
      <header>
        <h1>Ghost Network Auditor</h1>
        <span className={`badge badge-${badge.toLowerCase()}`}>{badge}</span>
      </header>
      <nav aria-label="Sections">
        <a href="#launcher">Run launcher</a>
        <a href="#live-run">Live run</a>
        <a href="#evidence">Evidence card</a>
        <a href="#outreach">Outreach queue</a>
        <a href="#memory">Memory and results</a>
      </nav>
      {error ? <p role="alert">{error}</p> : null}
      <div className="panels">
        <section id="launcher" className="panel panel-wide">
          <h2>Run launcher</h2>
          <RunLauncher running={running} onStart={start} />
          {runId ? <p>Run {runId}</p> : null}
        </section>
        <section id="live-run" className="panel panel-wide">
          <h2>Live run</h2>
          <LiveRun events={events} report={report} settled={settled} />
        </section>
        <section id="evidence" className="panel">
          <h2>Evidence card</h2>
          <EvidenceCards
            cards={cards}
            onOpenReceipt={(receiptId) => {
              void getReceipt(receiptId)
                .then(setReceipt)
                .catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : "Receipt failed");
                });
            }}
          />
        </section>
        <section id="outreach" className="panel">
          <h2>Outreach queue</h2>
          <OutreachQueue
            runId={runId}
            cards={cards}
            onSubmit={async (ruling) => {
              await postRuling(ruling);
            }}
          />
        </section>
        <section id="memory" className="panel">
          <h2>Memory and results</h2>
          <MemoryResults trust={trust} cold={coldReport} warm={warmReport} runId={runId} />
        </section>
      </div>
      <ReceiptPanel receipt={receipt} onClose={() => setReceipt(null)} />
    </main>
  );
}
