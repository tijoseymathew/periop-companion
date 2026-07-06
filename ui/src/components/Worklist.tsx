/**
 * Left sidebar worklist (spec v2 §6.8): many concurrent cases at different
 * stages, scannable at a glance. Each row answers "what needs me": label,
 * headline stage + status in words, who performed the last stage, and the
 * existing claim-status strip (conflict indicator) + audio marker. The claim
 * status filter toggles of ui.md §5.2 stay at the bottom.
 */
import { LayoutGrid, Plus, Volume2 } from "lucide-react";
import type { StatusFilters } from "../lib/filters";
import {
  CLAIM_STATUSES,
  STAGE_KEYS,
  STAGE_STATUSES,
  type CaseSummary,
  type ClaimStatus,
  type Provider,
  type Workflow,
} from "../lib/schema";
import {
  filterWorklist,
  headline,
  STAGE_TITLES,
  STATUS_WORDS,
  type WorklistFilters,
} from "../lib/workflow";
import { STATUS_GLYPHS, STATUS_TEXT } from "./StatusBadge";

/** The provider who acted most recently: the last stage carrying an attribution. */
function lastActor(workflow: Workflow | null, providers: Provider[]): string | null {
  if (!workflow) return null;
  const acted = STAGE_KEYS.map((k) => workflow.stages[k].performed_by).filter(Boolean);
  const id = acted[acted.length - 1];
  if (!id) return null;
  return providers.find((p) => p.provider_id === id)?.name ?? id;
}

export function Worklist({
  cases,
  providers,
  selectedId,
  onSelect,
  onNewCase,
  filters,
  onToggleFilter,
  workFilters,
  onWorkFilters,
  me = null,
  onDepartment,
  className,
}: {
  cases: CaseSummary[];
  providers: Provider[];
  selectedId: string | null;
  onSelect: (caseId: string) => void;
  onNewCase: () => void;
  filters: StatusFilters;
  onToggleFilter: (status: ClaimStatus) => void;
  workFilters: WorklistFilters;
  onWorkFilters: (filters: WorklistFilters) => void;
  /** the picked provider — powers the "my cases" filter (v2 W6b) */
  me?: string | null;
  /** opens the department dashboard (v2 W6c) */
  onDepartment?: () => void;
  /** shell-level responsive classes (tablet drawer, v2 W6d) */
  className?: string;
}) {
  const rows = filterWorklist(cases, workFilters, me);
  return (
    <aside
      data-testid="worklist"
      className={`flex w-80 shrink-0 flex-col border-r border-surface-overlay bg-surface-raised ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 border-b border-surface-overlay p-3">
        <button
          type="button"
          onClick={onNewCase}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded bg-brand px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" aria-hidden /> New case
        </button>
        {onDepartment && (
          <button
            type="button"
            onClick={onDepartment}
            className="flex min-h-[44px] items-center gap-1.5 rounded border border-surface-overlay px-3 py-2 text-sm text-ink-secondary hover:border-brand hover:text-brand"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden /> Department
          </button>
        )}
      </div>
      <div className="flex gap-2 border-b border-surface-overlay p-3 text-xs">
        <label className="flex flex-1 flex-col gap-0.5 text-ink-subtle">
          Stage
          <select
            value={workFilters.stage}
            onChange={(e) =>
              onWorkFilters({ ...workFilters, stage: e.target.value as WorklistFilters["stage"] })
            }
            className="rounded border border-surface-overlay bg-surface-sunken px-1.5 py-1.5 text-sm text-ink-primary"
          >
            <option value="all">All</option>
            {STAGE_KEYS.map((k) => (
              <option key={k} value={k}>
                {STAGE_TITLES[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-0.5 text-ink-subtle">
          Status
          <select
            value={workFilters.status}
            onChange={(e) =>
              onWorkFilters({ ...workFilters, status: e.target.value as WorklistFilters["status"] })
            }
            className="rounded border border-surface-overlay bg-surface-sunken px-1.5 py-1.5 text-sm text-ink-primary"
          >
            <option value="all">All</option>
            {STAGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_WORDS[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={workFilters.mine}
          disabled={!me}
          title={me ? "Show only cases you touched" : "Choose your name first"}
          onClick={() => onWorkFilters({ ...workFilters, mine: !workFilters.mine })}
          className={`self-end rounded border px-2.5 py-2 text-sm ${
            workFilters.mine
              ? "border-brand text-brand"
              : "border-surface-overlay text-ink-secondary"
          } disabled:opacity-40`}
        >
          My cases
        </button>
      </div>
      <div role="listbox" aria-label="Cases" className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((summary) => {
          const actor = lastActor(summary.workflow, providers);
          return (
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
                <span className={summary.label ? "text-sm font-medium" : "font-mono text-sm"}>
                  {summary.label ?? summary.case_id}
                </span>
                {summary.has_audio && (
                  <span role="img" aria-label="audio available" title="audio available">
                    <Volume2 className="h-4 w-4 text-brand" />
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-ink-secondary">
                {headline(summary.workflow)}
                {actor && <span className="text-ink-subtle"> · {actor}</span>}
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
          );
        })}
        {rows.length === 0 && (
          <p className="p-4 text-sm text-ink-subtle">
            No cases match these filters. Clear the stage and status filters to see everything.
          </p>
        )}
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
