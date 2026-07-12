/**
 * Department worklist (PeriOp Catch-Up.dc.html "WORKLIST"). A calm table of
 * cases: the ones waiting for you carry a rust edge and a "Catch up →" action,
 * the rest read as in-progress. Segments and search are client-side over the
 * summaries the API already returns.
 */
import { useMemo, useState, type ReactNode } from "react";
import { STAGE_DISPLAY, type WorklistRow } from "../../lib/catchup";

export function Worklist({
  rows,
  providerControl,
  onOpen,
  onNewCase,
  onStock,
}: {
  rows: WorklistRow[];
  providerControl?: ReactNode;
  onOpen: (caseId: string) => void;
  onNewCase: () => void;
  onStock?: () => void;
}) {
  // null = auto: follow the data (show "waiting for you" when it has cases,
  // otherwise fall back to all). An explicit click pins the choice.
  const [segment, setSegment] = useState<"you" | "all" | null>(null);
  const [query, setQuery] = useState("");

  const forYouCount = rows.filter((r) => r.forYou).length;
  const effective: "you" | "all" = segment ?? (forYouCount > 0 ? "you" : "all");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (effective === "you") list = list.filter((r) => r.forYou);
    else list = list.slice().sort((a, b) => (b.forYou ? 1 : 0) - (a.forYou ? 1 : 0));
    if (q)
      list = list.filter(
        (r) => r.title.toLowerCase().includes(q) || r.caseId.toLowerCase().includes(q),
      );
    return list;
  }, [rows, effective, query]);

  const segments: { key: "you" | "all"; label: string; count: number }[] = [
    { key: "you", label: "Waiting for you", count: forYouCount },
    { key: "all", label: "All cases", count: rows.length },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-none items-end justify-between gap-6 border-b border-surface-chromeline px-10 pb-5 pt-6">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[.14em] text-gold">
            Department worklist
          </div>
          <h1 className="mt-2 font-serif text-[32px] font-medium text-ink-primary">Cases</h1>
          <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-secondary">
            You won't have met most of these patients. Each one opens to a one-minute catch-up —
            everything you need, and who's responsible at each step.
          </p>
        </div>
        <div className="flex flex-none items-center gap-3">
          {onStock && (
            <button
              type="button"
              onClick={onStock}
              className="flex min-h-[48px] flex-none items-center rounded-[11px] border border-surface-overlay bg-surface-panel px-5 py-3 text-[14px] font-semibold text-ink-muted hover:text-ink-primary"
            >
              Equipment stock
            </button>
          )}
          <button
            type="button"
            onClick={onNewCase}
            className="flex min-h-[48px] flex-none items-center rounded-[11px] bg-brand px-5 py-3 text-[15px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] hover:bg-brand-soft"
          >
            + &nbsp;New case intake
          </button>
        </div>
      </div>

      <div className="flex flex-none items-center gap-4 border-b border-surface-line px-10 py-4">
        <div className="flex rounded-[11px] border border-surface-overlay bg-surface-panel p-[3px]">
          {segments.map((s) => {
            const on = effective === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSegment(s.key)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13.5px] font-semibold ${
                  on
                    ? "bg-surface-base text-ink-primary shadow-[0_1px_2px_rgba(35,27,15,.08)]"
                    : "text-ink-dim"
                }`}
              >
                {s.label}
                <span
                  className={`rounded-full px-[7px] py-px text-[11.5px] font-bold ${
                    on ? "bg-brand text-ink-onBrand" : "bg-[#E0D8C9] text-ink-dim"
                  }`}
                >
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        {providerControl}
        <div className="flex w-[260px] flex-none items-center gap-2.5 rounded-[10px] border border-surface-overlay bg-surface-sunken px-3 py-2.5">
          <span className="text-[14px] text-ink-faint">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patient or case number"
            className="w-full border-none bg-transparent text-[14px] text-ink-primary outline-none placeholder:text-ink-ghost"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-10">
        <div className="sticky top-0 grid grid-cols-[130px_1.6fr_120px_1.6fr_150px] gap-3.5 bg-surface-base px-4 pb-2.5 pt-3.5 text-[11px] font-bold uppercase tracking-[.08em] text-ink-faint">
          <div>Case</div>
          <div>Patient / case</div>
          <div>Stage</div>
          <div>Status</div>
          <div />
        </div>
        {shown.map((c) => {
          const stage = c.stage ? STAGE_DISPLAY[c.stage] : null;
          return (
            <button
              key={c.caseId}
              type="button"
              onClick={() => onOpen(c.caseId)}
              className="grid w-full grid-cols-[130px_1.6fr_120px_1.6fr_150px] items-center gap-3.5 border-t border-surface-line px-4 py-4 text-left"
              style={{ borderLeft: `3px solid ${c.forYou ? "#A24B2E" : "transparent"}` }}
            >
              <div className="text-[13.5px] font-semibold text-ink-muted">{c.caseId}</div>
              <div>
                <div className="text-[15px] font-semibold text-ink-primary">{c.title}</div>
                <div className="mt-px text-[12.5px] text-ink-subtle">{c.subtitle}</div>
              </div>
              <div>
                {stage ? (
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${stage.className}`}
                  >
                    {stage.short}
                  </span>
                ) : (
                  <span className="text-[12.5px] text-ink-ghost">—</span>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[13.5px] text-ink-muted">{c.statusText}</span>
                {c.withText && (
                  <span
                    className="text-[12px] font-semibold"
                    style={{ color: c.forYou ? "#A24B2E" : "#9a917f" }}
                  >
                    {c.withText}
                  </span>
                )}
              </div>
              <div className="text-right">
                {c.forYou ? (
                  <span className="inline-flex items-center gap-1.5 rounded-[9px] bg-brand px-3.5 py-2 text-[13px] font-semibold text-ink-onBrand">
                    {c.actionLabel} →
                  </span>
                ) : (
                  <span className="text-[12.5px] text-ink-ghost">
                    {c.generated ? "Catch up" : "In progress"}
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {shown.length === 0 && (
          <p className="border-t border-surface-line px-4 py-10 text-center text-[14px] text-ink-subtle">
            {effective === "you"
              ? "Nothing is waiting for you right now."
              : "No cases match your search."}
          </p>
        )}
      </div>
    </div>
  );
}
