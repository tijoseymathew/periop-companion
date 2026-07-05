import type { Case, Event } from "../lib/schema";
import { ProvenanceChip } from "./ProvenanceChip";

/** Structured intra-op events (ui.md §5.3) — same chip interaction as claims. */
export function EventsTable({
  kase,
  events,
  onActivateRef,
}: {
  kase: Case;
  events: Event[];
  onActivateRef: (ref: string) => void;
}) {
  return (
    <table className="mt-3 w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-ink-subtle">
          <th className="py-1 pr-3 font-medium">time</th>
          <th className="py-1 pr-3 font-medium">category</th>
          <th className="py-1 pr-3 font-medium">value</th>
          <th className="py-1 pr-3 font-medium">units</th>
          <th className="py-1 font-medium">provenance</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event, i) => (
          <tr key={i} className="border-t border-surface-overlay/50 align-top">
            <td className="py-1.5 pr-3 font-mono text-xs">{event.t}</td>
            <td className="py-1.5 pr-3">{event.category}</td>
            <td className="py-1.5 pr-3">{event.value}</td>
            <td className="py-1.5 pr-3">{event.units ?? ""}</td>
            <td className="py-1.5">
              <div className="flex flex-wrap gap-1">
                {event.provenance.map((ref) => (
                  <ProvenanceChip key={ref} kase={kase} refStr={ref} onActivate={onActivateRef} />
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
