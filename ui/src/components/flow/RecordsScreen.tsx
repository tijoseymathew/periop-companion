/**
 * Pre-op · Add the records (PeriOp Workflow.dc.html "isRecords"). Describe
 * the case, stage the documents with a tag each, then one "Create intake"
 * action creates the case, saves every record, and kicks off question prep.
 * The case description doubles as the operative-plan record (doc:op-plan) —
 * the backend's intake gate needs the op plan plus one record, so a described
 * case with one tagged document is immediately buildable.
 */
import { useRef, useState, type ReactNode } from "react";
import type { Case } from "../../lib/schema";

export interface StagedDoc {
  file: File;
  tag: string;
}

export const DOC_TAGS: { value: string; label: string }[] = [
  { value: "gp-summary", label: "GP summary" },
  { value: "med-list", label: "Medication list" },
  { value: "prior-anesthetic-record", label: "Prior anaesthetic" },
  { value: "other", label: "Other document" },
];

const RECOMMENDED = [
  { key: "description", label: "Case description / op plan" },
  { key: "gp-summary", label: "GP summary letter" },
  { key: "med-list", label: "Medication list" },
  { key: "prior-anesthetic-record", label: "Prior anaesthetic record" },
];

function guessTag(name: string, free: string[]): string {
  const n = name.toLowerCase();
  const guess = /gp|summary|letter/.test(n)
    ? "gp-summary"
    : /med|drug|prescri/.test(n)
      ? "med-list"
      : /ana?esthetic|anesthesia/.test(n)
        ? "prior-anesthetic-record"
        : "other";
  return free.includes(guess) ? guess : (free[0] ?? "other");
}

