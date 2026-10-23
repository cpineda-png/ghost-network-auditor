import { z } from "zod";
import { fieldSchema, sourceSchema, type Field, type Source } from "contracts";

export type RunRequest = {
  scope: { batch: "A" | "B"; county?: string; specialty?: string };
  useMemory?: boolean /* default true */;
};

export type Ruling = {
  runId: string;
  listingId: string;
  field: Field;
  value: string | boolean | null;
  source: Source | "other";
  analyst: string;
  note?: string;
};

export type TrustRow = {
  source: Source;
  field: Field;
  helpful: number;
  notHelpful: number;
  wrong: number;
  score: number;
};

export type EvidenceCard = {
  runId: string;
  listingId: string;
  field: Field;
  sources: { source: Source; value: string | boolean | null; receiptIds: string[] }[];
  winner: { value: string | boolean | null; source: Source } | null;
  confidence: number | null;
  rationale: string;
  critique: { verdict: "pass" | "revise" | "reject"; reasons: string[] } | null;
  status: "applied" | "escalated" | "unchanged";
  memoryIds: string[];
};

export type RunReport = {
  runId: string;
  useMemory: boolean;
  listings: number;
  applied: number;
  escalated: number;
  retried: number;
  ghosts: number;
  memoryHits: number;
  models: { model: string; calls: number }[];
};

const valueSchema = z.union([z.string(), z.boolean(), z.null()]);

export const runRequestSchema: z.ZodType<RunRequest> = z.object({
  scope: z.object({
    batch: z.enum(["A", "B"]),
    county: z.string().optional(),
    specialty: z.string().optional(),
  }),
  useMemory: z.boolean().optional(),
});

export const rulingSchema: z.ZodType<Ruling> = z.object({
  runId: z.string(),
  listingId: z.string(),
  field: fieldSchema,
  value: valueSchema,
  source: z.union([sourceSchema, z.literal("other")]),
  analyst: z.string(),
  note: z.string().optional(),
});

export const trustRowSchema: z.ZodType<TrustRow> = z.object({
  source: sourceSchema,
  field: fieldSchema,
  helpful: z.number(),
  notHelpful: z.number(),
  wrong: z.number(),
  score: z.number(),
});

export const evidenceCardSchema: z.ZodType<EvidenceCard> = z.object({
  runId: z.string(),
  listingId: z.string(),
  field: fieldSchema,
  sources: z.array(
    z.object({
      source: sourceSchema,
      value: valueSchema,
      receiptIds: z.array(z.string()),
    }),
  ),
  winner: z
    .object({
      value: valueSchema,
      source: sourceSchema,
    })
    .nullable(),
  confidence: z.number().nullable(),
  rationale: z.string(),
  critique: z
    .object({
      verdict: z.enum(["pass", "revise", "reject"]),
      reasons: z.array(z.string()),
    })
    .nullable(),
  status: z.enum(["applied", "escalated", "unchanged"]),
  memoryIds: z.array(z.string()),
});

export const runReportSchema: z.ZodType<RunReport> = z.object({
  runId: z.string(),
  useMemory: z.boolean(),
  listings: z.number().int(),
  applied: z.number().int(),
  escalated: z.number().int(),
  retried: z.number().int(),
  ghosts: z.number().int(),
  memoryHits: z.number().int(),
  models: z.array(
    z.object({
      model: z.string(),
      calls: z.number().int(),
    }),
  ),
});
