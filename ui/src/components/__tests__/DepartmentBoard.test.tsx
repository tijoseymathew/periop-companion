/**
 * Department dashboard (v2 §2 stretch): many lists running in parallel, one
 * screen answering "where is every case, and what needs a reviewer". Derived
 * client-side from the case summaries; rows navigate to the case.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeSummary } from "../../test/fixtures";
import type { Workflow } from "../../lib/schema";
import { DepartmentBoard } from "../DepartmentBoard";

function wf(stages: Partial<Record<string, object>>): Workflow {
  const stage = (extra: object = {}) => ({
    status: "awaiting_inputs",
    performed_by: null,
    signed_off_by: null,
    signed_off_at: null,
    questions_approved_at: null,
    gap_analysis: null,
    gap_analysis_error: null,
    inputs_recorded_at: null,
    handoff_acknowledged_by: null,
    handoff_acknowledged_at: null,
    reopens: [],
    ...extra,
  });
  return {
    created_by: { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
    created_at: "2026-07-06T09:00:00Z",
    stages: {
      preop: stage(stages.preop),
      intraop: stage(stages.intraop),
      postop: stage(stages.postop),
    },
  } as Workflow;
}

const PROVIDERS = [
  { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
  { provider_id: "p-tan", name: "Dr B. Tan", role: "registrar" },
];

const CASES = [
  makeSummary({ case_id: "sg-demo" }),
  makeSummary({
    case_id: "tkr-mrs-w",
    label: "TKR Mrs W",
    workflow: wf({ preop: { status: "awaiting_review", performed_by: "p-tan" } }),
    status_counts: { conflicting: 1 },
  }),
  makeSummary({
    case_id: "chole-mr-k",
    label: "Chole Mr K",
    workflow: wf({
      preop: { status: "signed_off" },
      intraop: { status: "ready_to_generate" },
    }),
    status_counts: {},
  }),
];

function renderBoard(overrides: Partial<Parameters<typeof DepartmentBoard>[0]> = {}) {
  const props = { cases: CASES, providers: PROVIDERS, onSelect: vi.fn(), ...overrides };
  render(<DepartmentBoard {...props} />);
  return props;
}

describe("DepartmentBoard", () => {
  it("shows one column per stage with counts and statuses in words", () => {
    renderBoard();
    expect(screen.getByRole("heading", { name: /pre-op/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /intra-op/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /post-op/i })).toBeInTheDocument();
    expect(screen.getByText(/1 awaiting review/i)).toBeInTheDocument();
    expect(screen.getByText(/1 ready to generate/i)).toBeInTheDocument();
  });

  it("the needs-review queue names the case, stage, and who generated", () => {
    renderBoard();
    const row = screen.getByRole("button", { name: /TKR Mrs W/ });
    expect(row).toHaveTextContent(/pre-op/i);
    expect(row).toHaveTextContent(/Dr B\. Tan/);
  });

  it("queue rows navigate to the case", async () => {
    const props = renderBoard();
    await userEvent.click(screen.getByRole("button", { name: /TKR Mrs W/ }));
    expect(props.onSelect).toHaveBeenCalledWith("tkr-mrs-w");
  });

  it("says when nothing awaits review", () => {
    renderBoard({ cases: [CASES[0], CASES[2]] });
    expect(screen.getByText(/nothing is waiting for review/i)).toBeInTheDocument();
  });

  it("counts outstanding conflicts across live cases", () => {
    renderBoard();
    expect(screen.getByText(/1 conflicting claim across live cases/i)).toBeInTheDocument();
  });
});
