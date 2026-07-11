import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CaseSchema, type Case } from "../../lib/schema";
import { InterviewScreen } from "../flow/InterviewScreen";

const PROVIDER = { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" };

function interviewCase(patch: (c: Case) => void = () => {}): Case {
  const c = CaseSchema.parse({
    case_id: "sg-w",
    label: "Whitfield — hernia",
    workflow: {
      created_by: PROVIDER,
      created_at: "2026-07-01T06:00:00Z",
      stages: {
        preop: { status: "awaiting_inputs", gap_analysis: "complete" },
        intraop: { status: "awaiting_inputs" },
        postop: { status: "awaiting_inputs" },
      },
    },
    sources: [
      { source_id: "doc:op-plan", type: "document", chunks: [] },
      { source_id: "doc:gp-summary", type: "document", chunks: [] },
    ],
    open_questions: [
      {
        question: "Is the patient still taking aspirin?",
        reason: "The list conflicts with the interview.",
        provenance: [],
        review: null,
        edited_text: null,
      },
      {
        question: "Any anticoagulants?",
        reason: "not documented anywhere",
        provenance: [],
        review: null,
        edited_text: null,
      },
    ],
  });
  patch(c);
  return c;
}

function renderScreen(kase: Case) {
  const props = {
    onApproveQuestions: vi.fn(),
    onUploadAudio: vi.fn(),
    onGenerate: vi.fn(),
  };
  render(
    <InterviewScreen kase={kase} busy={false} notice={null} canWrite {...props} />,
  );
  return props;
}

describe("InterviewScreen", () => {
  it("hides Generate while questions are still under review — Approve is the one green action", () => {
    renderScreen(interviewCase());
    expect(screen.queryByRole("button", { name: /Generate pre-op brief/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve questions/ })).toBeEnabled();
  });

  it("submits the reviewed list, honouring a dismiss", async () => {
    const props = renderScreen(interviewCase());
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[1]);
    await userEvent.click(screen.getByRole("button", { name: /Approve questions/ }));
    const submitted = props.onApproveQuestions.mock.calls[0][0];
    expect(submitted.map((q: { review: string }) => q.review)).toEqual([
      "approved",
      "dismissed",
    ]);
  });

  it("shows approved questions as the ask-list and hides dismissed ones", () => {
    renderScreen(
      interviewCase((c) => {
        c.workflow!.stages.preop.questions_approved_at = "2026-07-01T07:00:00Z";
        c.open_questions[0].review = "approved";
        c.open_questions[1].review = "dismissed";
      }),
    );
    expect(screen.getByText("Ask during the interview")).toBeInTheDocument();
    expect(screen.getByText("Is the patient still taking aspirin?")).toBeInTheDocument();
    expect(screen.queryByText("Any anticoagulants?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve questions/ })).not.toBeInTheDocument();
  });

  it("shows the transcribing state while the upload's ASR runs", () => {
    renderScreen(
      interviewCase((c) => {
        c.workflow!.stages.preop.questions_approved_at = "2026-07-01T07:00:00Z";
        c.workflow!.stages.preop.inputs_recorded_at = "2026-07-01T07:20:00Z";
        c.workflow!.stages.preop.transcription = "running";
      }),
    );
    expect(screen.getByText(/Transcribing/)).toBeInTheDocument();
    // mid-transcription the run gate would 409 — the button says not yet
    expect(screen.getByRole("button", { name: /Generate pre-op brief/ })).toBeDisabled();
  });

  it("shows the transcript and enables Generate once it lands", () => {
    renderScreen(
      interviewCase((c) => {
        c.workflow!.stages.preop.questions_approved_at = "2026-07-01T07:00:00Z";
        c.workflow!.stages.preop.inputs_recorded_at = "2026-07-01T07:20:00Z";
        c.workflow!.stages.preop.transcription = "complete";
        c.sources.push({
          source_id: "audio:preop-interview",
          type: "audio",
          chunks: [],
          segments: [
            {
              seg_id: "s001",
              t0: 64,
              t1: 70,
              speaker: "PATIENT",
              text: "I stopped the amlodipine about six months ago.",
            },
          ],
        });
      }),
    );
    expect(screen.getByText("✓ transcribed")).toBeInTheDocument();
    expect(
      screen.getByText("I stopped the amlodipine about six months ago."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate pre-op brief/ })).toBeEnabled();
  });
});
