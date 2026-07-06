/**
 * zod mirror of `periop.schemas` (ui.md §3): field names match the pydantic
 * models exactly, and every API response is parsed through these at the
 * client boundary. Provenance refs arrive in the compact string form
 * (`source_id#anchor`) — parsing lives in `provenance.ts`.
 */
import { z } from "zod";

export const CLAIM_STATUSES = [
  "unverified",
  "supported",
  "unsupported",
  "conflicting",
  "inference",
] as const;

export const ClaimStatusSchema = z.enum(CLAIM_STATUSES);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ChunkSchema = z.object({
  chunk_id: z.string(),
  text: z.string(),
  section: z.string().nullable().default(null),
});
export type Chunk = z.infer<typeof ChunkSchema>;

export const AudioSegmentSchema = z.object({
  seg_id: z.string(),
  t0: z.number(),
  t1: z.number(),
  speaker: z.string(),
  text: z.string(),
});
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;

export const SourceSchema = z.object({
  source_id: z.string(),
  type: z.enum(["document", "audio"]),
  chunks: z.array(ChunkSchema).default([]),
  segments: z.array(AudioSegmentSchema).default([]),
});
export type Source = z.infer<typeof SourceSchema>;

export const ClaimSchema = z.object({
  claim_id: z.string(),
  text: z.string(),
  provenance: z.array(z.string()).default([]),
  status: ClaimStatusSchema.default("unverified"),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const EventSchema = z.object({
  t: z.string(),
  category: z.enum(["agent", "dose", "airway", "line", "fluid", "event"]),
  value: z.string(),
  units: z.string().nullable().default(null),
  provenance: z.array(z.string()).default([]),
});
export type Event = z.infer<typeof EventSchema>;

export const ArtifactRecordSchema = z.object({
  artifact_id: z.string(),
  claims: z.array(ClaimSchema).default([]),
});
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;

export const CaseSchema = z.object({
  case_id: z.string(),
  patient_profile_ref: z.string().nullable().default(null),
  sources: z.array(SourceSchema).default([]),
  artifacts: z.array(ArtifactRecordSchema).default([]),
  // v2 serves questions as objects; legacy fixtures may still hold plain
  // strings — normalize to the object form on parse
  open_questions: z
    .array(
      z.union([
        z.string().transform((question) => ({
          question,
          reason: null as string | null,
          provenance: [] as string[],
          review: null as string | null,
          edited_text: null as string | null,
        })),
        z.object({
          question: z.string(),
          reason: z.string().nullable().default(null),
          provenance: z.array(z.string()).default([]),
          review: z.enum(["approved", "dismissed", "edited"]).nullable().default(null),
          edited_text: z.string().nullable().default(null),
        }),
      ]),
    )
    .default([]),
  intraop_events: z.array(EventSchema).default([]),
  anticipated_issues: z.array(z.string()).default([]),
});
export type Case = z.infer<typeof CaseSchema>;

export const CaseSummarySchema = z.object({
  case_id: z.string(),
  artifact_count: z.number(),
  claim_count: z.number(),
  status_counts: z.record(ClaimStatusSchema, z.number()),
  has_audio: z.boolean(),
});
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
