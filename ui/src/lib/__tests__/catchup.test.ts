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

  it("links story-so-far items to their claims and keeps human-attested ones", () => {
    const kase = CaseSchema.parse({
      case_id: "sg-story",
      label: "Whitfield — hernia",
      workflow: {
        created_by: PROVIDERS[0],
        created_at: "2026-04-02T06:00:00Z",
        stages: {
          preop: stage({ status: "awaiting_review", performed_by: "p-lim" }),
          intraop: stage(),
          postop: stage(),
        },
      },
      artifacts: [
        {
          artifact_id: "note:pre-anesthesia-eval",
          claims: [
            {
              claim_id: "c-001",
              text: "Records list aspirin as current.",
              provenance: ["doc:gp-summary#c1"],
              status: "conflicting",
            },
            // edited by a provider: supported now, but must stay in the story
            {
              claim_id: "c-002",
              text: "Aspirin was stopped last Tuesday (confirmed with patient).",
              provenance: ["doc:gp-summary#c1", "edit:p-lim#c1"],
              status: "supported",
            },
            // machine-supported and untouched — key facts only, not the story
            {
              claim_id: "c-003",
              text: "Diabetes is diet controlled.",
              provenance: ["doc:gp-summary#c2"],
              status: "supported",
            },
          ],
        },
      ],
      open_questions: [{ question: "Confirm fasting time", reason: null, review: null }],
    });
    const brief = buildBrief(kase, PROVIDERS);

    expect(brief.attentionItems).toEqual([
      { text: "Records list aspirin as current.", claimId: "c-001" },
      {
        text: "Aspirin was stopped last Tuesday (confirmed with patient).",
        claimId: "c-002",
      },
      { text: "Confirm fasting time", claimId: null },
    ]);
  });

  it("reads anticipated issues from the artifact's claims, falling back to the strings", () => {
    const withArtifact = CaseSchema.parse({
      case_id: "sg-a",
      anticipated_issues: ["Stale mirror text"],
      artifacts: [
        {
          artifact_id: "note:anticipated-issues",
          claims: [{ claim_id: "c-020", text: "Elevated PONV risk post-op." }],
        },
      ],
    });
    expect(buildBrief(withArtifact, PROVIDERS).issues).toEqual([
      { text: "Elevated PONV risk post-op.", claimId: "c-020" },
    ]);
    expect(buildBrief(withArtifact, PROVIDERS).issuesArtifact).toBe("note:anticipated-issues");

    const stringsOnly = CaseSchema.parse({
      case_id: "sg-b",
      anticipated_issues: ["Watch for PONV"],
    });
    expect(buildBrief(stringsOnly, PROVIDERS).issues).toEqual([
      { text: "Watch for PONV", claimId: null },
    ]);
    expect(buildBrief(stringsOnly, PROVIDERS).issuesArtifact).toBeNull();
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

  it("keys the facts to the displayed stage — theatre reads the pre-op note, recovery the handoff", () => {
    const artifacts = [
      {
        artifact_id: "note:pre-anesthesia-eval",
        claims: [{ claim_id: "p1", text: "Pre-op fact." }],
      },
      {
        artifact_id: "note:pacu-handoff",
        claims: [{ claim_id: "h1", text: "Handoff fact." }],
      },
    ];
    const inTheatre = CaseSchema.parse({
      case_id: "sg-theatre",
      workflow: {
        created_by: PROVIDERS[0],
        created_at: "2026-04-02T06:00:00Z",
        stages: { preop: signedStage("p-lim"), intraop: stage(), postop: stage() },
      },
      artifacts,
    });
    const theatreBrief = buildBrief(inTheatre, PROVIDERS);
    expect(theatreBrief.stage).toBe("intraop");
    expect(theatreBrief.keyFactsSource).toBe("note:pre-anesthesia-eval");
    expect(theatreBrief.keyFacts.map((f) => f.text)).toEqual(["Pre-op fact."]);

    const inRecovery = CaseSchema.parse({
      case_id: "sg-recovery",
      workflow: {
        created_by: PROVIDERS[0],
        created_at: "2026-04-02T06:00:00Z",
        stages: {
          preop: signedStage("p-lim"),
          intraop: signedStage("p-tan"),
          postop: stage({ status: "awaiting_review" }),
        },
      },
      artifacts,
    });
    const recoveryBrief = buildBrief(inRecovery, PROVIDERS);
    expect(recoveryBrief.stage).toBe("postop");
    expect(recoveryBrief.keyFactsSource).toBe("note:pacu-handoff");
    expect(recoveryBrief.keyFacts.map((f) => f.text)).toEqual(["Handoff fact."]);
  });

  it("pins the brief to a completed stage on request, withholding the forward action", () => {
    const kase = CaseSchema.parse({
      case_id: "sg-pin",
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
      artifacts: [
        {
          artifact_id: "note:pre-anesthesia-eval",
          claims: [{ claim_id: "p1", text: "Pre-op fact." }],
        },
        { artifact_id: "note:pacu-handoff", claims: [] },
      ],
    });
    const live = buildBrief(kase, PROVIDERS);
    expect(live.stage).toBe("postop");
    expect(live.viewingPast).toBe(false);
    expect(live.action?.kind).toBe("acknowledge-handoff");

    const pinned = buildBrief(kase, PROVIDERS, { stage: "preop" });
    expect(pinned.stage).toBe("preop");
    expect(pinned.viewingPast).toBe(true);
    expect(pinned.action).toBeNull();
    expect(pinned.keyFacts.map((f) => f.text)).toEqual(["Pre-op fact."]);
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
