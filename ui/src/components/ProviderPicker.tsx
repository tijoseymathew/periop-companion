/**
 * Provider picker (spec v2 §5.1): a name/role select whose honest job is
 * stamping attribution — not an identity system, and the product's only
 * "setup" (v2 §6.6). Rendered as an avatar + compact select to match the
 * imported design's header treatment.
 */
import type { Provider } from "../lib/schema";

/** First-letters of a provider's name, e.g. "Dr. A. Reyes" → "AR". */
export function providerInitials(name: string): string {
  const parts = name.replace(/^dr\.?\s*/i, "").split(/\s+/).filter(Boolean);
  const letters = parts.map((p) => p[0]).filter((c) => /[a-z]/i.test(c));
  return (letters[0] ?? "") + (letters[letters.length - 1] ?? "");
}

export function ProviderPicker({
  providers,
  selected,
  onSelect,
}: {
  providers: Provider[];
  selected: string | null;
  onSelect: (providerId: string) => void;
}) {
  const me = providers.find((p) => p.provider_id === selected) ?? null;
  return (
    <label className="flex flex-none items-center gap-2" title="Working as (attribution only)">
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-full border border-surface-line bg-surface-overlay text-xs font-semibold text-brand-soft"
      >
        {me ? providerInitials(me.name).toUpperCase() : "?"}
      </span>
      {/* appearance-none + own chevron: the raw browser select was the one
          off-palette element in the chrome (design review) */}
      <span className="relative flex items-center">
        <select
          aria-label="Working as"
          value={selected ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          className="min-h-[32px] appearance-none rounded-lg border border-surface-overlay bg-surface-sunken py-1 pl-2.5 pr-7 text-xs font-medium text-ink-secondary outline-none focus:border-brand"
        >
          <option value="" disabled>
            Choose your name
          </option>
          {providers.map((p) => (
            <option key={p.provider_id} value={p.provider_id}>
              {p.name} ({p.role})
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-2.5 text-[9px] text-ink-dim"
        >
          ▾
        </span>
      </span>
    </label>
  );
}
