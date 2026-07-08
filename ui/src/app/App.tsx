/**
 * App shell (imported "PeriOp Companion" design): a top Stepper navigation
 * chrome over a single screen body. Worklist is a full-screen view; opening a
 * case reveals the stage nodes + substep pills and routes to one sub-screen at
 * a time. All state lives here with useState/useMemo and props down — no
 * router, no store (ui.md §3). The provenance engine (audio + source panel)
 * lives here and is handed to the Review and Handoff screens.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
import { claimDomId } from "../components/ClaimRow";
import { HandoffScreen } from "../components/HandoffScreen";
import { NewCaseForm } from "../components/NewCaseForm";
import { ProviderPicker } from "../components/ProviderPicker";
import { ReviewScreen } from "../components/ReviewScreen";
import { SignOffScreen } from "../components/SignOffScreen";
import { SourcePanel } from "../components/SourcePanel";
import { StagePanel } from "../components/StagePanel";
import { StepperShell } from "../components/StepperShell";
import { WorklistScreen } from "../components/WorklistScreen";
import {
  acknowledgeHandoff,
  audioUrl,
  createCase,
  fetchCase,
  fetchCases,
  fetchClaimReviews,
  fetchProviders,
  reopenStage,
  reviewClaim,
  signoffStage,
} from "../lib/api";
import { defaultFilters, type StatusFilters } from "../lib/filters";
import { buildReverseIndex, resolveRef, type CitingClaim } from "../lib/provenance";
import { claimFlagged, allClaims } from "../lib/claims";
import type {
  Case,
  CaseSummary,
  ClaimReviews,
  ClaimReviewState,
  Provider,
  StageKey,
} from "../lib/schema";
import {
  defaultSubScreen,
  primaryAction,
  STAGE_SUBSTEPS,
  type SubScreen,
  type WorklistFilters,
} from "../lib/workflow";

const PROVIDER_STORAGE_KEY = "periop-provider";

const PRIMARY_ARTIFACT: Record<StageKey, string> = {
  preop: "note:pre-anesthesia-eval",
  intraop: "record:intra-op",
  postop: "note:pacu-handoff",
};

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kase, setKase] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<StatusFilters>(defaultFilters());

  // navigation: the worklist vs an open case, and which sub-screen within it
  const [view, setView] = useState<"worklist" | "case" | "new">("worklist");
  const [activeStage, setActiveStage] = useState<StageKey>("preop");
  const [subScreen, setSubScreen] = useState<SubScreen>("review");

  const [providers, setProviders] = useState<Provider[]>([]);
  const [me, setMe] = useState<string | null>(
    () => localStorage.getItem(PROVIDER_STORAGE_KEY) ?? null,
  );
  const [workFilters, setWorkFilters] = useState<WorklistFilters>({
    stage: "all",
    status: "all",
    mine: false,
  });

  // per-claim review actions (v2 W6a): sidecar map for the selected live case
  const [claimReviews, setClaimReviews] = useState<ClaimReviews>({});
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [highlightedAnchor, setHighlightedAnchor] = useState<string | null>(null);
  // claim ids repeat across artifacts (each artifact numbers its own claims),
  // so the active claim must be tracked per artifact
  const [activeClaim, setActiveClaim] = useState<{
    artifactId: string;
    claimId: string;
  } | null>(null);

  // audio provenance (U2): which recording the player holds, playback position
  // for transcript follow-along, and sources whose wav 404'd (degrade to
  // timestamp-only, ui.md §2)
  const playerRef = useRef<AudioPlayerHandle>(null);
  const pendingSeekRef = useRef<{ t0: number; t1: number | null } | null>(null);
  const [loadedAudio, setLoadedAudio] = useState<{ sourceId: string; src: string } | null>(null);
  const [playerTime, setPlayerTime] = useState<number | null>(null);
  const [missingAudio, setMissingAudio] = useState<Set<string>>(new Set());

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

  async function handleCreateCase(label: string) {
    if (!me) return;
    try {
      const created = await createCase(label, me);
      setCases(await fetchCases());
      openCase(created.case_id);
    } catch (e) {
      setError(String(e));
    }
  }

  function openCase(caseId: string) {
    setSelectedId(caseId);
    setView("case");
  }

  useEffect(() => {
    if (!selectedId) return;
    let stale = false;
    fetchCase(selectedId)
      .then((c) => {
        if (stale) return;
        setKase(c);
        // land on the stage/screen that needs attention (brief §4.9)
        const landing = defaultSubScreen(c);
        setActiveStage(landing.stage);
        setSubScreen(landing.screen);
        setActiveSourceId(c.sources[0]?.source_id ?? null);
        setHighlightedAnchor(null);
        setActiveClaim(null);
        setLoadedAudio(null);
        setPlayerTime(null);
        setMissingAudio(new Set());
        setClaimReviews({});
        if (c.workflow) {
          fetchClaimReviews(c.case_id)
            .then((r) => {
              if (!stale) setClaimReviews(r);
            })
            .catch(() => {});
        }
      })
      .catch((e) => setError(String(e)));
    return () => {
      stale = true;
    };
  }, [selectedId]);

  const reverseIndex = useMemo(
    () => (kase ? buildReverseIndex(kase) : new Map<string, CitingClaim[]>()),
    [kase],
  );

  const conflictCount = useMemo(
    () => (kase ? allClaims(kase.artifacts).filter(claimFlagged).length : 0),
    [kase],
  );

  /** Artifacts that belong to a stage (for Review/Sign-off/Handoff screens). */
  function stageArtifacts(stage: StageKey) {
    if (!kase) return [];
    const ids =
      stage === "preop"
        ? ["note:pre-anesthesia-eval"]
        : stage === "intraop"
          ? ["record:intra-op", "note:anticipated-issues"]
          : ["note:pacu-handoff", "note:post-anesthesia-eval"];
    return ids
      .map((id) => kase.artifacts.find((a) => a.artifact_id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a));
  }

  /** Land on a stage node: its Review if generated, else its first capture step. */
  function stageLanding(stage: StageKey): SubScreen {
    const generated = kase?.artifacts.some((a) => a.artifact_id === PRIMARY_ARTIFACT[stage]);
    if (generated) return stage === "postop" ? "handoff" : "review";
    return STAGE_SUBSTEPS[stage][0].key;
  }

  /** Load a source's wav (if needed) then seek/clip once the element exists. */
  function driveAudio(sourceId: string, t0: number, t1: number | null) {
    if (!kase || missingAudio.has(sourceId)) return; // timestamp-only mode
    if (loadedAudio?.sourceId === sourceId) {
      if (t1 === null) playerRef.current?.seekToTime(t0);
      else playerRef.current?.playClip(t0, t1);
    } else {
      pendingSeekRef.current = { t0, t1 };
      setLoadedAudio({ sourceId, src: audioUrl(kase.case_id, sourceId) });
    }
  }

  useEffect(() => {
    const pending = pendingSeekRef.current;
    if (!loadedAudio || !pending) return;
    pendingSeekRef.current = null;
    if (pending.t1 === null) playerRef.current?.seekToTime(pending.t0);
    else playerRef.current?.playClip(pending.t0, pending.t1);
  }, [loadedAudio]);

  /**
   * Claim/chip click (ui.md §5.3): resolve the ref; chunks highlight in the
   * source panel, segments additionally play the exact clip (v1 §11 step 3).
   */
  function activateRef(ref: string) {
    if (!kase) return;
    const hit = resolveRef(kase, ref);
    if (!hit) return; // UNRESOLVED — the chip badge is the finding
    setActiveSourceId(hit.source.source_id);
    setHighlightedAnchor(hit.kind === "chunk" ? hit.chunk.chunk_id : hit.segment.seg_id);
    if (hit.kind === "segment") {
      driveAudio(hit.source.source_id, hit.segment.t0, hit.segment.t1);
    }
  }

  // keyboard navigation (ui.md §11 U4): ↑/↓ walk the visible claims of the
  // review ledger, Enter activates the focused claim's first ref
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!kase || view !== "case" || (subScreen !== "review" && subScreen !== "handoff")) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag && ["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
      const rows = stageArtifacts(activeStage).flatMap((a) =>
        a.claims
          .filter((c) => filters[c.status])
          .map((c) => ({ artifactId: a.artifact_id, claimId: c.claim_id, claim: c })),
      );
      if (rows.length === 0) return;
      const idx = rows.findIndex(
        (r) => r.artifactId === activeClaim?.artifactId && r.claimId === activeClaim?.claimId,
      );
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next =
          idx === -1
            ? 0
            : Math.min(Math.max(idx + (e.key === "ArrowDown" ? 1 : -1), 0), rows.length - 1);
        const row = rows[next];
        setActiveClaim({ artifactId: row.artifactId, claimId: row.claimId });
        document
          .getElementById(claimDomId(row.artifactId, row.claimId))
          ?.scrollIntoView?.({ block: "nearest" });
      } else if (e.key === "Enter" && idx >= 0) {
        const ref = rows[idx].claim.provenance[0];
        if (ref) activateRef(ref);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /** Per-claim review action (v2 W6a): optimistic-free, server map wins. */
  async function handleReviewClaim(ref: string, state: ClaimReviewState | null) {
    if (!kase || !me) return;
    try {
      setClaimReviews(await reviewClaim(kase.case_id, ref, state, me));
    } catch (e) {
      setError(String(e));
    }
  }

  /** Which stage owns an artifact (for reverse-index jumps across stages). */
  function artifactStage(artifactId: string): StageKey {
    if (["record:intra-op", "note:anticipated-issues"].includes(artifactId)) return "intraop";
    if (["note:pacu-handoff", "note:post-anesthesia-eval"].includes(artifactId)) return "postop";
    return "preop";
  }

  /** Bring a citing claim into view in its stage's ledger. */
  function jumpToClaim(artifactId: string, claimId: string) {
    setActiveStage(artifactStage(artifactId));
    setSubScreen("review");
    setActiveClaim({ artifactId, claimId });
    requestAnimationFrame(() => {
      document
        .getElementById(claimDomId(artifactId, claimId))
        ?.scrollIntoView?.({ block: "center" });
    });
  }

  function refresh(updated: Case) {
    setKase(updated);
    fetchCases().then(setCases).catch(() => {});
  }

  // The provenance panel (audio + Interview/Documents source browser), shared
  // by the Review and Handoff screens.
  const provenancePanel = kase ? (
    <div className="flex min-h-0 w-[min(42%,440px)] flex-none flex-col border-l border-surface-overlay bg-surface-sunken">
      <AudioPlayer
        ref={playerRef}
        src={loadedAudio?.src ?? null}
        label={loadedAudio?.sourceId ?? null}
        onTimeUpdate={setPlayerTime}
        onError={() => {
          if (!loadedAudio) return;
          setMissingAudio((prev) => new Set(prev).add(loadedAudio.sourceId));
          setLoadedAudio(null);
          setPlayerTime(null);
        }}
      />
      {missingAudio.size > 0 && (
        <p className="border-b border-surface-overlay px-4 py-1.5 text-xs text-status-unsupported">
          timestamp-only mode — no rendered wav for{" "}
          <span className="font-mono">{[...missingAudio].join(", ")}</span>
        </p>
      )}
      <SourcePanel
        kase={kase}
        reverseIndex={reverseIndex}
        activeSourceId={activeSourceId}
        highlightedAnchor={highlightedAnchor}
        currentTime={playerTime}
        playingSourceId={loadedAudio?.sourceId ?? null}
        onSelectSource={(id) => {
          setActiveSourceId(id);
          setHighlightedAnchor(null);
        }}
        onSeekToTime={(seconds) => {
          if (activeSourceId) driveAudio(activeSourceId, seconds, null);
        }}
        onJumpToClaim={jumpToClaim}
      />
    </div>
  ) : null;

  const providerControl = (
    <ProviderPicker providers={providers} selected={me} onSelect={pickProvider} />
  );

  function renderCaseBody() {
    if (!kase) return null;
    const action = primaryAction(kase);
    const stageAction = action?.stage === activeStage ? action : null;
    const artifacts = stageArtifacts(activeStage);

    switch (subScreen) {
      case "review":
        return (
          <ReviewScreen
            kase={kase}
            stage={activeStage}
            artifacts={artifacts}
            filters={filters}
            onToggleFilter={(s) => setFilters((f) => ({ ...f, [s]: !f[s] }))}
            activeClaim={activeClaim}
            onActivateRef={activateRef}
            reviews={claimReviews}
            onReviewClaim={me ? handleReviewClaim : undefined}
            canSignOff={stageAction?.kind === "sign-off"}
            onGoSignOff={() => setSubScreen("signoff")}
            provenancePanel={provenancePanel}
          />
        );
      case "signoff":
        return (
          <SignOffScreen
            kase={kase}
            stage={activeStage}
            artifacts={artifacts}
            reviews={claimReviews}
            me={me}
            providers={providers}
            signedOff={kase.workflow?.stages[activeStage].status === "signed_off"}
            onSignOff={async () => {
              if (!me) return;
              refresh(await signoffStage(kase.case_id, activeStage, me));
            }}
            onReopen={async () => {
              if (!me) return;
              refresh(await reopenStage(kase.case_id, activeStage, me));
            }}
            onJumpToClaim={jumpToClaim}
          />
        );
      case "handoff":
        return (
          <HandoffScreen
            kase={kase}
            artifacts={artifacts}
            me={me}
            providers={providers}
            onActivateRef={activateRef}
            onAcknowledge={async () => {
              if (!me) return;
              refresh(await acknowledgeHandoff(kase.case_id, me));
            }}
            provenancePanel={provenancePanel}
          />
        );
      default:
        // capture + generate + orientation screens
        return (
          <StagePanel
            kase={kase}
            me={me}
            stage={activeStage}
            screen={subScreen}
            onCaseUpdated={refresh}
            onActivateRef={activateRef}
            onNavigate={setSubScreen}
            onWorklist={() => setView("worklist")}
          />
        );
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <StepperShell
        kase={view === "case" ? kase : null}
        activeStage={activeStage}
        activeScreen={subScreen}
        conflictCount={conflictCount}
        providerControl={providerControl}
        onWorklist={() => setView("worklist")}
        onStage={(stage) => {
          setActiveStage(stage);
          setSubScreen(stageLanding(stage));
        }}
        onSubStep={(stage, screen) => {
          setActiveStage(stage);
          setSubScreen(screen);
        }}
        onOrientation={() => setSubScreen("orientation")}
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="m-4 rounded-lg border border-status-conflicting/50 bg-status-conflicting/10 p-3 text-sm text-status-conflicting">
            {error}
          </div>
        )}
        {view === "worklist" && (
          <WorklistScreen
            cases={cases}
            providers={providers}
            workFilters={workFilters}
            onWorkFilters={setWorkFilters}
            me={me}
            onOpen={openCase}
            onNewCase={() => setView("new")}
          />
        )}
        {view === "new" && (
          <NewCaseForm
            canCreate={me !== null}
            onCreate={handleCreateCase}
            onCancel={() => setView("worklist")}
          />
        )}
        {view === "case" && renderCaseBody()}
      </main>
    </div>
  );
}
