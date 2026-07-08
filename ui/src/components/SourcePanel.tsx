import { useEffect, useState } from "react";
import type { CitingClaim } from "../lib/provenance";
import type { Case, Source } from "../lib/schema";
import { DocumentView } from "./DocumentView";
import { TranscriptView } from "./TranscriptView";

type Tab = "interview" | "docs";

/**
 * Right-sidebar source browser (brief §4.5), two tabs matching the design:
 * Interview (the recording's diarized transcript, with follow-along) and
 * Documents (the case's source documents, with the cited excerpt highlighted).
 * The audio player itself lives above this panel.
 */
export function SourcePanel({
  kase,
  reverseIndex,
  activeSourceId,
  highlightedAnchor,
  currentTime,
  playingSourceId,
  onSelectSource,
  onSeekToTime,
  onJumpToClaim,
}: {
  kase: Case;
  reverseIndex: Map<string, CitingClaim[]>;
  activeSourceId: string | null;
  highlightedAnchor: string | null;
  currentTime: number | null;
  playingSourceId: string | null;
  onSelectSource: (sourceId: string) => void;
  onSeekToTime: (seconds: number) => void;
  onJumpToClaim: (artifactId: string, claimId: string) => void;
}) {
  const audioSources = kase.sources.filter((s) => s.type === "audio");
  const docSources = kase.sources.filter((s) => s.type === "document");
  const active = kase.sources.find((s) => s.source_id === activeSourceId) ?? null;

  const [tab, setTab] = useState<Tab>(active?.type === "document" ? "docs" : "interview");
  // follow the active source's kind (a doc citation opens Documents, etc.)
  useEffect(() => {
    if (active?.type === "document") setTab("docs");
    else if (active?.type === "audio") setTab("interview");
  }, [active?.source_id, active?.type]);

  const audio: Source | null =
    (active?.type === "audio" ? active : null) ?? audioSources[0] ?? null;
  const doc: Source | null =
    (active?.type === "document" ? active : null) ?? docSources[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none gap-5 border-b border-surface-overlay px-5 pt-3.5">
        <TabButton
          label="Interview"
          active={tab === "interview"}
          onClick={() => {
            setTab("interview");
            if (audio) onSelectSource(audio.source_id);
          }}
        />
        <TabButton
          label="Documents"
          active={tab === "docs"}
          onClick={() => {
            setTab("docs");
            if (doc) onSelectSource(doc.source_id);
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "interview" &&
          (audio ? (
            <TranscriptView
              source={audio}
              highlightedAnchor={highlightedAnchor}
              currentTime={currentTime}
              playing={audio.source_id === playingSourceId}
              reverseIndex={reverseIndex}
              onSeekToTime={onSeekToTime}
              onJumpToClaim={onJumpToClaim}
            />
          ) : (
            <p className="p-4 text-sm text-ink-subtle">No interview recording on this case.</p>
          ))}

        {tab === "docs" &&
          (docSources.length > 0 ? (
            <>
              {docSources.length > 1 && (
                <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                  {docSources.map((s) => (
                    <button
                      key={s.source_id}
                      type="button"
                      onClick={() => onSelectSource(s.source_id)}
                      className={`rounded-md px-2 py-1 font-mono text-[11px] ${
                        s.source_id === doc?.source_id
                          ? "bg-surface-overlay text-ink-primary"
                          : "text-ink-subtle hover:text-ink-secondary"
                      }`}
                    >
                      {s.source_id}
                    </button>
                  ))}
                </div>
              )}
              {doc && (
                <DocumentView
                  source={doc}
                  highlightedAnchor={highlightedAnchor}
                  reverseIndex={reverseIndex}
                  onJumpToClaim={onJumpToClaim}
                />
              )}
            </>
          ) : (
            <p className="p-4 text-sm text-ink-subtle">No documents on this case.</p>
          ))}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`border-b-2 py-2 text-[13.5px] font-semibold ${
        active ? "border-brand text-ink-primary" : "border-transparent text-ink-subtle"
      }`}
    >
      {label}
    </button>
  );
}
