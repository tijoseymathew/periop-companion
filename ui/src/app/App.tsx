/**
 * App shell: the worklist, the capture flow (imported PeriOp Workflow.dc.html
 * — add records → intake build → interview → theatre memo → post-op
 * interview), the live generation stream, and the brief (imported PeriOp
 * Catch-Up.dc.html patient view). All state here via useState/useMemo and
 * props down (ui.md §3: no router, no store). The flow view-model
 * (`lib/flow`) decides which capture screen a case is on; explicit
 * navigation (sub-stage pills, the brief's primary action) overrides it.
 */
import { useEffect, useMemo, useState } from "react";
import { BriefScreen } from "../components/catchup/BriefScreen";
import { GeneratingScreen } from "../components/catchup/GeneratingScreen";
import { SourceModal, type SourceRequest } from "../components/catchup/SourceModal";
import { Worklist } from "../components/catchup/Worklist";
import { CaptureScreen } from "../components/flow/CaptureScreen";
import { FlowChrome } from "../components/flow/FlowChrome";
import { IntakeBuildScreen, type UploadProgress } from "../components/flow/IntakeBuildScreen";
import { InterviewScreen } from "../components/flow/InterviewScreen";
import { RecordsScreen, type StagedDoc } from "../components/flow/RecordsScreen";
import { ProviderPicker } from "../components/ProviderPicker";
import {
  acknowledgeHandoff,
  addDocumentText,
  analyzeQuestions,
  createCase,
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
  flowScreen,
  hasPreopRecords,
  transcriptionBusy,
  type FlowScreen,
} from "../lib/flow";
import type { Case, CaseSummary, OpenQuestion, Provider, StageKey } from "../lib/schema";
import { STAGE_KEYS } from "../lib/schema";
import { streamStageRun, type RunEvent } from "../lib/sse";
import { GENERATE_LABELS, headlineStage, type PrimaryAction } from "../lib/workflow";

const PROVIDER_STORAGE_KEY = "periop-provider";

