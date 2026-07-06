/**
 * New case (spec v2 §4.1 step 1): the case label is the only obligatory
 * typing in the whole workflow (v2 §6.3). Synthetic-data note rendered on
 * the form.
 */
import { useState } from "react";

export function NewCaseForm({
  canCreate,
  onCreate,
  onCancel,
}: {
  canCreate: boolean;
  onCreate: (label: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const ready = canCreate && label.trim().length > 0;
  return (
    <form
      className="mx-auto mt-10 w-full max-w-md rounded border border-surface-overlay bg-surface-raised p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onCreate(label.trim());
      }}
    >
      <h2 className="text-base font-semibold">New case</h2>
      <label className="mt-4 block text-sm text-ink-secondary">
        Case label
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. TKR Mrs W — Thursday list"
          className="mt-1 w-full rounded border border-surface-overlay bg-surface-sunken px-3 py-2.5 text-sm text-ink-primary"
        />
      </label>
      <p className="mt-2 text-xs text-ink-subtle">
        Demo identifiers only — never enter real patient details. All data in
        this tool is synthetic.
      </p>
      {!canCreate && (
        <p className="mt-2 text-xs text-status-unsupported">
          Choose your name in the top-right picker first.
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!ready}
          className="min-h-[44px] flex-1 rounded bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Create case
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded border border-surface-overlay px-4 py-2 text-sm text-ink-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
