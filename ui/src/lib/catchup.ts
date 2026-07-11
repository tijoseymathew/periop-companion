/**
 * View-model layer for the "PeriOp Catch-Up" design (imported
 * PeriOp Catch-Up.dc.html). Pure functions that map the real API shapes
 * (`Case`, `CaseSummary`, `Provider`) onto what each screen renders.
 *
 * The design was drawn without the backend in view, so a few of its fields
 * have no source in our data — patient name/age, a hand-written narrative,
 * gap-analysis reason categories. Where a field is real we surface it; where
 * it is not we derive an honest stand-in from what the case does carry
 * (labels, claim statuses, open questions) rather than invent it.
 */
import { claimFlagged } from "./claims";
import {
  headlineStage,
  primaryAction,
  STATUS_WORDS,
  type PrimaryAction,
} from "./workflow";
import type {
  Case,
  CaseSummary,
  Claim,
  ClaimStatus,
  Provider,
  StageKey,
  Workflow,
} from "./schema";

// ---- shared palette meta (mirrors the design's SM / stageMeta maps) ---------

export interface StatusMeta {
  glyph: string;
  label: string;
  className: string; // text colour utility for the status
  dotClassName: string; // faint background chip for the glyph
}

export const CLAIM_STATUS_META: Record<ClaimStatus, StatusMeta> = {
  supported: {
    glyph: "✓",
    label: "Supported",
    className: "text-status-supported",
    dotClassName: "bg-status-supported/15",
  },
  conflicting: {
    glyph: "✕",
    label: "Conflicting",
    className: "text-status-conflicting",
    dotClassName: "bg-status-conflicting/15",
  },
  unsupported: {
    glyph: "○",
    label: "Unsupported",
    className: "text-status-unsupported",
    dotClassName: "bg-status-unsupported/15",
  },
  inference: {
    glyph: "→",
    label: "Inference",
    className: "text-status-inference",
    dotClassName: "bg-status-inference/15",
  },
  unverified: {
    glyph: "○",
    label: "Unverified",
    className: "text-status-unverified",
    dotClassName: "bg-status-unverified/15",
  },
};

export interface StageDisplay {
  short: string; // worklist pill
  long: string; // brief header badge
  className: string; // pill text + tint
}

export const STAGE_DISPLAY: Record<StageKey, StageDisplay> = {
  preop: {
    short: "Pre-op",
    long: "Pre-op assessment",
    className: "text-status-inference bg-status-inference/12",
  },
  intraop: {
    short: "In theatre",
    long: "In theatre",
    className: "text-status-unsupported bg-status-unsupported/13",
  },
  postop: {
    short: "Recovery",
    long: "In recovery · PACU",
    className: "text-brand-ink bg-brand/12",
  },
};

// ---- gap-analysis reason categories (design "Needs you now" REASON map) ------
//
// The design tags every open question with one of three coloured reasons
// (Conflict / Missing / Stale). Our GapAnalyst stores `reason` as free text,
// so we categorise it honestly from its wording rather than invent a field —
// falling back to a neutral "Clarify" when the wording is unclassifiable.

export type ReasonKey = "conflict" | "missing" | "stale" | "clarify";

export interface ReasonMeta {
  key: ReasonKey;
  label: string;
  textClass: string; // accent text colour
  dotClass: string; // solid status dot
  borderClass: string; // card border
  bgClass: string; // card tint
}

export const REASON_META: Record<ReasonKey, ReasonMeta> = {
  conflict: {
    key: "conflict",
    label: "Conflict",
    textClass: "text-status-conflicting",
    dotClass: "bg-status-conflicting",
    borderClass: "border-status-conflicting/28",
    bgClass: "bg-status-conflicting/[0.06]",
  },
  missing: {
    key: "missing",
    label: "Missing",
    textClass: "text-status-unsupported",
    dotClass: "bg-status-unsupported",
    borderClass: "border-status-unsupported/28",
    bgClass: "bg-status-unsupported/[0.07]",
  },
  stale: {
    key: "stale",
    label: "Stale",
    textClass: "text-status-inference",
    dotClass: "bg-status-inference",
    borderClass: "border-status-inference/26",
    bgClass: "bg-status-inference/[0.06]",
  },
  clarify: {
    key: "clarify",
    label: "Clarify",
    textClass: "text-gold",
    dotClass: "bg-gold",
    borderClass: "border-gold/30",
    bgClass: "bg-gold/[0.06]",
  },
};

