/**
 * Human-in-the-loop question review (spec v2 §4.1 steps 3-4): the
 * GapAnalyst's questions with their why and triggering chunk; the provider
 * dismisses, rewords, or adds, then approves. Dismissals are kept.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OpenQuestion } from "../../lib/schema";
import { QuestionReview } from "../QuestionReview";

const QUESTIONS: OpenQuestion[] = [
  {
    question: "Is the patient still taking aspirin?",
    reason: "conflicting",
    provenance: ["doc:gp-summary#c001"],
    review: null,
    edited_text: null,
  },
  {
    question: "Any prior anaesthetic problems?",
    reason: "missing",
    provenance: ["doc:prior-anesthetic-record#c002"],
    review: null,
    edited_text: null,
  },
];

function renderReview(overrides: Partial<Parameters<typeof QuestionReview>[0]> = {}) {
  const props = {
    questions: QUESTIONS,
    onApprove: vi.fn(async () => {}),
    onActivateRef: vi.fn(),
    ...overrides,
  };
  render(<QuestionReview {...props} />);
  return props;
}

describe("QuestionReview", () => {
  it("shows each question with its why and a clickable triggering chunk", async () => {
    const props = renderReview();
    expect(screen.getByText("Is the patient still taking aspirin?")).toBeInTheDocument();
    expect(screen.getByText("conflicting")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "doc:gp-summary#c001" }));
    expect(props.onActivateRef).toHaveBeenCalledWith("doc:gp-summary#c001");
  });

  it("approve sends every untouched question as approved", async () => {
    const props = renderReview();
    await userEvent.click(screen.getByRole("button", { name: /approve questions/i }));
    expect(props.onApprove).toHaveBeenCalledWith([
      expect.objectContaining({ question: QUESTIONS[0].question, review: "approved" }),
      expect.objectContaining({ question: QUESTIONS[1].question, review: "approved" }),
    ]);
  });

  it("dismissed questions are kept in the payload, marked dismissed", async () => {
    const props = renderReview();
    await userEvent.click(screen.getAllByRole("button", { name: /dismiss/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: /approve questions/i }));
    expect(props.onApprove).toHaveBeenCalledWith([
      expect.objectContaining({ review: "dismissed" }),
      expect.objectContaining({ review: "approved" }),
    ]);
  });

  it("a dismissed question can be restored", async () => {
    renderReview();
    await userEvent.click(screen.getAllByRole("button", { name: /dismiss/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: /restore/i }));
    expect(screen.getAllByRole("button", { name: /dismiss/i })).toHaveLength(2);
  });

  it("rewording marks the question edited and keeps the original", async () => {
    const props = renderReview();
    await userEvent.click(screen.getAllByRole("button", { name: /reword/i })[0]);
    const box = screen.getByDisplayValue("Is the patient still taking aspirin?");
    await userEvent.clear(box);
    await userEvent.type(box, "When was the last aspirin dose?");
    await userEvent.click(screen.getByRole("button", { name: /done/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve questions/i }));
    expect(props.onApprove).toHaveBeenCalledWith([
      expect.objectContaining({
        question: "Is the patient still taking aspirin?",
        review: "edited",
        edited_text: "When was the last aspirin dose?",
      }),
      expect.objectContaining({ review: "approved" }),
    ]);
  });

  it("a provider can add their own question", async () => {
    const props = renderReview();
    await userEvent.type(
      screen.getByLabelText(/add a question/i),
      "Do you smoke?",
    );
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await userEvent.click(screen.getByRole("button", { name: /approve questions/i }));
    expect(props.onApprove).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ question: "Do you smoke?", review: "approved" }),
    ]);
  });
});
