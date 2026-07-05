import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultFilters } from "../../lib/filters";
import { makeSummary } from "../../test/fixtures";
import { CaseList } from "../CaseList";

const cases = [
  makeSummary({ case_id: "sg-0001", has_audio: false }),
  makeSummary({ case_id: "sg-0002" }),
];

describe("defaultFilters", () => {
  it("never hides any status by default — unsupported/conflicting surfacing is an invariant", () => {
    expect(defaultFilters()).toEqual({
      supported: true,
      unsupported: true,
      conflicting: true,
      inference: true,
      unverified: true,
    });
  });
});

describe("CaseList", () => {
  it("lists cases with counts and an audio indicator", () => {
    render(
      <CaseList cases={cases} selectedId="sg-0002" onSelect={() => {}} filters={defaultFilters()} onToggleFilter={() => {}} />,
    );
    expect(screen.getByText("sg-0001")).toBeInTheDocument();
    expect(screen.getByText("sg-0002")).toBeInTheDocument();
    // 4 artifacts / 7 claims shown per case
    expect(screen.getAllByText(/4 artifacts · 7 claims/)).toHaveLength(2);
    // audio indicator only where wavs exist
    expect(screen.getByRole("option", { name: /sg-0002/ })).toHaveAccessibleName(/audio/);
    expect(screen.getByRole("option", { name: /sg-0001/ })).not.toHaveAccessibleName(/audio/);
  });

  it("selects a case on click", async () => {
    const onSelect = vi.fn();
    render(
      <CaseList cases={cases} selectedId={null} onSelect={onSelect} filters={defaultFilters()} onToggleFilter={() => {}} />,
    );
    await userEvent.click(screen.getByText("sg-0001"));
    expect(onSelect).toHaveBeenCalledWith("sg-0001");
  });

  it("marks the selected case", () => {
    render(
      <CaseList cases={cases} selectedId="sg-0002" onSelect={() => {}} filters={defaultFilters()} onToggleFilter={() => {}} />,
    );
    expect(screen.getByRole("option", { name: /sg-0002/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /sg-0001/ })).toHaveAttribute("aria-selected", "false");
  });

  it("exposes one pressed filter toggle per status", async () => {
    const onToggleFilter = vi.fn();
    render(
      <CaseList cases={cases} selectedId={null} onSelect={() => {}} filters={{ ...defaultFilters(), supported: false }} onToggleFilter={onToggleFilter} />,
    );
    const supported = screen.getByRole("button", { name: /filter supported/i });
    expect(supported).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /filter conflicting/i })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(supported);
    expect(onToggleFilter).toHaveBeenCalledWith("supported");
  });
});
