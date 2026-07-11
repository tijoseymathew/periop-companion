import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** Render with the provider-edit callbacks wired, as App does on a live case. */
function renderEditableBrief(model: ReturnType<typeof buildBrief>) {
  const props = { onEditClaim: vi.fn(), onAddClaim: vi.fn() };
  render(
    <BriefScreen
      model={model}
      queue={null}
      canReview={model.writable}
      onBack={vi.fn()}
      onOpenSource={vi.fn()}
      onAction={vi.fn()}
      {...props}
    />,
  );
  return props;
}

/** A live pre-op case with one flagged fact and one open question. */
function livePreopCase() {
  return CaseSchema.parse({
    case_id: "sg-edit",
    label: "Whitfield — hernia",
    workflow: {
      created_by: PROVIDERS[0],
      created_at: "2026-04-02T06:00:00Z",
      stages: {
        preop: { status: "awaiting_review", performed_by: "p-lim" },
        intraop: { status: "awaiting_inputs" },
        postop: { status: "awaiting_inputs" },
      },
    },
    artifacts: [
      {
        artifact_id: "note:pre-anesthesia-eval",
        claims: [
          {
            claim_id: "c-001",
            text: "Records list aspirin as current.",
            provenance: ["doc:gp-summary#c1"],
            status: "conflicting",
          },
        ],
      },
    ],
    open_questions: [{ question: "Confirm fasting time", reason: null, review: null }],
  });
}

/** A case live in theatre with the anticipated-issues note generated. */
function liveIntraopCase() {
  return CaseSchema.parse({
    case_id: "sg-theatre",
    label: "Whitfield — hernia",
    workflow: {
      created_by: PROVIDERS[0],
      created_at: "2026-04-02T06:00:00Z",
      stages: {
        preop: {
          status: "signed_off",
          performed_by: "p-lim",
          signed_off_by: "p-lim",
          signed_off_at: "2026-04-02T07:15:00Z",
        },
        intraop: { status: "awaiting_review", performed_by: "p-lim" },
        postop: { status: "awaiting_inputs" },
      },
    },
    artifacts: [
      { artifact_id: "record:intra-op", claims: [] },
      {
        artifact_id: "note:anticipated-issues",
        claims: [
          {
            claim_id: "c-020",
            text: "Elevated PONV risk post-op.",
            provenance: ["doc:gp-summary#c2"],
            status: "inference",
          },
        ],
      },
    ],
  });
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

  it("lets the provider edit a fact-backed story item before pre-op sign-off", async () => {
    const props = renderEditableBrief(buildBrief(livePreopCase(), PROVIDERS));

    // question-derived items carry no claim — nothing to edit
    expect(
      screen.queryByRole("button", { name: "Edit: Confirm fasting time" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Edit: Records list aspirin as current." }),
    );
    const box = screen.getByDisplayValue("Records list aspirin as current.");
    await userEvent.clear(box);
    await userEvent.type(box, "Aspirin stopped last Tuesday.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(props.onEditClaim).toHaveBeenCalledWith(
      "note:pre-anesthesia-eval",
      "c-001",
      "Aspirin stopped last Tuesday.",
    );
  });

  it("lets the provider add their own line to the story so far", async () => {
    const props = renderEditableBrief(buildBrief(livePreopCase(), PROVIDERS));
    await userEvent.type(
      screen.getByPlaceholderText("Add to the story so far…"),
      "Patient anxious about the LMA.{Enter}",
    );
    expect(props.onAddClaim).toHaveBeenCalledWith(
      "note:pre-anesthesia-eval",
      "Patient anxious about the LMA.",
    );
  });

  it("lets the provider edit and extend the anticipated issues in theatre", async () => {
    const props = renderEditableBrief(buildBrief(liveIntraopCase(), PROVIDERS));

    await userEvent.click(
      screen.getByRole("button", { name: "Edit: Elevated PONV risk post-op." }),
    );
    const box = screen.getByDisplayValue("Elevated PONV risk post-op.");
    await userEvent.clear(box);
    await userEvent.type(box, "High PONV risk — ondansetron given.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onEditClaim).toHaveBeenCalledWith(
      "note:anticipated-issues",
      "c-020",
      "High PONV risk — ondansetron given.",
    );

    await userEvent.type(
      screen.getByPlaceholderText("Add an anticipated issue…"),
      "Watch urine output overnight.{Enter}",
    );
    expect(props.onAddClaim).toHaveBeenCalledWith(
      "note:anticipated-issues",
      "Watch urine output overnight.",
    );
  });

  it("withholds the edit affordances when pinned to a completed stage", () => {
    const model = buildBrief(liveIntraopCase(), PROVIDERS, { stage: "preop" });
    expect(model.viewingPast).toBe(true);
    renderEditableBrief(model);
    expect(screen.queryByPlaceholderText("Add to the story so far…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit:/ })).not.toBeInTheDocument();
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
