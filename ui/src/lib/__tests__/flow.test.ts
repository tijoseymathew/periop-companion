import { describe, expect, it } from "vitest";
import { CaseSchema, type Case } from "../schema";
import {
  audioSource,
  flowScreen,
  hasPreopRecords,
  subLabel,
  subPills,
  transcriptionBusy,
  transcriptionState,
} from "../flow";
import { makeCase } from "../../test/fixtures";

const PROVIDER = { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" };

function liveCase(patch: (c: Case) => void = () => {}): Case {
  const base = CaseSchema.parse({
    case_id: "sg-live",
    label: "Nowak — hip",
    workflow: {
      created_by: PROVIDER,
      created_at: "2026-04-02T06:00:00Z",
      stages: {
        preop: { status: "awaiting_inputs" },
        intraop: { status: "awaiting_inputs" },
        postop: { status: "awaiting_inputs" },
      },
    },
  });
  patch(base);
  return base;
}

function withPreopRecords(c: Case) {
  c.sources.push(
    { source_id: "doc:op-plan", type: "document", chunks: [], segments: [] },
    { source_id: "doc:gp-summary", type: "document", chunks: [], segments: [] },
  );
}

describe("flowScreen", () => {
  it("lands a fresh case on the records screen", () => {
    expect(flowScreen(null)).toBe("records");
    expect(flowScreen(liveCase())).toBe("records");
  });

  it("shows the intake build while question prep runs", () => {
    const c = liveCase((k) => {
      withPreopRecords(k);
      k.workflow!.stages.preop.gap_analysis = "running";
    });
    expect(flowScreen(c)).toBe("intake-generating");
  });

  it("moves to the interview once the records and questions exist", () => {
    const c = liveCase((k) => {
      withPreopRecords(k);
      k.workflow!.stages.preop.gap_analysis = "complete";
    });
    expect(flowScreen(c)).toBe("interview");
  });

  it("hands over to the brief once the stage artifact exists", () => {
    const c = liveCase((k) => {
      withPreopRecords(k);
      k.artifacts.push({ artifact_id: "note:pre-anesthesia-eval", claims: [] });
    });
    expect(flowScreen(c)).toBe("brief");
  });

  it("routes an intra-op case to the capture screen until its record exists", () => {
    const c = liveCase((k) => {
      k.workflow!.stages.preop.status = "signed_off";
    });
    expect(flowScreen(c)).toBe("capture");
    c.artifacts.push({ artifact_id: "record:intra-op", claims: [] });
    expect(flowScreen(c)).toBe("brief");
  });

  it("sends demo (read-only) cases straight to the brief", () => {
    expect(flowScreen(makeCase())).toBe("brief");
  });
});

describe("records gate & transcript selectors", () => {
  it("needs the op plan plus one more record", () => {
    const c = liveCase();
    expect(hasPreopRecords(c)).toBe(false);
    c.sources.push({ source_id: "doc:op-plan", type: "document", chunks: [], segments: [] });
    expect(hasPreopRecords(c)).toBe(false);
    c.sources.push({ source_id: "doc:gp-summary", type: "document", chunks: [], segments: [] });
    expect(hasPreopRecords(c)).toBe(true);
  });

  it("reads the stage's transcription lifecycle and audio source", () => {
    const c = liveCase((k) => {
      k.workflow!.stages.preop.transcription = "running";
    });
    expect(transcriptionState(c, "preop")).toBe("running");
    expect(transcriptionBusy(c, "preop")).toBe(true);
    expect(audioSource(c, "preop")).toBeNull();
    c.sources.push({
      source_id: "audio:preop-interview",
      type: "audio",
      chunks: [],
      segments: [{ seg_id: "s001", t0: 0, t1: 2, speaker: "PATIENT", text: "hi" }],
    });
    c.workflow!.stages.preop.transcription = "complete";
    expect(transcriptionBusy(c, "preop")).toBe(false);
    expect(audioSource(c, "preop")?.segments).toHaveLength(1);
  });
});

describe("sub-stage pills", () => {
  it("marks progress through the pre-op steps", () => {
    expect(subPills("preop", "records").map((p) => p.state)).toEqual([
      "current",
      "todo",
      "todo",
    ]);
    expect(subPills("preop", "interview").map((p) => p.state)).toEqual([
      "done",
      "current",
      "todo",
    ]);
    expect(subPills("preop", "brief").map((p) => p.state)).toEqual([
      "done",
      "done",
      "current",
    ]);
  });

  it("treats the intake build as sitting on the interview step", () => {
    expect(subPills("preop", "intake-generating").map((p) => p.state)).toEqual([
      "done",
      "current",
      "todo",
    ]);
    expect(subLabel("preop", "intake-generating")).toBe("Building the intake");
  });

  it("gives capture stages their own two steps", () => {
    expect(subPills("intraop", "capture").map((p) => p.label)).toEqual([
      "Voice memo",
      "Theatre record",
    ]);
    expect(subLabel("postop", "capture")).toBe("Post-op interview");
  });
});
