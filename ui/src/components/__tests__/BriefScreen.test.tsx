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
      onReviewNeed={vi.fn()}
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

  it("shows the theatre timeline, issues, and needs-you-now once past pre-op", () => {
    const model = buildBrief(makeCase(), PROVIDERS); // demo case lands on postop
    expect(model.stage).toBe("postop");
    renderBrief(model);

    expect(screen.getByText("In theatre")).toBeInTheDocument();
    expect(screen.getByText("Anticipated issues")).toBeInTheDocument();
  });
});
