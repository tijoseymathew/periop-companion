import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultFilters } from "../../lib/filters";
import { makeCase } from "../../test/fixtures";
import { ArtifactView } from "../ArtifactView";
import { EventsTable } from "../EventsTable";

const kase = makeCase();

describe("ArtifactView", () => {
  it("renders the artifact as its ordered claims — the claims are the note", () => {
    render(
      <ArtifactView kase={kase} artifact={kase.artifacts[0]} filters={defaultFilters()} onActivateRef={() => {}} />,
    );
    expect(screen.getByRole("heading", { name: /note:pre-anesthesia-eval/i })).toBeInTheDocument();
    const texts = screen.getAllByTestId("claim-text").map((el) => el.textContent);
    expect(texts).toEqual([
      "Aspirin was discontinued 6 days prior to surgery.",
      "Records list aspirin 100mg daily as current.",
      "Diabetes is diet controlled.",
    ]);
  });

  it("status filters hide rows, but an explicit toggle is required — defaults hide nothing", () => {
    render(
      <ArtifactView
        kase={kase}
        artifact={kase.artifacts[0]}
        filters={{ ...defaultFilters(), supported: false }}
        onActivateRef={() => {}}
      />,
    );
    expect(screen.queryByText("Aspirin was discontinued 6 days prior to surgery.")).not.toBeInTheDocument();
    // conflicting stays visible when its toggle is on
    expect(screen.getByText("Records list aspirin 100mg daily as current.")).toBeInTheDocument();
  });

  it("shows the events table for record:intra-op", () => {
    render(
      <ArtifactView kase={kase} artifact={kase.artifacts[1]} filters={defaultFilters()} onActivateRef={() => {}} />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("propofol 120")).toBeInTheDocument();
  });
});

describe("EventsTable", () => {
  it("renders time, category, value, units and clickable provenance chips", async () => {
    const onActivateRef = vi.fn();
    render(<EventsTable kase={kase} events={kase.intraop_events} onActivateRef={onActivateRef} />);
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
    expect(screen.getByText("mg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /audio:preop-interview#s016/ }));
    expect(onActivateRef).toHaveBeenCalledWith("audio:preop-interview#s016");
  });
});