export function RecordsScreen({
  kase,
  busy,
  notice,
  canWrite,
  onCreateIntake,
  onUploadDocument,
  onContinue,
}: {
  kase: Case | null;
  busy: boolean;
  notice: string | null;
  canWrite: boolean;
  /** new case: create it, save the description as the op plan, upload docs */
  onCreateIntake: (name: string, description: string, docs: StagedDoc[]) => void;
  /** existing case: records land as they're picked */
  onUploadDocument: (docType: string, file: File) => void;
  onContinue: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [staged, setStaged] = useState<StagedDoc[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const existingDocs = (kase?.sources ?? []).filter((s) => s.type === "document");
  const usedTags = new Set([
    ...existingDocs.map((s) => s.source_id.replace(/^doc:/, "")),
    ...staged.map((d) => d.tag),
  ]);
  const freeTags = DOC_TAGS.map((t) => t.value).filter((t) => !usedTags.has(t));

  const described = kase
    ? existingDocs.some((s) => s.source_id === "doc:op-plan")
    : description.trim().length > 0;
  const docCount = existingDocs.filter((s) => s.source_id !== "doc:op-plan").length + staged.length;
  const ready = described && docCount > 0 && (kase ? true : name.trim().length > 0);

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (kase) {
        const free = DOC_TAGS.map((t) => t.value)
          .concat(existingDocs.some((s) => s.source_id === "doc:op-plan") ? [] : ["op-plan"])
          .filter((t) => !usedTags.has(t));
        if (free.length === 0) return;
        onUploadDocument(guessTag(file.name, free), file);
      } else {
        setStaged((prev) => {
          const used = new Set(prev.map((d) => d.tag));
          const free = DOC_TAGS.map((t) => t.value).filter((t) => !used.has(t));
          if (free.length === 0) return prev;
          return [...prev, { file, tag: guessTag(file.name, free) }];
        });
      }
    }
  }

  return (
    <div className="px-10 pb-14 pt-7">
      <div className="mx-auto flex max-w-[1080px] items-start gap-9">
        <div className="min-w-0 flex-1">
          <div className="mb-6">
            <div className="text-[12px] font-bold uppercase tracking-[.13em] text-gold">
              Pre-op · Intake
            </div>
            <h1 className="mt-2 font-serif text-[29px] font-medium text-ink-primary">
              Add the records
            </h1>
            <p className="mt-2 max-w-[560px] text-[14.5px] leading-relaxed text-ink-secondary">
              Describe the case, then drop in whatever you already have. Tag each document so
              every fact can be traced back to it.
            </p>
          </div>

          {notice && (
            <div className="mb-6 rounded-[12px] border border-status-unsupported/40 bg-status-unsupported/[0.08] px-4 py-3 text-[13.5px] text-status-unsupported">
              {notice}
            </div>
          )}

          <Label>Patient &amp; case description</Label>
          {kase ? (
            <div className="mb-6 rounded-[13px] border border-surface-overlay bg-surface-sunken px-5 py-4">
              <div className="font-serif text-[21px] font-medium text-ink-primary">
                {kase.label ?? kase.case_id}
              </div>
              <div className="mt-1 text-[13.5px] text-ink-secondary">Case {kase.case_id}</div>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <div className="mb-1.5 text-[12px] font-semibold text-ink-dim">Patient name</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. James Whitfield"
                  className="w-full rounded-[10px] border border-surface-overlay bg-surface-sunken px-3.5 py-3 text-[15px] text-ink-primary outline-none placeholder:text-ink-ghost"
                />
              </div>
              <div className="mb-7">
                <div className="mb-1.5 text-[12px] font-semibold text-ink-dim">
                  Case description — saved as the operative plan
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Elective open right inguinal hernia repair under GA with an LMA, planned as a day case."
                  className="min-h-[88px] w-full rounded-[10px] border border-surface-overlay bg-surface-sunken px-3.5 py-3 text-[14.5px] leading-relaxed text-ink-primary outline-none placeholder:text-ink-ghost"
                />
              </div>
            </>
          )}

          <Label>Documents</Label>
          <button
            type="button"
            disabled={busy || !canWrite}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy && canWrite && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
            className="mb-3.5 flex w-full flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-[#cdbfa4] bg-surface-sunken p-6 disabled:opacity-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[#EBE4D6] text-[16px] text-ink-dim">
              ⬍
            </span>
            <span className="text-[14.5px] font-semibold text-ink-muted">
              Drag &amp; drop files here
            </span>
            <span className="text-[12.5px] text-ink-subtle">
              or click to browse · PDF, text, markdown
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".txt,.md,.pdf,text/plain,application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {existingDocs.map((s) => (
            <DocRow
              key={s.source_id}
              name={s.source_id}
              meta={`added · ${s.chunks.length} passage${s.chunks.length === 1 ? "" : "s"}`}
              trailing={
                <span className="flex-none text-[13px] font-semibold text-status-supported">
                  ✓ Added
                </span>
              }
            />
          ))}
          {staged.map((d, i) => (
            <DocRow
              key={`${d.file.name}-${i}`}
              name={d.file.name}
              meta={d.file.size > 0 ? `${Math.max(1, Math.round(d.file.size / 1024))} KB` : "staged"}
              trailing={
                <>
                  <select
                    aria-label={`Tag for ${d.file.name}`}
                    value={d.tag}
                    onChange={(e) =>
                      setStaged((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)),
                      )
                    }
                    className="flex-none rounded-full border border-surface-overlay bg-surface-sunken px-3 py-1.5 text-[12.5px] font-semibold text-ink-muted outline-none"
                  >
                    {DOC_TAGS.filter((t) => t.value === d.tag || freeTags.includes(t.value)).map(
                      (t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ),
                    )}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${d.file.name}`}
                    onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
                    className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-surface-overlay bg-surface-sunken text-[13px] text-ink-faint"
                  >
                    ✕
                  </button>
                </>
              }
            />
          ))}

          <div className="mt-6 flex items-center gap-4 border-t border-surface-line pt-5">
            <div className="flex-1 text-[13.5px] leading-relaxed text-ink-dim">
              {!canWrite
                ? "Pick a provider (top right) to start the intake."
                : kase
                  ? "Records are saved as you add them."
                  : docCount > 0 && described
                    ? `${docCount} document${docCount === 1 ? "" : "s"} tagged. Creating the intake saves everything and prepares the interview questions.`
                    : "Describe the case and add at least one document to create the intake."}
            </div>
            {kase ? (
              <button
                type="button"
                disabled={busy || !ready}
                onClick={onContinue}
                className="flex min-h-[52px] flex-none items-center rounded-[11px] bg-brand px-6 text-[15.5px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] disabled:opacity-40"
              >
                Continue &nbsp;→
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !ready || !canWrite}
                onClick={() => onCreateIntake(name.trim(), description.trim(), staged)}
                className="flex min-h-[52px] flex-none items-center rounded-[11px] bg-brand px-6 text-[15.5px] font-semibold text-ink-onBrand shadow-[0_1px_0_rgba(255,255,255,.16)_inset] disabled:opacity-40"
              >
                Create intake &nbsp;→
              </button>
            )}
          </div>
        </div>

        {/* recommended documents rail */}
        <div className="sticky top-0 w-[300px] flex-none rounded-[15px] border border-surface-overlay bg-surface-sunken px-5 py-5">
          <div className="mb-3 text-[11.5px] font-bold uppercase tracking-[.11em] text-ink-faint">
            Recommended documents
          </div>
          {RECOMMENDED.map((r) => {
            const have =
              r.key === "description" ? described : usedTags.has(r.key);
            return (
              <div
                key={r.key}
                className="flex items-center gap-2.5 border-t border-[#EAE1D0] py-2.5"
              >
                <span
                  className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[10px] ${
                    have
                      ? "bg-status-supported/20 text-status-supported"
                      : "bg-[#EBE4D6] text-ink-ghost"
                  }`}
                >
                  {have ? "✓" : ""}
                </span>
                <span
                  className={`text-[13.5px] ${have ? "text-ink-muted" : "text-ink-subtle"}`}
                >
                  {r.label}
                </span>
              </div>
            );
          })}
          <p className="mt-3 border-t border-[#EAE1D0] pt-3 text-[12.5px] leading-relaxed text-ink-subtle">
            Anything missing becomes a clarifying question to ask in the interview.
          </p>
        </div>
      </div>
    </div>
  );
}

function DocRow({
  name,
  meta,
  trailing,
}: {
  name: string;
  meta: string;
  trailing: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-3.5 rounded-[12px] border border-surface-overlay bg-surface-base px-4 py-3">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#EBE4D6] text-[13px] text-ink-secondary">
        ¶
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink-primary">{name}</div>
        <div className="mt-0.5 text-[12px] text-ink-subtle">{meta}</div>
      </div>
      {trailing}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 text-[12px] font-bold uppercase tracking-[.12em] text-gold">
      {children}
    </div>
  );
}
