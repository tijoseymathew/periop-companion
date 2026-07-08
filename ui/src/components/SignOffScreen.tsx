/**
 * Sign-off checkpoint (brief §4.7): a deliberate "are you sure you've seen
 * this" gate. It surfaces — never buries — the counts of conflicting,
 * unsupported, unresolved-source, and unverified claims, then asks for an
 * explicit, named, timestamped confirmation. A signed-off stage is read-only;
 * Reopen is present but quieter than sign-off.
 */
import { useMemo, useState } from "react";
import { resolveRef } from "../lib/provenance";
import { claimUnresolved } from "../lib/claims";
import { providerInitials } from "./ProviderPicker";
import type {
  ArtifactRecord,
  Case,
  Claim,
  ClaimReviews,
  Provider,
  StageKey,
} from "../lib/schema";
import { STATUS_GLYPHS, STATUS_TEXT } from "./StatusBadge";

const STAGE_TITLE: Record<StageKey, string> = {
  preop: "Sign off — pre-op evaluation",
  intraop: "Sign off — intra-op record",
  postop: "Sign off — PACU handoff",
};
const STAGE_WORD: Record<StageKey, string> = {
  preop: "PRE-OP",
  intraop: "INTRA-OP",
  postop: "POST-OP",
};

interface IssueKind {
  key: string;
  label: string;
  note: string;
  glyph: string;
  text: string;
  match: (kase: Case, c: Claim) => boolean;
}

const ISSUES: IssueKind[] = [
  {
    key: "conflicting",
    label: "Conflicting",
    note: "Two sources disagree",
    glyph: STATUS_GLYPHS.conflicting,
    text: STATUS_TEXT.conflicting,
    match: (_k, c) => c.status === "conflicting",
  },
  {
    key: "unsupported",
    label: "Unsupported",
    note: "Cited but not established",
    glyph: STATUS_GLYPHS.unsupported,
    text: STATUS_TEXT.unsupported,
    match: (_k, c) => c.status === "unsupported",
  },
  {
    key: "unresolved",
    label: "Unresolved sources",
    note: "Source link missing",
    glyph: "⚠",
    text: STATUS_TEXT.conflicting,
    match: (k, c) => claimUnresolved(c) || c.provenance.some((r) => resolveRef(k, r) === null),
  },
  {
    key: "unverified",
    label: "Unverified",
    note: "Not yet checked",
    glyph: STATUS_GLYPHS.unverified,
    text: STATUS_TEXT.unverified,
    match: (_k, c) => c.status === "unverified",
  },
];

export function SignOffScreen({
  kase,
  stage,
  artifacts,
  reviews: _reviews,
  me,
  providers,
  signedOff,
  onSignOff,
  onReopen,
  onJumpToClaim,
}: {
  kase: Case;
  stage: StageKey;
  artifacts: ArtifactRecord[];
  reviews: ClaimReviews;
  me: string | null;
  providers: Provider[];
  signedOff: boolean;
  onSignOff: () => Promise<void>;
  onReopen: () => Promise<void>;
  onJumpToClaim: (artifactId: string, claimId: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const meProvider = providers.find((p) => p.provider_id === me) ?? null;

  const flat = useMemo(
    () => artifacts.flatMap((a) => a.claims.map((c) => ({ artifactId: a.artifact_id, claim: c }))),
    [artifacts],
  );

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  const firstOf = (kind: IssueKind) => flat.find((r) => kind.match(kase, r.claim));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-none border-b border-surface-overlay px-8 py-5">
        <div className="mb-1.5 font-mono text-[11px] tracking-wide text-ink-subtle">
          {kase.case_id} · {(kase.label ?? "").toUpperCase()} · {STAGE_WORD[stage]}
        </div>
        <h1 className="text-[23px] font-semibold tracking-tight">{STAGE_TITLE[stage]}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          You're confirming you've reviewed this note. The items below still need your eyes — check
          them before you sign.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-3 font-mono text-[10.5px] tracking-wider text-ink-faint">
            STILL FLAGGED IN THIS NOTE
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ISSUES.map((kind) => {
              const count = flat.filter((r) => kind.match(kase, r.claim)).length;
              const target = firstOf(kind);
              return (
                <button
                  key={kind.key}
                  type="button"
                  disabled={!target}
                  onClick={() => target && onJumpToClaim(target.artifactId, target.claim.claim_id)}
                  className={`flex items-center gap-3.5 rounded-xl border border-surface-line bg-surface-raised p-4 text-left disabled:cursor-default ${
                    count > 0 ? "hover:border-surface-overlay" : "opacity-60"
                  }`}
                >
                  <span className={`min-w-[26px] font-mono text-2xl font-semibold ${kind.text}`}>
                    {count}
                  </span>
                  <span>
                    <span className={`flex items-center gap-1.5 text-sm font-semibold ${kind.text}`}>
                      <span aria-hidden>{kind.glyph}</span>
                      {kind.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-secondary">{kind.note}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {signedOff ? (
            <div className="mt-6 flex items-center justify-between rounded-2xl border border-surface-line bg-surface-chrome p-6">
              <p className="text-sm text-status-supported">This stage is signed off and read-only.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(onReopen)}
                className="rounded-lg border border-surface-line px-3.5 py-2 text-xs text-ink-secondary hover:text-ink-primary"
              >
                Reopen stage
              </button>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-surface-line bg-surface-chrome p-6">
              <label className="flex cursor-pointer items-start gap-3 border-b border-surface-overlay pb-4">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-5 w-5 flex-none accent-brand"
                />
                <span className="text-sm leading-relaxed text-ink-primary">
                  I have reviewed every claim above, including the flagged items, and confirm this{" "}
                  {stage === "preop" ? "pre-op evaluation" : stage === "intraop" ? "intra-op record" : "handoff"}{" "}
                  is ready for the next team.
                </span>
              </label>
              <div className="flex items-center gap-3.5 pt-4">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-surface-overlay bg-surface-raised text-[13px] font-semibold text-brand-soft">
                  {meProvider ? providerInitials(meProvider.name).toUpperCase() : "?"}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {meProvider ? `${meProvider.name} · ${meProvider.role}` : "Choose your name first"}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-ink-subtle">
                    {new Date().toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  data-primary-action
                  disabled={busy || !confirmed || !meProvider}
                  onClick={() => run(onSignOff)}
                  className="min-h-[48px] flex-none rounded-lg bg-brand px-5 py-3 text-[14.5px] font-semibold text-ink-onBrand hover:bg-brand-soft disabled:opacity-40"
                >
                  {meProvider ? `Sign off as ${providerInitials(meProvider.name).toUpperCase()}` : "Sign off"}
                </button>
              </div>
            </div>
          )}
          <p className="mt-4 text-center text-[12.5px] text-ink-faint">
            Once signed, the note becomes read-only. Reopening it later is possible under{" "}
            <span className="text-ink-secondary">Reopen stage</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
