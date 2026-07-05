import type { ClaimStatus } from "../lib/schema";

/** One glyph vocabulary across CLI, static HTML, and this UI (ui.md §6). */
export const STATUS_GLYPHS: Record<ClaimStatus, string> = {
  supported: "✓",
  unsupported: "?",
  conflicting: "✗",
  unverified: "·",
  inference: "→",
};

export const STATUS_TEXT: Record<ClaimStatus, string> = {
  supported: "text-status-supported",
  unsupported: "text-status-unsupported",
  conflicting: "text-status-conflicting",
  inference: "text-status-inference",
  unverified: "text-status-unverified",
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      role="img"
      aria-label={status}
      title={status}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-current text-xs font-bold ${STATUS_TEXT[status]}`}
    >
      {STATUS_GLYPHS[status]}
    </span>
  );
}