type View = "worklist" | "case" | "generating";

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
  const [uploads, setUploads] = useState<UploadProgress | null>(null);

  const [source, setSource] = useState<SourceRequest | null>(null);
  const [genEvents, setGenEvents] = useState<RunEvent[]>([]);
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
  const jobsBusy =
    gap === "pending" ||
    gap === "running" ||
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
    setUploads(null);
    setNotice(null);
    refreshCases();
  }

  function newCase() {
    setSelectedId(null);
    setKase(null);
    setScreenOverride(null);
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

  async function handleUploadAudio(file: File) {
    if (!kase || !me) return;
    const stage = headlineStage(kase.workflow) ?? "preop";
    setBusy(true);
    setNotice(null);
    try {
      setKase(await uploadAudio(kase.case_id, AUDIO_KIND[stage], file, me, true));
    } catch (e) {
      setNotice(readDetail(e));
    } finally {
      setBusy(false);
    }
  }

  /** Approve/dismiss the pre-op clarification questions, passing the
   * question gate so the note can generate (v2 §4.1). */
  async function handleApproveQuestions(questions: OpenQuestion[]) {
    if (!kase || !me) return;
    setBusy(true);
    setNotice(null);
    try {
      setKase(await reviewQuestions(kase.case_id, questions, me));
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

  async function handleGenerate() {
    if (!kase || !me) return;
    const stage = headlineStage(kase.workflow) ?? "preop";
    setGenEvents([]);
    setNotice(null);
    setView("generating");
    try {
      await streamStageRun(kase.case_id, stage, me, (ev) => {
        setGenEvents((prev) => [...prev, ev]);
      });
      const fresh = await fetchCase(kase.case_id);
      setKase(fresh);
      await refreshCases();
      setScreenOverride("brief");
      setView("case");
    } catch (e) {
      // gate (409) or run error — back to the flow with the plain reason
      setNotice(readDetail(e));
      setScreenOverride(null);
      setView("case");
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
   * the case reappears with its next stage's status. */
  async function handleSignoff(stage: StageKey) {
    if (!kase || !me) return;
    try {
      await signoffStage(kase.case_id, stage, me);
      goWorklist();
    } catch (e) {
      setError(readDetail(e));
    }
  }

  /** Dispatch the brief's single adaptive action (workflow.primaryAction).
   * Capture steps route into the flow's screen; terminal actions run here. */
  function handleAction(action: PrimaryAction) {
    switch (action.kind) {
      case "sign-off":
        void handleSignoff(action.stage);
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

  /** Toggle an open question's review state (design: "Needs you now" cards). */
  async function handleReviewNeed(key: number, reviewed: boolean) {
    if (!kase || !me) return;
    const questions = kase.open_questions.map((q, i) =>
      i === key ? { ...q, review: reviewed ? ("approved" as const) : null } : q,
    );
    try {
      setKase(await reviewQuestions(kase.case_id, questions, me));
    } catch (e) {
      setError(readDetail(e));
    }
  }

  const providerControl = (
    <ProviderPicker providers={providers} selected={me} onSelect={pickProvider} />
  );

  // brief queue: step through the cases still waiting for you
  const forYouIds = rows.filter((r) => r.forYou).map((r) => r.caseId);

  function renderBrief() {
    if (!kase) return null;
    const model = buildBrief(kase, providers);
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
        onReviewNeed={handleReviewNeed}
      />
    );
  }

  const stage: StageKey = kase ? (headlineStage(kase.workflow) ?? "preop") : "preop";
  // uploads in flight render as the intake build; otherwise follow the flow
  const screen: FlowScreen = screenOverride ?? (uploads ? "intake-generating" : flowScreen(kase));

  const canReach = (target: FlowScreen): boolean => {
    if (!kase) return false;
    switch (target) {
      case "brief":
        return kase.artifacts.length > 0;
      case "records":
        return stage === "preop";
      case "interview":
        return stage === "preop" && hasPreopRecords(kase) && gap !== "pending" && gap !== "running";
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
          setScreenOverride(s);
        }}
        canReach={canReach}
      >
        {screen === "records" && (
          <RecordsScreen
            kase={kase}
            busy={busy}
            notice={notice}
            canWrite={!!me}
            onCreateIntake={handleCreateIntake}
            onUploadDocument={handleUploadDocument}
            onContinue={() => setScreenOverride(null)}
          />
        )}
        {screen === "intake-generating" && (
          <IntakeBuildScreen
            title={kase?.label ?? kase?.case_id ?? "New case"}
            uploads={uploads}
            gap={gap}
            gapError={kase?.workflow?.stages.preop.gap_analysis_error ?? null}
            onRetry={() => void handleRetryQuestions()}
            onBackToRecords={() => setScreenOverride("records")}
          />
        )}
        {screen === "interview" && kase && (
          <InterviewScreen
            kase={kase}
            busy={busy}
            notice={notice}
            canWrite={!!me}
            onApproveQuestions={handleApproveQuestions}
            onUploadAudio={handleUploadAudio}
            onGenerate={() => void handleGenerate()}
          />
        )}
        {screen === "capture" && kase && stage !== "preop" && (
          <CaptureScreen
            stage={stage}
            kase={kase}
            busy={busy}
            notice={notice}
            canWrite={!!me}
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
          />
        )}
        {view === "case" && renderCase()}
        {view === "generating" && (
          <GeneratingScreen
            title={kase?.label ?? kase?.case_id ?? "case"}
            heading={GENERATE_LABELS[stage]}
            events={genEvents}
            onBack={goWorklist}
          />
        )}
      </main>
      {source && kase && (
        <SourceModal kase={kase} request={source} onClose={() => setSource(null)} />
      )}
    </div>
  );
}

/** Pull the FastAPI `detail` off an axios error, else the message. */
function readDetail(e: unknown): string {
  const anyE = e as { response?: { data?: { detail?: string } }; message?: string };
  return anyE?.response?.data?.detail ?? anyE?.message ?? String(e);
}
