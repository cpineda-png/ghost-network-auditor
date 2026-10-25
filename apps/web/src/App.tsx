import { useEffect, useRef, useState } from "react";
import {
  COLD_RUN_ID,
  WARM_RUN_ID,
  createRun,
  errorText,
  getCards,
  getHealth,
  getReceipt,
  getReport,
  getTrust,
  postRuling,
  replayReceipt,
  streamEvents,
  usingFixtures,
  type RunReportView,
} from "./api";
import { EvidenceCards } from "./components/EvidenceCards";
import { LiveRun } from "./components/LiveRun";
import { MemoryResults } from "./components/MemoryResults";
import { OutreachQueue } from "./components/OutreachQueue";
import { ReceiptPanel } from "./components/ReceiptPanel";
import { RunLauncher } from "./components/RunLauncher";
import type { EvidenceCard, Receipt, RunRequest, Ruling, TrustRow, WmEvent } from "./types";

type Badge = "LIVE" | "REPLAY" | "UNKNOWN";
type LoadState = "idle" | "loading" | "ready" | "error";

export default function App() {
  const [badge, setBadge] = useState<Badge>("UNKNOWN");
  const [healthState, setHealthState] = useState<LoadState>("loading");
  const [healthError, setHealthError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<WmEvent[]>([]);
  const [cards, setCards] = useState<EvidenceCard[]>([]);
  const [cardsState, setCardsState] = useState<LoadState>("idle");
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [report, setReport] = useState<RunReportView | null>(null);
  const [reportState, setReportState] = useState<LoadState>("idle");
  const [reportError, setReportError] = useState<string | null>(null);
  const [coldReport, setColdReport] = useState<RunReportView | null>(null);
  const [warmReport, setWarmReport] = useState<RunReportView | null>(null);
  const [trust, setTrust] = useState<TrustRow[]>([]);
  const [trustState, setTrustState] = useState<LoadState>("loading");
  const [trustError, setTrustError] = useState<string | null>(null);
  const [memoryIds, setMemoryIds] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [replayMatch, setReplayMatch] = useState<boolean | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [settled, setSettled] = useState(false);
  const [launcherError, setLauncherError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((body) => {
        if (cancelled) return;
        setHealthState("ready");
        setBadge(body.llmReplay ? "REPLAY" : "LIVE");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setHealthState("error");
        setBadge("UNKNOWN");
        setHealthError(errorText(reason));
      });
    getTrust()
      .then((rows) => {
        if (cancelled) return;
        setTrust(rows);
        setTrustState("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setTrust([]);
        setTrustState("error");
        setTrustError(errorText(reason));
      });
    if (usingFixtures()) {
      getReport(COLD_RUN_ID)
        .then((next) => {
          if (!cancelled) setColdReport(next);
        })
        .catch(() => undefined);
      getReport(WARM_RUN_ID)
        .then((next) => {
          if (!cancelled) setWarmReport(next);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      stopRef.current?.();
    };
  }, []);

  function remember(next: RunReportView) {
    if (next.useMemory) setWarmReport(next);
    else setColdReport(next);
  }

  function resetReceipt() {
    setReceipt(null);
    setReceiptLoading(false);
    setReceiptError(null);
    setReplayMatch(null);
    setReplayError(null);
    setReplayLoading(false);
  }

  function start(request: RunRequest) {
    stopRef.current?.();
    setRunning(true);
    setStarting(true);
    setSettled(false);
    setEvents([]);
    setCards([]);
    setCardsState("idle");
    setCardsError(null);
    setReport(null);
    setReportState("idle");
    setReportError(null);
    setMemoryIds({});
    setLauncherError(null);
    setLiveError(null);
    resetReceipt();
    void createRun(request)
      .then(({ runId: nextId }) => {
        setStarting(false);
        setRunId(nextId);
        stopRef.current = streamEvents(
          nextId,
          (event) => setEvents((current) => [...current, event]),
          (result) => {
            if (!result.ok) {
              setRunning(false);
              setLiveError("Agents service is unreachable");
              return;
            }
            setCardsState("loading");
            setReportState("loading");
            void Promise.allSettled([getCards(nextId), getReport(nextId), getTrust()]).then((results) => {
              const [cardsResult, reportResult, trustResult] = results;
              if (cardsResult.status === "fulfilled") {
                setCards(cardsResult.value);
                setCardsState("ready");
              } else {
                setCards([]);
                setCardsState("error");
                setCardsError(errorText(cardsResult.reason));
              }
              if (reportResult.status === "fulfilled") {
                setReport(reportResult.value);
                setReportState("ready");
                setSettled(true);
                remember(reportResult.value);
              } else {
                setReport(null);
                setReportState("error");
                setReportError(errorText(reportResult.reason));
              }
              if (trustResult.status === "fulfilled") {
                setTrust(trustResult.value);
                setTrustState("ready");
                setTrustError(null);
              } else {
                setTrustState("error");
                setTrustError(errorText(trustResult.reason));
              }
              setRunning(false);
            });
          },
        );
      })
      .catch((reason: unknown) => {
        setRunning(false);
        setStarting(false);
        setLauncherError(errorText(reason));
      });
  }

  function openReceipt(receiptId: string) {
    setReceipt(null);
    setReceiptError(null);
    setReplayMatch(null);
    setReplayError(null);
    setReceiptLoading(true);
    setReplayLoading(false);
    void getReceipt(receiptId)
      .then((next) => {
        setReceipt(next);
        setReceiptLoading(false);
        setReplayLoading(true);
        return replayReceipt(receiptId)
          .then((replay) => {
            setReplayMatch(replay.match);
          })
          .catch((reason: unknown) => {
            setReplayError(errorText(reason));
          })
          .finally(() => setReplayLoading(false));
      })
      .catch((reason: unknown) => {
        setReceiptLoading(false);
        setReceiptError(errorText(reason));
      });
  }

  async function submitRuling(ruling: Ruling): Promise<string> {
    const stored = await postRuling(ruling);
    setMemoryIds((current) => ({
      ...current,
      [`${ruling.listingId}:${ruling.field}`]: stored.memoryId,
    }));
    try {
      setTrust(await getTrust());
      setTrustState("ready");
      setTrustError(null);
    } catch (reason: unknown) {
      setTrustState("error");
      setTrustError(errorText(reason));
    }
    return stored.memoryId;
  }

  return (
    <main>
      <header>
        <h1>Ghost Network Auditor</h1>
        {healthState === "loading" ? (
          <p>Checking agents…</p>
        ) : (
          <span className={`badge badge-${badge.toLowerCase()}`}>{badge}</span>
        )}
      </header>
      {healthError ? <p role="alert">{healthError}</p> : null}
      <nav aria-label="Sections">
        <a href="#launcher">Run launcher</a>
        <a href="#live-run">Live run</a>
        <a href="#evidence">Evidence card</a>
        <a href="#outreach">Outreach queue</a>
        <a href="#memory">Memory and results</a>
      </nav>
      <div className="panels">
        <section id="launcher" className="panel panel-wide">
          <h2>Run launcher</h2>
          <RunLauncher running={running} onStart={start} />
          {starting ? <p>Starting run…</p> : null}
          {runId ? <p>Run {runId}</p> : null}
          {launcherError ? <p role="alert">{launcherError}</p> : null}
        </section>
        <section id="live-run" className="panel panel-wide">
          <h2>Live run</h2>
          {liveError ? <p role="alert">{liveError}</p> : null}
          <LiveRun events={events} report={report} settled={settled} running={running && !starting} />
        </section>
        <section id="evidence" className="panel">
          <h2>Evidence card</h2>
          <EvidenceCards
            cards={cards}
            runId={runId}
            loading={cardsState === "loading"}
            error={cardsError}
            settled={settled}
            memoryIds={memoryIds}
            onOpenReceipt={openReceipt}
            onSubmitRuling={(ruling) => submitRuling(ruling)}
          />
        </section>
        <section id="outreach" className="panel">
          <h2>Outreach queue</h2>
          <OutreachQueue runId={runId} cards={cards} memoryIds={memoryIds} onSubmit={submitRuling} />
        </section>
        <section id="memory" className="panel">
          <h2>Memory and results</h2>
          <MemoryResults
            trust={trust}
            trustState={trustState}
            trustError={trustError}
            cold={coldReport}
            warm={warmReport}
            report={settled ? report : null}
            reportState={reportState}
            reportError={reportError}
            runId={settled ? runId : null}
          />
        </section>
      </div>
      <ReceiptPanel
        receipt={receipt}
        loading={receiptLoading}
        error={receiptError}
        match={replayMatch}
        matchError={replayError}
        replayLoading={replayLoading}
        onClose={resetReceipt}
      />
    </main>
  );
}
