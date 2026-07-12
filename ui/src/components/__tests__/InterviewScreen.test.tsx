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

function renderScreen(kase: Case, extra: { genFailed?: boolean } = {}) {
  const props = {
    onUploadAudio: vi.fn(),
    onGenerate: vi.fn(),
    onOpenSource: vi.fn(),
  };
  render(
    <InterviewScreen kase={kase} busy={false} notice={null} canWrite {...extra} {...props} />,
  );
  return props;
}

function uploadRecording() {
  const input = document.querySelector('input[type="file"][accept*="audio"]') as HTMLInputElement;
  return userEvent.upload(input, new File(["riff"], "interview.wav", { type: "audio/wav" }));
}

describe("InterviewScreen", () => {
  it("has no approve gate — the recording can be added while the review is open", () => {
    renderScreen(interviewCase());
    expect(screen.queryByRole("button", { name: /Generate pre-op brief/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve questions/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
  });

  it("waits while question prep runs — no review list, recording held", () => {
    renderScreen(
      interviewCase((c) => {
        c.workflow!.stages.preop.gap_analysis = "running";
        c.open_questions = [];
      }),
    );
    expect(screen.getByText("Preparing the questions")).toBeInTheDocument();
    expect(screen.getByText(/Reading the records for gaps and conflicts/)).toBeInTheDocument();
    // no premature "nothing needed clarifying", no gate-passing upload
    expect(screen.queryByText(/record the interview when you're ready/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  });

  it("submits the reviewed list with the upload, honouring a dismiss", async () => {
    const props = renderScreen(interviewCase());
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[1]);
    await uploadRecording();
    const [, reviewed] = props.onUploadAudio.mock.calls[0];
    expect(reviewed.map((q: { review: string }) => q.review)).toEqual([
      "approved",
      "dismissed",
    ]);
  });

  it("lets the provider add their own questions, carried on the upload", async () => {
    const props = renderScreen(interviewCase());
    await userEvent.type(
      screen.getByPlaceholderText("Add your own question…"),
      "Any loose teeth or dental work?{Enter}",
    );
    expect(screen.getByText("Any loose teeth or dental work?")).toBeInTheDocument();
    await uploadRecording();
    const [, reviewed] = props.onUploadAudio.mock.calls[0];
    expect(reviewed).toHaveLength(3);
    expect(reviewed[2]).toMatchObject({
      question: "Any loose teeth or dental work?",
      review: "approved",
    });
  });

  it("drops a removed added question from the reviewed list", async () => {
    const props = renderScreen(interviewCase());
    await userEvent.type(
      screen.getByPlaceholderText("Add your own question…"),
      "Scratch this one{Enter}",
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Scratch this one" }));
    expect(screen.queryByText("Scratch this one")).not.toBeInTheDocument();
    await uploadRecording();
    const [, reviewed] = props.onUploadAudio.mock.calls[0];
    expect(reviewed).toHaveLength(2);
  });

  it("passes reviewed as null once the questions are already approved", async () => {
    const props = renderScreen(
      interviewCase((c) => {
        c.workflow!.stages.preop.questions_approved_at = "2026-07-01T07:00:00Z";
        c.open_questions[0].review = "approved";
        c.open_questions[1].review = "approved";
      }),
    );
    await uploadRecording();
    expect(props.onUploadAudio.mock.calls[0][1]).toBeNull();
  });

  it("cites each gap-analysis question's source, but never a provider's own", async () => {
    const props = renderScreen(
      interviewCase((c) => {
        c.open_questions[0].provenance = ["doc:gp-summary#c2", "doc:op-plan#c1"];
      }),
    );
    await userEvent.type(
      screen.getByPlaceholderText("Add your own question…"),
      "Any loose teeth or dental work?{Enter}",
    );
    // one cited question → one link; the second (no provenance) and the
    // provider's own question carry none
    const links = screen.getAllByTestId("source-link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("See sources (2)");
    await userEvent.click(links[0]);
    expect(props.onOpenSource).toHaveBeenCalledWith({
      title: "Is the patient still taking aspirin?",
      refs: ["doc:gp-summary#c2", "doc:op-plan#c1"],
    });
  });

  it("keeps the source link on the ask-list once the questions are approved", () => {
    renderScreen(
      interviewCase((c) => {
        c.workflow!.stages.preop.questions_approved_at = "2026-07-01T07:00:00Z";
        c.open_questions[0].review = "approved";
        c.open_questions[0].provenance = ["doc:gp-summary#c2"];
        c.open_questions[1].review = "dismissed";
      }),
    );
    expect(screen.getByTestId("source-link")).toHaveTextContent("See the source");
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
    // the brief will generate itself when the transcript lands — no button
    expect(
      screen.queryByRole("button", { name: /Generate pre-op brief/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the transcript with no Generate button — the brief generates itself", () => {
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
    expect(
      screen.queryByRole("button", { name: /Generate pre-op brief/ }),
    ).not.toBeInTheDocument();
  });

  it("offers a manual Generate when the upload's transcription failed", () => {
    renderScreen(
      interviewCase((c) => {
        c.workflow!.stages.preop.questions_approved_at = "2026-07-01T07:00:00Z";
        c.workflow!.stages.preop.inputs_recorded_at = "2026-07-01T07:20:00Z";
        c.workflow!.stages.preop.transcription = "failed";
      }),
    );
    expect(screen.getByRole("button", { name: /Generate pre-op brief/ })).toBeEnabled();
  });

  it("offers a manual Generate again after a failed run", async () => {
    const props = renderScreen(
      interviewCase((c) => {
        c.workflow!.stages.preop.questions_approved_at = "2026-07-01T07:00:00Z";
        c.workflow!.stages.preop.inputs_recorded_at = "2026-07-01T07:20:00Z";
        c.workflow!.stages.preop.transcription = "complete";
      }),
      { genFailed: true },
    );
    await userEvent.click(screen.getByRole("button", { name: /Generate pre-op brief/ }));
    expect(props.onGenerate).toHaveBeenCalled();
  });
});
