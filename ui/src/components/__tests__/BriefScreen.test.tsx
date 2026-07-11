import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BriefScreen } from "../catchup/BriefScreen";
import { buildBrief } from "../../lib/catchup";
import { CaseSchema, type Provider } from "../../lib/schema";
import { makeCase } from "../../test/fixtures";

const PROVIDERS: Provider[] = [{ provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" }];

function renderBrief(model: ReturnType<typeof buildBrief>) {
  return render(
    <BriefScreen
      model={model}
      queue={null}
      canReview={model.writable}
      onBack={vi.fn()}
      onOpenSource={vi.fn()}
      onAction={vi.fn()}
    />,
  );
}

describe("BriefScreen", () => {
  it("shows the Pre-op › Intra-op › Post-op stepper", () => {
    const model = buildBrief(makeCase(), PROVIDERS);
    renderBrief(model);
    expect(screen.getByText("Pre-op")).toBeInTheDocument();
    expect(screen.getByText("Intra-op")).toBeInTheDocument();
    expect(screen.getByText("Post-op")).toBeInTheDocument();
  });

  it("keeps the pre-op brief to story + key facts — no theatre timeline, issues, or needs-you-now", () => {
    const kase = CaseSchema.parse({
      case_id: "sg-preop",
      workflow: {
        created_by: PROVIDERS[0],
        created_at: "2026-04-02T06:00:00Z",
        stages: {
          preop: {
            status: "awaiting_review",
            performed_by: "p-lim",
            questions_approved_at: "2026-04-02T06:30:00Z",
            inputs_recorded_at: "2026-04-02T06:45:00Z",
          },
          intraop: { status: "awaiting_inputs" },
          postop: { status: "awaiting_inputs" },
        },
      },
      open_questions: [
        { question: "Confirm BP meds", reason: "already reviewed", review: "approved" },
      ],
      artifacts: [{ artifact_id: "note:pre-anesthesia-eval", claims: [] }],
    });
    const model = buildBrief(kase, PROVIDERS);
    expect(model.stage).toBe("preop");
    renderBrief(model);

    expect(screen.getByText("The story so far")).toBeInTheDocument();
    expect(screen.getByText("Key facts")).toBeInTheDocument();
    expect(screen.queryByText("In theatre")).not.toBeInTheDocument();
    expect(screen.queryByText("Anticipated issues")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs you now")).not.toBeInTheDocument();
  });

  it("shows three columns in theatre — key facts, theatre timeline, issues; no story or needs-you-now", () => {
    const model = buildBrief(makeCase(), PROVIDERS, { stage: "intraop" });
    renderBrief(model);

    expect(screen.getByText("Key facts")).toBeInTheDocument();
    // "In theatre" appears twice: the header stage badge and the column
    expect(screen.getAllByText("In theatre")).toHaveLength(2);
    expect(screen.getByText("propofol 120 mg")).toBeInTheDocument();
    expect(screen.getByText("Anticipated issues")).toBeInTheDocument();
    expect(screen.queryByText("The story so far")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs you now")).not.toBeInTheDocument();
  });

  it("shows the post-op run's two writers in recovery — not the intra-op columns again", () => {
    const model = buildBrief(makeCase(), PROVIDERS); // demo case lands on postop
    expect(model.stage).toBe("postop");
    renderBrief(model);

    expect(screen.getByText("PACU handoff")).toBeInTheDocument();
    expect(screen.getByText("Post-anaesthesia evaluation")).toBeInTheDocument();
    expect(screen.getByText("Recovered without airway complications.")).toBeInTheDocument();
    expect(screen.queryByText("In theatre")).not.toBeInTheDocument();
    expect(screen.queryByText("Anticipated issues")).not.toBeInTheDocument();
  });

  it("reads the recovery brief's key facts from the PACU handoff, not the pre-op note", () => {
    const model = buildBrief(makeCase(), PROVIDERS);
    renderBrief(model);

    // fixture: "Aspirin held pre-op." lives on note:pacu-handoff;
    // "Aspirin was discontinued…" on note:pre-anesthesia-eval
    expect(screen.getByText("Aspirin held pre-op.")).toBeInTheDocument();
    expect(
      screen.queryByText("Aspirin was discontinued 6 days prior to surgery."),
    ).not.toBeInTheDocument();
  });
});
