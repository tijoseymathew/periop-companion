/**
 * Worklist status derivation + the one-primary-action state machine
 * (spec v2 §6.1, §6.8). Every lifecycle state maps to exactly one primary
 * action — a provider who only ever presses the big button completes the
 * whole workflow.
 */
import { describe, expect, it } from "vitest";
import { CaseSchema, type Case, type Workflow } from "../schema";
import {
  filterWorklist,
  headline,
  headlineStage,
  primaryAction,
  STATUS_WORDS,
} from "../workflow";
import { makeSummary } from "../../test/fixtures";

function makeWorkflow(overrides: Partial<Record<string, object>> = {}): Workflow {
  const stage = (extra: object = {}) => ({
    status: "awaiting_inputs",
    performed_by: null,
    signed_off_by: null,
    signed_off_at: null,
    questions_approved_at: null,
    inputs_recorded_at: null,
    handoff_acknowledged_by: null,
    handoff_acknowledged_at: null,
    reopens: [],
    ...extra,
  });
  return {
    created_by: { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
    created_at: "2026-07-06T09:12:00+08:00",
    stages: {
      preop: stage(overrides.preop),
      intraop: stage(overrides.intraop),
      postop: stage(overrides.postop),
    },
  } as Workflow;
}

function liveCase(partial: Record<string, unknown> = {}, wf: Workflow = makeWorkflow()): Case {
  return CaseSchema.parse({
    case_id: "tkr-mrs-w",
    label: "TKR Mrs W",
    workflow: wf,
    sources: [],
    artifacts: [],
    open_questions: [],
    ...partial,
  });
}

const DOCS = [
  { source_id: "doc:gp-summary", type: "document", chunks: [{ chunk_id: "c001", text: "x" }] },
  { source_id: "doc:op-plan", type: "document", chunks: [{ chunk_id: "c001", text: "y" }] },
];

describe("headline", () => {
  it("names the first non-signed-off stage in words", () => {
    const wf = makeWorkflow({
      preop: { status: "signed_off" },
      intraop: { status: "awaiting_review" },
    });
    expect(headlineStage(wf)).toBe("intraop");
    expect(headline(wf)).toBe("Intra-op — awaiting review");
  });

  it("reads Complete when everything is signed off", () => {
    const wf = makeWorkflow({
      preop: { status: "signed_off" },
      intraop: { status: "signed_off" },
      postop: { status: "signed_off" },
    });
    expect(headlineStage(wf)).toBeNull();
    expect(headline(wf)).toBe("Complete");
  });

  it("reads Review only for demo cases", () => {
    expect(headline(null)).toBe("Review only");
  });

  it("has plain words for every status", () => {
    expect(STATUS_WORDS.awaiting_inputs).toBe("awaiting inputs");
    expect(STATUS_WORDS.ready_to_generate).toBe("ready to generate");
  });
});

describe("primaryAction — exactly one per lifecycle state", () => {
  it("demo cases have none (read-only)", () => {
    expect(primaryAction(CaseSchema.parse({ case_id: "sg-demo" }))).toBeNull();
  });

  it("fresh case: add records", () => {
    expect(primaryAction(liveCase())?.kind).toBe("add-records");
  });

  it("records without op plan: still add records", () => {
    const kase = liveCase({ sources: [DOCS[0]] });
    expect(primaryAction(kase)?.kind).toBe("add-records");
  });

  it("docs present, questions unapproved: review questions", () => {
    const kase = liveCase({
      sources: DOCS,
      open_questions: [{ question: "Q?", reason: "missing", provenance: [], review: null, edited_text: null }],
    });
    expect(primaryAction(kase)?.kind).toBe("review-questions");
  });

  it("questions approved, no interview: record interview", () => {
    const kase = liveCase(
      { sources: DOCS },
      makeWorkflow({ preop: { questions_approved_at: "2026-07-06T10:00:00Z" } }),
    );
    expect(primaryAction(kase)?.kind).toBe("record-interview");
  });

  it("interview recorded: generate the pre-op note", () => {
    const kase = liveCase(
      { sources: DOCS },
      makeWorkflow({
        preop: {
          status: "ready_to_generate",
          questions_approved_at: "2026-07-06T10:00:00Z",
          inputs_recorded_at: "2026-07-06T10:20:00Z",
        },
      }),
    );
    const action = primaryAction(kase);
    expect(action?.kind).toBe("generate");
    expect(action?.stage).toBe("preop");
    expect(action?.label).toBe("Generate pre-op note");
  });

  it("generating: no button, progress state", () => {
    const kase = liveCase(
      { sources: DOCS },
      makeWorkflow({
        preop: {
          status: "generating",
          questions_approved_at: "2026-07-06T10:00:00Z",
          inputs_recorded_at: "2026-07-06T10:20:00Z",
        },
      }),
    );
    expect(primaryAction(kase)?.kind).toBe("generating");
  });

  it("note generated: sign off", () => {
    const kase = liveCase(
      {
        sources: DOCS,
        artifacts: [{ artifact_id: "note:pre-anesthesia-eval", claims: [] }],
      },
      makeWorkflow({
        preop: {
          status: "awaiting_review",
          questions_approved_at: "2026-07-06T10:00:00Z",
          inputs_recorded_at: "2026-07-06T10:20:00Z",
        },
      }),
    );
    const action = primaryAction(kase);
    expect(action?.kind).toBe("sign-off");
    expect(action?.stage).toBe("preop");
  });

  it("preop signed off: record a voice memo", () => {
    const kase = liveCase(
      { sources: DOCS, artifacts: [{ artifact_id: "note:pre-anesthesia-eval", claims: [] }] },
      makeWorkflow({ preop: { status: "signed_off" } }),
    );
    const action = primaryAction(kase);
    expect(action?.kind).toBe("record-memo");
    expect(action?.stage).toBe("intraop");
  });

  it("memos recorded: generate the intra-op record", () => {
    const kase = liveCase(
      { sources: DOCS, artifacts: [{ artifact_id: "note:pre-anesthesia-eval", claims: [] }] },
      makeWorkflow({
        preop: { status: "signed_off" },
        intraop: { status: "ready_to_generate", inputs_recorded_at: "2026-07-06T12:00:00Z" },
      }),
    );
    expect(primaryAction(kase)?.label).toBe("Generate intra-op record");
  });

  it("intraop signed off: record the post-op interview", () => {
    const kase = liveCase(
      { sources: DOCS },
      makeWorkflow({
        preop: { status: "signed_off" },
        intraop: { status: "signed_off" },
      }),
    );
    const action = primaryAction(kase);
    expect(action?.kind).toBe("record-interview");
    expect(action?.stage).toBe("postop");
  });

  it("postop generated: acknowledge the handoff before sign-off", () => {
    const kase = liveCase(
      { sources: DOCS, artifacts: [{ artifact_id: "note:pacu-handoff", claims: [] }] },
      makeWorkflow({
        preop: { status: "signed_off" },
        intraop: { status: "signed_off" },
        postop: { status: "awaiting_review", inputs_recorded_at: "2026-07-06T14:00:00Z" },
      }),
    );
    expect(primaryAction(kase)?.kind).toBe("acknowledge-handoff");
  });

  it("handoff acknowledged: sign off post-op", () => {
    const kase = liveCase(
      { sources: DOCS, artifacts: [{ artifact_id: "note:pacu-handoff", claims: [] }] },
      makeWorkflow({
        preop: { status: "signed_off" },
        intraop: { status: "signed_off" },
        postop: {
          status: "awaiting_review",
          inputs_recorded_at: "2026-07-06T14:00:00Z",
          handoff_acknowledged_by: "p-rahman",
        },
      }),
    );
    expect(primaryAction(kase)?.kind).toBe("sign-off");
  });

  it("everything signed off and acknowledged: case complete, no action", () => {
    const kase = liveCase(
      { sources: DOCS, artifacts: [{ artifact_id: "note:pacu-handoff", claims: [] }] },
      makeWorkflow({
        preop: { status: "signed_off" },
        intraop: { status: "signed_off" },
        postop: { status: "signed_off", handoff_acknowledged_by: "p-rahman" },
      }),
    );
    expect(primaryAction(kase)).toBeNull();
  });
});

describe("filterWorklist", () => {
  const rows = [
    makeSummary({ case_id: "demo-1" }),
    makeSummary({
      case_id: "live-preop",
      workflow: makeWorkflow({ preop: { status: "awaiting_review" } }),
    }),
    makeSummary({
      case_id: "live-intraop",
      workflow: makeWorkflow({
        preop: { status: "signed_off" },
        intraop: { status: "ready_to_generate" },
      }),
    }),
  ];

  it("no filters keeps everything", () => {
    expect(filterWorklist(rows, { stage: "all", status: "all" })).toHaveLength(3);
  });

  it("stage filter keeps cases whose headline stage matches", () => {
    const kept = filterWorklist(rows, { stage: "intraop", status: "all" });
    expect(kept.map((r) => r.case_id)).toEqual(["live-intraop"]);
  });

  it("status filter matches the headline status", () => {
    const kept = filterWorklist(rows, { stage: "all", status: "awaiting_review" });
    expect(kept.map((r) => r.case_id)).toEqual(["live-preop"]);
  });
});
