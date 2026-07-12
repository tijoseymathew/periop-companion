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

export const GENERATE_LABELS: Record<StageKey, string> = {
  preop: "Generate pre-op note",
  intraop: "Generate intra-op record",
  postop: "Generate handoff & post-op note",
};

const SIGNOFF_LABELS: Record<StageKey, string> = {
  preop: "Sign off pre-op",
  intraop: "Sign off intra-op",
  postop: "Sign off post-op",
};

export const PRIMARY_ARTIFACT: Record<StageKey, string> = {
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

// ---- stepper sub-navigation (design: substep pills) -------------------------

/** The screens reachable within an open case (the stepper's substep pills). */
export type SubScreen =
  | "intake"
  | "questions"
  | "record"
  | "generate"
  | "review"
  | "signoff"
  | "handoff"
  | "intraop"
  | "orientation";

/** Ordered substep pills per stage. Labels are clinical, never enum values. */
export const STAGE_SUBSTEPS: Record<StageKey, { key: SubScreen; label: string }[]> = {
  preop: [
    { key: "intake", label: "Records intake" },
    { key: "questions", label: "Clarifying questions" },
    { key: "record", label: "Pre-op interview" },
    { key: "generate", label: "Generate note" },
    { key: "review", label: "Review & claims" },
    { key: "signoff", label: "Sign off" },
  ],
  intraop: [
    { key: "intraop", label: "Voice memos" },
    { key: "generate", label: "Generate record" },
    { key: "review", label: "Review & claims" },
    { key: "signoff", label: "Sign off" },
  ],
  postop: [
    { key: "record", label: "Post-op interview" },
    { key: "generate", label: "Generate handoff" },
    { key: "handoff", label: "PACU handoff" },
    { key: "signoff", label: "Sign off" },
  ],
};

const ACTION_SUBSCREEN: Record<PrimaryActionKind, SubScreen> = {
  "add-records": "intake",
  "review-questions": "questions",
  "record-interview": "record",
  "record-memo": "intraop",
  generate: "generate",
  generating: "generate",
  "acknowledge-handoff": "handoff",
  "sign-off": "review",
};

/** Which stage a case's newest artifact belongs to (fallback for demo cases). */
function newestStageWithArtifacts(kase: Case): StageKey | null {
  const has = (id: string) => kase.artifacts.some((a) => a.artifact_id === id);
  if (has("note:pacu-handoff") || has("note:post-anesthesia-eval")) return "postop";
  if (has("record:intra-op") || has("note:anticipated-issues")) return "intraop";
  if (has("note:pre-anesthesia-eval")) return "preop";
  return null;
}

/**
 * Where a freshly-opened case lands: the screen of its one live primary action
 * (the one-primary-action invariant, docs/frontend.md). Complete or demo
 * (read-only) cases land on their most advanced
 * note. Stepper pills override this afterward.
 */
export function defaultSubScreen(kase: Case): { stage: StageKey; screen: SubScreen } {
  const action = primaryAction(kase);
  if (action) return { stage: action.stage, screen: ACTION_SUBSCREEN[action.kind] };
  const stage = headlineStage(kase.workflow) ?? newestStageWithArtifacts(kase) ?? "preop";
  return { stage, screen: stage === "postop" ? "handoff" : "review" };
}

/** Per-stage node state for the stepper (done / current / todo). */
export type StageNodeState = "done" | "current" | "todo";

export function stageNodeState(kase: Case, stage: StageKey): StageNodeState {
  const wf = kase.workflow;
  if (!wf) {
    // demo/read-only: a stage is "done" if it produced artifacts
    return newestStageWithArtifacts(kase) === stage ||
      STAGE_KEYS.indexOf(stage) < STAGE_KEYS.indexOf(newestStageWithArtifacts(kase) ?? "preop")
      ? "done"
      : "todo";
  }
  if (wf.stages[stage].status === "signed_off") return "done";
  const head = headlineStage(wf);
  if (!head) return "done"; // complete
  const cur = STAGE_KEYS.indexOf(head);
  const i = STAGE_KEYS.indexOf(stage);
  return i < cur ? "done" : i === cur ? "current" : "todo";
}

// ---- worklist filters (v2 §6.8, "my cases" §2 stretch) ----------------------

export interface WorklistFilters {
  stage: StageKey | "all";
  status: StageStatus | "all";
  mine: boolean;
}

/** Did this provider touch the case — create it, perform or sign off a stage,
 * or acknowledge the handoff? */
export function caseInvolves(workflow: Workflow | null, providerId: string | null): boolean {
  if (!workflow || !providerId) return false;
  if (workflow.created_by.provider_id === providerId) return true;
  return STAGE_KEYS.some((key) => {
    const stage = workflow.stages[key];
    return (
      stage.performed_by === providerId ||
      stage.signed_off_by === providerId ||
      stage.handoff_acknowledged_by === providerId
    );
  });
}

// ---- department dashboard (v2 §2 stretch) -----------------------------------

export interface DepartmentBoardData {
  /** live cases bucketed by their headline stage */
  stages: Record<StageKey, { total: number; byStatus: Partial<Record<StageStatus, number>> }>;
  complete: number;
  demo: number;
  /** the queue that needs a reviewer, in worklist order */
  needsReview: { caseId: string; label: string; stage: StageKey; by: string | null }[];
  /** outstanding conflicting claims across live cases */
  conflicts: number;
}

export function departmentBoard(rows: CaseSummary[]): DepartmentBoardData {
  const board: DepartmentBoardData = {
    stages: {
      preop: { total: 0, byStatus: {} },
      intraop: { total: 0, byStatus: {} },
      postop: { total: 0, byStatus: {} },
    },
    complete: 0,
    demo: 0,
    needsReview: [],
    conflicts: 0,
  };
  for (const row of rows) {
    if (!row.workflow) {
      board.demo += 1;
      continue;
    }
    board.conflicts += row.status_counts.conflicting ?? 0;
    const stage = headlineStage(row.workflow);
    if (!stage) {
      board.complete += 1;
      continue;
    }
    const state = row.workflow.stages[stage];
    const bucket = board.stages[stage];
    bucket.total += 1;
    bucket.byStatus[state.status] = (bucket.byStatus[state.status] ?? 0) + 1;
    if (state.status === "awaiting_review") {
      board.needsReview.push({
        caseId: row.case_id,
        label: row.label ?? row.case_id,
        stage,
        by: state.performed_by,
      });
    }
  }
  return board;
}

export function filterWorklist(
  rows: CaseSummary[],
  filters: WorklistFilters,
  me: string | null = null,
): CaseSummary[] {
  return rows.filter((row) => {
    if (filters.mine && !caseInvolves(row.workflow, me)) return false;
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
