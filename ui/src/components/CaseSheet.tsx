/**
 * The centered sheet every case view lives in (v2-ui feedback): the chrome
 * and the body share one column instead of the header stretching edge to
 * edge, the gutters either side read as backstage in a deeper paper shade,
 * and clicking a gutter returns to the worklist — replacing the ‹ Worklist
 * button the case screens used to carry.
 */
import type { ReactNode } from "react";

export function CaseSheet({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const gutter = (
    <button
      type="button"
      aria-label="Back to Worklist"
      title="Back to the worklist"
      onClick={onBack}
      className="group min-w-0 flex-1 cursor-pointer overflow-hidden bg-surface-sunken hover:bg-surface-panel"
    >
      {/* a resting hint that the gutter is the way back (design review:
          without it the margins read as inert and the sheet feels trapping) */}
      <span className="whitespace-nowrap text-[12.5px] font-semibold text-ink-subtle opacity-45 transition-opacity group-hover:opacity-100">
        ‹ Worklist
      </span>
    </button>
  );
  return (
    <div className="flex h-full min-h-0 flex-1">
      {gutter}
      <div className="flex h-full w-[1160px] max-w-full flex-none flex-col overflow-hidden border-x border-surface-overlay bg-surface-base shadow-[0_1px_40px_rgba(60,45,20,0.05)]">
        {children}
      </div>
      {gutter}
    </div>
  );
}
