/**
 * The identical centered column every capture-flow screen (add records,
 * interview, voice memo/interview capture) renders its content in — one
 * padding rhythm and one max-width, so stepping between screens doesn't
 * jitter (v2-ui feedback: the stage pages didn't share a layout).
 */
import type { ReactNode } from "react";

export function StageContainer({
  children,
  fullHeight = false,
  className = "",
}: {
  children: ReactNode;
  /** the screen needs the full viewport height (e.g. a centered record
   * button) rather than top-aligned content that scrolls */
  fullHeight?: boolean;
  className?: string;
}) {
  if (fullHeight) {
    return (
      <div className="flex h-full flex-col px-10 pb-14 pt-7">
        <div className={`mx-auto flex h-full w-full max-w-[1080px] flex-col ${className}`}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="px-10 pb-14 pt-7">
      <div className={`mx-auto max-w-[1080px] ${className}`}>{children}</div>
    </div>
  );
}
