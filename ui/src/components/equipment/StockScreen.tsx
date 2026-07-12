/**
 * Equipment stock view: the fixed anaesthesia store with live availability.
 * Read-only — assignments happen through the case assistant during pre-op;
 * this screen shows what's on the shelf and which case holds what.
 */
import { useEffect, useState } from "react";
import { fetchEquipment } from "../../lib/api";
import type { StockLevel } from "../../lib/schema";

export function StockScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<StockLevel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setError(null);
    fetchEquipment()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }
  useEffect(refresh, []);

  const categories = items
    ? [...new Set(items.map((i) => i.category))]
    : [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-none items-end justify-between gap-6 border-b border-surface-chromeline px-10 pb-5 pt-6">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-[13px] font-semibold text-ink-dim hover:text-ink-primary"
          >
            ‹ Worklist
          </button>
          <div className="mt-2 text-[12px] font-bold uppercase tracking-[.14em] text-gold">
            Anaesthesia store
          </div>
          <h1 className="mt-2 font-serif text-[32px] font-medium text-ink-primary">
            Equipment stock
          </h1>
          <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-secondary">
            The fixed shelf of common anaesthesia equipment. Items are assigned to a
            case through its assistant during pre-op and return to the shelf when
            released.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex min-h-[44px] flex-none items-center rounded-[11px] border border-surface-overlay bg-surface-panel px-4 py-2.5 text-[13.5px] font-semibold text-ink-muted hover:text-ink-primary"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-10">
        {error && (
          <div className="mt-6 rounded-lg border border-status-conflicting/50 bg-status-conflicting/10 p-3 text-sm text-status-conflicting">
            {error}
          </div>
        )}
        {!items && !error && (
          <p className="px-4 py-10 text-[14px] text-ink-subtle">Loading the store…</p>
        )}
        {items &&
          categories.map((category) => (
            <section key={category} className="mt-7">
              <h2 className="px-4 text-[11px] font-bold uppercase tracking-[.1em] text-ink-faint">
                {category}
              </h2>
              <div className="mt-2 overflow-hidden rounded-xl border border-surface-line">
                <div className="grid grid-cols-[2fr_130px_110px_1.6fr] gap-3.5 border-b border-surface-line bg-surface-panel px-4 py-2.5 text-[11px] font-bold uppercase tracking-[.08em] text-ink-faint">
                  <div>Item</div>
                  <div>Available</div>
                  <div>In use</div>
                  <div>Assigned to</div>
                </div>
                {items
                  .filter((i) => i.category === category)
                  .map((item) => (
                    <div
                      key={item.item_id}
                      className="grid grid-cols-[2fr_130px_110px_1.6fr] items-center gap-3.5 border-t border-surface-line px-4 py-3 first:border-t-0"
                    >
                      <div>
                        <div className="text-[14px] font-semibold text-ink-primary">
                          {item.name}
                        </div>
                        <div className="mt-px text-[12px] text-ink-subtle">{item.item_id}</div>
                      </div>
                      <div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                            item.available === 0
                              ? "bg-status-conflicting/15 text-status-conflicting"
                              : "bg-status-supported/15 text-status-supported"
                          }`}
                        >
                          {item.available} of {item.total}
                        </span>
                      </div>
                      <div className="text-[13.5px] text-ink-muted">
                        {item.reserved > 0 ? item.reserved : "—"}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {item.reservations.length === 0 ? (
                          <span className="text-[12.5px] text-ink-ghost">Unassigned</span>
                        ) : (
                          item.reservations.map((r, i) => (
                            <span
                              key={i}
                              title={`assigned by ${r.by}`}
                              className="rounded-full border border-surface-overlay bg-surface-panel px-2.5 py-1 text-[12px] font-semibold text-ink-muted"
                            >
                              {r.case_id} × {r.qty}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}
