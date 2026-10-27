import { useEffect, useState } from "react";
import { errorText, getDiffCsv, usingFixtures } from "../api";
import type { RunReport, TrustRow } from "../types";

type LoadState = "idle" | "loading" | "ready" | "error";

type Props = {
  trust: TrustRow[];
  trustState: LoadState;
  trustError: string | null;
  cold: RunReport | null;
  warm: RunReport | null;
  report: RunReport | null;
  reportState: LoadState;
  reportError: string | null;
  runId: string | null;
  running?: boolean;
};

export function MemoryResults({
  trust,
  trustState,
  trustError,
  cold,
  warm,
  report,
  reportState,
  reportError,
  runId,
  running = false,
}: Props) {
  const diff = useDiffHref(runId);

  return (
    <div>
      <h3>Trust</h3>
      {trustState === "loading" ? <p className="loading-state">Loading trust scores…</p> : null}
      {trustError ? (
        <div className="error-banner" role="alert">
          <p className="error-title">{trustError}</p>
          <p className="error-hint">Trust scores did not load. Check the agents service, then reload this page.</p>
        </div>
      ) : null}
      {trustState === "loading" ? null : trust.length === 0 ? (
        trustError ? null : (
          <p className="empty-state">No trust rows yet. Scores appear after a ruling is stored.</p>
        )
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Field</th>
              <th scope="col">Helpful</th>
              <th scope="col">Not helpful</th>
              <th scope="col">Wrong</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {trust.map((row) => (
              <tr key={`${row.source}:${row.field}`}>
                <td>{row.source}</td>
                <td>{row.field}</td>
                <td>{row.helpful}</td>
                <td>{row.notHelpful}</td>
                <td>{row.wrong}</td>
                <td>{row.score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <div id="results">
      <h3>Report</h3>
      {reportState === "loading" ? <p className="loading-state">Loading the run report…</p> : null}
      {reportError ? (
        <div className="error-banner" role="alert">
          <p className="error-title">{reportError}</p>
          <p className="error-hint">The report did not load. Check the agents service, then start the batch again.</p>
        </div>
      ) : null}
      {report ? (
        <ul className="counts">
          <li>
            <span className="status status-applied">Applied</span>
            <span className="count-num">{report.applied}</span>
          </li>
          <li>
            <span className="status status-escalated">Escalated</span>
            <span className="count-num">{report.escalated}</span>
          </li>
          <li>
            <span className="status status-human">Ghosts</span>
            <span className="count-num">{report.ghosts}</span>
          </li>
          <li>
            <span className="count-label">Memory hits</span>
            <span className="count-num">{report.memoryHits}</span>
          </li>
          <li>
            <span className="count-label">Models</span>
            <span>{modelText(report.models)}</span>
          </li>
        </ul>
      ) : reportState === "loading" || reportError ? null : running ? (
        <p className="loading-state">Waiting for this run to finish. The report loads next.</p>
      ) : (
        <p className="empty-state">No report yet. Choose a batch and press Start.</p>
      )}
      <h3>Cold versus warm</h3>
      <ul className="counts">
        <li>
          <span className="count-label">Cold escalations</span>
          <span className="count-num">{cold ? cold.escalated : "—"}</span>
        </li>
        <li>
          <span className="count-label">Warm escalations</span>
          <span className="count-num">{warm ? warm.escalated : "—"}</span>
        </li>
      </ul>
      {!cold && !warm ? (
        <p className="field-hint">These counts fill in after a cold run and a warm run finish.</p>
      ) : null}
      {diff.loading ? <p className="loading-state">Loading the diff file…</p> : null}
      {diff.error ? (
        <div className="error-banner" role="alert">
          <p className="error-title">{diff.error}</p>
          <p className="error-hint">The diff did not load. Check the agents service, then start the batch again.</p>
        </div>
      ) : null}
      {diff.href ? (
        <a className="link-button" href={diff.href} download={`diff-${runId ?? "run"}.csv`}>
          Download diff.csv
        </a>
      ) : null}
      </div>
    </div>
  );
}

function modelText(models: RunReport["models"]): string {
  if (models.length === 0) return "none";
  return models.map((item) => `${item.model} (${item.calls})`).join(", ");
}

function useDiffHref(runId: string | null): { href: string | null; error: string | null; loading: boolean } {
  const [href, setHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!runId && !usingFixtures()) {
      setHref(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = runId ?? "run-cold";
    let objectUrl: string | undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDiffCsv(id)
      .then((csv) => {
        if (cancelled) return;
        if (usingFixtures()) {
          objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
          setHref(objectUrl);
        } else {
          setHref(`/api/runs/${encodeURIComponent(id)}/diff.csv`);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setHref(null);
          setError(errorText(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [runId]);
  return { href, error, loading };
}
