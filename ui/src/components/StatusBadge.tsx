import type { ClaimStatus } from "../lib/schema";

/** One glyph vocabulary across CLI, static HTML, and this UI (ui.md §6),
 * aligned to the imported design's status icons. */
export const STATUS_GLYPHS: Record<ClaimStatus, string> = {
  supported: "✓",
  unsupported: "⚠",
  conflicting: "✕",
  inference: "→",
  unverified: "○",
};

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  supported: "Supported",
  unsupported: "Unsupported",
  conflicting: "Conflicting",
  inference: "Inference",
  unverified: "Unverified",
};

export const STATUS_TEXT: Record<ClaimStatus, string> = {
  supported: "text-status-supported",
  unsupported: "text-status-unsupported",
  conflicting: "text-status-conflicting",
  inference: "text-status-inference",
  unverified: "text-status-unverified",
};

/**
 * Verification status badge. The design's default treatment is icon + label
 * ("iconLabel"): immediately scannable, air-traffic-legible (brief §3). A
 * compact `icon` variant serves the worklist count strips.
 */
export function StatusBadge({
  status,
  variant = "iconLabel",
}: {
  status: ClaimStatus;
  variant?: "iconLabel" | "icon";
}) {
  if (variant === "icon") {
    return (
      <span
        role="img"
        aria-label={status}
        title={STATUS_LABEL[status]}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs ${STATUS_TEXT[status]}`}
      >
        {STATUS_GLYPHS[status]}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={status}
      title={STATUS_LABEL[status]}
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${STATUS_TEXT[status]}`}
    >
      <span aria-hidden className="text-[13px]">
        {STATUS_GLYPHS[status]}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}
