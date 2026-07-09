/**
 * App shell for the "PeriOp Catch-Up" design (imported PeriOp Catch-Up.dc.html).
 * Four full-screen views — worklist, intake, generating, brief — plus a source
 * modal, with all state here via useState/useMemo and props down (ui.md §3: no
 * router, no store). The design was drawn without the backend in view; this
 * shell binds it to the real read/write API (`lib/api`, `lib/catchup`) and
 * degrades honestly where a designed field has no source in our data.
 */
import { useEffect, useMemo, useState } from "react";
import { BriefScreen } from "../components/catchup/BriefScreen";
import { GeneratingScreen } from "../components/catchup/GeneratingScreen";
import { IntakeScreen } from "../components/catchup/IntakeScreen";
import { SourceModal, type SourceRequest } from "../components/catchup/SourceModal";
import { Worklist } from "../components/catchup/Worklist";
import { ProviderPicker } from "../components/ProviderPicker";
import {
  acknowledgeHandoff,
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
import type { Case, CaseSummary, Provider, StageKey } from "../lib/schema";
import { streamStageRun, type RunEvent } from "../lib/sse";
import { headlineStage, type PrimaryAction } from "../lib/workflow";

const PROVIDER_STORAGE_KEY = "periop-provider";

const AUDIO_KIND: Record<StageKey, string> = {
  preop: "preop-interview",
  intraop: "intraop-notes",
  postop: "postop-interview",
};

type View = "worklist" | "intake" | "generating" | "brief";

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [me, setMe] = useState<string | null>(
    () => localStorage.getItem(PROVIDER_STORAGE_KEY) ?? null,
  );

  const [view, setView] = useState<View>("worklist");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kase, setKase] = useState<Case | null>(null);

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

  /** Load a case and land on its brief (generated) or its intake (not yet). */
  async function openCase(caseId: string) {
    setSelectedId(caseId);
    setNotice(null);
    try {
      const c = await fetchCase(caseId);
      setKase(c);
      setView(c.artifacts.length > 0 ? "brief" : "intake");
    } catch (e) {
      setError(String(e));
    }
  }

  function goWorklist() {
    setView("worklist");
    setSelectedId(null);
    setKase(null);
    setNotice(null);
    refreshCases();
  }

  function newHandoff() {
    setSelectedId(null);
    setKase(null);
    setNotice(null);
    setView("intake");
  }

  async function handleCreateCase(label: string) {
    if (!me) return;
    setBusy(true);
    setNotice(null);
    try {
      const created = await createCase(label, me);
      await refreshCases();
      setSelectedId(created.case_id);
      setKase(created);
    } catch (e) {
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
      setView("brief");
    } catch (e) {
      // gate (409) or run error — return to intake with the plain-language reason
      setNotice(readDetail(e));
      setView("intake");
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

  /** Dispatch the patient view's single adaptive action (workflow.primaryAction).
   * Forward-moving capture steps route back to intake; terminal actions run here. */
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
      default:
        // add-records / review-questions / record-interview / record-memo
        setNotice(null);
        setView("intake");
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

  const genStage = kase ? (headlineStage(kase.workflow) ?? "preop") : "preop";

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
            onNewHandoff={newHandoff}
          />
        )}
        {view === "intake" && (
          <IntakeScreen
            kase={kase}
            audioKind={AUDIO_KIND[genStage]}
            busy={busy}
            notice={notice}
            canWrite={!!me}
            providerControl={providerControl}
            onCreateCase={handleCreateCase}
            onUploadDocument={handleUploadDocument}
            onUploadAudio={handleUploadAudio}
            onGenerate={handleGenerate}
            onBack={goWorklist}
          />
        )}
        {view === "generating" && (
          <GeneratingScreen
            title={kase?.label ?? kase?.case_id ?? "case"}
            events={genEvents}
            onBack={goWorklist}
          />
        )}
        {view === "brief" && renderBrief()}
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
