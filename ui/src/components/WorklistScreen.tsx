/**
 * Full-screen department worklist (brief §4.1, imported design). A busy unit's
 * cases as a scannable table: identifier, label, headline stage + plain-word
 * status, who acted last, and an unmissable unresolved-conflict flag. Filterable
 * by stage. "Start a new case" is the one primary action.
 */
import type { CaseSummary, Provider, Workflow } from "../lib/schema";
import { STAGE_KEYS } from "../lib/schema";
import { filterWorklist, headline, STAGE_TITLES, type WorklistFilters } from "../lib/workflow";
import { headlineStage } from "../lib/workflow";

/** The provider who acted most recently: the last stage carrying an attribution. */
function lastActor(workflow: Workflow | null, providers: Provider[]): string | null {
  if (!workflow) return null;
  const acted = STAGE_KEYS.map((k) => workflow.stages[k].performed_by).filter(Boolean);
  const id = acted[acted.length - 1];
  if (!id) return null;
  return providers.find((p) => p.provider_id === id)?.name ?? id;
}

function stageChip(workflow: Workflow | null): string {
  if (!workflow) return "DEMO";
  const stage = headlineStage(workflow);
  if (!stage) return "COMPLETE";
  return STAGE_TITLES[stage].toUpperCase();
}

const GRID = "grid-cols-[110px_1.6fr_110px_1.6fr_130px]";

const STAGE_FILTERS: { key: WorklistFilters["stage"]; label: string }[] = [
  { key: "all", label: "All" },
  { key: "preop", label: "Pre-op" },
  { key: "intraop", label: "Intra-op" },
  { key: "postop", label: "PACU" },
];

export function WorklistScreen({
  cases,
  providers,
  workFilters,
  onWorkFilters,
  me,
  onOpen,
  onNewCase,
}: {
  cases: CaseSummary[];
  providers: Provider[];
  workFilters: WorklistFilters;
  onWorkFilters: (f: WorklistFilters) => void;
  me: string | null;
  onOpen: (caseId: string) => void;
  onNewCase: () => void;
}) {
  const rows = filterWorklist(cases, workFilters, me);
  const flagCount = cases.filter((c) => (c.status_counts.conflicting ?? 0) > 0).length;

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="worklist">
      <div className="flex flex-none items-start justify-between gap-6 border-b border-surface-overlay px-8 py-5">
        <div>
          <div className="mb-1.5 font-mono text-[11px] tracking-wide text-ink-subtle">
            DEPARTMENT WORKLIST
          </div>
          <h1 className="text-[23px] font-semibold tracking-tight">Cases</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-secondary">
            {flagCount > 0
              ? `${flagCount} ${flagCount === 1 ? "case carries" : "cases carry"} an unresolved conflict — clear these before their next stage.`
              : "No cases carry an unresolved conflict."}
          </p>
        </div>
        <button
          type="button"
          data-primary-action
          onClick={onNewCase}
          className="flex min-h-[44px] flex-none items-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.12)_inset] hover:bg-brand-soft"
        >
          + Start a new case
        </button>
      </div>

      <div className="flex flex-none items-center gap-2 border-b border-surface-line px-8 py-3.5">
        <span className="mr-1 text-xs text-ink-subtle">Stage</span>
        {STAGE_FILTERS.map((f) => {
          const on = workFilters.stage === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => onWorkFilters({ ...workFilters, stage: f.key })}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] ${
                on
                  ? "border-brand/50 bg-brand/12 font-semibold text-brand"
                  : "border-surface-line font-medium text-ink-secondary hover:text-ink-primary"
              }`}
            >
              {f.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={workFilters.mine}
          disabled={!me}
          onClick={() => onWorkFilters({ ...workFilters, mine: !workFilters.mine })}
          className={`ml-auto rounded-full border px-3.5 py-1.5 text-[13px] disabled:opacity-40 ${
            workFilters.mine
              ? "border-brand/50 bg-brand/12 font-semibold text-brand"
              : "border-surface-line font-medium text-ink-secondary"
          }`}
        >
          My cases
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <div
          className={`sticky top-0 grid ${GRID} gap-3 bg-surface-base px-4 pb-2.5 pt-3.5 font-mono text-[11px] tracking-wide text-ink-faint`}
        >
          <div>CASE</div>
          <div>LABEL</div>
          <div>STAGE</div>
          <div>STATUS</div>
          <div>LAST BY</div>
        </div>
        {rows.map((c) => {
          const flag = (c.status_counts.conflicting ?? 0) > 0;
          const actor = lastActor(c.workflow, providers);
          return (
            <button
              key={c.case_id}
              type="button"
              onClick={() => onOpen(c.case_id)}
              className={`grid w-full ${GRID} items-center gap-3 border-t border-surface-line border-l-2 px-4 py-3.5 text-left hover:bg-surface-raised/50 ${
                flag ? "border-l-status-conflicting" : "border-l-transparent"
              }`}
            >
              <div className="truncate font-mono text-[13px] text-ink-primary">{c.case_id}</div>
              <div className="min-w-0 truncate text-sm font-medium">
                {c.label ?? <span className="font-mono text-ink-subtle">no label</span>}
              </div>
              <div>
                <span className="rounded border border-surface-overlay px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-ink-secondary">
                  {stageChip(c.workflow)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] text-ink-primary">{headline(c.workflow)}</span>
                {flag && (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-status-conflicting">
                    ✕ Unresolved conflict
                  </span>
                )}
              </div>
              <div className="truncate text-[13px] text-ink-secondary">{actor ?? "—"}</div>
            </button>
          );
        })}
        {rows.length === 0 && (
          <p className="px-4 py-8 text-sm text-ink-subtle">
            No cases match this filter. Choose "All" to see every case.
          </p>
        )}
      </div>
    </div>
  );
}
