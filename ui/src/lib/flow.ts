/**
 * View-model for the capture flow (imported PeriOp Workflow.dc.html): the
 * screens a provider moves through while a stage still needs inputs — add
 * records, the intake build, the interview, the theatre memo — before the
 * case hands over to the brief for review. Pure functions over the parsed
 * Case; the design's stage/sub-stage chrome reads from here so every screen
 * agrees on where the case is.
 */
import type { Case, Source, StageKey } from "./schema";
import { headlineStage, PRIMARY_ARTIFACT } from "./workflow";

/** Stage → the audio kind its capture screen records (matches the API). */
export const AUDIO_KIND: Record<StageKey, string> = {
  preop: "preop-interview",
  intraop: "intraop-notes",
  postop: "postop-interview",
};

export type FlowScreen =
  | "records" // pre-op · add the records (also: no case yet)
  | "intake-generating" // pre-op · building the intake (gap analysis)
  | "interview" // pre-op · questions + the recorded interview
  | "capture" // intra-op memo / post-op interview
  | "brief"; // review & everything after — the patient view owns it

/** The uploaded recording for a stage, if its transcript has landed. */
export function audioSource(kase: Case | null, stage: StageKey): Source | null {
  if (!kase) return null;
  return kase.sources.find((s) => s.source_id === `audio:${AUDIO_KIND[stage]}`) ?? null;
}

export type JobState = "pending" | "running" | "complete" | "failed" | null;

/** Upload-time transcription lifecycle for a stage's recording. */
export function transcriptionState(kase: Case | null, stage: StageKey): JobState {
  return kase?.workflow?.stages[stage].transcription ?? null;
}

export function transcriptionBusy(kase: Case | null, stage: StageKey): boolean {
  const state = transcriptionState(kase, stage);
  return state === "pending" || state === "running";
}

/**
 * Should this stage's output start generating on its own right now?
 * Pre-op and post-op generate the moment their recording's transcript lands
 * (v2-ui feedback: no "Generate" click after the interview). Intra-op memos
 * accumulate, so the provider still says when the theatre record is ready.
 * A failed transcription never auto-fires — the capture screens keep their
 * manual generate for that path (the run transcribes at generate time).
 */
export function autoGenerateReady(kase: Case | null, stage: StageKey): boolean {
  if (!kase?.workflow || stage === "intraop") return false;
  const state = kase.workflow.stages[stage];
  if (state.status !== "ready_to_generate") return false;
  if (stage === "preop" && !state.questions_approved_at) return false;
  if (!state.inputs_recorded_at) return false;
  if (transcriptionState(kase, stage) !== "complete") return false;
  return !kase.artifacts.some((a) => a.artifact_id === PRIMARY_ARTIFACT[stage]);
}

/** Intake gate (v2 §4.1): the op plan plus at least one other record. */
export function hasPreopRecords(kase: Case | null): boolean {
  if (!kase) return false;
  const docs = kase.sources.filter((s) => s.type === "document");
  return docs.some((s) => s.source_id === "doc:op-plan") && docs.length > 1;
}

/**
 * Where an open case lands in the capture flow. "brief" means the capture
 * work is done (or the case is read-only) and the patient view takes over.
 */
export function flowScreen(kase: Case | null): FlowScreen {
  if (!kase) return "records";
  if (!kase.workflow) return kase.artifacts.length > 0 ? "brief" : "records";
  const stage = headlineStage(kase.workflow);
  if (!stage) return "brief";
  const hasArtifact = kase.artifacts.some(
    (a) => a.artifact_id === PRIMARY_ARTIFACT[stage],
  );
  if (hasArtifact) return "brief";
  if (stage === "preop") {
    const gap = kase.workflow.stages.preop.gap_analysis;
    if (gap === "pending" || gap === "running") return "intake-generating";
    if (!hasPreopRecords(kase)) return "records";
    return "interview";
  }
  return "capture";
}

// ---- the design's sub-stage pills -------------------------------------------

export interface SubPill {
  key: FlowScreen;
  label: string;
  state: "done" | "current" | "todo";
}

const SUB_STEPS: Record<StageKey, { key: FlowScreen; label: string }[]> = {
  preop: [
    { key: "records", label: "Add records" },
    { key: "interview", label: "Interview" },
    { key: "brief", label: "Pre-op brief" },
  ],
  intraop: [
    { key: "capture", label: "Voice memo" },
    { key: "brief", label: "Theatre record" },
  ],
  postop: [
    { key: "capture", label: "Post-op interview" },
    { key: "brief", label: "PACU handoff" },
  ],
};

/** Pills for the current stage; `screen` is what the app is showing now. */
export function subPills(stage: StageKey, screen: FlowScreen): SubPill[] {
  const steps = SUB_STEPS[stage];
  // the generating interstitial belongs between records and interview
  const effective = screen === "intake-generating" ? "interview" : screen;
  const at = Math.max(
    0,
    steps.findIndex((s) => s.key === effective),
  );
  return steps.map((s, i) => ({
    ...s,
    state: i < at ? "done" : i === at ? "current" : "todo",
  }));
}

export function subLabel(stage: StageKey, screen: FlowScreen): string {
  if (screen === "intake-generating") return "Building the intake";
  return (
    SUB_STEPS[stage].find((s) => s.key === screen)?.label ?? SUB_STEPS[stage][0].label
  );
}
