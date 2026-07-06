/**
 * Pre-op intake (spec v2 §4.1 step 2): paste or upload prior records into
 * typed slots plus the operative plan. Records can be pasted — the label was
 * the only obligatory typing (v2 §6.3).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntakeForm } from "../IntakeForm";

function renderForm(overrides: Partial<Parameters<typeof IntakeForm>[0]> = {}) {
  const props = {
    providerId: "p-lim",
    existingDocTypes: [] as string[],
    onAddText: vi.fn(async () => {}),
    onUploadFile: vi.fn(async () => {}),
    ...overrides,
  };
  render(<IntakeForm {...props} />);
  return props;
}

describe("IntakeForm", () => {
  it("opens with one plain sentence of instruction", () => {
    renderForm();
    expect(
      screen.getByText(/add the patient's records and the operative plan/i),
    ).toBeInTheDocument();
  });

  it("offers the typed slots in clinical vocabulary", () => {
    renderForm();
    const slot = screen.getByLabelText(/document type/i);
    for (const label of [
      "GP summary",
      "Medication list",
      "Previous anaesthetic record",
      "Operative plan",
      "Other",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
    expect(slot).toBeInTheDocument();
  });

  it("pasting text and pressing Add document sends it to the API", async () => {
    const props = renderForm();
    await userEvent.selectOptions(screen.getByLabelText(/document type/i), "gp-summary");
    await userEvent.type(screen.getByLabelText(/paste/i), "Aspirin 100mg OD.");
    await userEvent.click(screen.getByRole("button", { name: /add document/i }));
    expect(props.onAddText).toHaveBeenCalledWith("gp-summary", "Aspirin 100mg OD.");
  });

  it("Add document stays disabled with nothing pasted", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /add document/i })).toBeDisabled();
  });

  it("already-provided slots are marked and not offered again", () => {
    renderForm({ existingDocTypes: ["gp-summary"] });
    expect(screen.getByText(/GP summary/)).toBeInTheDocument();
    expect(screen.getByText(/added/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "GP summary" }),
    ).not.toBeInTheDocument();
  });

  it("file upload is a labelled control, not an icon", async () => {
    const props = renderForm();
    const file = new File(["# GP"], "gp.md", { type: "text/markdown" });
    await userEvent.selectOptions(screen.getByLabelText(/document type/i), "med-list");
    await userEvent.upload(screen.getByLabelText(/upload a file/i), file);
    expect(props.onUploadFile).toHaveBeenCalledWith("med-list", file);
  });
});
