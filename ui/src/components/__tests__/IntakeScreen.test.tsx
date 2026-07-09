import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CaseSchema, type Case } from "../../lib/schema";
import { IntakeScreen } from "../catchup/IntakeScreen";

/** A pre-op case with two records on file and a preop stage in a given
 * gap-analysis / question-approval state. */
function caseWith(preop: Record<string, unknown>, openQuestions: unknown[] = []): Case {
  return CaseSchema.parse({
    case_id: "sg-t",
    label: "Okafor — lap chole",
    workflow: {
      created_by: { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
      created_at: "2026-04-02T06:00:00Z",
      stages: {
        preop: { status: "ready_to_generate", ...preop },
        intraop: { status: "awaiting_inputs" },
        postop: { status: "awaiting_inputs" },
      },
    },
    sources: [
      { source_id: "doc:op-plan", type: "document", chunks: [] },
      { source_id: "doc:gp-summary", type: "document", chunks: [] },
    ],
    open_questions: openQuestions,
    artifacts: [],
  });
}

function renderIntake(kase: Case, extra: Record<string, unknown> = {}) {
  const props = {
    kase,
    audioKind: "preop-interview",
    busy: false,
    notice: null,
    canWrite: true,
    onCreateCase: vi.fn(),
    onUploadDocument: vi.fn(),
    onUploadAudio: vi.fn(),
    onApproveQuestions: vi.fn(),
    onGenerate: vi.fn(),
    onBack: vi.fn(),
    ...extra,
  };
  render(<IntakeScreen {...props} />);
  return props;
}

describe("IntakeScreen — clarifying questions gate", () => {
  it("blocks Generate while question prep is still running", () => {
    renderIntake(caseWith({ gap_analysis: "running" }));
    expect(screen.getByRole("button", { name: /Generate the brief/ })).toBeDisabled();
    expect(screen.getByText(/Reading the records/)).toBeInTheDocument();
  });

  it("surfaces the questions for review and keeps Generate disabled until approved", () => {
    renderIntake(
      caseWith({ gap_analysis: "complete" }, [
        { question: "Is the patient still taking aspirin?", reason: "conflicting" },
      ]),
    );
    expect(screen.getByText("Is the patient still taking aspirin?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve questions & continue/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate the brief/ })).toBeDisabled();
  });

  it("approves the reviewed list, defaulting to 'approved' and honouring a dismiss", async () => {
    const { onApproveQuestions } = renderIntake(
      caseWith({ gap_analysis: "complete" }, [
        { question: "Still on aspirin?", reason: "conflicting" },
        { question: "Fasting confirmed?", reason: "missing" },
      ]),
    );
    // dismiss the second question, keep the first at its default
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[1]);
    await userEvent.click(screen.getByRole("button", { name: /Approve questions & continue/ }));

    expect(onApproveQuestions).toHaveBeenCalledTimes(1);
    const submitted = onApproveQuestions.mock.calls[0][0];
    expect(submitted.map((q: { review: string }) => q.review)).toEqual(["approved", "dismissed"]);
  });

  it("enables Generate once the questions are approved", () => {
    renderIntake(
      caseWith({ gap_analysis: "complete", questions_approved_at: "2026-04-02T06:30:00Z" }, [
        { question: "Is the patient still taking aspirin?", reason: "conflicting", review: "approved" },
      ]),
    );
    expect(
      screen.queryByRole("button", { name: /Approve questions & continue/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate the brief/ })).toBeEnabled();
  });
});
