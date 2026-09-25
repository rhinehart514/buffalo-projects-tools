import { z } from "zod";
import {
  availabilityStatuses,
  isoDateSchema,
  type Opportunity,
} from "./catalog.js";
import report from "./catalog-verification.json" with { type: "json" };

/** A stated date: full `YYYY-MM-DD`, or `--MM-DD` when the source omits the year. */
export const statedDateSchema = z
  .string()
  .regex(/^(?:\d{4}|-)-\d{2}-\d{2}$/u, "Use YYYY-MM-DD or --MM-DD");

export const evidenceFields = ["status", "deadline", "cohort-date"] as const;

export const catalogEvidenceSchema = z.object({
  field: z.enum(evidenceFields),
  value: z.string().min(1),
  /** Exact text from the official page; code checked it is on the page. */
  quote: z.string().min(1),
  url: z.url(),
});

export const driftKinds = [
  "dead-link",
  "access-denied",
  "unreachable",
  "redirected",
  "closed",
  "status-changed",
  "status-conflict",
  "deadline-changed",
  "deadline-passed",
  "deadline-unconfirmed",
] as const;

export const catalogDriftSchema = z.object({
  kind: z.enum(driftKinds),
  url: z.url(),
  detail: z.string().min(1),
});

export const pageCheckSchema = z.object({
  role: z.enum(["official", "registration"]),
  url: z.url(),
  finalUrl: z.url().nullable(),
  httpStatus: z.number().int().nullable(),
  ok: z.boolean(),
  characterCount: z.number().int().min(0),
});

export const catalogVerificationEntrySchema = z.object({
  id: z.string().min(1),
  checkedAt: z.iso.datetime(),
  /** Last day code read the official page and found no drift from the catalog. */
  lastVerified: isoDateSchema.nullable(),
  pages: z.array(pageCheckSchema),
  observed: z.object({
    status: z.enum(availabilityStatuses),
    deadline: statedDateSchema.nullable(),
  }),
  evidence: z.array(catalogEvidenceSchema),
  /** Extractor findings dropped because their quote was not on the page. */
  rejectedFindingCount: z.number().int().min(0),
  drift: z.array(catalogDriftSchema),
});

export const catalogVerificationReportSchema = z.object({
  version: z.literal("buffalo-catalog-verification/v1"),
  generatedAt: z.iso.datetime(),
  extractor: z.string().min(1),
  entries: z.array(catalogVerificationEntrySchema),
});

export type CatalogEvidence = z.infer<typeof catalogEvidenceSchema>;
export type CatalogDrift = z.infer<typeof catalogDriftSchema>;
export type PageCheck = z.infer<typeof pageCheckSchema>;
export type CatalogVerificationEntry = z.infer<typeof catalogVerificationEntrySchema>;
export type CatalogVerificationReport = z.infer<typeof catalogVerificationReportSchema>;

export const catalogVerification: CatalogVerificationReport =
  catalogVerificationReportSchema.parse(report);

/** What an MCP user sees about how fresh and how grounded an entry is. */
export function verificationFor(
  opportunity: Opportunity,
  source: CatalogVerificationReport = catalogVerification,
) {
  const entry = source.entries.find((item) => item.id === opportunity.id);
  if (!entry) {
    return {
      state: "never-verified" as const,
      lastVerified: null,
      checkedAt: null,
      observed: null,
      evidence: [],
      drift: [],
    };
  }
  return {
    state: entry.drift.length > 0 ? ("drift" as const) : ("no-drift" as const),
    lastVerified: entry.lastVerified,
    checkedAt: entry.checkedAt,
    observed: entry.observed,
    evidence: entry.evidence,
    drift: entry.drift,
  };
}
