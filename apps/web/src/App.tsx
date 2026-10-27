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
import { OutreachQueue, outreachCount } from "./components/OutreachQueue";
import { SideTabList, type SideTab } from "./components/SideTabs";
import { ReceiptPanel } from "./components/ReceiptPanel";
import { RunLauncher } from "./components/RunLauncher";
import { useTheme } from "./theme";
import type { EvidenceCard, Receipt, RunRequest, Ruling, TrustRow, WmEvent } from "./types";

type Badge = "LIVE" | "REPLAY" | "UNKNOWN";
type LoadState = "idle" | "loading" | "ready" | "error";

export default function App() {
  const { theme, toggleTheme } = useTheme();
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
  const [sideTab, setSideTab] = useState<SideTab>("memory");
  const stopRef = useRef<(() => void) | null>(null);
  const pendingScroll = useRef<string | null>(null);

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

  useEffect(() => {
    const anchor = pendingScroll.current;
    if (!anchor) return;
    pendingScroll.current = null;
    scrollToId(anchor);
  }, [sideTab]);

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

  function replayCurrent(receiptId: string) {
    setReplayMatch(null);
    setReplayError(null);
    setReplayLoading(true);
    void replayReceipt(receiptId)
      .then((replay) => {
        setReplayMatch(replay.match);
      })
      .catch((reason: unknown) => {
        setReplayError(errorText(reason));
      })
      .finally(() => setReplayLoading(false));
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
        replayCurrent(receiptId);
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

  function selectSideTab(tab: SideTab, anchor: string) {
    return (event: { preventDefault: () => void }) => {
      event.preventDefault();
      pendingScroll.current = anchor;
      setSideTab(tab);
      if (tab === sideTab) {
        pendingScroll.current = null;
        scrollToId(anchor);
      }
    };
  }

  return (
    <main>
      <a className="skip-link" href="#launcher">
        Skip to run launcher
      </a>
      <header className="app-header">
        <div className="brand">
          <div className="brand-title">
            <svg className="logo" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
              <path
                d="M7 8.5H21L14 16.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M14 16.5L20.5 21"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity="0.35"
              />
              <circle cx="7" cy="8.5" r="2.5" />
              <circle cx="21" cy="8.5" r="2.5" />
              <circle cx="14" cy="16.5" r="2.5" />
              <circle cx="20.5" cy="21" r="2.3" opacity="0.35" />
            </svg>
            <h1>Ghost Network Auditor</h1>
          </div>
          <p className="tagline">Audit provider listings against claims, rosters, and prior rulings.</p>
          <ul className="legend" aria-label="Status meanings">
            <li>
              <span className="status status-applied">Applied</span>
            </li>
            <li>
              <span className="status status-escalated">Escalated</span>
            </li>
            <li>
              <span className="status status-unchanged">Unchanged</span>
            </li>
            <li>
              <span className="status status-human">Needs a human</span>
            </li>
          </ul>
        </div>
        <div className="header-meta">
          <button
            type="button"
            className="theme-toggle"
            aria-pressed={theme === "dark"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? "Dark" : "Light"}
          </button>
          {healthState === "loading" ? (
            <p className="header-note">Checking agents…</p>
          ) : (
            <span className={`badge badge-${badge.toLowerCase()}`} title={badgeTitle(badge)}>
              {badge}
            </span>
          )}
        </div>
      </header>
      {healthError ? (
        <div className="error-banner" role="alert">
          <p className="error-title">{healthError}</p>
          <p className="error-hint">Agents are unreachable. Check that the agents service is running, then reload this page.</p>
        </div>
      ) : null}
      <nav className="section-nav" aria-label="Sections">
        <a href="#launcher">Run launcher</a>
        <a href="#timeline">Timeline</a>
        <a href="#evidence">Evidence</a>
        <a href="#outreach" onClick={selectSideTab("outreach", "outreach")}>
          Outreach queue
        </a>
        <a href="#memory" onClick={selectSideTab("memory", "memory")}>
          Memory
        </a>
        <a href="#results" onClick={selectSideTab("results", "results")}>
          Results
        </a>
      </nav>
      <div className="panels">
        <section className="intro panel panel-wide" aria-label="About this tool">
          <p>Ghost Network Auditor checks provider listings against claims, rosters, and prior rulings.</p>
          <p>Each finding keeps its sources, its confidence, and the receipt that supports it.</p>
          <p className="intro-cta">Choose a batch and press Start.</p>
        </section>
        <section id="launcher" className="panel panel-wide">
          <div className="panel-head">
            <h2>Run launcher</h2>
            <p className="panel-desc">Choose a batch and press Start.</p>
          </div>
          <RunLauncher running={running} onStart={start} />
          {starting ? <p className="loading-line">Starting run…</p> : null}
          {runId ? <p className="run-id mono">Run {runId}</p> : null}
          {launcherError ? (
            <div className="error-banner" role="alert">
              <p className="error-title">{launcherError}</p>
              <p className="error-hint">The run did not start. Check the agents service, then press Start again.</p>
            </div>
          ) : null}
        </section>
        <div className="workbench">
          <section id="timeline" className="panel">
            <div className="panel-head">
              <h2>Live run</h2>
              <p className="panel-desc">Events from each actor, in the order they arrive.</p>
            </div>
            {liveError ? (
              <div className="error-banner" role="alert">
                <p className="error-title">{liveError}</p>
                <p className="error-hint">
                  Check that the agents service is running and can reach the gateway, then press Start again.
                </p>
              </div>
            ) : null}
            <LiveRun events={events} report={report} settled={settled} running={running} />
          </section>
          <aside className="work-side">
            <section id="memory" className="panel">
              <div className="panel-head">
                <h2>Memory and results</h2>
                <p className="panel-desc">Trust scores, the run report, cold versus warm, and rulings.</p>
              </div>
              <SideTabList tab={sideTab} outreachCount={outreachCount(cards)} onChange={setSideTab} />
              <div className="side-tab-scroll">
                <div
                  id="panel-memory"
                  role="tabpanel"
                  aria-labelledby="tab-memory"
                  hidden={sideTab !== "memory"}
                >
                  <MemoryResults
                    part="trust"
                    trust={trust}
                    trustState={trustState}
                    trustError={trustError}
                    cold={coldReport}
                    warm={warmReport}
                    report={settled ? report : null}
                    reportState={reportState}
                    reportError={reportError}
                    runId={settled ? runId : null}
                    running={running}
                  />
                </div>
                <div id="results" role="tabpanel" aria-labelledby="tab-results" hidden={sideTab !== "results"}>
                  <MemoryResults
                    part="report"
                    trust={trust}
                    trustState={trustState}
                    trustError={trustError}
                    cold={coldReport}
                    warm={warmReport}
                    report={settled ? report : null}
                    reportState={reportState}
                    reportError={reportError}
                    runId={settled ? runId : null}
                    running={running}
                  />
                </div>
                <div id="outreach" role="tabpanel" aria-labelledby="tab-outreach" hidden={sideTab !== "outreach"}>
                  <OutreachQueue
                    runId={runId}
                    cards={cards}
                    memoryIds={memoryIds}
                    running={running}
                    onSubmit={submitRuling}
                  />
                </div>
              </div>
            </section>
          </aside>
          <section id="evidence" className="panel">
            <div className="panel-head">
              <h2>Evidence card</h2>
              <p className="panel-desc">Sources, confidence, and the critic verdict for each field.</p>
            </div>
            <EvidenceCards
              cards={cards}
              runId={runId}
              loading={cardsState === "loading"}
              error={cardsError}
              settled={settled}
              running={running}
              memoryIds={memoryIds}
              onOpenReceipt={openReceipt}
              onSubmitRuling={(ruling) => submitRuling(ruling)}
            />
          </section>
        </div>
      </div>
      <ReceiptPanel
        receipt={receipt}
        loading={receiptLoading}
        error={receiptError}
        match={replayMatch}
        matchError={replayError}
        replayLoading={replayLoading}
        onReplay={() => receipt && replayCurrent(receipt.receiptId)}
        onClose={resetReceipt}
      />
    </main>
  );
}

function scrollToId(id: string) {
  const node = document.getElementById(id);
  if (!node) return;
  try {
    node.scrollIntoView();
  } catch {
    // jsdom does not implement scrolling.
  }
}

function badgeTitle(badge: Badge): string {
  if (badge === "LIVE") return "Models are called live";
  if (badge === "REPLAY") return "Models are replayed from stored responses";
  return "Agents health has not been confirmed";
}
