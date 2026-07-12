import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveResults } from "../flow/LiveResults";
import type { RunEvent } from "../../lib/sse";

describe("LiveResults", () => {
  it("renders nothing until a step has completed", () => {
    const { container } = render(
      <LiveResults events={[{ event: "agent_start", data: { agent: "EventExtractor" } }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each completed step's preview as it streams in", () => {
    const events: RunEvent[] = [
      { event: "agent_start", data: { agent: "EventExtractor" } },
      {
        event: "agent_end",
        data: {
          agent: "EventExtractor",
          summary: "1 events",
          preview: ["08:02 [agent] Propofol 120 mg"],
        },
      },
    ];
    render(<LiveResults events={events} />);
    expect(screen.getByText("EventExtractor")).toBeInTheDocument();
    expect(screen.getByText("08:02 [agent] Propofol 120 mg")).toBeInTheDocument();
  });

  it("falls back to the summary when a step has no preview", () => {
    const events: RunEvent[] = [
      { event: "agent_end", data: { agent: "ClaimVerifier", summary: "verified" } },
    ];
    render(<LiveResults events={events} />);
    expect(screen.getByText("verified")).toBeInTheDocument();
  });
});