/** Bucket a free-text gap reason into the design's coloured categories. */
export function categorizeReason(reason: string | null): ReasonMeta {
  const r = (reason ?? "").toLowerCase();
  if (/conflict|disagree|mismatch|contradic|inconsist|differ|does not match|doesn't match/.test(r))
    return REASON_META.conflict;
  if (
    /missing|undocument|not documented|no record|absent|unconfirmed|not on file|no mention|not stated|never documented|no document/.test(
      r,
    )
  )
    return REASON_META.missing;
  if (/stale|outdated|out of date|predate|superseded|prior admission|previous admission|earlier admission|last documented|older than/.test(r))
    return REASON_META.stale;
  return REASON_META.clarify;
}

// ---- shared helpers ---------------------------------------------------------

export function providerName(providers: Provider[], id: string | null): string | null {
  if (!id) return null;
  return providers.find((p) => p.provider_id === id)?.name ?? id;
}

function initialsOf(name: string): string {
  const parts = name.replace(/^Dr\.?\s+/i, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || first.toUpperCase();
}

function timeHM(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Newest stage that has produced its primary artifact (fallback for demos). */
function newestStageWithArtifacts(kase: Case): StageKey | null {
  const has = (id: string) => kase.artifacts.some((a) => a.artifact_id === id);
  if (has("note:pacu-handoff") || has("note:post-anesthesia-eval")) return "postop";
  if (has("record:intra-op") || has("note:anticipated-issues")) return "intraop";
  if (has("note:pre-anesthesia-eval")) return "preop";
  return null;
}

// ---- worklist ---------------------------------------------------------------

export interface WorklistRow {
  caseId: string;
  title: string;
  subtitle: string;
  stage: StageKey | null;
  statusText: string;
  withText: string;
  forYou: boolean;
  generated: boolean;
  actionLabel: string;
}

/** Verification totals that count as "needs a human's eyes" (claims.ts vocab). */
function flaggedCount(counts: Partial<Record<ClaimStatus, number>>): number {
  return (
    (counts.conflicting ?? 0) + (counts.unsupported ?? 0) + (counts.unverified ?? 0)
  );
}

export function worklistRow(summary: CaseSummary, providers: Provider[]): WorklistRow {
  const generated = summary.artifact_count > 0;
  const flagged = flaggedCount(summary.status_counts);
  const factsLine =
    summary.claim_count > 0
      ? `${summary.claim_count} fact${summary.claim_count === 1 ? "" : "s"}` +
        (flagged > 0 ? ` · ${flagged} to check` : "")
      : "No facts yet";

  const wf = summary.workflow;
  if (!wf) {
    return {
      caseId: summary.case_id,
      title: summary.label ?? summary.case_id,
      subtitle: summary.label ? summary.case_id : factsLine,
      stage: null,
      statusText: "Seed case — review only",
      withText: "",
      forYou: false,
      generated,
      actionLabel: generated ? "Catch up" : "Start handoff",
    };
  }

  const stage = headlineStage(wf);
  const complete = stage === null;
  const state = stage ? wf.stages[stage] : wf.stages.postop;
  const performerId = state.signed_off_by ?? state.performed_by ?? wf.created_by.provider_id;
  const performer = providerName(providers, performerId) ?? "the team";

  // "waiting for you": a live case with an open human action — not generating,
  // not fully signed off. Everything else is in progress or complete.
  const forYou =
    !complete && state.status !== "generating";

  const statusText = complete
    ? "Signed off — complete"
    : `${STAGE_DISPLAY[stage].short} — ${STATUS_WORDS[state.status]}`;

  return {
    caseId: summary.case_id,
    title: summary.label ?? summary.case_id,
    subtitle: summary.label ? summary.case_id : factsLine,
    stage: stage ?? "postop",
    statusText,
    withText: forYou ? `${performer} → you` : `with ${performer}`,
    forYou,
    generated,
    actionLabel: generated ? "Catch up" : "Start handoff",
  };
}

// ---- brief ------------------------------------------------------------------

export interface KeyFact {
  claimId: string;
  text: string;
  status: ClaimStatus;
  statusMeta: StatusMeta;
  showStatus: boolean;
  refs: string[];
  hasProv: boolean;
  provLabel: string;
  flagged: boolean;
}

export interface TimelineEvent {
  t: string;
  text: string;
  refs: string[];
  hasProv: boolean;
}

export interface NeedItem {
  key: number;
  title: string;
  detail: string;
  reason: ReasonMeta;
  refs: string[];
  hasProv: boolean;
  reviewed: boolean;
}

export interface ChainNode {
  role: string;
  name: string;
  initials: string;
  meta: string;
  state: "done" | "current" | "todo";
}

/** Who has the case at each stage — shared by the brief and the capture
 * chrome (design: the top-bar provider chain). Unreached stages are omitted. */
export function providerChain(wf: Workflow | null, providers: Provider[]): ChainNode[] {
  const chain: ChainNode[] = [];
  if (!wf) return chain;
  const head = headlineStage(wf);
  const roles: Record<StageKey, string> = {
    preop: "PRE-OP EVAL",
    intraop: "IN THEATRE",
    postop: "RECOVERY",
  };
  (["preop", "intraop", "postop"] as StageKey[]).forEach((st) => {
    const s = wf.stages[st];
    const performerId = s.signed_off_by ?? s.performed_by;
    if (!performerId && st !== head) return; // stage not reached
    const name = providerName(providers, performerId ?? wf.created_by.provider_id) ?? "—";
    const signedAt = timeHM(s.signed_off_at);
    const nodeState: ChainNode["state"] =
      s.status === "signed_off" ? "done" : st === head ? "current" : performerId ? "done" : "todo";
    const meta = signedAt
      ? `signed ${signedAt}`
      : s.status === "generating"
        ? "generating"
        : performerId
          ? "in progress"
          : "waiting";
    chain.push({ role: roles[st], name, initials: initialsOf(name), meta, state: nodeState });
  });
  return chain;
}

export interface BriefModel {
  caseId: string;
  title: string;
  stage: StageKey;
  stageDisplay: StageDisplay;
  /** true once the case has left the operating room (timeline is real, not pending) */
  reachedTheatre: boolean;
  assembledFrom: string;
  attentionCount: number;
  attentionItems: string[];
  keyFacts: KeyFact[];
  keyFactsSource: string | null;
  events: TimelineEvent[];
  intraopPerformer: string | null;
  issues: string[];
  needs: NeedItem[];
  pendingReview: number;
  chain: ChainNode[];
  writable: boolean;
  /** the single forward action for this case's stage (null = read-only / complete) */
  action: PrimaryAction | null;
  /** provider this reviewer is taking the case over from (acknowledge / sign-off copy) */
  handedFrom: string | null;
  // acknowledge (post-op handoff)
  handoffReady: boolean;
  acknowledgedBy: string | null;
  acknowledgedMeta: string | null;
}

const KEY_FACT_ARTIFACTS = ["note:pre-anesthesia-eval", "note:pacu-handoff"];

function mapKeyFact(claim: Claim, alwaysShowStatus: boolean): KeyFact {
  const has = claim.provenance.length > 0;
  return {
    claimId: claim.claim_id,
    text: claim.text,
    status: claim.status,
    statusMeta: CLAIM_STATUS_META[claim.status],
    showStatus: alwaysShowStatus || claim.status !== "supported",
    refs: claim.provenance,
    hasProv: has,
    provLabel: claim.provenance.length > 1 ? `See sources (${claim.provenance.length})` : "See the source",
    flagged: claimFlagged(claim),
  };
}

export function buildBrief(
  kase: Case,
  providers: Provider[],
  opts: { alwaysShowStatus?: boolean; flaggedFirst?: boolean } = {},
): BriefModel {
  const wf = kase.workflow;
  const stage = headlineStage(wf) ?? newestStageWithArtifacts(kase) ?? "postop";

  // key facts: prefer the pre-op evaluation (patient-level facts), else handoff
  const factArtifact = KEY_FACT_ARTIFACTS.map((id) =>
    kase.artifacts.find((a) => a.artifact_id === id),
  ).find(Boolean);
  let keyFacts = (factArtifact?.claims ?? []).map((c) =>
    mapKeyFact(c, !!opts.alwaysShowStatus),
  );
  if (opts.flaggedFirst) {
    keyFacts = keyFacts.slice().sort((a, b) => (a.flagged ? 0 : 1) - (b.flagged ? 0 : 1));
  }

  // theatre timeline
  const intraop = wf?.stages.intraop;
  const events: TimelineEvent[] = kase.intraop_events.map((e) => ({
    t: e.t,
    text: e.units ? `${e.value} ${e.units}` : e.value,
    refs: e.provenance,
    hasProv: e.provenance.length > 0,
  }));

  // anticipated issues: the plain-string list, else the artifact's claim texts
  let issues = kase.anticipated_issues;
  if (issues.length === 0) {
    issues =
      kase.artifacts
        .find((a) => a.artifact_id === "note:anticipated-issues")
        ?.claims.map((c) => c.text) ?? [];
  }

  // needs you now = gap-analysis open questions, minus the ones the reviewer
  // dismissed (kept in the record, but not something that "needs you now")
  const needs: NeedItem[] = kase.open_questions
    .map((q, i) => ({
      key: i,
      title: q.edited_text ?? q.question,
      detail: q.reason ?? "",
      reason: categorizeReason(q.reason),
      refs: q.provenance,
      hasProv: q.provenance.length > 0,
      reviewed: q.review !== null,
    }))
    .filter((n) => kase.open_questions[n.key].review !== "dismissed");
  const pendingReview = needs.filter((n) => !n.reviewed).length;

  // attention summary (the design's hand-written "story so far", derived)
  const attentionItems = [
    ...keyFacts.filter((f) => f.flagged).map((f) => f.text),
    ...needs.filter((n) => !n.reviewed).map((n) => n.title),
  ].slice(0, 4);

  // provider chain
  const chain = providerChain(wf, providers);

  // assembled-from line
  const docCount = kase.sources.filter((s) => s.type === "document").length;
  const audioCount = kase.sources.filter((s) => s.type === "audio").length;
  const parts: string[] = [];
  if (docCount > 0) parts.push(`${docCount} document${docCount === 1 ? "" : "s"}`);
  if (audioCount > 0)
    parts.push(audioCount === 1 ? "the interview" : `${audioCount} recordings`);
  const assembledFrom = parts.length ? `Assembled from ${parts.join(" and ")}` : "No sources yet";

  const hasHandoff = kase.artifacts.some((a) => a.artifact_id === "note:pacu-handoff");
  const ackBy = providerName(providers, wf?.stages.postop.handoff_acknowledged_by ?? null);
  const ackAt = timeHM(wf?.stages.postop.handoff_acknowledged_at ?? null);

  // the case has genuinely left theatre once an intra-op artifact/events exist —
  // before that the timeline section renders as a calm "not yet" placeholder so
  // the page skeleton is identical at every stage
  const reachedTheatre =
    events.length > 0 ||
    kase.artifacts.some(
      (a) => a.artifact_id === "record:intra-op" || a.artifact_id === "note:anticipated-issues",
    );

  // who is handing the case to this reviewer: the most recent stage they signed off
  let handedFrom: string | null = null;
  if (wf) {
    for (const st of ["preop", "intraop", "postop"] as StageKey[]) {
      const pid = wf.stages[st].signed_off_by;
      if (pid) handedFrom = providerName(providers, pid);
    }
  }

  return {
    caseId: kase.case_id,
    title: kase.label ?? kase.case_id,
    stage,
    stageDisplay: STAGE_DISPLAY[stage],
    reachedTheatre,
    assembledFrom,
    attentionCount: attentionItems.length,
    attentionItems,
    keyFacts,
    keyFactsSource: factArtifact?.artifact_id ?? null,
    events,
    intraopPerformer: providerName(providers, intraop?.signed_off_by ?? intraop?.performed_by ?? null),
    issues,
    needs,
    pendingReview,
    chain,
    writable: !!wf,
    action: primaryAction(kase),
    handedFrom,
    handoffReady: hasHandoff,
    acknowledgedBy: ackBy,
    acknowledgedMeta: ackBy ? [ackAt, ackBy].filter(Boolean).join(" · ") : null,
  };
}
