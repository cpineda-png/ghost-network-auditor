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
  if (!receipt && !loading && !error) return null;
  const rows = receipt?.rowsPreview.filter((row): row is Record<string, unknown> => isRow(row)) ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const showMatch = replayLoading || match !== null || Boolean(matchError);

  return (
    <dialog className="receipt-panel" open aria-labelledby="receipt-title">
      <h3 id="receipt-title">{receipt ? `Receipt ${receipt.receiptId}` : "Receipt"}</h3>
      {loading && !receipt ? <p>Loading receipt…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {receipt ? (
      <>
      <dl>
        <div>
          <dt>templateId</dt>
          <dd>{receipt.templateId}</dd>
        </div>
        <div>
          <dt>rowCount</dt>
          <dd>{receipt.rowCount}</dd>
        </div>
        <div>
          <dt>executedAt</dt>
          <dd>{receipt.executedAt}</dd>
        </div>
        <div>
          <dt>mode</dt>
          <dd>{receipt.mode}</dd>
        </div>
        {showMatch ? (
          <div>
            <dt>match</dt>
            <dd>{matchError ? "unavailable" : match === null ? "Loading replay…" : String(match)}</dd>
          </div>
        ) : null}
      </dl>
      <h4>SQL</h4>
      <pre>{receipt.sql}</pre>
      <h4>Rows</h4>
      {rows.length === 0 ? (
        <p>No rows</p>
      ) : (
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
      )}
      </>
      ) : null}
      {matchError ? <p role="alert">{matchError}</p> : null}
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
