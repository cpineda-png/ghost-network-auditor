import { Fragment, useEffect, useRef, useState } from "react";
import type { Receipt } from "../types";

const KEY_COLUMNS = [
  "listing_id",
  "provider_name",
  "specialty",
  "address_line1",
  "phone",
  "accepting_new_patients",
  "network_status",
];

const CLOSE_MS = 160;

type Props = {
  receipt: Receipt | null;
  loading?: boolean;
  error?: string | null;
  match?: boolean | null;
  matchError?: string | null;
  replayLoading?: boolean;
  onReplay?: () => void;
  onClose: () => void;
};

export function ReceiptPanel({
  receipt,
  loading = false,
  error = null,
  match = null,
  matchError = null,
  replayLoading = false,
  onReplay,
  onClose,
}: Props) {
  const open = Boolean(receipt || loading || error);
  const panelRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const visibleRef = useRef(open);
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      visibleRef.current = true;
      setVisible(true);
      setClosing(false);
      return;
    }
    if (!visibleRef.current) return;
    if (prefersReducedMotion()) {
      visibleRef.current = false;
      setVisible(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      visibleRef.current = false;
      setVisible(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains("receipt-id")) {
      returnFocusRef.current = active;
    }
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") trapFocus(event, panelRef.current);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      const back = returnFocusRef.current;
      returnFocusRef.current = null;
      if (back?.isConnected) back.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains("receipt-id")) {
      returnFocusRef.current = active;
      panelRef.current?.focus();
    }
  }, [open, receipt?.receiptId, loading]);

  if (!visible) return null;
  const rows = receipt?.rowsPreview.filter((row): row is Record<string, unknown> => isRow(row)) ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const keyColumns = KEY_COLUMNS.filter((column) => columns.includes(column));
  const shownColumns = keyColumns.length > 0 ? keyColumns : ["Fields"];
  const detailColumns = [...keyColumns, ...columns.filter((column) => !keyColumns.includes(column))];
  const showMatch = replayLoading || match !== null || Boolean(matchError);
  const replayLabel = replayLoading ? "Replaying…" : match !== null ? "Replay again" : "Replay";
  const motionClass = closing ? " is-closing" : "";

  return (
    <>
      <div className={`receipt-backdrop${motionClass}`} onClick={onClose} />
      <dialog
        ref={panelRef}
        className={`receipt-panel${motionClass}`}
        open
        aria-labelledby="receipt-title"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="receipt-head">
          <h3 id="receipt-title">{receipt ? `Receipt ${receipt.receiptId}` : "Receipt"}</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
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
              <div className="section-tools">
                <h4>SQL</h4>
                <button
                  type="button"
                  aria-expanded={sqlOpen}
                  aria-controls="receipt-sql"
                  onClick={() => setSqlOpen((openSql) => !openSql)}
                >
                  {sqlOpen ? "Hide SQL" : "Show SQL"}
                </button>
              </div>
              <pre id="receipt-sql" className={sqlOpen ? "sql-block" : "sql-block sql-collapsed"}>
                {receipt.sql}
              </pre>
              <h4>Rows</h4>
              {rows.length === 0 ? (
                <p className="empty-state">No rows in this preview.</p>
              ) : (
                <div className="receipt-rows">
                  <table>
                    <thead>
                      <tr>
                        {shownColumns.map((column) => (
                          <th key={column} scope="col" title={column}>
                            <span className="cell-ellipsis">{column}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => {
                        const expanded = openRow === index;
                        return (
                          <Fragment key={index}>
                            <tr
                              className="receipt-row"
                              tabIndex={0}
                              aria-expanded={expanded}
                              onClick={() => setOpenRow((current) => (current === index ? null : index))}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                setOpenRow((current) => (current === index ? null : index));
                              }}
                            >
                              {shownColumns.map((column) => {
                                const text = column === "Fields" ? (expanded ? "Hide fields" : "Show fields") : cellText(row[column]);
                                return (
                                  <td key={column} title={text}>
                                    <span className="cell-ellipsis">{text}</span>
                                  </td>
                                );
                              })}
                            </tr>
                            {expanded ? (
                              <tr className="receipt-detail-row">
                                <td colSpan={shownColumns.length}>
                                  <dl className="receipt-detail">
                                    {detailColumns.map((column) => {
                                      const text = cellText(row[column]);
                                      return (
                                        <div key={column}>
                                          <dt>{column}</dt>
                                          <dd title={text}>{text}</dd>
                                        </div>
                                      );
                                    })}
                                  </dl>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
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
          <button type="button" disabled={!receipt || replayLoading} onClick={onReplay}>
            {replayLabel}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </p>
      </dialog>
    </>
  );
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

function trapFocus(event: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const items = focusable(root);
  if (items.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || active === root || !root.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]")].filter((element) => {
    if (element.hasAttribute("disabled")) return false;
    if (element.tabIndex < 0) return false;
    return true;
  });
}
