/**
 * Live intermediate results during a stage run (v2-ui feedback: "possible
 * to show intermediate results of event extraction, op record writer etc.
 * Do this for other stages also"). Reads straight off the SSE stream — each
 * completed agent step's preview lines (agents.context.preview_texts on the
 * backend), appended as they land. Renders nothing while nothing has
 * finished yet, so it never competes with the record/upload UI above it.
 */
import { agentResults, type RunEvent } from "../../lib/sse";

export function LiveResults({ events }: { events: RunEvent[] }) {
  const results = agentResults(events);
  if (results.length === 0) return null;

  return (
    <div className="mt-5 rounded-[13px] border border-surface-overlay bg-surface-sunken px-4 py-4">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[.09em] text-ink-faint">
        Building live
      </div>
      <div className="space-y-3.5">
        {results.map((r, i) => (
          <div key={i}>
            <div className="text-[12.5px] font-semibold text-ink-primary">{r.agent}</div>
            {r.preview.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {r.preview.map((p, j) => (
                  <li key={j} className="flex gap-2 text-[13px] leading-snug text-ink-secondary">
                    <span className="flex-none text-ink-faint">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-0.5 text-[12.5px] text-ink-subtle">{r.summary}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
