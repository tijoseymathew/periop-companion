/**
 * Generation progress (brief §4.4): real per-step progress from the stage-run
 * SSE stream, not a bare spinner, and an explicit "safe to leave" reassurance.
 */
import type { StageKey } from "../lib/schema";
import type { RunEvent } from "../lib/sse";

function line(event: RunEvent): { text: string; done: boolean } | null {
  switch (event.event) {
    case "stage_start":
      return { text: `Starting ${String(event.data.stage ?? "")}`, done: true };
    case "agent_start":
      return { text: `${event.data.agent} working…`, done: false };
    case "agent_end":
      return { text: `${event.data.agent} — ${event.data.summary ?? "done"}`, done: true };
    case "artifact_complete":
      return { text: `${event.data.artifact_id} (${event.data.claims} claims)`, done: true };
    case "status":
      return event.data.message ? { text: String(event.data.message), done: true } : null;
    case "complete":
      return { text: "complete — loading the review…", done: true };
    default:
      return null;
  }
}

export function RunProgress({
  stage: _stage,
  events,
  onWorklist,
}: {
  stage: StageKey;
  events: RunEvent[];
  onWorklist: () => void;
}) {
  const rows = events.map(line).filter((r): r is { text: string; done: boolean } => r !== null);
  return (
    <div
      data-testid="run-progress"
      className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 py-9"
    >
      <div className="w-full max-w-xl">
        <div className="rounded-2xl border border-surface-line bg-surface-raised p-6">
          <div className="mb-5 flex items-center gap-3.5">
            <span className="h-5 w-5 flex-none animate-spin rounded-full border-2 border-surface-overlay border-t-brand" />
            <div className="text-[15px] font-medium">Generating…</div>
          </div>
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-3">
                <span
                  className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 text-[11px] ${
                    r.done
                      ? "border-status-supported text-status-supported"
                      : "border-brand text-brand"
                  }`}
                >
                  {r.done ? "✓" : ""}
                </span>
                <span className="flex-1 font-mono text-[12.5px] text-ink-secondary">{r.text}</span>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="font-mono text-[12.5px] text-ink-subtle">starting…</li>
            )}
          </ul>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-brand/20 bg-brand/[0.07] px-4 py-3.5">
          <span className="text-brand" aria-hidden>
            ✓
          </span>
          <span className="text-[13.5px] text-brand-soft">
            Safe to close this. You'll find the case waiting on your worklist.
          </span>
        </div>
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={onWorklist}
            className="min-h-[44px] rounded-lg border border-surface-line px-5 py-2.5 text-[13.5px] text-ink-primary hover:border-brand hover:text-brand"
          >
            Back to worklist
          </button>
        </div>
      </div>
    </div>
  );
}
