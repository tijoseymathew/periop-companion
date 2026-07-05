import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase, makeSummary } from "../../test/fixtures";
import App from "../App";

vi.mock("../../lib/api", () => ({
  fetchCases: vi.fn(async () => [makeSummary()]),
  fetchCase: vi.fn(async () => makeCase()),
  audioUrl: (caseId: string, sourceId: string) =>
    `/api/cases/${caseId}/audio/${encodeURIComponent(sourceId)}`,
}));

describe("App workspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the case list and auto-selects the first case", async () => {
    render(<App />);
    expect(await screen.findByRole("option", { name: /sg-t/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // pre-op tab content is visible by default
    expect(await screen.findByText("Aspirin was discontinued 6 days prior to surgery.")).toBeInTheDocument();
  });

  it("switches stages via tabs", async () => {
    render(<App />);
    await screen.findByText("Aspirin was discontinued 6 days prior to surgery.");
    await userEvent.click(screen.getByRole("tab", { name: "Post-op" }));
    expect(screen.getByText("Aspirin held pre-op.")).toBeInTheDocument();
    expect(screen.getByText("UNRESOLVED")).toBeInTheDocument();
    expect(screen.queryByText("Aspirin was discontinued 6 days prior to surgery.")).not.toBeInTheDocument();
  });

  it("doc-chunk citation click highlights the chunk in the source panel (U1 exit)", async () => {
    render(<App />);
    await screen.findByText("Records list aspirin 100mg daily as current.");
    await userEvent.click(screen.getByRole("button", { name: /doc:gp-summary#c001/ }));
    await waitFor(() =>
      expect(screen.getByTestId("chunk-c001")).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("audio citation click highlights the transcript segment (degraded, no wav yet)", async () => {
    render(<App />);
    await screen.findByText("Aspirin was discontinued 6 days prior to surgery.");
    // two claims cite s017; either chip works
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
    const { container } = render(<App />);
    await screen.findByText("Aspirin was discontinued 6 days prior to surgery.");
    await userEvent.click(screen.getAllByRole("button", { name: /audio:preop-interview#s017$/ })[0]);
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toContain("/api/cases/sg-t/audio/audio%3Apreop-interview");
    await waitFor(() => expect(audio.currentTime).toBe(214.3));
    expect(audio.play).toHaveBeenCalled();
  });

  it("degrades to highlight-only when the wav 404s", async () => {
    const { container } = render(<App />);
    await screen.findByText("Aspirin was discontinued 6 days prior to surgery.");
    await userEvent.click(screen.getAllByRole("button", { name: /audio:preop-interview#s017$/ })[0]);
    const audio = container.querySelector("audio")!;
    fireEvent(audio, new Event("error"));
    expect(await screen.findByText(/timestamp-only/i)).toBeInTheDocument();
    // the citation still resolves visually
    expect(screen.getByTestId("segment-s017")).toHaveAttribute("data-highlighted", "true");
  });

  it("arrow keys walk the visible claims; Enter activates the first ref (U4)", async () => {
    render(<App />);
    await screen.findByText("Aspirin was discontinued 6 days prior to surgery.");
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
    // Enter resolves the active claim's first ref (c-001 → audio segment s017)
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("segment-s017")).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("status filter toggle hides matching claims in the ledger", async () => {
    render(<App />);
    await screen.findByText("Aspirin was discontinued 6 days prior to surgery.");
    await userEvent.click(screen.getByRole("button", { name: /filter supported/i }));
    expect(screen.queryByText("Aspirin was discontinued 6 days prior to surgery.")).not.toBeInTheDocument();
    expect(screen.getByText("Records list aspirin 100mg daily as current.")).toBeInTheDocument();
  });
});
