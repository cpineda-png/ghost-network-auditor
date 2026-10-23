import type { Receipt } from "../types";

type Props = {
  receipt: Receipt | null;
  onClose: () => void;
};

export function ReceiptPanel({ receipt, onClose }: Props) {
  if (!receipt) return null;
  const rows = receipt.rowsPreview.filter((row): row is Record<string, unknown> => isRow(row));
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <dialog className="receipt-panel" open aria-labelledby="receipt-title">
      <h3 id="receipt-title">Receipt {receipt.receiptId}</h3>
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
