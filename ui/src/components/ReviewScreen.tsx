/**
 * The claim-ledger review workspace (brief §4.5, the centerpiece). Left: the
 * note rendered as sourced claim cards with a status summary that doubles as
 * the show/hide filter (default: everything shown, brief §3). Right: the
 * provenance panel (audio + Interview/Documents browser). One primary action —
 * Sign off — sits in the header.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ArtifactView } from "./ArtifactView";
import { allClaims, claimFlagged } from "../lib/claims";
import { artifactToMarkdown, copyText } from "../lib/markdown";
import type { StatusFilters } from "../lib/filters";
import { CLAIM_STATUSES, type ArtifactRecord, type Case, type ClaimReviews, type ClaimReviewState, type ClaimStatus, type StageKey } from "../lib/schema";
import { STATUS_GLYPHS, STATUS_LABEL, STATUS_TEXT } from "./StatusBadge";

const STAGE_TITLE: Record<StageKey, string> = {
  preop: "Pre-op evaluation — review",
  intraop: "Intra-op record — review",
  postop: "PACU handoff — review",
};
const STAGE_WORD: Record<StageKey, string> = {
  preop: "PRE-OP",
  intraop: "INTRA-OP",
  postop: "POST-OP",
};

export function ReviewScreen({
  kase,
  stage,
  artifacts,
  filters,
  onToggleFilter,
  activeClaim,
  onActivateRef,
  reviews,
  onReviewClaim,
  canSignOff,
  onGoSignOff,
  provenancePanel,
}: {
  kase: Case;
  stage: StageKey;
  artifacts: ArtifactRecord[];
  filters: StatusFilters;
  onToggleFilter: (status: ClaimStatus) => void;
  activeClaim: { artifactId: string; claimId: string } | null;
  onActivateRef: (ref: string) => void;
  reviews: ClaimReviews;
  onReviewClaim?: (ref: string, state: ClaimReviewState | null) => void;
  canSignOff: boolean;
  onGoSignOff: () => void;
  provenancePanel: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const claims = useMemo(() => allClaims(artifacts), [artifacts]);
  const flaggedCount = claims.filter(claimFlagged).length;

  async function copyAll() {
    const text = artifacts.map((a) => artifactToMarkdown(kase, a)).join("\n\n");
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-10 text-center">
        <p className="max-w-md text-sm text-ink-secondary">
          This stage has no note yet. Record its inputs and generate the note — its claims will
          appear here for review.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-none items-start justify-between gap-6 border-b border-surface-overlay px-8 py-5">
        <div>
          <div className="mb-1.5 font-mono text-[11px] tracking-wide text-ink-subtle">
            {kase.case_id} · {(kase.label ?? "").toUpperCase()} · {STAGE_WORD[stage]}
          </div>
          <h1 className="text-[23px] font-semibold tracking-tight">{STAGE_TITLE[stage]}</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-secondary">
            Every statement below points back to its source.{" "}
            {flaggedCount > 0
              ? `Clear the ${flaggedCount} flagged ${flaggedCount === 1 ? "item" : "items"}, then sign off.`
              : "Nothing is flagged — sign off when ready."}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <button
            type="button"
            onClick={copyAll}
            className="min-h-[44px] rounded-lg border border-surface-line px-4 py-2.5 text-[13.5px] font-medium text-ink-primary hover:border-brand hover:text-brand"
          >
            {copied ? "Copied" : "Copy as text"}
          </button>
          {canSignOff && (
            <button
              type="button"
              data-primary-action
              onClick={onGoSignOff}
              className="min-h-[44px] rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-ink-onBrand hover:bg-brand-soft"
            >
              Sign off →
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-surface-line px-8 py-3">
        {CLAIM_STATUSES.map((status) => {
          const count = claims.filter((c) => c.status === status).length;
          const on = filters[status];
          return (
            <button
              key={status}
              type="button"
              aria-label={`filter ${status}`}
              aria-pressed={on}
              onClick={() => onToggleFilter(status)}
              className={`inline-flex items-center gap-1.5 text-[12.5px] ${on ? "" : "opacity-40"}`}
            >
              <span aria-hidden className={`text-[13px] ${STATUS_TEXT[status]}`}>
                {STATUS_GLYPHS[status]}
              </span>
              <b className="font-mono font-semibold text-ink-primary">{count}</b>
              <span className="text-ink-secondary">{STATUS_LABEL[status]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {artifacts.map((artifact) => (
            <ArtifactView
              key={artifact.artifact_id}
              kase={kase}
              artifact={artifact}
              filters={filters}
              activeClaimId={
                activeClaim?.artifactId === artifact.artifact_id ? activeClaim.claimId : null
              }
              onActivateRef={onActivateRef}
              reviews={reviews}
              onReviewClaim={onReviewClaim}
            />
          ))}
        </div>
        {provenancePanel}
      </div>
    </div>
  );
}
