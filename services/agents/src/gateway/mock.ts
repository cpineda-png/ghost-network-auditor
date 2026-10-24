import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogResponse, QueryResponse, Receipt, ReplayResponse } from "contracts";
import { CATALOG } from "./catalog.js";
import { makeQueryResponse } from "./receipt.js";
import type { Gateway } from "./types.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): QueryResponse {
  const raw = readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf8");
  return JSON.parse(raw) as QueryResponse;
}

export class MockGateway implements Gateway {
  private readonly receipts = new Map<string, Receipt>();
  private readonly tampered = new Set<string>();

  tamper(receiptId: string): void {
    this.tampered.add(receiptId);
  }

  async query(templateId: string, params: Record<string, unknown>, runId: string): Promise<QueryResponse> {
    const fixtureName =
      templateId === "directory_batch"
        ? "directory_batch"
        : templateId === "roster_by_npis"
          ? "roster_by_npis"
          : "claims_by_npis";
    const fixture = loadFixture(fixtureName);
    let rows = fixture.rows;
    if (templateId === "directory_batch") {
      if (params.batch) {
        rows = rows.filter((row) => (row as { batch?: string }).batch === params.batch);
      }
      const offset = Number(params.offset);
      const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
      const limit = Number(params.limit);
      if (Number.isFinite(limit) && limit >= 0) {
        rows = rows.slice(start, start + limit);
      } else if (start > 0) {
        rows = rows.slice(start);
      }
    }
    if (templateId !== "directory_batch" && Array.isArray(params.npis)) {
      const npis = new Set(params.npis as string[]);
      rows = rows.filter((row) => npis.has(String((row as { npi?: string }).npi)));
    }
    const response = makeQueryResponse(templateId, params, runId, fixture.columns, rows, {
      mode: "replayed",
      sql: fixture.receipt.sql,
      sources: fixture.receipt.sources,
    });
    this.receipts.set(response.receipt.receiptId, response.receipt);
    return response;
  }

  async getReceipt(id: string): Promise<Receipt> {
    const receipt = this.receipts.get(id);
    if (!receipt) {
      throw new Error(`receipt ${id} not found`);
    }
    return receipt;
  }

  async catalog(): Promise<CatalogResponse> {
    return CATALOG;
  }

  async replay(receiptId: string): Promise<ReplayResponse> {
    const receipt = await this.getReceipt(receiptId);
    const match = !this.tampered.has(receiptId);
    return {
      receiptId,
      match,
      originalRowsHash: receipt.rowsHash,
      newRowsHash: match ? receipt.rowsHash : `${receipt.rowsHash}-tampered`,
      rows: receipt.rowsPreview,
    };
  }
}
