/**
 * Intra-op orientation (spec v2 §4.2 step 1): the incoming provider's
 * "what you need to know before induction" — unanswered questions and
 * flagged conflicts pinned to the top, each traceable.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CaseSchema } from "../../lib/schema";
import { makeCase } from "../../test/fixtures";
import { OrientationView } from "../OrientationView";

function caseWithQuestions() {
  const base = makeCase();
  return CaseSchema.parse({
    ...base,
    open_questions: [
      {
        question: "Is the patient still taking aspirin?",
        reason: "conflicting",
        provenance: ["doc:gp-summary#c001"],
        review: "approved",
        edited_text: null,
      },
      {
        question: "Dismissed one",
        reason: "missing",
        provenance: [],
        review: "dismissed",
        edited_text: null,
      },
    ],
  });
}

describe("OrientationView", () => {
  it("pins approved questions and conflicting claims to the top", () => {
    render(<OrientationView kase={caseWithQuestions()} onActivateRef={vi.fn()} />);
    expect(screen.getByText(/before induction/i)).toBeInTheDocument();
    expect(screen.getByText("Is the patient still taking aspirin?")).toBeInTheDocument();
    // the fixture's conflicting claim from the signed-off pre-op note
    expect(screen.getByText("Records list aspirin 100mg daily as current.")).toBeInTheDocument();
    // dismissed questions stay out of the orientation
    expect(screen.queryByText("Dismissed one")).not.toBeInTheDocument();
  });

  it("every pinned item is traceable via its provenance chip", async () => {
    const onActivateRef = vi.fn();
    render(<OrientationView kase={caseWithQuestions()} onActivateRef={onActivateRef} />);
    await userEvent.click(
      screen.getAllByRole("button", { name: "doc:gp-summary#c001" })[0],
    );
    expect(onActivateRef).toHaveBeenCalledWith("doc:gp-summary#c001");
  });
});
