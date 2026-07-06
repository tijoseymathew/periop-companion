/**
 * Worklist status derivation + the one-primary-action state machine
 * (spec v2 §4, §6.1). All pure functions over the parsed Case/CaseSummary —
 * every case screen asks `primaryAction` what its single big button is, so a
 * provider can never be in a state where they must know what to do next.
 */
import type { Case, CaseSummary, StageKey, StageStatus, Workflow } from "./schema";
import { STAGE_KEYS } from "./schema";

export const STAGE_TITLES = {
  preop: "Pre-op",
  intraop: "Intra-op",
  postop: "Post-op",
} as const satisfies Record<StageKey, string>;

/** Plain words, never enum values, in provider-facing copy (v2 §6.4). */
export const STATUS_WORDS: Record<StageStatus, string> = {
  awaiting_inputs: "awaiting inputs",
  ready_to_generate: "ready to generate",
  generating: "generating",
  awaiting_review: "awaiting review",
  signed_off: "signed off",
};

/** First stage that is not signed off; null when the case is complete. */
export function headlineStage(workflow: Workflow | null): StageKey | null {
  if (!workflow) return null;
  for (const key of STAGE_KEYS) {
    if (workflow.stages[key].status !== "signed_off") return key;
  }
  return null;
}

/** The worklist's one-line answer to "what needs me" (v2 §6.8). */
export function headline(workflow: Workflow | null): string {
  if (!workflow) return "Review only";
  const stage = headlineStage(workflow);
  if (!stage) return "Complete";
  return `${STAGE_TITLES[stage]} — ${STATUS_WORDS[workflow.stages[stage].status]}`;
}

export type PrimaryActionKind =
  | "add-records"
  | "review-questions"
  | "record-interview"
  | "record-memo"
  | "generate"
  | "generating"
  | "acknowledge-handoff"
  | "sign-off";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  stage: StageKey;
  label: string;
}

const GENERATE_LABELS: Record<StageKey, string> = {
  preop: "Generate pre-op note",
  intraop: "Generate intra-op record",
  postop: "Generate handoff & post-op note",
};

const SIGNOFF_LABELS: Record<StageKey, string> = {
  preop: "Sign off pre-op",
  intraop: "Sign off intra-op",
  postop: "Sign off post-op",
};

const PRIMARY_ARTIFACT: Record<StageKey, string> = {
  preop: "note:pre-anesthesia-eval",
  intraop: "record:intra-op",
  postop: "note:pacu-handoff",
};

/**
 * Exactly one primary action per case state (v2 §6.1); null means the case
 * is read-only (demo) or complete.
 */
export function primaryAction(kase: Case): PrimaryAction | null {
  const wf = kase.workflow;
  if (!wf) return null;

  const stage = headlineStage(wf);
  const hasArtifact = (id: string) => kase.artifacts.some((a) => a.artifact_id === id);

  if (!stage) {
    // fully signed off — only a missed handoff acknowledge can remain
    if (hasArtifact("note:pacu-handoff") && !wf.stages.postop.handoff_acknowledged_by) {
      return { kind: "acknowledge-handoff", stage: "postop", label: "Acknowledge handoff" };
    }
    return null;
  }

  const state = wf.stages[stage];
  if (state.status === "generating") {
    return { kind: "generating", stage, label: "Generating…" };
  }

  if (stage === "preop") {
    const hasOpPlan = kase.sources.some((s) => s.source_id === "doc:op-plan");
    const hasRecord = kase.sources.some(
      (s) => s.type === "document" && s.source_id !== "doc:op-plan",
    );
    if (!hasOpPlan || !hasRecord) {
      return { kind: "add-records", stage, label: "Add records" };
    }
    if (!state.questions_approved_at) {
      return { kind: "review-questions", stage, label: "Review questions" };
    }
  }

  if (!state.inputs_recorded_at) {
    if (stage === "intraop") {
      return { kind: "record-memo", stage, label: "Record voice memo" };
    }
    return {
      kind: "record-interview",
      stage,
      label: stage === "preop" ? "Record interview" : "Record post-op interview",
    };
  }

  if (!hasArtifact(PRIMARY_ARTIFACT[stage])) {
    return { kind: "generate", stage, label: GENERATE_LABELS[stage] };
  }

  if (stage === "postop" && !state.handoff_acknowledged_by) {
    return { kind: "acknowledge-handoff", stage, label: "Acknowledge handoff" };
  }

  return { kind: "sign-off", stage, label: SIGNOFF_LABELS[stage] };
}

// ---- worklist filters (v2 §6.8) --------------------------------------------

export interface WorklistFilters {
  stage: StageKey | "all";
  status: StageStatus | "all";
}

export function filterWorklist(
  rows: CaseSummary[],
  filters: WorklistFilters,
): CaseSummary[] {
  return rows.filter((row) => {
    if (filters.stage === "all" && filters.status === "all") return true;
    if (!row.workflow) return false; // demo cases have no stage to match
    const stage = headlineStage(row.workflow);
    if (filters.stage !== "all" && stage !== filters.stage) return false;
    if (filters.status !== "all") {
      const status = stage ? row.workflow.stages[stage].status : null;
      if (status !== filters.status) return false;
    }
    return true;
  });
}
