/**
 * The review workspace (ui.md §5): one screen, three columns, all state here
 * with useState/useMemo and props down — no router, no store (ui.md §3).
 */
import { useEffect, useMemo, useState } from "react";
import { Stethoscope } from "lucide-react";
import { ArtifactView } from "../components/ArtifactView";
import { CaseList } from "../components/CaseList";
import { claimDomId } from "../components/ClaimRow";
import { SourcePanel } from "../components/SourcePanel";
import { StageTabs } from "../components/StageTabs";
import { fetchCase, fetchCases } from "../lib/api";
import { defaultFilters, type StatusFilters } from "../lib/filters";
import { buildReverseIndex, resolveRef, type CitingClaim } from "../lib/provenance";
import { groupArtifactsByStage, type Stage } from "../lib/stages";
import type { Case, CaseSummary, ClaimStatus } from "../lib/schema";

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kase, setKase] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<StatusFilters>(defaultFilters());
  const [activeStage, setActiveStage] = useState<Stage>("Pre-op");
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [highlightedAnchor, setHighlightedAnchor] = useState<string | null>(null);
  // claim ids repeat across artifacts (each artifact numbers its own claims),
  // so the active claim must be tracked per artifact
  const [activeClaim, setActiveClaim] = useState<{
    artifactId: string;
    claimId: string;
  } | null>(null);

  useEffect(() => {
    fetchCases()
      .then((list) => {
        setCases(list);
        if (list.length > 0) setSelectedId((cur) => cur ?? list[0].case_id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let stale = false;
    fetchCase(selectedId)
      .then((c) => {
        if (stale) return;
        setKase(c);
        setActiveStage("Pre-op");
        setActiveSourceId(c.sources[0]?.source_id ?? null);
        setHighlightedAnchor(null);
        setActiveClaim(null);
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
  const activeGroup = groups.find((g) => g.stage === activeStage) ?? groups[0] ?? null;

  /** Claim/chip click: resolve the ref and drive the source panel (ui.md §5.3). */
  function activateRef(ref: string) {
    if (!kase) return;
    const hit = resolveRef(kase, ref);
    if (!hit) return; // UNRESOLVED — the chip badge is the finding
    setActiveSourceId(hit.source.source_id);
    setHighlightedAnchor(hit.kind === "chunk" ? hit.chunk.chunk_id : hit.segment.seg_id);
    // audio clip playback arrives with U2
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
        {selectedId && (
          <span className="ml-auto font-mono text-xs text-ink-secondary">{selectedId}</span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <CaseList
          cases={cases}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filters={filters}
          onToggleFilter={(status: ClaimStatus) =>
            setFilters((f) => ({ ...f, [status]: !f[status] }))
          }
        />
        <main className="flex min-w-0 flex-1 flex-col">
          {error && (
            <div className="m-4 rounded border border-status-conflicting/50 p-3 text-sm text-status-conflicting">
              {error}
            </div>
          )}
          {kase && activeGroup && (
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
          )}
        </main>
        <aside className="flex w-96 shrink-0 flex-col border-l border-surface-overlay bg-surface-sunken">
          {/* audio player slot (h-40) arrives with U2 */}
          {kase && (
            <SourcePanel
              kase={kase}
              reverseIndex={reverseIndex}
              activeSourceId={activeSourceId}
              highlightedAnchor={highlightedAnchor}
              currentTime={null}
              playingSourceId={null}
              onSelectSource={(id) => {
                setActiveSourceId(id);
                setHighlightedAnchor(null);
              }}
              onSeekToTime={() => {
                /* wired to the player in U2 */
              }}
              onJumpToClaim={jumpToClaim}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
