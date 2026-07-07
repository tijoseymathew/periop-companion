/**
 * StagePanel question-prep states (spec v2-speed §3.2): while the background
 * gap analysis runs, the review-questions screen narrates the wait and polls
 * the case; a failure names the error and offers an explicit retry.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseSchema, type Case } from "../../lib/schema";
import type { PrimaryAction } from "../../lib/workflow";
import { StagePanel } from "../StagePanel";

vi.mock("../../lib/api", () => ({
  addDocumentText: vi.fn(),
  analyzeQuestions: vi.fn(),
  fetchCase: vi.fn(),
  reviewQuestions: vi.fn(),
  uploadAudio: vi.fn(),
  uploadDocumentFile: vi.fn(),
}));

import { analyzeQuestions, fetchCase } from "../../lib/api";

function intakeCase(gapAnalysis: string | null, error: string | null = null): Case {
  return CaseSchema.parse({
    case_id: "tkr-mrs-w",
    label: "TKR Mrs W",
    sources: [
      { source_id: "doc:gp-summary", type: "document", chunks: [{ chunk_id: "c001", text: "Aspirin." }] },
      { source_id: "doc:op-plan", type: "document", chunks: [{ chunk_id: "c001", text: "Lap chole." }] },
    ],
    workflow: {
      created_by: { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
      created_at: "2026-07-08T00:00:00Z",
      stages: {
        preop: { status: "awaiting_inputs", gap_analysis: gapAnalysis, gap_analysis_error: error },
        intraop: { status: "awaiting_inputs" },
        postop: { status: "awaiting_inputs" },
      },
    },
  });
}

const reviewAction: PrimaryAction = {
  kind: "review-questions",
  stage: "preop",
  label: "Review questions",
};

function renderPanel(kase: Case, onCaseUpdated = vi.fn()) {
  render(
    <StagePanel
      kase={kase}
      me="p-lim"
      stage="preop"
      action={reviewAction}
      onCaseUpdated={onCaseUpdated}
      onActivateRef={vi.fn()}
    />,
  );
  return onCaseUpdated;
}

describe("StagePanel question prep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("narrates the wait and polls the case while questions are prepared", async () => {
    const fresh = intakeCase("complete");
    vi.mocked(fetchCase).mockResolvedValue(fresh);
    const onCaseUpdated = renderPanel(intakeCase("running"));

    expect(screen.getByText(/preparing interview questions/i)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fetchCase).toHaveBeenCalledWith("tkr-mrs-w");
    expect(onCaseUpdated).toHaveBeenCalledWith(fresh);
  });

  it("failure names the error, keeps the documents, and offers a retry", async () => {
    vi.useRealTimers();
    const relaunched = intakeCase("pending");
    vi.mocked(analyzeQuestions).mockResolvedValue(relaunched);
    const onCaseUpdated = renderPanel(intakeCase("failed", "model unreachable"));

    expect(screen.getByText(/model unreachable/)).toBeInTheDocument();
    expect(screen.getByText(/nothing was lost/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(analyzeQuestions).toHaveBeenCalledWith("tkr-mrs-w");
    await waitFor(() => expect(onCaseUpdated).toHaveBeenCalledWith(relaunched));
  });

  it("does not poll once the analysis has failed", async () => {
    renderPanel(intakeCase("failed", "model unreachable"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchCase).not.toHaveBeenCalled();
  });
});
