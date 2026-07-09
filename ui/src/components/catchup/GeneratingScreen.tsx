/**
 * Generating (PeriOp Catch-Up.dc.html "GENERATING"). The design mocks five
 * fixed steps; we drive it from the real stage-run SSE stream instead, so the
 * checkmarks reflect the pipeline actually working. "Safe to close" is honest —
 * the run continues server-side and the case reappears on the worklist.
 */
import type { RunEvent } from "../../lib/sse";

function line(event: RunEvent): string | null {
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

export function GeneratingScreen({
  title,
  events,
  onBack,
}: {
  title: string;
  events: RunEvent[];
  onBack: () => void;
}) {
  const rows = events
    .map((e) => ({ text: line(e), event: e.event }))
    .filter((r): r is { text: string; event: string } => r.text !== null);
  const done = events.some((e) => e.event === "complete");

  return (
    <div className="flex h-full flex-col items-center justify-center p-10">
      <div className="w-full max-w-[540px]">
        <div className="mb-6 text-center">
          <div className="text-[12px] font-bold uppercase tracking-[.12em] text-gold">
            Building the handoff brief
          </div>
          <div className="mt-2 font-serif text-[26px] font-medium text-ink-primary">{title}</div>
        </div>
        <div className="rounded-[16px] border border-surface-overlay bg-surface-base px-6 py-6">
          <ul className="space-y-1">
            {rows.map((r, i) => {
              const isLast = i === rows.length - 1;
              const active = isLast && !done;
              return (
                <li key={i} className="flex items-center gap-3.5 py-2.5">
                  <span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-[12px]"
                    style={{
                      borderColor: active ? "#2F6B5E" : "#5f8a52",
                      color: active ? "#2F6B5E" : "#5f8a52",
                    }}
                  >
                    {active ? (
                      <span
                        className="h-5 w-5 rounded-full border-[2.5px] border-transparent border-t-brand"
                        style={{ animation: "spin .8s linear infinite" }}
                      />
                    ) : (
                      "✓"
                    )}
                  </span>
                  <span className="flex-1 text-[15px] text-ink-primary">{r.text}</span>
                </li>
              );
            })}
            {rows.length === 0 && (
              <li className="flex items-center gap-3.5 py-2.5">
                <span
                  className="h-5 w-5 flex-none rounded-full border-[2.5px] border-transparent border-t-brand"
                  style={{ animation: "spin .8s linear infinite" }}
                />
                <span className="text-[15px] text-ink-secondary">Starting…</span>
              </li>
            )}
          </ul>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-brand/20 bg-brand/[0.07] px-4 py-3.5">
          <span className="text-[15px] text-brand-ink">✓</span>
          <span className="text-[13.5px] text-brand-ink">
            Safe to close — the brief will be waiting on your worklist.
          </span>
        </div>
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] rounded-lg border border-surface-overlay px-5 py-2.5 text-[13.5px] text-ink-primary hover:border-brand hover:text-brand-ink"
          >
            Back to worklist
          </button>
        </div>
      </div>
    </div>
  );
}
