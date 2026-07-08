import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeCase } from "../../test/fixtures";
import { ClaimRow } from "../ClaimRow";
import { StatusBadge, STATUS_GLYPHS } from "../StatusBadge";

const kase = makeCase();
const preop = kase.artifacts[0];

describe("StatusBadge", () => {
  it("uses the design's status glyph vocabulary (ui.md §6)", () => {
    expect(STATUS_GLYPHS).toEqual({
      supported: "✓",
      unsupported: "⚠",
      conflicting: "✕",
      unverified: "○",
      inference: "→",
    });
  });

  it("labels the glyph with the status for a11y and tests", () => {
    render(<StatusBadge status="conflicting" />);
    expect(screen.getByLabelText("conflicting")).toHaveTextContent("✕");
  });
});

describe("ClaimRow", () => {
  it("shows status badge, claim text, and one chip per provenance ref", () => {
    render(<ClaimRow kase={kase} artifactId={preop.artifact_id} claim={preop.claims[1]} onActivateRef={() => {}} />);
    expect(screen.getByLabelText("conflicting")).toBeInTheDocument();
    expect(screen.getByText("Records list aspirin 100mg daily as current.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /doc:gp-summary#c001/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /audio:preop-interview#s017/ })).toBeInTheDocument();
  });

  it("clicking the row activates the first ref", async () => {
    const onActivateRef = vi.fn();
    render(<ClaimRow kase={kase} artifactId={preop.artifact_id} claim={preop.claims[1]} onActivateRef={onActivateRef} />);
    await userEvent.click(screen.getByText("Records list aspirin 100mg daily as current."));
    expect(onActivateRef).toHaveBeenCalledWith("doc:gp-summary#c001");
  });

  it("chips are individually clickable", async () => {
    const onActivateRef = vi.fn();
    render(<ClaimRow kase={kase} artifactId={preop.artifact_id} claim={preop.claims[1]} onActivateRef={onActivateRef} />);
    await userEvent.click(screen.getByRole("button", { name: /audio:preop-interview#s017/ }));
    expect(onActivateRef).toHaveBeenCalledTimes(1);
    expect(onActivateRef).toHaveBeenCalledWith("audio:preop-interview#s017");
  });

  it("marks unresolvable refs with an unmissable UNRESOLVED badge", () => {
    const pacu = kase.artifacts[3];
    render(<ClaimRow kase={kase} artifactId={pacu.artifact_id} claim={pacu.claims[1]} onActivateRef={() => {}} />);
    expect(screen.getByText("UNRESOLVED")).toBeInTheDocument();
  });

  it("flags a claim with no citations as an unresolved source (never hidden)", () => {
    const intraop = kase.artifacts[1];
    render(<ClaimRow kase={kase} artifactId={intraop.artifact_id} claim={intraop.claims[0]} onActivateRef={() => {}} />);
    expect(screen.getByText(/source unresolved/i)).toBeInTheDocument();
  });

  // ---- per-claim review actions (v2 W6a) -----------------------------------

  it("offers no review actions unless a handler is wired (demo cases)", () => {
    render(<ClaimRow kase={kase} artifactId={preop.artifact_id} claim={preop.claims[0]} onActivateRef={() => {}} />);
    expect(screen.queryByRole("button", { name: /mark reviewed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^flag$/i })).not.toBeInTheDocument();
  });

  it("marking reviewed reports the action without activating the ref", async () => {
    const onReview = vi.fn();
    const onActivateRef = vi.fn();
    render(
      <ClaimRow
        kase={kase}
        artifactId={preop.artifact_id}
        claim={preop.claims[0]}
        onActivateRef={onActivateRef}
        review={null}
        onReview={onReview}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /mark reviewed/i }));
    expect(onReview).toHaveBeenCalledWith("reviewed");
    expect(onActivateRef).not.toHaveBeenCalled();
  });

  it("the active state is pressed, and clicking it again clears the action", async () => {
    const onReview = vi.fn();
    render(
      <ClaimRow
        kase={kase}
        artifactId={preop.artifact_id}
        claim={preop.claims[0]}
        onActivateRef={() => {}}
        review="flagged"
        onReview={onReview}
      />,
    );
    const flag = screen.getByRole("button", { name: /^flag$/i });
    expect(flag).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /mark reviewed/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(flag);
    expect(onReview).toHaveBeenCalledWith(null);
  });
});
