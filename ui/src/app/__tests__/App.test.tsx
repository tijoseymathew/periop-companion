import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  createCase: vi.fn(async (label: string) => ({ ...makeCase(), case_id: "new-case", label })),
  audioUrl: (caseId: string, sourceId: string) =>
    `/api/cases/${caseId}/audio/${encodeURIComponent(sourceId)}`,
}));

/** Open the fixture case from the worklist. It lands on its most advanced note. */
async function openCase() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /sg-t/ }));
}

/** Open the case, then step to the Pre-op evaluation → its claim review. */
async function openPreopReview() {
  await openCase();
  await userEvent.click(await screen.findByRole("button", { name: /Pre-op evaluation/ }));
  await screen.findByText("Aspirin was discontinued 6 days prior to surgery.");
}

describe("App workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("lists cases on the worklist and opens one on click", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Cases" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /sg-t/ }));
    // a demo case opens on its most advanced note (the PACU handoff)
    expect(await screen.findByText("Aspirin held pre-op.")).toBeInTheDocument();
  });

  it("steps between stages via the stepper nodes", async () => {
    await openCase();
    // landed on the handoff (post-op) note
    await screen.findByText("Aspirin held pre-op.");
    // stepping to Pre-op shows its claims and hides the handoff's
    await userEvent.click(await screen.findByRole("button", { name: /Pre-op evaluation/ }));
    expect(
      await screen.findByText("Aspirin was discontinued 6 days prior to surgery."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Orphan claim.")).not.toBeInTheDocument();
  });

  it("doc-chunk citation click highlights the chunk in the source panel (U1 exit)", async () => {
    await openPreopReview();
    await userEvent.click(screen.getByRole("button", { name: /doc:gp-summary#c001/ }));
    await waitFor(() =>
      expect(screen.getByTestId("chunk-c001")).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("audio citation click highlights the transcript segment (degraded, no wav yet)", async () => {
    await openPreopReview();
    await userEvent.click(screen.getAllByRole("button", { name: /audio:preop-interview#s017$/ })[0]);
    await waitFor(() =>
      expect(screen.getByTestId("segment-s017")).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("audio citation click loads the wav and plays the exact clip (U2)", async () => {
    Object.defineProperty(window.HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => 1,
    });
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    await openPreopReview();
    const container = document.body;
    await userEvent.click(screen.getAllByRole("button", { name: /audio:preop-interview#s017$/ })[0]);
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toContain("/api/cases/sg-t/audio/audio%3Apreop-interview");
    await waitFor(() => expect(audio.currentTime).toBe(214.3));
    expect(audio.play).toHaveBeenCalled();
  });

  it("degrades to highlight-only when the wav 404s", async () => {
    await openPreopReview();
    await userEvent.click(screen.getAllByRole("button", { name: /audio:preop-interview#s017$/ })[0]);
    const audio = document.body.querySelector("audio")!;
    fireEvent(audio, new Event("error"));
    expect(await screen.findByText(/timestamp-only/i)).toBeInTheDocument();
    expect(screen.getByTestId("segment-s017")).toHaveAttribute("data-highlighted", "true");
  });

  it("arrow keys walk the visible claims; Enter activates the first ref (U4)", async () => {
    await openPreopReview();
    await userEvent.keyboard("{ArrowDown}");
    const first = document.getElementById("claim-note-pre-anesthesia-eval-c-001")!;
    expect(first).toHaveAttribute("data-active", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.getElementById("claim-note-pre-anesthesia-eval-c-002")!).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(first).toHaveAttribute("data-active", "false");
    await userEvent.keyboard("{ArrowUp}");
    expect(first).toHaveAttribute("data-active", "true");
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("segment-s017")).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("status filter toggle hides matching claims in the ledger", async () => {
    await openPreopReview();
    await userEvent.click(screen.getByRole("button", { name: /filter supported/i }));
    expect(
      screen.queryByText("Aspirin was discontinued 6 days prior to surgery."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Records list aspirin 100mg daily as current.")).toBeInTheDocument();
  });
});

describe("App workflow shell (v2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("header offers the provider picker; the choice persists", async () => {
    render(<App />);
    const picker = await screen.findByLabelText(/working as/i);
    await userEvent.selectOptions(picker, "p-tan");
    expect(localStorage.getItem("periop-provider")).toBe("p-tan");
  });

  it("demo cases read as review-only in the worklist", async () => {
    render(<App />);
    expect(await screen.findByText("Review only")).toBeInTheDocument();
  });

  it("New case needs a provider picked, then creates and opens the case", async () => {
    const api = await import("../../lib/api");
    render(<App />);
    await screen.findByRole("heading", { name: "Cases" });
    await userEvent.click(screen.getByRole("button", { name: /start a new case/i }));
    // no provider picked → form explains what to do (v2 §6.7)
    expect(screen.getByText(/choose your name in the top-right picker/i)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/working as/i), "p-lim");
    await userEvent.type(screen.getByLabelText(/case label/i), "TKR Mrs W");
    await userEvent.click(screen.getByRole("button", { name: /create case/i }));
    await waitFor(() =>
      expect(vi.mocked(api.createCase)).toHaveBeenCalledWith("TKR Mrs W", "p-lim"),
    );
  });

  it("the New case form carries the synthetic-data note", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Cases" });
    await userEvent.click(screen.getByRole("button", { name: /start a new case/i }));
    expect(screen.getByText(/never enter real patient details/i)).toBeInTheDocument();
  });
});
