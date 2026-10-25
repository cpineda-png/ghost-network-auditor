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
}: Props) {
  const diff = useDiffHref(runId);

  return (
    <div>
      <h3>Trust</h3>
      {trustState === "loading" ? <p>Loading trust…</p> : null}
      {trustError ? <p role="alert">{trustError}</p> : null}
      {trustState === "loading" ? null : trust.length === 0 ? (
        <p className="muted">No trust rows.</p>
      ) : (
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
      )}
      <h3>Report</h3>
      {reportState === "loading" ? <p>Loading report…</p> : null}
      {reportError ? <p role="alert">{reportError}</p> : null}
      {report ? (
        <ul className="counts">
          <li>Applied {report.applied}</li>
          <li>Escalated {report.escalated}</li>
          <li>Ghosts {report.ghosts}</li>
          <li>Memory hits {report.memoryHits}</li>
          <li>Models {modelText(report.models)}</li>
        </ul>
      ) : reportState === "loading" || reportError ? null : (
        <p className="muted">No report yet.</p>
      )}
      <h3>Cold versus warm</h3>
      <ul className="counts">
        <li>Cold escalations {cold ? cold.escalated : "—"}</li>
        <li>Warm escalations {warm ? warm.escalated : "—"}</li>
      </ul>
      {diff.loading ? <p>Loading diff…</p> : null}
      {diff.error ? <p role="alert">{diff.error}</p> : null}
      {diff.href ? (
        <a href={diff.href} download={`diff-${runId ?? "run"}.csv`}>
          Download diff.csv
        </a>
      ) : null}
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
