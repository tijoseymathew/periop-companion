/**
 * Stage rail (spec v2 §6): the Pre-op / Intra-op / Post-op stepper above the
 * center pane for live cases — each step shows its status in plain words, so
 * the case's position in the lifecycle is always visible.
 */
import { STAGE_KEYS, type StageKey, type Workflow } from "../lib/schema";
import { STAGE_TITLES, STATUS_WORDS } from "../lib/workflow";

export function StageRail({
  workflow,
  active,
  onSelect,
}: {
  workflow: Workflow;
  active: StageKey;
  onSelect: (stage: StageKey) => void;
}) {
  return (
    <div role="tablist" aria-label="Stages" className="flex border-b border-surface-overlay">
      {STAGE_KEYS.map((key) => {
        const state = workflow.stages[key];
        const isActive = key === active;
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onSelect(key)}
            className={`min-h-[44px] flex-1 border-b-2 px-4 py-2 text-left ${
              isActive
                ? "border-brand bg-surface-overlay/40"
                : "border-transparent hover:bg-surface-overlay/20"
            }`}
          >
            <span className="block text-sm font-medium">{STAGE_TITLES[key]}</span>
            <span
              className={`block text-xs ${
                state.status === "signed_off" ? "text-status-supported" : "text-ink-subtle"
              }`}
            >
              {STATUS_WORDS[state.status]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
