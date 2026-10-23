import type { CatalogResponse, QueryResponse, Receipt } from "contracts";

export interface Gateway {
  query(templateId: string, params: Record<string, unknown>, runId: string): Promise<QueryResponse>;
  getReceipt(id: string): Promise<Receipt>;
  catalog(): Promise<CatalogResponse>;
}
