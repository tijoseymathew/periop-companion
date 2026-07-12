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
      className="min-w-0 flex-1 cursor-pointer bg-surface-sunken hover:bg-surface-panel"
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-1">
      {gutter}
      <div className="flex h-full w-[1160px] max-w-full flex-none flex-col overflow-hidden border-x border-surface-chromeline bg-surface-base shadow-[0_0_28px_rgba(35,27,15,.06)]">
        {children}
      </div>
      {gutter}
    </div>
  );
}
