/**
 * Stage rail (spec v2 §6): Pre-op / Intra-op / Post-op stepper with each
 * stage's status in plain words, above the center pane.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Workflow } from "../../lib/schema";
import { StageRail } from "../StageRail";

function wf(): Workflow {
  const stage = (status: string) => ({
    status,
    performed_by: null,
    signed_off_by: null,
    signed_off_at: null,
    questions_approved_at: null,
    inputs_recorded_at: null,
    handoff_acknowledged_by: null,
    handoff_acknowledged_at: null,
    reopens: [],
  });
  return {
    created_by: { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
    created_at: "2026-07-06T09:00:00Z",
    stages: {
      preop: stage("signed_off"),
      intraop: stage("awaiting_review"),
      postop: stage("awaiting_inputs"),
    },
  } as Workflow;
}

describe("StageRail", () => {
  it("shows all three stages with status words", () => {
    render(<StageRail workflow={wf()} active="intraop" onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /Pre-op.*signed off/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Intra-op.*awaiting review/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Post-op.*awaiting inputs/i })).toBeInTheDocument();
  });

  it("marks the active stage", () => {
    render(<StageRail workflow={wf()} active="intraop" onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /Intra-op/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("clicking a stage selects it", async () => {
    const onSelect = vi.fn();
    render(<StageRail workflow={wf()} active="intraop" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: /Post-op/i }));
    expect(onSelect).toHaveBeenCalledWith("postop");
  });
});
