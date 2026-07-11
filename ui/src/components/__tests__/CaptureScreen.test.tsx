import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaseSchema, type Case } from "../../lib/schema";
import type { RunEvent } from "../../lib/sse";
import { CaptureScreen } from "../flow/CaptureScreen";

const PROVIDER = { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" };

/** A post-op case whose interview has been transcribed. */
function postopCase(): Case {
  return CaseSchema.parse({
    case_id: "sg-p",
    label: "Whitfield — hernia",
    workflow: {
      created_by: PROVIDER,
      created_at: "2026-07-01T06:00:00Z",
      stages: {
        preop: { status: "signed_off" },
        intraop: { status: "signed_off" },
        postop: {
          status: "ready_to_generate",
          inputs_recorded_at: "2026-07-01T11:00:00Z",
          transcription: "complete",
        },
      },
    },
    sources: [
      {
        source_id: "audio:postop-interview",
        type: "audio",
        segments: [
          { seg_id: "s001", t0: 3, t1: 9, speaker: "PATIENT", text: "Pain is about a four." },
        ],
      },
    ],
  });
}

function renderScreen(liveEvents: RunEvent[] = []) {
  render(
    <CaptureScreen
      stage="postop"
      kase={postopCase()}
      busy={false}
      notice={null}
      canWrite
      liveEvents={liveEvents}
      onUploadAudio={vi.fn()}
      onGenerate={vi.fn()}
    />,
  );
}

describe("CaptureScreen — post-op live columns", () => {
  it("keeps the resting rail when no run is streaming", () => {
    renderScreen();
    expect(screen.getByText("Interview captured")).toBeInTheDocument();
    expect(screen.queryByText("Post-anaesthesia evaluation")).not.toBeInTheDocument();
  });

  it("shows the two writers as columns beside the transcript while the run streams", () => {
    renderScreen([
      { event: "stage_start", data: { stage: "postop" } },
      { event: "agent_start", data: { stage: "postop", agent: "PostAnesthesiaEvaluator" } },
      { event: "agent_start", data: { stage: "postop", agent: "HandoffComposer" } },
      {
        event: "agent_end",
        data: {
          stage: "postop",
          agent: "HandoffComposer",
          summary: "5 claims",
          preview: ["Aspirin held pre-op."],
        },
      },
    ]);
    // the transcript stays put
    expect(screen.getByText("Pain is about a four.")).toBeInTheDocument();
    // the composer's finished result reads in its column; the evaluator is
    // still drafting; the resting rail yields to the columns
    expect(screen.getByText("PACU handoff")).toBeInTheDocument();
    expect(screen.getByText("Aspirin held pre-op.")).toBeInTheDocument();
    expect(screen.getByText("Post-anaesthesia evaluation")).toBeInTheDocument();
    expect(screen.getByText("Drafting…")).toBeInTheDocument();
    expect(screen.queryByText("Interview captured")).not.toBeInTheDocument();
  });
});
