/**
 * The review workspace (ui.md §5): one screen, three columns, all state here
 * with useState/useMemo and props down — no router, no store (ui.md §3).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Stethoscope } from "lucide-react";
import { ArtifactView } from "../components/ArtifactView";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
import { claimDomId } from "../components/ClaimRow";
import { DepartmentBoard } from "../components/DepartmentBoard";
import { NewCaseForm } from "../components/NewCaseForm";
import { ProviderPicker } from "../components/ProviderPicker";
import { SourcePanel } from "../components/SourcePanel";
import { StageRail } from "../components/StageRail";
import { StageTabs } from "../components/StageTabs";
import { Worklist } from "../components/Worklist";
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
import { groupArtifactsByStage, type Stage } from "../lib/stages";
import { SignOffBar } from "../components/SignOffBar";
import { StagePanel } from "../components/StagePanel";
import { headlineStage, primaryAction, STAGE_TITLES, type WorklistFilters } from "../lib/workflow";
import type {
  Case,
  CaseSummary,
  ClaimReviews,
  ClaimReviewState,
  ClaimStatus,
  Provider,
  StageKey,
} from "../lib/schema";

const PROVIDER_STORAGE_KEY = "periop-provider";

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kase, setKase] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<StatusFilters>(defaultFilters());
  const [activeStage, setActiveStage] = useState<Stage>("Pre-op");
  // v2 workflow state: the provider identity (attribution, not identity),
  // worklist filters, and the New case form
  const [providers, setProviders] = useState<Provider[]>([]);
  const [me, setMe] = useState<string | null>(
    () => localStorage.getItem(PROVIDER_STORAGE_KEY) ?? null,
  );
  const [workFilters, setWorkFilters] = useState<WorklistFilters>({
    stage: "all",
    status: "all",
    mine: false,
  });
  const [creating, setCreating] = useState(false);
  // department dashboard (v2 W6c) rendered in place of the case view
  const [showBoard, setShowBoard] = useState(false);
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

  // audio provenance (U2): which recording the player holds, playback
  // position for transcript follow-along, and sources whose wav 404'd
  // (degrade to timestamp-only, ui.md §2)
  const playerRef = useRef<AudioPlayerHandle>(null);
  const pendingSeekRef = useRef<{ t0: number; t1: number | null } | null>(null);
  const [loadedAudio, setLoadedAudio] = useState<{ sourceId: string; src: string } | null>(null);
  const [playerTime, setPlayerTime] = useState<number | null>(null);
  const [missingAudio, setMissingAudio] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchCases()
      .then((list) => {
        setCases(list);
        if (list.length > 0) setSelectedId((cur) => cur ?? list[0].case_id);
      })
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
      setCreating(false);
      setCases(await fetchCases());
      setSelectedId(created.case_id);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (!selectedId) return;
    let stale = false;
    fetchCase(selectedId)
      .then((c) => {
        if (stale) return;
        setKase(c);
        // live cases open on the stage that needs attention (v2 §6.8)
        const current = headlineStage(c.workflow);
        setActiveStage(current ? STAGE_TITLES[current] : "Pre-op");
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

  const groups = useMemo(() => (kase ? groupArtifactsByStage(kase.artifacts) : []), [kase]);
  const reverseIndex = useMemo(
    () => (kase ? buildReverseIndex(kase) : new Map<string, CitingClaim[]>()),
    [kase],
  );
  // live cases keep the selected stage even when it has no artifacts yet
  // (capture screens render there); demo cases fall back to the first group
  const activeGroup = kase?.workflow
    ? (groups.find((g) => g.stage === activeStage) ?? null)
    : (groups.find((g) => g.stage === activeStage) ?? groups[0] ?? null);
  const activeKey: StageKey =
    ({ "Pre-op": "preop", "Intra-op": "intraop", "Post-op": "postop" } as const)[
      activeStage as "Pre-op" | "Intra-op" | "Post-op"
    ] ?? "preop";

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

  // apply a seek/clip that was waiting for the player to (re)load
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
  // active stage, Enter activates the focused claim's first ref
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!kase || !activeGroup) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag && ["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
      const rows = activeGroup.artifacts.flatMap((a) =>
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

  /** Reverse-index click: bring the citing claim into view in the ledger. */
  function jumpToClaim(artifactId: string, claimId: string) {
    const group = groups.find((g) => g.artifacts.some((a) => a.artifact_id === artifactId));
    if (group) setActiveStage(group.stage);
    setActiveClaim({ artifactId, claimId });
    requestAnimationFrame(() => {
      document
        .getElementById(claimDomId(artifactId, claimId))
        ?.scrollIntoView?.({ block: "center" });
    });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-surface-overlay bg-surface-raised px-4 py-2">
        <Stethoscope className="h-5 w-5 text-brand" aria-hidden />
        <h1 className="text-sm font-semibold">
          PeriOp Companion <span className="font-normal text-ink-subtle">· Review</span>
        </h1>
        <div className="ml-auto flex items-center gap-3">
          {selectedId && (
            <span className="font-mono text-xs text-ink-secondary">{selectedId}</span>
          )}
          <ProviderPicker providers={providers} selected={me} onSelect={pickProvider} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Worklist
          cases={cases}
          providers={providers}
          selectedId={selectedId}
          onSelect={(id) => {
            setCreating(false);
            setShowBoard(false);
            setSelectedId(id);
          }}
          onNewCase={() => {
            setShowBoard(false);
            setCreating(true);
          }}
          onDepartment={() => {
            setCreating(false);
            setShowBoard(true);
          }}
          filters={filters}
          onToggleFilter={(status: ClaimStatus) =>
            setFilters((f) => ({ ...f, [status]: !f[status] }))
          }
          workFilters={workFilters}
          onWorkFilters={setWorkFilters}
          me={me}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          {error && (
            <div className="m-4 rounded border border-status-conflicting/50 p-3 text-sm text-status-conflicting">
              {error}
            </div>
          )}
          {creating ? (
            <NewCaseForm
              canCreate={me !== null}
              onCreate={handleCreateCase}
              onCancel={() => setCreating(false)}
            />
          ) : showBoard ? (
            <DepartmentBoard
              cases={cases}
              providers={providers}
              onSelect={(id) => {
                setShowBoard(false);
                setSelectedId(id);
              }}
            />
          ) : kase?.workflow ? (
            <>
              <StageRail
                workflow={kase.workflow}
                active={activeKey}
                onSelect={(key) => setActiveStage(STAGE_TITLES[key])}
              />
              {(() => {
                const action = primaryAction(kase);
                const stageAction = action?.stage === activeKey ? action : null;
                const refresh = (updated: Case) => {
                  setKase(updated);
                  fetchCases().then(setCases).catch(() => {});
                };
                if (!activeGroup) {
                  return (
                    <StagePanel
                      kase={kase}
                      me={me}
                      stage={activeKey}
                      action={stageAction}
                      onCaseUpdated={refresh}
                      onActivateRef={activateRef}
                    />
                  );
                }
                return (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      {activeGroup.artifacts.map((artifact) => (
                        <ArtifactView
                          key={artifact.artifact_id}
                          kase={kase}
                          artifact={artifact}
                          filters={filters}
                          activeClaimId={
                            activeClaim?.artifactId === artifact.artifact_id
                              ? activeClaim.claimId
                              : null
                          }
                          onActivateRef={activateRef}
                          reviews={claimReviews}
                          onReviewClaim={me ? handleReviewClaim : undefined}
                        />
                      ))}
                    </div>
                    <SignOffBar
                      kase={kase}
                      artifacts={activeGroup.artifacts}
                      reviews={claimReviews}
                      action={
                        stageAction?.kind === "sign-off" ||
                        stageAction?.kind === "acknowledge-handoff"
                          ? stageAction
                          : null
                      }
                      signedOff={kase.workflow.stages[activeKey].status === "signed_off"}
                      onSignOff={async () => {
                        if (!me) return;
                        refresh(await signoffStage(kase.case_id, activeKey, me));
                      }}
                      onAcknowledge={async () => {
                        if (!me) return;
                        refresh(await acknowledgeHandoff(kase.case_id, me));
                      }}
                      onReopen={async () => {
                        if (!me) return;
                        refresh(await reopenStage(kase.case_id, activeKey, me));
                      }}
                      onJumpToClaim={jumpToClaim}
                    />
                  </>
                );
              })()}
            </>
          ) : (
            kase &&
            activeGroup && (
              <>
                <StageTabs groups={groups} active={activeGroup.stage} onSelect={setActiveStage} />
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {activeGroup.artifacts.map((artifact) => (
                    <ArtifactView
                      key={artifact.artifact_id}
                      kase={kase}
                      artifact={artifact}
                      filters={filters}
                      activeClaimId={
                        activeClaim?.artifactId === artifact.artifact_id
                          ? activeClaim.claimId
                          : null
                      }
                      onActivateRef={activateRef}
                    />
                  ))}
                </div>
              </>
            )
          )}
        </main>
        <aside className="flex w-96 shrink-0 flex-col border-l border-surface-overlay bg-surface-sunken">
          <AudioPlayer
            ref={playerRef}
            src={loadedAudio?.src ?? null}
            label={loadedAudio?.sourceId ?? null}
            onTimeUpdate={setPlayerTime}
            onError={() => {
              if (!loadedAudio) return;
              // wav not rendered (gitignored) → timestamp-only mode
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
          {kase && (
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
          )}
        </aside>
      </div>
    </div>
  );
}
