import { useEffect, useState } from "react";
import { getDiffCsv, usingFixtures } from "../api";
import type { RunReport, TrustRow } from "../types";

type Props = {
  trust: TrustRow[];
  cold: RunReport | null;
  warm: RunReport | null;
  runId: string | null;
};

export function MemoryResults({ trust, cold, warm, runId }: Props) {
  const href = useDiffHref(runId);

  return (
    <div>
      <h3>Trust</h3>
      {trust.length === 0 ? (
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
      <h3>Cold versus warm</h3>
      <ul className="counts">
        <li>Cold escalations {cold ? cold.escalated : "—"}</li>
        <li>Warm escalations {warm ? warm.escalated : "—"}</li>
      </ul>
      {href ? (
        <a href={href} download={`diff-${runId ?? "run"}.csv`}>
          diff.csv
        </a>
      ) : (
        <p className="muted">diff.csv unavailable</p>
      )}
    </div>
  );
}

function useDiffHref(runId: string | null): string | null {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    const id = runId ?? "run-cold";
    let objectUrl: string | undefined;
    let cancelled = false;
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
      .catch(() => {
        if (!cancelled) setHref(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [runId]);
  return href;
}
