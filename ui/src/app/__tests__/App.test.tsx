import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  addDocumentText: vi.fn(),
  analyzeQuestions: vi.fn(),
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

/** The seed fixture has no workflow, so it lands under "All cases"; open it.
 * It reads as a recovery case, so the brief is the three-column view with
 * its key facts drawn from the PACU handoff. */
async function openBrief() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /sg-t/ }));
  await screen.findByText("Aspirin held pre-op.");
}

/** A pre-op case that has cleared the interview gate but hasn't generated
 * its note yet — lands on the interview screen with "Generate" live. */
function preopReadyCase() {
  return CaseSchema.parse({
    case_id: "sg-ready",
    label: "Doyle — knee",
    workflow: {
      created_by: PROVIDERS[0],
      created_at: "2026-04-02T06:00:00Z",
      stages: {
        preop: {
          status: "ready_to_generate",
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
      {
        source_id: "audio:preop-interview",
        type: "audio",
        segments: [
          { seg_id: "s1", t0: 0, t1: 1, speaker: "PROVIDER", text: "Any blood thinners?" },
        ],
      },
    ],
  });
}

/** A pre-op case whose question prep is still running in the background. */
function preopBuildingCase() {
  return CaseSchema.parse({
    case_id: "sg-building",
    label: "Kwan — appendix",
    workflow: {
      created_by: PROVIDERS[0],
      created_at: "2026-04-02T06:00:00Z",
      stages: {
        preop: { status: "awaiting_inputs", gap_analysis: "running" },
        intraop: { status: "awaiting_inputs" },
        postop: { status: "awaiting_inputs" },
      },
    },
    sources: [
      { source_id: "doc:op-plan", type: "document", chunks: [] },
      { source_id: "doc:gp-summary", type: "document", chunks: [] },
    ],
  });
}

describe("Catch-Up app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the worklist and opens a case's brief — three columns for a recovery case", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Cases" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /sg-t/ }));
    // key facts come from the PACU handoff, not the pre-op note
    expect(await screen.findByText("Aspirin held pre-op.")).toBeInTheDocument();
    expect(
      screen.queryByText("Aspirin was discontinued 6 days prior to surgery."),
    ).not.toBeInTheDocument();
    // the three columns, with story-so-far gone past pre-op
    expect(screen.getByText("Key facts")).toBeInTheDocument();
    expect(screen.getByText(/In theatre/)).toBeInTheDocument();
    expect(screen.getByText("Anticipated issues")).toBeInTheDocument();
    expect(screen.queryByText("The story so far")).not.toBeInTheDocument();
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

  it("navigates to a completed stage's output via the stage bubbles", async () => {
    await openBrief(); // lands on the recovery brief
    await userEvent.click(screen.getByRole("button", { name: /Pre-op/ }));

    // the brief is pinned to the pre-op output: narrative layout, pre-op facts
    expect(await screen.findByText("The story so far")).toBeInTheDocument();
    expect(
      screen.getByText("Aspirin was discontinued 6 days prior to surgery."),
    ).toBeInTheDocument();
    expect(screen.getByText(/viewing this completed stage/)).toBeInTheDocument();

    // and back to where the case is now
    await userEvent.click(screen.getByRole("button", { name: /Post-op/ }));
    expect(await screen.findByText("Aspirin held pre-op.")).toBeInTheDocument();
    expect(screen.queryByText("The story so far")).not.toBeInTheDocument();
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

  it("keeps the interview screen mounted during generation, live status folded into the chrome", async () => {
    localStorage.setItem("periop-provider", "p-lim");
    const ready = preopReadyCase();
    const generated = CaseSchema.parse({
      ...ready,
      artifacts: [
        {
          artifact_id: "note:pre-anesthesia-eval",
          claims: [{ claim_id: "c1", text: "Aspirin held pre-op.", status: "supported" }],
        },
      ],
    });
    vi.mocked(api.fetchCases).mockResolvedValue([
      makeSummary({ case_id: "sg-ready", label: "Doyle — knee", workflow: ready.workflow }),
    ]);
    vi.mocked(api.fetchCase).mockResolvedValueOnce(ready).mockResolvedValueOnce(generated);

    // held open until the test says so, so the intermediate "still on the
    // interview screen, live status in the chrome" state is observable
    // rather than racing straight through to the brief
    let sseController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: agent_start\ndata: {"stage": "preop", "agent": "PreOpNoteWriter"}\n\n' +
              'event: agent_end\ndata: {"stage": "preop", "agent": "PreOpNoteWriter", ' +
              '"summary": "1 claims", "preview": ["Aspirin held pre-op."]}\n\n',
          ),
        );
        sseController = controller;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, body: stream }) as unknown as Response),
    );

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /sg-ready/ }));
    const generate = await screen.findByRole("button", { name: /Generate pre-op brief/ });
    await userEvent.click(generate);

    // still the interview screen underneath — no full-screen takeover
    expect(
      await screen.findByText("Questions to ask, then the recording"),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("generating-strip")).toHaveTextContent(
      "PreOpNoteWriter — 1 claims",
    );

    // the completed step's actual output streams into the page itself —
    // not just the chrome's one-line status
    expect(await screen.findByText("Building live")).toBeInTheDocument();
    expect(screen.getByText("PreOpNoteWriter")).toBeInTheDocument();
    expect(screen.getByText("Aspirin held pre-op.")).toBeInTheDocument();

    // now let the stream finish; the fresh case lands and the brief takes over
    sseController!.close();
    expect(await screen.findByText("The story so far")).toBeInTheDocument();
    expect(screen.queryByTestId("generating-strip")).not.toBeInTheDocument();
  });

  it("auto-generates the pre-op brief the moment the transcript has landed — no click", async () => {
    localStorage.setItem("periop-provider", "p-lim");
    const ready = preopReadyCase();
    ready.workflow!.stages.preop.transcription = "complete";
    const generated = CaseSchema.parse({
      ...ready,
      artifacts: [
        {
          artifact_id: "note:pre-anesthesia-eval",
          claims: [{ claim_id: "c1", text: "Aspirin held pre-op.", status: "supported" }],
        },
      ],
    });
    vi.mocked(api.fetchCases).mockResolvedValue([
      makeSummary({ case_id: "sg-ready", label: "Doyle — knee", workflow: ready.workflow }),
    ]);
    vi.mocked(api.fetchCase).mockResolvedValueOnce(ready).mockResolvedValue(generated);

    const sse = vi.fn(async (url: RequestInfo | URL) => {
      void url;
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('event: complete\ndata: {"case_id": "sg-ready"}\n\n'),
            );
            controller.close();
          },
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", sse);

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /sg-ready/ }));

    // the run starts on its own and the brief takes over when it finishes
    expect(await screen.findByText("The story so far")).toBeInTheDocument();
    expect(sse).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(sse).mock.calls[0][0])).toContain(
      "/api/cases/sg-ready/stages/preop/run",
    );
    // no standing Generate button anywhere in this flow
    expect(
      screen.queryByRole("button", { name: /Generate pre-op brief/ }),
    ).not.toBeInTheDocument();
  });

  it("folds the intake build into the chrome strip — records stay visible, no full-screen takeover", async () => {
    localStorage.setItem("periop-provider", "p-lim");
    const building = preopBuildingCase();
    vi.mocked(api.fetchCases).mockResolvedValue([
      makeSummary({ case_id: "sg-building", label: "Kwan — appendix", workflow: building.workflow }),
    ]);
    vi.mocked(api.fetchCase).mockResolvedValue(building);

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /sg-building/ }));

    // still the records screen underneath, not a separate full-screen ring
    expect(await screen.findByText("Add the records")).toBeInTheDocument();
    expect(await screen.findByTestId("generating-strip")).toHaveTextContent(
      "Preparing the interview questions",
    );
  });
});
