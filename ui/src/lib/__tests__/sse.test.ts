/**
 * SSE stage-run client (ui.md §7): EventSource cannot POST, so the stream is
 * read with fetch + ReadableStream. Events surface progressively; a server
 * error event rejects with its message.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentResults, describeRunEvent, streamStageRun, type RunEvent } from "../sse";

function sseResponse(blocks: string[], ok = true, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(new TextEncoder().encode(block));
      controller.close();
    },
  });
  return {
    ok,
    status,
    body: stream,
    json: async () => ({ detail: "gate closed" }),
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("streamStageRun", () => {
  it("parses each event block and resolves on complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: status\ndata: {"message": "loading case x"}\n\n',
          'event: stage_start\ndata: {"stage": "preop"}\n\nevent: agent_start\ndata: {"stage": "preop", "agent": "GapAnalyst"}\n\n',
          'event: complete\ndata: {"case_id": "x"}\n\n',
        ]),
      ),
    );
    const events: RunEvent[] = [];
    await streamStageRun("x", "preop", "p-lim", (e) => events.push(e));
    expect(events.map((e) => e.event)).toEqual([
      "status",
      "stage_start",
      "agent_start",
      "complete",
    ]);
    expect(events[2].data.agent).toBe("GapAnalyst");
  });

  it("rejects with the server's message on an error event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(['event: error\ndata: {"message": "stage run failed"}\n\n']),
      ),
    );
    await expect(streamStageRun("x", "preop", "p-lim", () => {})).rejects.toThrow(
      "stage run failed",
    );
  });

  it("rejects with the gate's detail on a non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([], false, 409)));
    await expect(streamStageRun("x", "preop", "p-lim", () => {})).rejects.toThrow(
      "gate closed",
    );
  });
});

describe("describeRunEvent", () => {
  it("renders one line per known event kind", () => {
    expect(describeRunEvent({ event: "agent_start", data: { agent: "GapAnalyst" } })).toBe(
      "GapAnalyst working…",
    );
    expect(
      describeRunEvent({ event: "agent_end", data: { agent: "GapAnalyst", summary: "3 questions" } }),
    ).toBe("GapAnalyst — 3 questions");
    expect(
      describeRunEvent({ event: "artifact_complete", data: { artifact_id: "record:intra-op", claims: 2 } }),
    ).toBe("record:intra-op (2 claims)");
  });

  it("returns null for a status event with no message", () => {
    expect(describeRunEvent({ event: "status", data: {} })).toBeNull();
  });
});

describe("agentResults", () => {
  it("collects each completed step's preview, ignoring other event kinds", () => {
    const events: RunEvent[] = [
      { event: "agent_start", data: { agent: "EventExtractor" } },
      {
        event: "agent_end",
        data: { agent: "EventExtractor", summary: "2 events", preview: ["08:00 propofol 120"] },
      },
      { event: "agent_start", data: { agent: "IntraOpRecordWriter" } },
      { event: "agent_end", data: { agent: "IntraOpRecordWriter", summary: "1 claims" } },
    ];
    expect(agentResults(events)).toEqual([
      { agent: "EventExtractor", summary: "2 events", preview: ["08:00 propofol 120"] },
      { agent: "IntraOpRecordWriter", summary: "1 claims", preview: [] },
    ]);
  });
});
