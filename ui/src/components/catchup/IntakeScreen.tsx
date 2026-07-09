/**
 * New handoff / add sources (PeriOp Catch-Up.dc.html "INTAKE"). The design
 * compresses source capture and one "Generate the brief" button; our backend
 * generates per stage behind gates (records → questions → interview → note),
 * so "Generate" kicks off the case's current stage and any gate is surfaced as
 * a plain-language notice rather than a dead end.
 */
import { useRef, useState, type ReactNode } from "react";
import type { Case } from "../../lib/schema";

const DOC_TYPES = [
  { value: "gp-summary", label: "GP summary" },
  { value: "med-list", label: "Medication list" },
  { value: "prior-anesthetic-record", label: "Prior anaesthetic record" },
  { value: "op-plan", label: "Surgical / op plan" },
  { value: "other", label: "Other document" },
];

export function IntakeScreen({
  kase,
  audioKind,
  busy,
  notice,
  canWrite,
  providerControl,
  onCreateCase,
  onUploadDocument,
  onUploadAudio,
  onGenerate,
  onBack,
}: {
  kase: Case | null;
  audioKind: string;
  busy: boolean;
  notice: string | null;
  canWrite: boolean;
  providerControl?: ReactNode;
  onCreateCase: (label: string) => void;
  onUploadDocument: (docType: string, file: File) => void;
  onUploadAudio: (file: File) => void;
  onGenerate: () => void;
  onBack: () => void;
}) {
  const [label, setLabel] = useState("");
  const [docType, setDocType] = useState("gp-summary");
  const docInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const sources = kase?.sources ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-none border-b border-surface-chromeline px-10 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="text-[13px] font-semibold text-ink-dim hover:text-ink-primary"
          >
            ‹ Worklist
          </button>
          {providerControl}
        </div>
        <h1 className="mt-2 font-serif text-[30px] font-medium text-ink-primary">
          {kase ? `Hand off ${kase.label ?? kase.case_id}` : "Start a new handoff"}
        </h1>
        <p className="mt-2 max-w-[620px] text-[14.5px] leading-relaxed text-ink-secondary">
          Add whatever you already have — prior notes and the pre-op interview. When you generate
          the brief, every fact is linked back to its source so the next doctor can trust it.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-12 pt-6">
        <div className="max-w-[760px]">
          {notice && (
            <div className="mb-6 rounded-[12px] border border-status-unsupported/40 bg-status-unsupported/[0.08] px-4 py-3 text-[13.5px] text-status-unsupported">
              {notice}
            </div>
          )}

          <Label>The patient</Label>
          {kase ? (
            <div className="mb-8 rounded-[13px] border border-surface-overlay bg-surface-sunken px-5 py-4">
              <div className="font-serif text-[23px] font-medium text-ink-primary">
                {kase.label ?? kase.case_id}
              </div>
              <div className="mt-1 text-[14px] text-ink-secondary">Case {kase.case_id}</div>
            </div>
          ) : (
            <div className="mb-8">
              <div className="mb-1.5 text-[12px] font-semibold text-ink-dim">
                Patient / case description
              </div>
              <div className="flex gap-2.5">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. James Whitfield — open inguinal hernia repair"
                  className="flex-1 rounded-[10px] border border-surface-overlay bg-surface-sunken px-3.5 py-3 text-[15px] text-ink-primary outline-none placeholder:text-ink-ghost"
                />
                <button
                  type="button"
                  disabled={!label.trim() || busy || !canWrite}
                  onClick={() => onCreateCase(label.trim())}
                  className="flex-none rounded-[10px] bg-brand px-5 py-3 text-[15px] font-semibold text-ink-onBrand disabled:opacity-40"
                >
                  Create
                </button>
              </div>
              {!canWrite && (
                <p className="mt-2 text-[12.5px] text-ink-subtle">
                  Pick a provider (top right) to create a case.
                </p>
              )}
            </div>
          )}

          <Label>Records &amp; interview</Label>
          {sources.map((s) => {
            const audio = s.type === "audio";
            return (
              <div
                key={s.source_id}
                className="mb-2.5 flex items-center gap-3.5 rounded-[12px] border border-surface-overlay bg-surface-base px-4 py-3.5"
              >
                <span
                  className={`flex h-[34px] w-[34px] flex-none items-center justify-center text-[14px] ${
                    audio
                      ? "rounded-full bg-brand/12 text-brand-ink"
                      : "rounded-lg bg-[#EBE4D6] text-ink-secondary"
                  }`}
                >
                  {audio ? "▶" : "¶"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-ink-primary">{s.source_id}</div>
                  <div className="mt-0.5 text-[12.5px] text-ink-subtle">
                    {audio
                      ? `transcribed · ${s.segments.length} segments`
                      : `added · ${s.chunks.length} passages`}
                  </div>
                </div>
                <span className="flex-none text-[13px] font-semibold text-status-supported">
                  ✓ Added
                </span>
              </div>
            );
          })}
          {kase && sources.length === 0 && (
            <p className="mb-2.5 text-[13.5px] text-ink-subtle">No sources added yet.</p>
          )}

          {kase && canWrite && (
            <>
              <div className="mt-1.5 flex items-center gap-2.5">
                <select
                  aria-label="Document type"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="rounded-[10px] border border-surface-overlay bg-surface-sunken px-2.5 py-2 text-[13px] text-ink-secondary outline-none"
                >
                  {DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2.5 flex gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => docInput.current?.click()}
                  className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-[12px] border border-dashed border-[#cdbfa4] bg-surface-sunken px-4 text-[14px] font-semibold text-ink-secondary disabled:opacity-50"
                >
                  ¶ &nbsp;Add a document
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => audioInput.current?.click()}
                  className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-[12px] border border-dashed border-[#a9c6bd] bg-surface-sunken px-4 text-[14px] font-semibold text-brand-ink disabled:opacity-50"
                >
                  ▶ &nbsp;Upload interview
                </button>
                <input
                  ref={docInput}
                  type="file"
                  accept=".txt,.md,.json,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadDocument(docType, f);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={audioInput}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadAudio(f);
                    e.target.value = "";
                  }}
                />
              </div>

              <div className="mt-7 flex items-center gap-4 border-t border-surface-line pt-6">
                <div className="flex-1 text-[13.5px] leading-relaxed text-ink-dim">
                  {sources.length} source{sources.length === 1 ? "" : "s"} on file. Generating the{" "}
                  {audioKind.replace("-", " ")} output runs the pipeline — you can leave and come
                  back to the worklist.
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onGenerate}
                  className="flex min-h-[52px] flex-none items-center rounded-[11px] bg-brand px-6 text-[15.5px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] disabled:opacity-50"
                >
                  Generate the brief &nbsp;→
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3.5 text-[12px] font-bold uppercase tracking-[.12em] text-gold">
      {children}
    </div>
  );
}
