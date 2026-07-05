import { Volume2 } from "lucide-react";
import type { StatusFilters } from "../lib/filters";
import { CLAIM_STATUSES, type CaseSummary, type ClaimStatus } from "../lib/schema";
import { STATUS_GLYPHS, STATUS_TEXT } from "./StatusBadge";

/** Left sidebar (ui.md §5.2): case list + claim-status filter toggles. */
export function CaseList({
  cases,
  selectedId,
  onSelect,
  filters,
  onToggleFilter,
}: {
  cases: CaseSummary[];
  selectedId: string | null;
  onSelect: (caseId: string) => void;
  filters: StatusFilters;
  onToggleFilter: (status: ClaimStatus) => void;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-surface-overlay bg-surface-raised">
      <div role="listbox" aria-label="Cases" className="min-h-0 flex-1 overflow-y-auto">
        {cases.map((summary) => (
          <div
            key={summary.case_id}
            role="option"
            aria-selected={summary.case_id === selectedId}
            onClick={() => onSelect(summary.case_id)}
            className={`cursor-pointer border-b border-surface-overlay/40 px-4 py-3 ${
              summary.case_id === selectedId
                ? "border-l-2 border-l-brand bg-surface-overlay/50"
                : "hover:bg-surface-overlay/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm">{summary.case_id}</span>
              {summary.has_audio && (
                <span role="img" aria-label="audio available" title="audio available">
                  <Volume2 className="h-4 w-4 text-brand" />
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-ink-subtle">
              {summary.artifact_count} artifacts · {summary.claim_count} claims
            </div>
            <div className="mt-1 flex gap-2 font-mono text-xs">
              {CLAIM_STATUSES.filter((s) => (summary.status_counts[s] ?? 0) > 0).map((s) => (
                <span key={s} className={STATUS_TEXT[s]} title={s}>
                  {STATUS_GLYPHS[s]}
                  {summary.status_counts[s]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-surface-overlay p-3">
        <div className="mb-1.5 text-xs uppercase tracking-wide text-ink-subtle">
          show statuses
        </div>
        <div className="flex gap-1">
          {CLAIM_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              aria-label={`filter ${status}`}
              aria-pressed={filters[status]}
              title={status}
              onClick={() => onToggleFilter(status)}
              className={`flex h-7 w-9 items-center justify-center rounded border font-mono text-sm ${
                filters[status]
                  ? `border-current ${STATUS_TEXT[status]}`
                  : "border-surface-overlay text-ink-subtle opacity-40"
              }`}
            >
              {STATUS_GLYPHS[status]}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
