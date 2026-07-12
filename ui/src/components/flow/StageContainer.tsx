/**
 * The identical centered column every capture-flow screen (add records,
 * interview, voice memo/interview capture) renders its content in — one
 * padding rhythm and one max-width, so stepping between screens doesn't
 * jitter (v2-ui feedback: the stage pages didn't share a layout). The column
 * always fills the chrome's height and never scrolls itself: a screen marks
 * its own scrollable regions (`min-h-0 flex-1 overflow-y-auto`) so the page
 * stays a single view (v2-ui feedback).
 */
import type { ReactNode } from "react";

export function StageContainer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col px-10 pb-8 pt-7">
      <div className={`mx-auto flex h-full w-full min-h-0 max-w-[1080px] flex-col ${className}`}>
        {children}
      </div>
    </div>
  );
}
