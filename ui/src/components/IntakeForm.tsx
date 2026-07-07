/**
 * Pre-op intake (spec v2 §4.1 step 2): prior records + operative plan into
 * typed slots, by paste or file upload. Each becomes a chunked document
 * source — provenance-ready from the first second.
 */
import { useState } from "react";

export const DOC_SLOTS = [
  { value: "gp-summary", label: "GP summary" },
  { value: "med-list", label: "Medication list" },
  { value: "prior-anesthetic-record", label: "Previous anaesthetic record" },
  { value: "op-plan", label: "Operative plan" },
  { value: "other", label: "Other" },
] as const;

export function IntakeForm({
  providerId,
  existingDocTypes,
  onAddText,
  onUploadFile,
}: {
  providerId: string | null;
  existingDocTypes: string[];
  onAddText: (docType: string, text: string) => Promise<void>;
  onUploadFile: (docType: string, file: File) => Promise<void>;
}) {
  const available = DOC_SLOTS.filter((s) => !existingDocTypes.includes(s.value));
  const [docType, setDocType] = useState<string>(available[0]?.value ?? "other");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onAddText(docType, text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {existingDocTypes.length > 0 && (
        <ul className="space-y-1">
          {DOC_SLOTS.filter((s) => existingDocTypes.includes(s.value)).map((s) => (
            <li
              key={s.value}
              className="flex items-center justify-between rounded border border-surface-overlay bg-surface-raised px-3 py-2 text-sm"
            >
              <span>{s.label}</span>
              <span className="text-xs text-status-supported">Added ✓</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded border border-surface-overlay bg-surface-raised p-4">
        <label className="block text-sm text-ink-secondary">
          Document type
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="mt-1 w-full rounded border border-surface-overlay bg-surface-sunken px-2 py-2 text-sm text-ink-primary"
          >
            {available.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm text-ink-secondary">
          Paste the document text
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste the record here…"
            className="mt-1 w-full rounded border border-surface-overlay bg-surface-sunken px-3 py-2 font-mono text-xs text-ink-primary"
          />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={!text.trim() || busy || !providerId}
            onClick={submit}
            data-primary-action
            className="min-h-[44px] rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-ink-onBrand disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add document"}
          </button>
          <label className="cursor-pointer text-sm text-ink-secondary underline">
            or upload a file (.txt, .md, .pdf)
            <input
              type="file"
              accept=".txt,.md,.pdf"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  await onUploadFile(docType, file);
                } finally {
                  setBusy(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        </div>
        {busy && (
          <p className="mt-2 text-sm text-ink-secondary" role="status">
            Saving — once the operative plan and a record are in, preparing
            interview questions can take several minutes on local hardware.
            Leave this open; the questions appear when ready.
          </p>
        )}
        {!providerId && (
          <p className="mt-2 text-xs text-status-unsupported">
            Choose your name in the top-right picker first.
          </p>
        )}
      </div>
    </div>
  );
}
