import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeCase } from "../../test/fixtures";
import { ClaimRow } from "../ClaimRow";
import { StatusBadge, STATUS_GLYPHS } from "../StatusBadge";

const kase = makeCase();
const preop = kase.artifacts[0];

describe("StatusBadge", () => {
  it("uses the CLI renderer's glyph vocabulary (ui.md §6)", () => {
    expect(STATUS_GLYPHS).toEqual({
      supported: "✓",
      unsupported: "?",
      conflicting: "✗",
      unverified: "·",
      inference: "→",
    });
  });

  it("labels the glyph with the status for a11y and tests", () => {
    render(<StatusBadge status="conflicting" />);
    expect(screen.getByLabelText("conflicting")).toHaveTextContent("✗");
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

  it("says so when a claim has no citations", () => {
    const intraop = kase.artifacts[1];
    render(<ClaimRow kase={kase} artifactId={intraop.artifact_id} claim={intraop.claims[0]} onActivateRef={() => {}} />);
    expect(screen.getByText(/no citations/i)).toBeInTheDocument();
  });
});
