/**
 * Sign-off screen (spec v2 §4.5): surfaces what a reviewer must not miss —
 * counts and a jump list of unsupported and conflicting claims and any
 * UNRESOLVED provenance. Sign-off with outstanding conflicts is allowed but
 * said out loud. Also hosts the handoff acknowledge and stage reopen.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeCase } from "../../test/fixtures";
import { SignOffBar } from "../SignOffBar";

function renderBar(overrides: Partial<Parameters<typeof SignOffBar>[0]> = {}) {
  const kase = makeCase();
  const props = {
    kase,
    // the fixture's pre-op note: 1 conflicting + 1 unsupported claim
    artifacts: kase.artifacts.filter((a) => a.artifact_id === "note:pre-anesthesia-eval"),
    action: { kind: "sign-off", stage: "preop", label: "Sign off pre-op" } as const,
    signedOff: false,
    onSignOff: vi.fn(async () => {}),
    onAcknowledge: vi.fn(async () => {}),
    onReopen: vi.fn(async () => {}),
    onJumpToClaim: vi.fn(),
    ...overrides,
  };
  render(<SignOffBar {...props} />);
  return props;
}

describe("SignOffBar", () => {
  it("counts unsupported and conflicting claims in words", () => {
    renderBar();
    expect(screen.getByText(/1 conflicting/i)).toBeInTheDocument();
    expect(screen.getByText(/1 unsupported/i)).toBeInTheDocument();
  });

  it("counts unresolved provenance", () => {
    const kase = makeCase();
    renderBar({
      // the fixture handoff carries an orphan ref (doc:gone#c9)
      artifacts: kase.artifacts.filter((a) => a.artifact_id === "note:pacu-handoff"),
      action: { kind: "sign-off", stage: "postop", label: "Sign off post-op" } as const,
    });
    expect(screen.getByText(/1 unresolved/i)).toBeInTheDocument();
  });

  it("jump list scrolls to each flagged claim", async () => {
    const props = renderBar();
    await userEvent.click(screen.getByRole("button", { name: /c-002/ }));
    expect(props.onJumpToClaim).toHaveBeenCalledWith("note:pre-anesthesia-eval", "c-002");
  });

  it("sign-off is the single primary action and is allowed with conflicts", async () => {
    const props = renderBar();
    const primary = screen.getByRole("button", { name: /sign off pre-op/i });
    expect(primary).toHaveAttribute("data-primary-action");
    await userEvent.click(primary);
    expect(props.onSignOff).toHaveBeenCalled();
  });

  it("acknowledge-handoff renders the acknowledge button instead", async () => {
    const props = renderBar({
      action: {
        kind: "acknowledge-handoff",
        stage: "postop",
        label: "Acknowledge handoff",
      } as const,
    });
    const primary = screen.getByRole("button", { name: /acknowledge handoff/i });
    await userEvent.click(primary);
    expect(props.onAcknowledge).toHaveBeenCalled();
  });

  it("signed-off stages offer a quiet reopen instead of a primary action", async () => {
    const props = renderBar({ action: null, signedOff: true });
    expect(screen.getByText(/signed off/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reopen/i }));
    expect(props.onReopen).toHaveBeenCalled();
  });
});
