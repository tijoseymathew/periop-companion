/**
 * Top "Stepper" navigation shell (imported design). For an open case it shows
 * the brand, a Worklist button, the patient identity line, a "Catch me up"
 * orientation shortcut, the three stage nodes (done/current/todo), the active
 * stage's substep pills, and a persistent unresolved-conflict banner. On the
 * worklist it collapses to brand + title. The screen body renders below it.
 */
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import type { Case, StageKey } from "../lib/schema";
import { STAGE_KEYS } from "../lib/schema";
import {
  STAGE_SUBSTEPS,
  STATUS_WORDS,
  headlineStage,
  stageNodeState,
  type SubScreen,
} from "../lib/workflow";

const STAGE_LABELS: Record<StageKey, string> = {
  preop: "Pre-op evaluation",
  intraop: "Intra-op record",
  postop: "PACU handoff",
};

function Brand() {
  return (
    <div className="flex flex-none items-center gap-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-brand">
        <div className="h-2.5 w-2.5 rounded-[3px] bg-surface-base" />
      </div>
      <span className="text-sm font-semibold">PeriOp Companion</span>
    </div>
  );
}

export function StepperShell({
  kase,
  activeStage,
  activeScreen,
  conflictCount,
  providerControl,
  onWorklist,
  onStage,
  onSubStep,
  onOrientation,
}: {
  /** the open case, or null on the worklist */
  kase: Case | null;
  activeStage: StageKey;
  activeScreen: SubScreen;
  conflictCount: number;
  providerControl: ReactNode;
  onWorklist: () => void;
  onStage: (stage: StageKey) => void;
  onSubStep: (stage: StageKey, screen: SubScreen) => void;
  onOrientation: () => void;
}) {
  const stageSub = (stage: StageKey): string => {
    if (!kase?.workflow) return "read-only";
    return STATUS_WORDS[kase.workflow.stages[stage].status];
  };

  return (
    <div className="flex-none border-b border-surface-overlay bg-surface-chrome">
      <div className="flex items-center gap-4 px-7 py-3">
        <Brand />
        {kase ? (
          <>
            <button
              type="button"
              onClick={onWorklist}
              className="flex min-h-[36px] flex-none items-center gap-1.5 rounded-lg border border-surface-line px-3 py-1.5 text-[12.5px] text-ink-secondary hover:text-ink-primary"
            >
              ← Worklist
            </button>
            <div className="h-6 w-px flex-none bg-surface-line" />
            <div className="min-w-0">
              <div className="truncate text-[14.5px] font-semibold">
                {kase.label ?? kase.case_id}{" "}
                <span className="font-mono text-xs font-normal text-ink-subtle">
                  · {kase.case_id}
                </span>
              </div>
            </div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onOrientation}
              aria-pressed={activeScreen === "orientation"}
              className={`flex min-h-[36px] flex-none items-center gap-1.5 rounded-lg border border-surface-line px-3 py-1.5 text-[12.5px] ${
                activeScreen === "orientation"
                  ? "bg-brand/10 text-brand"
                  : "text-ink-secondary hover:text-ink-primary"
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Catch me up
            </button>
            {providerControl}
          </>
        ) : (
          <>
            <div className="text-sm font-semibold text-ink-secondary">Department worklist</div>
            <div className="flex-1" />
            {providerControl}
          </>
        )}
      </div>

      {kase && (
        <>
          <div className="flex items-center px-7">
            {STAGE_KEYS.map((stage, i) => {
              const state = stageNodeState(kase, stage);
              const nodeCls =
                state === "done"
                  ? "bg-status-supported border-status-supported text-surface-base"
                  : state === "current"
                    ? "bg-brand border-brand text-ink-onBrand"
                    : "bg-surface-chrome border-surface-line text-ink-subtle";
              return (
                <div key={stage} className="flex flex-none items-center">
                  {i > 0 && (
                    <div
                      className={`mx-1.5 h-0.5 w-8 ${
                        headlineStage(kase.workflow) &&
                        STAGE_KEYS.indexOf(stage) <=
                          STAGE_KEYS.indexOf(headlineStage(kase.workflow)!)
                          ? "bg-ink-faint"
                          : "bg-surface-line"
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onStage(stage)}
                    className="flex items-center gap-2.5 py-2.5"
                  >
                    <span
                      className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 font-mono text-xs font-semibold ${nodeCls}`}
                    >
                      {state === "done" ? "✓" : i + 1}
                    </span>
                    <span className="text-left">
                      <span
                        className={`block text-[13.5px] font-semibold ${
                          state === "todo" ? "text-ink-subtle" : "text-ink-primary"
                        }`}
                      >
                        {STAGE_LABELS[stage]}
                      </span>
                      <span className="block font-mono text-[11px] text-ink-faint">
                        {stageSub(stage)}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5 px-7 pb-3 pt-2">
            {STAGE_SUBSTEPS[activeStage].map((step) => {
              const on = activeScreen === step.key;
              return (
                <button
                  key={step.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSubStep(activeStage, step.key)}
                  className={`min-h-[36px] rounded-full border border-surface-line px-3.5 py-1.5 text-[12.5px] ${
                    on
                      ? "bg-brand/12 font-semibold text-brand"
                      : "font-medium text-ink-secondary hover:text-ink-primary"
                  }`}
                >
                  {step.label}
                </button>
              );
            })}
          </div>

          {conflictCount > 0 && (
            <button
              type="button"
              onClick={() => onSubStep(activeStage, "review")}
              className="flex w-full items-center gap-2.5 border-t border-status-conflicting/20 bg-status-conflicting/[0.09] px-7 py-2.5 text-left"
            >
              <span className="text-sm text-status-conflicting" aria-hidden>
                ✕
              </span>
              <span className="flex-1 text-[13px] text-status-conflicting/90">
                This case has {conflictCount} unresolved{" "}
                {conflictCount === 1 ? "conflict" : "conflicts"}. Clear{" "}
                {conflictCount === 1 ? "it" : "them"} before the next stage.
              </span>
              <span className="flex-none text-[12.5px] font-semibold text-status-conflicting">
                Open review →
              </span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
