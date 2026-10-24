import { createHash } from "node:crypto";
import type { QueryResponse, Receipt } from "contracts";

export function makeQueryResponse(
  templateId: string,
  params: Record<string, unknown>,
  runId: string,
  columns: string[],
  rows: unknown[],
  extras?: Partial<Receipt>,
): QueryResponse {
  const receiptId = extras?.receiptId ?? `receipt-${templateId}-${runId}`;
  const rowsHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const receipt: Receipt = {
    receiptId,
    runId,
    templateId,
    sql: extras?.sql ?? `-- template ${templateId}`,
    params,
    sources: extras?.sources ?? [templateId.split("_")[0] ?? "directory"],
    rowCount: rows.length,
    rowsHash,
    rowsPreview: rows.slice(0, 5),
    executedAt: extras?.executedAt ?? "2026-01-15T00:00:00.000Z",
    mode: extras?.mode ?? "replayed",
    durationMs: extras?.durationMs ?? 12,
  };
  return { receipt, columns, rows };
}
