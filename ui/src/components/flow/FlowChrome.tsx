/**
 * Case chrome for the capture flow (PeriOp Workflow.dc.html top bar + stage /
 * sub-stage pills). Wraps every capture screen so the provider always sees
 * who the patient is, which stage the case is in, who holds it, and where
 * this screen sits in the stage's steps. The brief keeps its own header —
 * this chrome belongs to the flow that feeds it.
 */
import type { ReactNode } from "react";
import { providerChain, STAGE_DISPLAY, type ChainNode } from "../../lib/catchup";
import { subLabel, subPills, type FlowScreen } from "../../lib/flow";
import { stageNodeState, STAGE_TITLES } from "../../lib/workflow";
import { STAGE_KEYS, type Case, type Provider, type StageKey } from "../../lib/schema";

export function FlowChrome({
  kase,
  stage,
  screen,
  fallbackTitle,
  providers,
  providerControl,
  onBack,
  onSelectScreen,
  canReach,
  generating = null,
  children,
}: {
  kase: Case | null;
  stage: StageKey;
  screen: FlowScreen;
  /** shown while the case doesn't exist yet (new intake) */
  fallbackTitle: string;
  providers: Provider[];
  providerControl?: ReactNode;
  onBack: () => void;
  onSelectScreen: (screen: FlowScreen) => void;
  /** which pills may be clicked (the current one never is) */
  canReach: (screen: FlowScreen) => boolean;
  /** non-null while a stage run is streaming — replaces the sub-stage pills
   * with a minimal live-status strip instead of taking over the screen */
  generating?: string | null;
  children: ReactNode;
}) {
  const chip = STAGE_DISPLAY[stage];
  const chain = providerChain(kase?.workflow ?? null, providers);
  const pills = subPills(stage, screen);

  const reachable = (key: FlowScreen) => key !== screen && canReach(key);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* top bar: back · patient · status chip · provider chain */}
      <div className="flex-none bg-surface-chrome px-10 pt-4">
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="text-[13px] font-semibold text-ink-dim hover:text-ink-primary"
          >
            ‹ Worklist
          </button>
          {providerControl}
        </div>
        <div className="mt-1 flex items-end justify-between gap-6 pb-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-serif text-[24px] font-medium leading-none text-ink-primary">
                {kase ? (kase.label ?? kase.case_id) : fallbackTitle}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${chip.className}`}
              >
                {chip.long}
              </span>
            </div>
            {kase && (
              <div className="mt-1 text-[13px] text-ink-dim">Case {kase.case_id}</div>
            )}
          </div>
          <Chain chain={chain} />
        </div>
      </div>

      {/* stage › sub-stage pills */}
      <div className="flex flex-none flex-wrap items-center gap-5 border-b border-surface-chromeline bg-surface-chrome px-10 pb-3.5">
        <div className="inline-flex flex-none items-center gap-2 rounded-full bg-brand px-4 py-2 text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset]">
          <span className="text-[10px] font-bold uppercase tracking-[.13em] opacity-70">
            Stage
          </span>
          <span className="text-[13.5px] font-semibold">{STAGE_TITLES[stage]}</span>
          <span className="text-[12px] opacity-50">›</span>
          <span className="text-[13.5px] font-semibold opacity-90">
            {subLabel(stage, screen)}
          </span>
        </div>

        <div className="flex flex-1 items-center">
          {STAGE_KEYS.map((key, i) => {
            const state = kase ? stageNodeState(kase, key) : key === "preop" ? "current" : "todo";
            const current = state === "current";
            const done = state === "done";
            return (
              <div key={key} className="flex items-center">
                {i > 0 && <div className="mx-1 h-px w-8 bg-surface-overlay" />}
                <span
                  className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 ${
                    current ? "border-surface-overlay bg-surface-panel" : "border-transparent"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                      done
                        ? "bg-status-supported text-ink-onBrand"
                        : current
                          ? "bg-brand text-ink-onBrand"
                          : "border-2 border-surface-overlay bg-surface-panel text-ink-dim"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span
                    className={`text-[13px] font-semibold ${
                      current ? "text-ink-primary" : done ? "text-ink-muted" : "text-ink-dim"
                    }`}
                  >
                    {STAGE_TITLES[key]}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {generating !== null ? (
          <div
            data-testid="generating-strip"
            className="flex flex-none items-center gap-2.5 rounded-xl border border-brand/30 bg-brand/[0.07] px-3.5 py-2"
          >
            <span
              className="h-3.5 w-3.5 flex-none rounded-full border-2 border-transparent border-t-brand"
              style={{ animation: "spin .8s linear infinite" }}
            />
            <span className="max-w-[280px] truncate text-[12.5px] font-medium text-brand-ink">
              {generating || "Working…"}
            </span>
          </div>
        ) : (
          <div className="flex flex-none gap-1.5 rounded-xl border border-surface-overlay bg-surface-panel p-1">
            {pills.map((p) => {
              const on = p.state === "current";
              const can = reachable(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={!can}
                  onClick={() => onSelectScreen(p.key)}
                  className={`inline-flex min-h-[36px] items-center gap-2 rounded-lg px-3.5 text-[12.5px] ${
                    on
                      ? "bg-surface-base font-semibold text-ink-primary shadow-[0_1px_2px_rgba(35,27,15,.08)]"
                      : `font-medium text-ink-dim ${can ? "hover:text-ink-primary" : "cursor-default"}`
                  }`}
                >
                  <span
                    className={`flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full text-[9px] font-bold ${
                      p.state === "done"
                        ? "bg-status-supported/20 text-status-supported"
                        : on
                          ? "bg-brand text-ink-onBrand"
                          : "bg-[#E0D8C9] text-ink-dim"
                    }`}
                  >
                    {p.state === "done" ? "✓" : on ? "•" : ""}
                  </span>
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/** Compact provider chain (role + name); the brief renders the fuller one. */
function Chain({ chain }: { chain: ChainNode[] }) {
  if (chain.length === 0) return <div />;
  return (
    <div className="flex flex-none items-center">
      {chain.map((p, i) => {
        const cur = p.state === "current";
        return (
          <div key={i} className="flex items-center">
            {i > 0 && <div className="h-px w-4 flex-none bg-surface-overlay" />}
            <div
              className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 ${
                cur ? "border-brand bg-brand" : "border-surface-overlay bg-surface-panel"
              }`}
            >
              <span
                className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-bold ${
                  cur ? "bg-white/20 text-ink-onBrand" : "bg-[#DCD3C2] text-ink-secondary"
                }`}
              >
                {p.initials}
              </span>
              <span className="text-left">
                <span
                  className={`block text-[8.5px] font-bold tracking-[.07em] ${
                    cur ? "text-white/80" : "text-ink-subtle"
                  }`}
                >
                  {p.role}
                </span>
                <span
                  className={`block text-[12px] font-semibold leading-tight ${
                    cur ? "text-ink-onBrand" : "text-ink-body"
                  }`}
                >
                  {p.name}
                </span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
