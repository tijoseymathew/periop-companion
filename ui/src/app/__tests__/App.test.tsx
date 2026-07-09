import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase, makeSummary } from "../../test/fixtures";
import { CaseSchema } from "../../lib/schema";
import * as api from "../../lib/api";
import App from "../App";

const PROVIDERS = [
  { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
  { provider_id: "p-tan", name: "Dr B. Tan", role: "registrar" },
];

vi.mock("../../lib/api", () => ({
  fetchCases: vi.fn(async () => [makeSummary()]),
  fetchCase: vi.fn(async () => makeCase()),
  fetchProviders: vi.fn(async () => PROVIDERS),
  createCase: vi.fn(),
  uploadAudio: vi.fn(),
  uploadDocumentFile: vi.fn(),
  reviewQuestions: vi.fn(),
  signoffStage: vi.fn(),
  acknowledgeHandoff: vi.fn(),
  audioUrl: (caseId: string, sourceId: string) =>
    `/api/cases/${caseId}/audio/${encodeURIComponent(sourceId)}`,
}));

/** A live, generated pre-op case whose one action is "sign off". */
function livePreopCase() {
  return CaseSchema.parse({
    case_id: "sg-live",
    label: "Nowak — hip",
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
    sources: [
      { source_id: "doc:op-plan", type: "document", chunks: [] },
      { source_id: "doc:gp-summary", type: "document", chunks: [] },
    ],
    artifacts: [
      {
        artifact_id: "note:pre-anesthesia-eval",
        claims: [
          { claim_id: "c1", text: "Stopped amlodipine 6 months ago.", status: "supported" },
        ],
      },
    ],
  });
}

/** The seed fixture has no workflow, so it lands under "All cases"; open it. */
async function openBrief() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /sg-t/ }));
  await screen.findByText("Aspirin was discontinued 6 days prior to surgery.");
}

describe("Catch-Up app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows the worklist and opens a case's brief", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Cases" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /sg-t/ }));
    expect(
      await screen.findByText("Aspirin was discontinued 6 days prior to surgery."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Records list aspirin 100mg daily as current.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Conflicting")).toBeInTheDocument();
  });

  it("opens the cited source for a key fact and shows the highlighted segment", async () => {
    await openBrief();
    await userEvent.click(screen.getAllByRole("button", { name: "See the source" })[0]);
    expect(await screen.findByText("Source for this fact")).toBeInTheDocument();
    expect(await screen.findByText("I stopped the aspirin last Tuesday.")).toBeInTheDocument();
  });

  it("surfaces the theatre timeline", async () => {
    await openBrief();
    expect(screen.getByText(/In theatre/)).toBeInTheDocument();
    expect(screen.getByText("propofol 120 mg")).toBeInTheDocument();
  });

  it("keeps a demo (no-workflow) case's handoff read-only", async () => {
    await openBrief();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("drives a live pre-op case to sign-off from the patient view", async () => {
    localStorage.setItem("periop-provider", "p-lim");
    const live = livePreopCase();
    vi.mocked(api.fetchCases).mockResolvedValue([
      makeSummary({ case_id: "sg-live", label: "Nowak — hip", workflow: live.workflow }),
    ]);
    vi.mocked(api.fetchCase).mockResolvedValue(live);
    vi.mocked(api.signoffStage).mockResolvedValue(live);

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /sg-live/ }));

    const signOff = await screen.findByRole("button", { name: "Sign off pre-op" });
    await userEvent.click(signOff);
    expect(api.signoffStage).toHaveBeenCalledWith("sg-live", "preop", "p-lim");
  });
});
