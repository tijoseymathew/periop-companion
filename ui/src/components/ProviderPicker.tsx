/**
 * Provider picker (spec v2 §5.1): a name/role select whose honest job is
 * stamping attribution — not an identity system, and the product's only
 * "setup" (v2 §6.6).
 */
import type { Provider } from "../lib/schema";

export function ProviderPicker({
  providers,
  selected,
  onSelect,
}: {
  providers: Provider[];
  selected: string | null;
  onSelect: (providerId: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-subtle">
      Working as
      <select
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="min-h-[32px] rounded border border-surface-overlay bg-surface-sunken px-2 py-1 text-sm text-ink-primary"
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
    </label>
  );
}
