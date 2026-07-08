import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildReverseIndex } from "../../lib/provenance";
import { makeCase } from "../../test/fixtures";
import { SourcePanel } from "../SourcePanel";

const kase = makeCase();
const reverseIndex = buildReverseIndex(kase);

function renderPanel(props: Partial<Parameters<typeof SourcePanel>[0]> = {}) {
  const defaults: Parameters<typeof SourcePanel>[0] = {
    kase,
    reverseIndex,
    activeSourceId: "doc:gp-summary",
    highlightedAnchor: null,
    currentTime: null,
    playingSourceId: null,
    onSelectSource: () => {},
    onSeekToTime: () => {},
    onJumpToClaim: () => {},
  };
  return render(<SourcePanel {...defaults} {...props} />);
}

describe("SourcePanel", () => {
  it("groups sources into Interview and Documents tabs and switches on click", async () => {
    const onSelectSource = vi.fn();
    renderPanel({ onSelectSource });
    // a document source is active → the Documents tab is selected
    expect(screen.getByRole("tab", { name: "Documents" })).toHaveAttribute("aria-selected", "true");
    // switching to Interview selects the case's audio source
    await userEvent.click(screen.getByRole("tab", { name: "Interview" }));
    expect(onSelectSource).toHaveBeenCalledWith("audio:preop-interview");
  });

  it("renders document chunks with ids and section headings", () => {
    renderPanel();
    expect(screen.getByText("c001")).toBeInTheDocument();
    expect(screen.getByText("Medications")).toBeInTheDocument();
    expect(screen.getByText("On aspirin 100mg daily.")).toBeInTheDocument();
  });

  it("highlights the cited chunk", () => {
    renderPanel({ highlightedAnchor: "c001" });
    expect(screen.getByTestId("chunk-c001")).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByTestId("chunk-c002")).toHaveAttribute("data-highlighted", "false");
  });

  it("renders diarized transcript segments with speaker, times, and text", () => {
    renderPanel({ activeSourceId: "audio:preop-interview" });
    expect(screen.getByText("s017")).toBeInTheDocument();
    expect(screen.getByText("PATIENT")).toBeInTheDocument();
    expect(screen.getByText(/214\.3.*221\.8/)).toBeInTheDocument();
    expect(screen.getByText("I stopped the aspirin last Tuesday.")).toBeInTheDocument();
  });

  it("segment click seeks the player to its start", async () => {
    const onSeekToTime = vi.fn();
    renderPanel({ activeSourceId: "audio:preop-interview", onSeekToTime });
    await userEvent.click(screen.getByText("I stopped the aspirin last Tuesday."));
    expect(onSeekToTime).toHaveBeenCalledWith(214.3);
  });

  it("highlights the currently-playing segment from player time", () => {
    renderPanel({
      activeSourceId: "audio:preop-interview",
      currentTime: 216.2,
      playingSourceId: "audio:preop-interview",
    });
    expect(screen.getByTestId("segment-s017")).toHaveAttribute("data-playing", "true");
    expect(screen.getByTestId("segment-s016")).toHaveAttribute("data-playing", "false");
  });

  it("does not mark segments playing when another source's audio is loaded", () => {
    renderPanel({
      activeSourceId: "audio:preop-interview",
      currentTime: 216.2,
      playingSourceId: "audio:intraop-notes",
    });
    expect(screen.getByTestId("segment-s017")).toHaveAttribute("data-playing", "false");
  });

  it("shows a cited-by affordance that lists citing claims and jumps to them", async () => {
    const onJumpToClaim = vi.fn();
    renderPanel({ activeSourceId: "audio:preop-interview", onJumpToClaim });
    const seg = screen.getByTestId("segment-s017");
    // s017 is cited by c-001, c-002 (pre-op) and c-030 (handoff)
    await userEvent.click(within(seg).getByRole("button", { name: /cited by 3 claims/i }));
    // the conflict story is legible: supported and conflicting verdicts side by side
    expect(within(seg).getAllByLabelText("supported").length).toBeGreaterThan(0);
    expect(within(seg).getAllByLabelText("conflicting").length).toBeGreaterThan(0);
    await userEvent.click(within(seg).getByText("Aspirin held pre-op."));
    expect(onJumpToClaim).toHaveBeenCalledWith("note:pacu-handoff", "c-030");
  });

  it("chunks show cited-by too", () => {
    renderPanel();
    const chunk = screen.getByTestId("chunk-c002");
    // c002 cited by c-003 (unsupported) and c-020 (inference)
    expect(within(chunk).getByRole("button", { name: /cited by 2 claims/i })).toBeInTheDocument();
  });
});
