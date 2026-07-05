/** Shared component-test fixture: a small but story-complete Case. */
import { CaseSchema, type Case, type CaseSummary } from "../lib/schema";

export function makeCase(): Case {
  return CaseSchema.parse({
    case_id: "sg-t",
    sources: [
      {
        source_id: "doc:gp-summary",
        type: "document",
        chunks: [
          { chunk_id: "c001", text: "On aspirin 100mg daily.", section: "Medications" },
          { chunk_id: "c002", text: "Type 2 diabetes, diet controlled." },
        ],
      },
      {
        source_id: "audio:preop-interview",
        type: "audio",
        segments: [
          { seg_id: "s016", t0: 200.0, t1: 214.0, speaker: "PROVIDER", text: "Any blood thinners?" },
          {
            seg_id: "s017",
            t0: 214.3,
            t1: 221.8,
            speaker: "PATIENT",
            text: "I stopped the aspirin last Tuesday.",
          },
        ],
      },
    ],
    artifacts: [
      {
        artifact_id: "note:pre-anesthesia-eval",
        claims: [
          {
            claim_id: "c-001",
            text: "Aspirin was discontinued 6 days prior to surgery.",
            provenance: ["audio:preop-interview#s017"],
            status: "supported",
          },
          {
            claim_id: "c-002",
            text: "Records list aspirin 100mg daily as current.",
            provenance: ["doc:gp-summary#c001", "audio:preop-interview#s017"],
            status: "conflicting",
          },
          {
            claim_id: "c-003",
            text: "Diabetes is diet controlled.",
            provenance: ["doc:gp-summary#c002"],
            status: "unsupported",
          },
        ],
      },
      {
        artifact_id: "record:intra-op",
        claims: [{ claim_id: "c-010", text: "Propofol 120mg given at 08:00." }],
      },
      {
        artifact_id: "note:anticipated-issues",
        claims: [
          {
            claim_id: "c-020",
            text: "Elevated PONV risk post-op.",
            provenance: ["doc:gp-summary#c002"],
            status: "inference",
          },
        ],
      },
      {
        artifact_id: "note:pacu-handoff",
        claims: [
          {
            claim_id: "c-030",
            text: "Aspirin held pre-op.",
            provenance: ["audio:preop-interview#s017"],
            status: "supported",
          },
          {
            claim_id: "c-031",
            text: "Orphan claim.",
            provenance: ["doc:gone#c9"],
            status: "supported",
          },
        ],
      },
    ],
    intraop_events: [
      {
        t: "08:00",
        category: "agent",
        value: "propofol 120",
        units: "mg",
        provenance: ["audio:preop-interview#s016"],
      },
    ],
  });
}

export function makeSummary(overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    case_id: "sg-t",
    artifact_count: 4,
    claim_count: 7,
    status_counts: { supported: 3, unsupported: 1, conflicting: 1, inference: 1, unverified: 1 },
    has_audio: true,
    ...overrides,
  };
}
