import { useEffect, useRef } from "react";
import type { Receipt } from "../types";

type Props = {
  receipt: Receipt | null;
  loading?: boolean;
  error?: string | null;
  match?: boolean | null;
  matchError?: string | null;
  replayLoading?: boolean;
  onClose: () => void;
};

export function ReceiptPanel({
  receipt,
  loading = false,
  error = null,
  match = null,
  matchError = null,
  replayLoading = false,
  onClose,
}: Props) {
  const open = Boolean(receipt || loading || error);
  const panelRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const rows = receipt?.rowsPreview.filter((row): row is Record<string, unknown> => isRow(row)) ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const showMatch = replayLoading || match !== null || Boolean(matchError);

  return (
    <dialog
      ref={panelRef}
      className="receipt-panel"
      open
      aria-labelledby="receipt-title"
      aria-modal="false"
      tabIndex={-1}
    >
      <div className="receipt-head">
        <h3 id="receipt-title">{receipt ? `Receipt ${receipt.receiptId}` : "Receipt"}</h3>
      </div>
      <div className="receipt-body">
        {loading && !receipt ? <p className="loading-state">Loading receipt…</p> : null}
        {error ? (
          <div className="error-banner" role="alert">
            <p className="error-title">{error}</p>
            <p className="error-hint">The receipt did not load. Check the gateway, then open the receipt again.</p>
          </div>
        ) : null}
        {receipt ? (
          <>
            <dl className="meta">
              <div>
                <dt>Template</dt>
                <dd className="mono">{receipt.templateId}</dd>
              </div>
              <div>
                <dt>Rows</dt>
                <dd>{receipt.rowCount}</dd>
              </div>
              <div>
                <dt>Executed</dt>
                <dd className="mono">{receipt.executedAt}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{receipt.mode}</dd>
              </div>
              {showMatch ? (
                <div>
                  <dt>Replay</dt>
                  <dd>
                    {matchError ? (
                      "unavailable"
                    ) : match === null ? (
                      "Loading replay…"
                    ) : (
                      <span className={match ? "status status-applied" : "status status-human"}>
                        {match ? "Match" : "No match"}
                      </span>
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
            <h4>SQL</h4>
            <pre>{receipt.sql}</pre>
            <h4>Rows</h4>
            {rows.length === 0 ? (
              <p className="empty-state">No rows in this preview.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column} scope="col">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={index}>
                        {columns.map((column) => (
                          <td key={column}>{String(row[column] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
        {matchError ? (
          <div className="error-banner" role="alert">
            <p className="error-title">{matchError}</p>
            <p className="error-hint">Replay did not finish. Check the gateway, then open the receipt again.</p>
          </div>
        ) : null}
      </div>
      <p className="receipt-actions">
        <button type="button" disabled>
          Replay
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </p>
    </dialog>
  );
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
