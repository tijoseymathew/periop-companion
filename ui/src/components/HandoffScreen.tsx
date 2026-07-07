/**
 * PACU handoff — the highest-stakes screen (brief §4.8). The receiving provider
 * accepts responsibility for a patient they may never have met: every statement
 * shows its source (play the clip), anything unresolved/conflicting is pinned to
 * the top, and acknowledgement is an explicit, named, timestamped action with
 * the gravity it deserves — not a "mark as read".
 */
import { useMemo, useState, type ReactNode } from "react";
import { claimFlagged } from "../lib/claims";
import { providerInitials } from "./ProviderPicker";
import { ProvenanceChip } from "./ProvenanceChip";
import { StatusBadge } from "./StatusBadge";
import type { ArtifactRecord, Case, ClaimStatus, Provider } from "../lib/schema";

const STATUS_BORDER: Record<ClaimStatus, string> = {
  supported: "border-l-status-supported",
  unsupported: "border-l-status-unsupported",
  conflicting: "border-l-status-conflicting",
  inference: "border-l-status-inference",
  unverified: "border-l-status-unverified",
};

export function HandoffScreen({
  kase,
  artifacts,
  me,
  providers,
  onActivateRef,
  onAcknowledge,
  provenancePanel,
}: {
  kase: Case;
  artifacts: ArtifactRecord[];
  me: string | null;
  providers: Provider[];
  onActivateRef: (ref: string) => void;
  onAcknowledge: () => Promise<void>;
  provenancePanel: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const meProvider = providers.find((p) => p.provider_id === me) ?? null;
  const postop = kase.workflow?.stages.postop;
  const acked = postop?.handoff_acknowledged_by ?? null;
  const ackedName =
    providers.find((p) => p.provider_id === acked)?.name ?? acked ?? null;

  const handoff = artifacts.find((a) => a.artifact_id === "note:pacu-handoff") ?? artifacts[0];
  // conflicting/flagged items pinned to the very top (brief §4.8)
  const items = useMemo(() => {
    const claims = handoff?.claims ?? [];
    return [...claims].sort((a, b) => (claimFlagged(a) ? 0 : 1) - (claimFlagged(b) ? 0 : 1));
  }, [handoff]);
  const conflictCount = items.filter((c) => c.status === "conflicting").length;

  if (!handoff) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <p className="max-w-md text-sm text-ink-secondary">
          The handoff note has not been generated yet.
        </p>
      </div>
    );
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0b0f14]">
      <div className="flex-none border-b border-surface-overlay px-8 py-5">
        <div className="mb-1.5 font-mono text-[11px] tracking-wide text-ink-subtle">
          {kase.case_id} · {(kase.label ?? "").toUpperCase()} · THEATRE → PACU
        </div>
        <h1 className="text-[23px] font-semibold tracking-tight">PACU handoff — receiving care</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          You are accepting responsibility for this patient. Play any clip to hear its source, then
          acknowledge.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto w-full max-w-3xl">
            {conflictCount > 0 && (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-status-conflicting/30 bg-status-conflicting/[0.08] px-4 py-3.5">
                <span className="text-status-conflicting" aria-hidden>
                  ✕
                </span>
                <span className="text-[13.5px] text-status-conflicting/90">
                  {conflictCount} conflicting {conflictCount === 1 ? "item is" : "items are"}{" "}
                  unresolved — read {conflictCount === 1 ? "it" : "them"} first.{" "}
                  {conflictCount === 1 ? "It is" : "They are"} pinned to the top.
                </span>
              </div>
            )}

            {items.map((claim) => (
              <div
                key={claim.claim_id}
                className={`mb-2.5 rounded-xl border border-l-[3px] border-surface-line bg-surface-raised p-4 ${STATUS_BORDER[claim.status]}`}
              >
                <div className="mb-2">
                  <StatusBadge status={claim.status} />
                </div>
                <div className="text-[14.5px] leading-relaxed text-ink-primary">{claim.text}</div>
                {claim.provenance.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {claim.provenance.map((ref) => (
                      <ProvenanceChip key={ref} kase={kase} refStr={ref} onActivate={onActivateRef} />
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="mt-5 rounded-2xl border border-surface-line bg-surface-chrome p-6">
              {acked ? (
                <div className="flex items-center gap-3.5">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-surface-overlay bg-surface-raised text-[13px] font-semibold text-status-inference">
                    {ackedName ? providerInitials(ackedName).toUpperCase() : "✓"}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-status-supported">
                      Handoff acknowledged
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-ink-subtle">
                      {ackedName} ·{" "}
                      {postop?.handoff_acknowledged_at
                        ? new Date(postop.handoff_acknowledged_at).toLocaleString()
                        : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3.5">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-surface-overlay bg-surface-raised text-[13px] font-semibold text-status-inference">
                    {meProvider ? providerInitials(meProvider.name).toUpperCase() : "?"}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      {meProvider ? `${meProvider.name} · ${meProvider.role}` : "Choose your name first"}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-ink-subtle">
                      I have received and reviewed this handoff
                    </div>
                  </div>
                  <button
                    type="button"
                    data-primary-action
                    disabled={busy || !meProvider}
                    onClick={() => run(onAcknowledge)}
                    className="min-h-[50px] flex-none rounded-lg bg-brand px-6 py-3.5 text-[15px] font-semibold text-ink-onBrand hover:bg-brand-soft disabled:opacity-40"
                  >
                    Acknowledge handoff
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {provenancePanel}
      </div>
    </div>
  );
}
