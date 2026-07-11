/**
 * SSE stage-run client (ui.md §7). `EventSource` cannot POST, so the stream
 * is read with fetch + ReadableStream — the blueprint's own workaround for
 * exactly this. Events are forwarded as they arrive; a server `error` event
 * or a non-200 gate response rejects with its message.
 */

export interface RunEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface AgentResult {
  agent: string;
  summary: string;
  /** short lines of what the step actually produced (backend's
   * agents.context.preview_texts) — empty when the step attached none. */
  preview: string[];
}

/** Every agent step completed so far, in order, each with whatever preview
 * it attached — the provider's live look at what intra-op event extraction,
 * the record writer, etc. are actually finding/drafting, not just a count. */
export function agentResults(events: RunEvent[]): AgentResult[] {
  return events
    .filter((e) => e.event === "agent_end")
    .map((e) => ({
      agent: String(e.data.agent ?? ""),
      summary: String(e.data.summary ?? ""),
      preview: Array.isArray(e.data.preview) ? e.data.preview.map(String) : [],
    }));
}

/** One human line for a stage-run event, or null for events with nothing
 * to show (e.g. the terminal "complete"/"error" the caller handles itself). */
export function describeRunEvent(event: RunEvent): string | null {
  switch (event.event) {
    case "status":
      return event.data.message ? String(event.data.message) : null;
    case "stage_start":
      return `Starting the ${String(event.data.stage ?? "")} pipeline`;
    case "agent_start":
      return `${event.data.agent} working…`;
    case "agent_end":
      return `${event.data.agent} — ${event.data.summary ?? "done"}`;
    case "artifact_complete":
      return `${event.data.artifact_id} (${event.data.claims} claims)`;
    case "complete":
      return "Complete — opening the brief…";
    case "error":
      return `Failed: ${event.data.message ?? "stage run failed"}`;
    default:
      return null;
  }
}

function parseBlock(block: string): RunEvent | null {
  let event: string | null = null;
  let data: string | null = null;
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data = line.slice(6);
  }
  if (!event) return null;
  try {
    return { event, data: data ? JSON.parse(data) : {} };
  } catch {
    return { event, data: {} };
  }
}

export async function streamStageRun(
  caseId: string,
  stage: string,
  providerId: string,
  onEvent: (event: RunEvent) => void,
): Promise<void> {
  const resp = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}/stages/${encodeURIComponent(stage)}/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider_id: providerId }),
    },
  );
  if (!resp.ok || !resp.body) {
    const body = await resp.json().catch(() => null);
    throw new Error(
      (body as { detail?: string } | null)?.detail ?? `stage run failed (${resp.status})`,
    );
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let failure: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const parsed = parseBlock(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
      if (!parsed) continue;
      onEvent(parsed);
      if (parsed.event === "error") {
        failure = String(parsed.data.message ?? "stage run failed");
      }
    }
  }
  if (failure) throw new Error(failure);
}
