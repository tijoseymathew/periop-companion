/**
 * Worklist (spec v2 §6.8): each row answers "what needs me" — label, stage +
 * status in words, who performed the last stage, conflict indicator. Filters
 * by stage and status. Demo cases stay listed, marked review-only.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeSummary } from "../../test/fixtures";
import type { Workflow } from "../../lib/schema";
import { defaultFilters } from "../../lib/filters";
import { Worklist } from "../Worklist";

const PROVIDERS = [
  { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
  { provider_id: "p-tan", name: "Dr B. Tan", role: "registrar" },
];

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
    created_by: PROVIDERS[0],
    created_at: "2026-07-06T09:00:00Z",
    stages: {
      preop: stage(stages.preop),
      intraop: stage(stages.intraop),
      postop: stage(stages.postop),
    },
  } as Workflow;
}

const CASES = [
  makeSummary({ case_id: "sg-demo" }),
  makeSummary({
    case_id: "tkr-mrs-w",
    label: "TKR Mrs W",
    workflow: wf({
      preop: { status: "signed_off", performed_by: "p-lim" },
      intraop: { status: "awaiting_review", performed_by: "p-tan" },
    }),
  }),
];

function renderList(overrides: Partial<Parameters<typeof Worklist>[0]> = {}) {
  const props = {
    cases: CASES,
    providers: PROVIDERS,
    selectedId: null,
    onSelect: vi.fn(),
    onNewCase: vi.fn(),
    filters: defaultFilters(),
    onToggleFilter: vi.fn(),
    workFilters: { stage: "all", status: "all", mine: false } as const,
    onWorkFilters: vi.fn(),
    me: null,
    ...overrides,
  };
  render(<Worklist {...props} />);
  return props;
}

describe("Worklist", () => {
  it("live rows show label, stage + status in words, and who acted last", () => {
    renderList();
    expect(screen.getByText("TKR Mrs W")).toBeInTheDocument();
    expect(screen.getByText("Intra-op — awaiting review")).toBeInTheDocument();
    expect(screen.getByText(/Dr B\. Tan/)).toBeInTheDocument();
  });

  it("demo rows are marked review-only", () => {
    renderList();
    expect(screen.getByText("Review only")).toBeInTheDocument();
  });

  it("stage filter hides non-matching rows", async () => {
    const props = renderList();
    await userEvent.selectOptions(screen.getByLabelText(/stage/i), "preop");
    expect(props.onWorkFilters).toHaveBeenCalledWith({
      stage: "preop",
      status: "all",
      mine: false,
    });
  });

  it("applies the given workflow filters", () => {
    renderList({ workFilters: { stage: "preop", status: "all", mine: false } });
    expect(screen.queryByText("TKR Mrs W")).not.toBeInTheDocument();
    expect(screen.queryByText("sg-demo")).not.toBeInTheDocument();
  });

  // ---- "my cases" (v2 W6b) ---------------------------------------------------

  it("My cases toggles the mine filter", async () => {
    const props = renderList({ me: "p-tan" });
    const toggle = screen.getByRole("button", { name: /my cases/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(props.onWorkFilters).toHaveBeenCalledWith({
      stage: "all",
      status: "all",
      mine: true,
    });
  });

  it("mine filter keeps only my cases", () => {
    renderList({ me: "p-tan", workFilters: { stage: "all", status: "all", mine: true } });
    expect(screen.getByText("TKR Mrs W")).toBeInTheDocument(); // p-tan did intra-op
    expect(screen.queryByText("sg-demo")).not.toBeInTheDocument();
  });

  it("My cases is disabled until a provider is picked", () => {
    renderList({ me: null });
    expect(screen.getByRole("button", { name: /my cases/i })).toBeDisabled();
  });

  it("New case is a labelled button", async () => {
    const props = renderList();
    await userEvent.click(screen.getByRole("button", { name: /new case/i }));
    expect(props.onNewCase).toHaveBeenCalled();
  });

  it("row click selects the case", async () => {
    const props = renderList();
    await userEvent.click(screen.getByText("TKR Mrs W"));
    expect(props.onSelect).toHaveBeenCalledWith("tkr-mrs-w");
  });
});
