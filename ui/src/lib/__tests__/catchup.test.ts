import { describe, expect, it } from "vitest";
import { buildBrief, categorizeReason, REASON_META } from "../catchup";
import { CaseSchema, type Provider } from "../schema";

const PROVIDERS: Provider[] = [
  { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
  { provider_id: "p-tan", name: "Dr B. Tan", role: "registrar" },
];

/** A stage block with sensible signed/unsigned defaults for the test cases. */
function stage(over: Record<string, unknown> = {}) {
  return { status: "awaiting_inputs", ...over };
}

function signedStage(by: string) {
  return {
    status: "signed_off",
    performed_by: by,
    signed_off_by: by,
    signed_off_at: "2026-04-02T07:15:00Z",
  };
}

describe("categorizeReason", () => {
  it("buckets by wording, falling back to Clarify", () => {
    expect(categorizeReason("The record and interview disagree on amlodipine")).toBe(
      REASON_META.conflict,
    );
    expect(categorizeReason("Anticoagulation was never documented")).toBe(REASON_META.missing);
    expect(categorizeReason("Airway note predates today from a prior admission")).toBe(
      REASON_META.stale,
    );
    expect(categorizeReason("Please confirm fasting time")).toBe(REASON_META.clarify);
    expect(categorizeReason(null)).toBe(REASON_META.clarify);
  });
});

describe("buildBrief — adaptive patient view", () => {
  it("attaches a reason category to each need and drops dismissed questions", () => {
    const kase = CaseSchema.parse({
      case_id: "sg-live",
      label: "Whitfield — hernia",
      workflow: {
        created_by: PROVIDERS[0],
        created_at: "2026-04-02T06:00:00Z",
        stages: { preop: stage(), intraop: stage(), postop: stage() },
      },
      open_questions: [
        { question: "Confirm BP meds", reason: "record and interview disagree", review: null },
        { question: "Anticoagulation?", reason: "never documented", review: "approved" },
        { question: "Old airway note", reason: "from a prior admission", review: "dismissed" },
      ],
    });
    const brief = buildBrief(kase, PROVIDERS);

    // dismissed question is kept in the record but not shown as "needs you now"
    expect(brief.needs).toHaveLength(2);
    expect(brief.needs[0].reason.key).toBe("conflict");
    expect(brief.needs[1].reason.key).toBe("missing");
    // one still unreviewed
    expect(brief.pendingReview).toBe(1);
  });

  it("resolves the primary action to sign-off for a generated, unsigned pre-op case", () => {
    const kase = CaseSchema.parse({
      case_id: "sg-preop",
      label: "Nowak — hip",
      workflow: {
        created_by: PROVIDERS[0],
        created_at: "2026-04-02T06:00:00Z",
        stages: {
          preop: stage({
            status: "awaiting_review",
            performed_by: "p-lim",
            questions_approved_at: "2026-04-02T06:30:00Z",
            inputs_recorded_at: "2026-04-02T06:45:00Z",
          }),
          intraop: stage(),
          postop: stage(),
        },
      },
      sources: [
        { source_id: "doc:op-plan", type: "document", chunks: [] },
        { source_id: "doc:gp-summary", type: "document", chunks: [] },
      ],
      artifacts: [{ artifact_id: "note:pre-anesthesia-eval", claims: [] }],
    });
    const brief = buildBrief(kase, PROVIDERS);

    expect(brief.action?.kind).toBe("sign-off");
    expect(brief.action?.stage).toBe("preop");
    // pre-op case has not left theatre → timeline renders as a placeholder
    expect(brief.reachedTheatre).toBe(false);
    expect(brief.writable).toBe(true);
    // the brief header stepper mirrors FlowChrome's stage progress
    expect(brief.stageSteps.map((s) => [s.key, s.state])).toEqual([
      ["preop", "current"],
      ["intraop", "todo"],
      ["postop", "todo"],
    ]);
  });

  it("resolves acknowledge-handoff for a recovery case with an un-acknowledged handoff", () => {
    const kase = CaseSchema.parse({
      case_id: "sg-postop",
      label: "Whitfield — hernia",
      workflow: {
        created_by: PROVIDERS[0],
        created_at: "2026-04-02T06:00:00Z",
        stages: {
          preop: signedStage("p-lim"),
          intraop: signedStage("p-tan"),
          postop: stage({
            status: "awaiting_review",
            performed_by: "p-tan",
            inputs_recorded_at: "2026-04-02T10:00:00Z",
          }),
        },
      },
      artifacts: [{ artifact_id: "note:pacu-handoff", claims: [] }],
    });
    const brief = buildBrief(kase, PROVIDERS);

    expect(brief.action?.kind).toBe("acknowledge-handoff");
    // "taking over from" names the last provider who signed off
    expect(brief.handedFrom).toBe("Dr B. Tan");
  });

  it("has no action for a read-only demo case (no workflow)", () => {
    const kase = CaseSchema.parse({
      case_id: "sg-demo",
      artifacts: [{ artifact_id: "note:pacu-handoff", claims: [] }],
    });
    const brief = buildBrief(kase, PROVIDERS);
    expect(brief.action).toBeNull();
    expect(brief.writable).toBe(false);
  });
});
