import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase, makeSummary } from "../../test/fixtures";
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
  acknowledgeHandoff: vi.fn(),
  audioUrl: (caseId: string, sourceId: string) =>
    `/api/cases/${caseId}/audio/${encodeURIComponent(sourceId)}`,
}));

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
});
