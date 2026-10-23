import { z } from "zod";

export type Field = "address" | "phone" | "status" | "specialty" | "accepting";
export type Source = "directory" | "roster" | "claims" | "nppes";

export const fieldSchema = z.enum(["address", "phone", "status", "specialty", "accepting"]);
export const sourceSchema = z.enum(["directory", "roster", "claims", "nppes"]);

export type Receipt = {
  receiptId: string;
  runId: string;
  templateId: string;
  sql: string;
  params: Record<string, unknown>;
  sources: string[];
  rowCount: number;
  rowsHash: string;
  rowsPreview: unknown[];
  executedAt: string;
  mode: "live" | "replayed";
  durationMs: number;
};

export const receiptSchema: z.ZodType<Receipt> = z.object({
  receiptId: z.string(),
  runId: z.string(),
  templateId: z.string(),
  sql: z.string(),
  params: z.record(z.string(), z.unknown()),
  sources: z.array(z.string()),
  rowCount: z.number().int(),
  rowsHash: z.string(),
  rowsPreview: z.array(z.unknown()),
  executedAt: z.string(),
  mode: z.enum(["live", "replayed"]),
  durationMs: z.number(),
});

export type QueryRequest = {
  templateId: string;
  params: Record<string, unknown>;
  runId: string;
  requestedBy: string;
};

export const queryRequestSchema: z.ZodType<QueryRequest> = z.object({
  templateId: z.string(),
  params: z.record(z.string(), z.unknown()),
  runId: z.string(),
  requestedBy: z.string(),
});

export type QueryResponse = {
  receipt: Receipt;
  columns: string[];
  rows: unknown[];
};

export const queryResponseSchema: z.ZodType<QueryResponse> = z.object({
  receipt: receiptSchema,
  columns: z.array(z.string()),
  rows: z.array(z.unknown()),
});

export type QueryError = {
  error: string;
  templateId: string;
  sqlState: string | null;
};

export const queryErrorSchema: z.ZodType<QueryError> = z.object({
  error: z.string(),
  templateId: z.string(),
  sqlState: z.string().nullable(),
});

export type ReplayResponse = {
  receiptId: string;
  match: boolean;
  originalRowsHash: string;
  newRowsHash: string;
  rows: unknown[];
};

export const replayResponseSchema: z.ZodType<ReplayResponse> = z.object({
  receiptId: z.string(),
  match: z.boolean(),
  originalRowsHash: z.string(),
  newRowsHash: z.string(),
  rows: z.array(z.unknown()),
});

export type GatewayHealth = {
  zetaris: "up" | "down" | "not_configured";
  mode: "live" | "sample";
};

export const gatewayHealthSchema: z.ZodType<GatewayHealth> = z.object({
  zetaris: z.enum(["up", "down", "not_configured"]),
  mode: z.enum(["live", "sample"]),
});

export type CatalogParam = {
  name: string;
  type: string;
  required: boolean;
  allowed?: string[];
};

export const catalogParamSchema: z.ZodType<CatalogParam> = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  allowed: z.array(z.string()).optional(),
});

export type CatalogTemplate = {
  templateId: string;
  description: string;
  params: CatalogParam[];
  sources: string[];
};

export const catalogTemplateSchema: z.ZodType<CatalogTemplate> = z.object({
  templateId: z.string(),
  description: z.string(),
  params: z.array(catalogParamSchema),
  sources: z.array(z.string()),
});

export type CatalogResponse = {
  templates: CatalogTemplate[];
};

export const catalogResponseSchema: z.ZodType<CatalogResponse> = z.object({
  templates: z.array(catalogTemplateSchema),
});

export type WmEvent = {
  eventId: string;
  runId: string;
  ts: string;
  actor:
    | "planner"
    | "investigator.contact"
    | "investigator.status"
    | "investigator.specialty"
    | "arbiter"
    | "critic"
    | "risk"
    | "human";
  type:
    | "run_started"
    | "task_created"
    | "claim_added"
    | "conflict_found"
    | "proposal_made"
    | "critique"
    | "retry_requested"
    | "escalated"
    | "ruling_recorded"
    | "applied"
    | "run_finished";
  entityId: string;
  field?: Field;
  payload: Record<string, unknown>;
};

export const wmEventSchema: z.ZodType<WmEvent> = z.object({
  eventId: z.string(),
  runId: z.string(),
  ts: z.string(),
  actor: z.enum([
    "planner",
    "investigator.contact",
    "investigator.status",
    "investigator.specialty",
    "arbiter",
    "critic",
    "risk",
    "human",
  ]),
  type: z.enum([
    "run_started",
    "task_created",
    "claim_added",
    "conflict_found",
    "proposal_made",
    "critique",
    "retry_requested",
    "escalated",
    "ruling_recorded",
    "applied",
    "run_finished",
  ]),
  entityId: z.string(),
  field: fieldSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type Claim = {
  listingId: string;
  field: Field;
  source: Source;
  value: string | boolean | null;
  receiptIds: string[];
  confidence: number;
};

export const claimSchema: z.ZodType<Claim> = z.object({
  listingId: z.string(),
  field: fieldSchema,
  source: sourceSchema,
  value: z.union([z.string(), z.boolean(), z.null()]),
  receiptIds: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
});

const maxWords = (max: number) =>
  z.string().refine((text) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length <= max;
  }, `must be at most ${max} words`);

export type Proposal = {
  proposalId: string;
  listingId: string;
  field: Field;
  proposedValue: string | boolean | null;
  winningSource: Source;
  confidence: number;
  rationale: string;
  receiptIds: string[];
  memoryIds: string[];
};

export const proposalSchema: z.ZodType<Proposal> = z.object({
  proposalId: z.string(),
  listingId: z.string(),
  field: fieldSchema,
  proposedValue: z.union([z.string(), z.boolean(), z.null()]),
  winningSource: sourceSchema,
  confidence: z.number().min(0).max(1),
  rationale: maxWords(60),
  receiptIds: z.array(z.string()).min(1),
  memoryIds: z.array(z.string()),
});

export type Critique = {
  proposalId: string;
  verdict: "pass" | "revise" | "reject";
  reasons: string[];
  failedReceiptIds: string[];
};

export const critiqueSchema: z.ZodType<Critique> = z.object({
  proposalId: z.string(),
  verdict: z.enum(["pass", "revise", "reject"]),
  reasons: z.array(z.string()),
  failedReceiptIds: z.array(z.string()),
});

export type Escalation = {
  listingId: string;
  field: Field;
  reason: string;
  options: { value: string | boolean | null; source: Source; receiptIds: string[] }[];
};

export const escalationSchema: z.ZodType<Escalation> = z.object({
  listingId: z.string(),
  field: fieldSchema,
  reason: z.string(),
  options: z.array(
    z.object({
      value: z.union([z.string(), z.boolean(), z.null()]),
      source: sourceSchema,
      receiptIds: z.array(z.string()).min(1),
    }),
  ),
});

export const THRESHOLDS = { toCritic: 0.7, retryFloor: 0.5, maxRetries: 2, maxRevisions: 2 } as const;
