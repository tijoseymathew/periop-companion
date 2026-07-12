import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseChatPanel, describeToolCall } from "../chat/CaseChatPanel";
import { fetchChatHistory } from "../../lib/api";
import { streamChatTurn, type RunEvent } from "../../lib/sse";

vi.mock("../../lib/api", () => ({ fetchChatHistory: vi.fn() }));
vi.mock("../../lib/sse", () => ({ streamChatTurn: vi.fn() }));

const mockHistory = vi.mocked(fetchChatHistory);
const mockTurn = vi.mocked(streamChatTurn);

beforeEach(() => {
  vi.clearAllMocks();
  mockHistory.mockResolvedValue([]);
});

async function openPanel(me: string | null = "p-lim") {
  render(<CaseChatPanel caseId="sg-0001" me={me} />);
  await userEvent.click(screen.getByRole("button", { name: /Ask about this case/ }));
  return screen.findByTestId("case-chat-panel");
}

describe("CaseChatPanel", () => {
  it("opens from the floating button and loads history", async () => {
    mockHistory.mockResolvedValue([
      { role: "user", text: "still on aspirin?" },
      { role: "assistant", text: "Stopped last Tuesday." },
    ]);
    await openPanel();
    expect(await screen.findByText("still on aspirin?")).toBeInTheDocument();
    expect(screen.getByText("Stopped last Tuesday.")).toBeInTheDocument();
    expect(mockHistory).toHaveBeenCalledWith("sg-0001");
  });

  it("sends a turn: user bubble, tool activity, reply bubble", async () => {
    mockTurn.mockImplementation(async (_case, _msg, _me, onEvent) => {
      onEvent({
        event: "tool_call",
        data: { name: "search_case", args: { query: "aspirin" } },
      } as RunEvent);
      return "Aspirin was stopped last Tuesday (pre-op interview).";
    });
    await openPanel();
    await userEvent.type(screen.getByPlaceholderText(/Ask about this case/), "aspirin?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/stopped last Tuesday/)).toBeInTheDocument();
    expect(screen.getByText("aspirin?")).toBeInTheDocument();
    expect(screen.getByText(/Searching the record for “aspirin”/)).toBeInTheDocument();
    expect(mockTurn).toHaveBeenCalledWith("sg-0001", "aspirin?", "p-lim", expect.any(Function));
  });

  it("shows the server's message when a turn fails", async () => {
    mockTurn.mockRejectedValue(new Error("chat turn failed (503)"));
    await openPanel();
    await userEvent.type(screen.getByPlaceholderText(/Ask about this case/), "hi");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/chat turn failed \(503\)/)).toBeInTheDocument();
  });

  it("cannot send without a provider", async () => {
    await openPanel(null);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Pick a provider to chat")).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

describe("describeToolCall", () => {
  it("names the ordering tools with their arguments", () => {
    expect(
      describeToolCall("reserve_equipment", { item_id: "ett-7.0", quantity: 2 }),
    ).toBe("Reserving 2 × ett-7.0");
    expect(describeToolCall("read_source", { source_id: "doc:gp-summary" })).toBe(
      "Reading doc:gp-summary",
    );
  });
});
