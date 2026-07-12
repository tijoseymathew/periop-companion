/**
 * App shell: the worklist, the capture flow (imported PeriOp Workflow.dc.html
 * — add records → intake build → interview → theatre memo → post-op
 * interview), the live generation stream, and the brief (imported PeriOp
 * Catch-Up.dc.html patient view). All state here via useState/useMemo and
 * props down (ui.md §3: no router, no store). The flow view-model
 * (`lib/flow`) decides which capture screen a case is on; explicit
 * navigation (sub-stage pills, the brief's primary action) overrides it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BriefScreen } from "../components/catchup/BriefScreen";
import { SourceModal, type SourceRequest } from "../components/catchup/SourceModal";
import { Worklist } from "../components/catchup/Worklist";
import { CaseChatPanel } from "../components/chat/CaseChatPanel";
import { StockScreen } from "../components/equipment/StockScreen";
import { CaptureScreen } from "../components/flow/CaptureScreen";
import { FlowChrome } from "../components/flow/FlowChrome";
import { InterviewScreen } from "../components/flow/InterviewScreen";
import { RecordsScreen, type StagedDoc } from "../components/flow/RecordsScreen";
import { ProviderPicker } from "../components/ProviderPicker";
import {
  acknowledgeHandoff,
  addArtifactClaim,
  addDocumentText,
  analyzeQuestions,
  createCase,
  editArtifactClaim,
  fetchCase,
  fetchCases,
  fetchProviders,
  reviewQuestions,
  signoffStage,
  uploadAudio,
  uploadDocumentFile,
} from "../lib/api";
import { buildBrief, worklistRow } from "../lib/catchup";
import {
  AUDIO_KIND,
  autoGenerateReady,
  flowScreen,
  hasPreopRecords,
  transcriptionBusy,
  type FlowScreen,
} from "../lib/flow";
import type { Case, CaseSummary, OpenQuestion, Provider, StageKey } from "../lib/schema";
import { STAGE_KEYS } from "../lib/schema";
import { describeRunEvent, streamStageRun, type RunEvent } from "../lib/sse";
import { headlineStage, PRIMARY_ARTIFACT, type PrimaryAction } from "../lib/workflow";

const PROVIDER_STORAGE_KEY = "periop-provider";

type View = "worklist" | "case" | "stock";

interface UploadProgress {
  done: number;
  total: number;
}

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [me, setMe] = useState<string | null>(
    () => localStorage.getItem(PROVIDER_STORAGE_KEY) ?? null,
  );

  const [view, setView] = useState<View>("worklist");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kase, setKase] = useState<Case | null>(null);
  // explicit navigation (pills / brief actions); null = follow the flow
  const [screenOverride, setScreenOverride] = useState<FlowScreen | null>(null);
  // stage-bubble navigation: pin the brief to a completed stage's output;
  // null = the case's live stage
  const [stageView, setStageView] = useState<StageKey | null>(null);
  const [uploads, setUploads] = useState<UploadProgress | null>(null);

  const [source, setSource] = useState<SourceRequest | null>(null);
  const [genEvents, setGenEvents] = useState<RunEvent[]>([]);
  // a stage run in flight — folded into the stage chrome as a minimal live
  // status instead of a full-screen takeover (v2-ui feedback)
  const [running, setRunning] = useState(false);
  // the last stage run (auto or manual) ended in an error — the capture
  // screens surface a manual generate again so the provider can retry
  const [genFailed, setGenFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCases()
      .then(setCases)
      .catch((e) => setError(String(e)));
    fetchProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  // Question prep and upload-time transcription both run server-side
  // (v2-speed §3.2); while either is in flight on an open case, poll until it
  // settles so questions and transcripts appear the moment they land.
  const gap = kase?.workflow?.stages.preop.gap_analysis ?? null;
  // A stage can also be generating without this session streaming it — the
  // page was reloaded mid-run, or another session started it. The run
  // survives server-side; its durable status on the case is the truth, so
  // poll that until it settles and the output lands on its own.
  const generatingUnwatched =
    !running &&
    kase !== null &&
    STAGE_KEYS.some((s) => kase.workflow?.stages[s].status === "generating");
  const jobsBusy =
    gap === "pending" ||
    gap === "running" ||
    generatingUnwatched ||
    (kase !== null && STAGE_KEYS.some((s) => transcriptionBusy(kase, s)));
  useEffect(() => {
    if (view !== "case" || !kase || !jobsBusy) return;
    const caseId = kase.case_id;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const fresh = await fetchCase(caseId);
        if (!cancelled) setKase(fresh);
      } catch {
        /* transient — keep polling */
      }
    }, 1200);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view, kase?.case_id, jobsBusy]);

  function pickProvider(providerId: string) {
    setMe(providerId);
    localStorage.setItem(PROVIDER_STORAGE_KEY, providerId);
  }

  const rows = useMemo(
    () => cases.map((c) => worklistRow(c, providers)),
    [cases, providers],
  );

  async function refreshCases() {
    try {
      setCases(await fetchCases());
    } catch {
      /* keep the current list */
    }
  }

  /** Load a case; land on its brief when it has output, else on its flow step. */
  async function openCase(caseId: string) {
    setSelectedId(caseId);
    setNotice(null);
    try {
      const c = await fetchCase(caseId);
      setKase(c);
      setScreenOverride(c.artifacts.length > 0 ? "brief" : null);
      setStageView(null);
      setUploads(null);
      setView("case");
    } catch (e) {
      setError(String(e));
    }
  }

  function goWorklist() {
    setView("worklist");
    setSelectedId(null);
    setKase(null);
    setScreenOverride(null);
    setStageView(null);
    setUploads(null);
    setNotice(null);
    refreshCases();
  }

  function newCase() {
    setSelectedId(null);
    setKase(null);
    setScreenOverride(null);
    setStageView(null);
    setUploads(null);
    setNotice(null);
    setView("case");
  }

  /** One "Create intake" action: create the case, save the description as
   * the operative plan, land every staged record. Question prep launches
   * server-side as soon as the intake gate is met (v2-speed §3.2). */
  async function handleCreateIntake(name: string, description: string, docs: StagedDoc[]) {
    if (!me) return;
    setBusy(true);
    setNotice(null);
    const total = docs.length + 1; // description → doc:op-plan
    setUploads({ done: 0, total });
    try {
      let c = kase;
      if (!c) {
        c = await createCase(name, me);
        setSelectedId(c.case_id);
        setKase(c);
      }
      c = await addDocumentText(c.case_id, "op-plan", description, me);
      setKase(c);
      setUploads({ done: 1, total });
      for (let i = 0; i < docs.length; i++) {
        c = await uploadDocumentFile(c.case_id, docs[i].tag, docs[i].file, me);
        setKase(c);
        setUploads({ done: i + 2, total });
      }
      setUploads(null);
      await refreshCases();
    } catch (e) {
      setUploads(null);
      setScreenOverride("records");
      setNotice(readDetail(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadDocument(docType: string, file: File) {
    if (!kase || !me) return;
    setBusy(true);
    setNotice(null);
    try {
      setKase(await uploadDocumentFile(kase.case_id, docType, file, me));
    } catch (e) {
      setNotice(readDetail(e));
    } finally {
      setBusy(false);
    }
  }

  /** Save a stage recording. On pre-op, `reviewed` carries the question
   * list as the provider left it (keeps, dismissals, additions) — there is
   * no approve button, so the upload passes the question gate (v2 §4.1)
   * right before the audio lands. */
  async function handleUploadAudio(file: File, reviewed: OpenQuestion[] | null = null) {
    if (!kase || !me) return;
    const stage = headlineStage(kase.workflow) ?? "preop";
    setBusy(true);
    setNotice(null);
    try {
      if (reviewed) {
        setKase(await reviewQuestions(kase.case_id, reviewed, me));
      }
      setKase(await uploadAudio(kase.case_id, AUDIO_KIND[stage], file, me, true));
    } catch (e) {
      setNotice(readDetail(e));
    } finally {
      setBusy(false);
    }
  }

  /** Relaunch a failed intake question prep (v2-speed §3.2). */
  async function handleRetryQuestions() {
    if (!kase) return;
    setNotice(null);
    try {
      setKase(await analyzeQuestions(kase.case_id));
    } catch (e) {
      setNotice(readDetail(e));
      setScreenOverride("records");
    }
  }

  // watchRunSettled must not keep touching state for a case the provider
  // has left — reopening the case resumes the watch via the jobs poll
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  /** The SSE stream is only a progress feed — the run itself survives a
   * dropped connection, and the durable stage status on the case says how
   * it ended (generating → awaiting_review | ready_to_generate). Poll that
   * until it settles; null when the provider moved to another case. */
  async function watchRunSettled(caseId: string, stage: StageKey): Promise<Case | null> {
    let announced = false;
    for (;;) {
      if (selectedIdRef.current !== caseId) return null;
      try {
        const fresh = await fetchCase(caseId);
        if (fresh.workflow?.stages[stage].status !== "generating") return fresh;
        if (selectedIdRef.current !== caseId) return null;
        setKase(fresh);
        if (!announced) {
          announced = true;
          setGenEvents((prev) => [
            ...prev,
            {
              event: "status",
              data: { message: "Connection interrupted — the run is still going; waiting for it to finish…" },
            },
          ]);
        }
      } catch {
        /* transient — the run outlives a brief API blip */
      }
      await sleep(1500);
    }
  }

  async function handleGenerate() {
    if (!kase || !me) return;
    const caseId = kase.case_id;
    const stage = headlineStage(kase.workflow) ?? "preop";
    setGenEvents([]);
    setNotice(null);
    setGenFailed(false);
    setRunning(true);
    // `complete`/`error` is the server's verdict on the run; a stream that
    // ends without one just lost its connection mid-run
    let verdict = false;
    try {
      let streamError: unknown = null;
      try {
        await streamStageRun(caseId, stage, me, (ev) => {
          if (ev.event === "complete" || ev.event === "error") verdict = true;
          setGenEvents((prev) => [...prev, ev]);
        });
      } catch (e) {
        streamError = e;
      }
      if (streamError && verdict) throw streamError; // the run failed — the server said so

      let fresh: Case;
      if (verdict) {
        fresh = await fetchCase(caseId);
      } else {
        // no verdict (dropped stream, or a gate rejection — the first poll
        // settles which): follow the durable status instead of guessing
        const settled = await watchRunSettled(caseId, stage);
        if (!settled) return; // moved to another case; reopening resumes the watch
        fresh = settled;
      }
      if (!fresh.artifacts.some((a) => a.artifact_id === PRIMARY_ARTIFACT[stage])) {
        throw (
          streamError ??
          new Error("the run was interrupted before it finished — generate again when ready")
        );
      }
      setKase(fresh);
      await refreshCases();
      setStageView(null); // land on the freshly generated stage's brief
      setScreenOverride("brief");
    } catch (e) {
      // gate (409) or run error — back to the flow with the plain reason
      setNotice(readDetail(e));
      setGenFailed(true);
      setScreenOverride(null);
    } finally {
      setRunning(false);
    }
  }

  // Pre-op and post-op generate themselves the moment the transcript lands
  // (no "Generate" click after the recording). One attempt per recording:
  // a failed run leaves its notice plus a manual generate, never a loop.
  const autoGenAttempted = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "case" || !kase || !me || running || busy) return;
    const stage = headlineStage(kase.workflow) ?? "preop";
    if (!autoGenerateReady(kase, stage)) return;
    const key = `${kase.case_id}:${stage}:${kase.workflow?.stages[stage].inputs_recorded_at}`;
    if (autoGenAttempted.current === key) return;
    autoGenAttempted.current = key;
    void handleGenerate();
  }, [view, kase, me, running, busy]);

  /** Provider corrections on the brief before sign-off (v2-ui feedback):
   * both land as human-attested edits citing the provider's own source. */
  async function handleEditClaim(artifactId: string, claimId: string, text: string) {
    if (!kase || !me) return;
    try {
      setKase(await editArtifactClaim(kase.case_id, artifactId, claimId, text, me));
    } catch (e) {
      setError(readDetail(e));
    }
  }

  async function handleAddClaim(artifactId: string, text: string) {
    if (!kase || !me) return;
    try {
      setKase(await addArtifactClaim(kase.case_id, artifactId, text, me));
    } catch (e) {
      setError(readDetail(e));
    }
  }

  async function handleAcknowledge() {
    if (!kase || !me) return;
    try {
      setKase(await acknowledgeHandoff(kase.case_id, me));
      await refreshCases();
    } catch (e) {
      setError(readDetail(e));
    }
  }

  /** Sign off a stage from the patient view, then drop back to the worklist —
   * the case reappears with its next stage's status. On pre-op, `equipment`
   * carries the recommended items the provider ticked; the server reserves
   * them for the case as the stage completes. */
  async function handleSignoff(stage: StageKey, equipment: string[] = []) {
    if (!kase || !me) return;
    try {
      await signoffStage(kase.case_id, stage, me, equipment);
      goWorklist();
    } catch (e) {
      setError(readDetail(e));
    }
  }

  /** Stage-bubble navigation: pin the brief to a completed stage's output. */
  function handleSelectStage(stage: StageKey) {
    setNotice(null);
    setStageView(stage);
    setScreenOverride("brief");
  }

  /** Any stage whose primary artifact exists has output worth revisiting. */
  const canViewStage = (stage: StageKey): boolean =>
    !!kase && kase.artifacts.some((a) => a.artifact_id === PRIMARY_ARTIFACT[stage]);

  /** Dispatch the brief's single adaptive action (workflow.primaryAction).
   * Capture steps route into the flow's screen; terminal actions run here. */
  function handleAction(action: PrimaryAction, opts?: { equipment?: string[] }) {
    setStageView(null); // acting always happens on the live stage
    switch (action.kind) {
      case "sign-off":
        void handleSignoff(action.stage, opts?.equipment ?? []);
        return;
      case "acknowledge-handoff":
        void handleAcknowledge();
        return;
      case "generate":
        void handleGenerate();
        return;
      case "generating":
        return;
      case "add-records":
        setNotice(null);
        setScreenOverride("records");
        return;
      case "review-questions":
        setNotice(null);
        setScreenOverride(null); // the flow lands on the intake build / interview
        return;
      default:
        // record-interview / record-memo
        setNotice(null);
        setScreenOverride(action.stage === "preop" ? "interview" : "capture");
    }
  }

  const providerControl = (
    <ProviderPicker providers={providers} selected={me} onSelect={pickProvider} />
  );

  // brief queue: step through the cases still waiting for you
  const forYouIds = rows.filter((r) => r.forYou).map((r) => r.caseId);

  // this session's own stage run, as one live status line — null when
  // nothing is running (folded into the chrome, ui.md §7 / v2-ui feedback)
  const generatingLabel = running
    ? ([...genEvents].reverse().map(describeRunEvent).find((s): s is string => !!s) ?? "")
    : null;

  function renderBrief() {
    if (!kase) return null;
    const model = buildBrief(kase, providers, stageView ? { stage: stageView } : {});
    const pos = selectedId ? forYouIds.indexOf(selectedId) : -1;
    const queue =
      pos >= 0 && forYouIds.length > 1
        ? {
            pos: pos + 1,
            total: forYouIds.length,
            onPrev: () => openCase(forYouIds[(pos - 1 + forYouIds.length) % forYouIds.length]),
            onNext: () => openCase(forYouIds[(pos + 1) % forYouIds.length]),
          }
        : null;
    return (
      <BriefScreen
        model={model}
        queue={queue}
        canReview={model.writable && !!me}
        onBack={goWorklist}
        onOpenSource={setSource}
        onAction={handleAction}
        canViewStage={canViewStage}
        onSelectStage={handleSelectStage}
        generating={generatingLabel}
        onEditClaim={(a, c, t) => void handleEditClaim(a, c, t)}
        onAddClaim={(a, t) => void handleAddClaim(a, t)}
      />
    );
  }

  const stage: StageKey = kase ? (headlineStage(kase.workflow) ?? "preop") : "preop";
  // uploads in flight render as the intake build; otherwise follow the flow
  const screen: FlowScreen = screenOverride ?? (uploads ? "intake-generating" : flowScreen(kase));

  // building the intake (uploads landing, then gap analysis) folds into the
  // same minimal chrome strip as a stage run — no full-screen takeover, and
  // the records screen it's built from stays visible underneath (v2-ui
  // feedback). A failed run isn't "in flight" any more, so it drops out of
  // the strip in favor of RecordsScreen's own retry banner below.
  const buildingLabel: string | null =
    screen !== "intake-generating" || gap === "failed"
      ? null
      : uploads && uploads.done < uploads.total
        ? `Saving the records (${uploads.done} of ${uploads.total})`
        : gap === "running"
          ? "Preparing the interview questions"
          : "Reading the records for gaps and conflicts";
  // a run this session isn't streaming (reopened mid-run) still gets the
  // chrome strip — the jobs poll lands its output the moment it settles
  const watchingLabel = generatingUnwatched
    ? "Generating — reconnected to a run in progress"
    : null;
  const chromeStatus = generatingLabel ?? buildingLabel ?? watchingLabel;

  const canReach = (target: FlowScreen): boolean => {
    if (!kase) return false;
    switch (target) {
      case "brief":
        return kase.artifacts.length > 0;
      case "records":
        return stage === "preop";
      case "interview":
        // reachable even while question prep runs — the screen shows a
        // preparing state and the questions land via the polling refresh
        return stage === "preop" && hasPreopRecords(kase);
      case "capture":
        return stage !== "preop";
      default:
        return false;
    }
  };

  function renderCase() {
    if (screen === "brief") return renderBrief();
    return (
      <FlowChrome
        kase={kase}
        stage={stage}
        screen={screen}
        fallbackTitle="New case intake"
        providers={providers}
        providerControl={providerControl}
        onBack={goWorklist}
        onSelectScreen={(s) => {
          setNotice(null);
          setStageView(null);
          setScreenOverride(s);
        }}
        canReach={canReach}
        canViewStage={canViewStage}
        onSelectStage={handleSelectStage}
        generating={chromeStatus}
      >
        {(screen === "records" || screen === "intake-generating") && (
          <RecordsScreen
            kase={kase}
            busy={busy}
            notice={notice}
            canWrite={!!me}
            onCreateIntake={handleCreateIntake}
            onUploadDocument={handleUploadDocument}
            // explicit — while question prep still runs, following the flow
            // (null) would resolve right back to this screen and go nowhere
            onContinue={() => setScreenOverride("interview")}
            gapFailure={
              gap === "failed"
                ? {
                    message:
                      kase?.workflow?.stages.preop.gap_analysis_error ??
                      "the analysis could not finish",
                    onRetry: () => void handleRetryQuestions(),
                  }
                : null
            }
          />
        )}
        {screen === "interview" && kase && (
          <InterviewScreen
            kase={kase}
            busy={busy || running || generatingUnwatched}
            notice={notice}
            canWrite={!!me}
            genFailed={genFailed}
            onUploadAudio={handleUploadAudio}
            onGenerate={() => void handleGenerate()}
            onOpenSource={setSource}
            liveEvents={running ? genEvents : []}
          />
        )}
        {screen === "capture" && kase && stage !== "preop" && (
          <CaptureScreen
            stage={stage}
            kase={kase}
            busy={busy || running || generatingUnwatched}
            notice={notice}
            canWrite={!!me}
            genFailed={genFailed}
            liveEvents={running ? genEvents : []}
            onUploadAudio={handleUploadAudio}
            onGenerate={() => void handleGenerate()}
          />
        )}
      </FlowChrome>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-surface-base">
      {error && (
        <div className="m-4 rounded-lg border border-status-conflicting/50 bg-status-conflicting/10 p-3 text-sm text-status-conflicting">
          {error}
          <button className="ml-3 underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === "worklist" && (
          <Worklist
            rows={rows}
            providerControl={providerControl}
            onOpen={openCase}
            onNewCase={newCase}
            onStock={() => setView("stock")}
          />
        )}
        {view === "stock" && <StockScreen onBack={goWorklist} />}
        {view === "case" && renderCase()}
      </main>
      {view === "case" && kase && (
        // remount per case so one conversation never bleeds into another
        <CaseChatPanel key={kase.case_id} caseId={kase.case_id} me={me} />
      )}
      {source && kase && (
        <SourceModal kase={kase} request={source} onClose={() => setSource(null)} />
      )}
    </div>
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Pull the FastAPI `detail` off an axios error, else the message. */
function readDetail(e: unknown): string {
  const anyE = e as { response?: { data?: { detail?: string } }; message?: string };
  return anyE?.response?.data?.detail ?? anyE?.message ?? String(e);
}
