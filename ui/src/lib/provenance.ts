/**
 * Provenance ref parsing, resolution, and the reverse index (ui.md §5.3–5.4).
 *
 * Mirrors `ProvenanceRef.parse` / `Case.resolve` in `periop.schemas`, with one
 * UI-facing difference: failures return `null` instead of throwing, because an
 * unresolvable ref is a *finding* the UI must render (`UNRESOLVED` badge),
 * never a crash.
 */
import type { AudioSegment, Case, Chunk, Claim, Source } from "./schema";

export interface ParsedRef {
  sourceId: string;
  anchor: string;
}

/** Split `source_id#anchor` on the final `#` (source ids contain colons). */
export function parseRef(ref: string): ParsedRef | null {
  const i = ref.lastIndexOf("#");
  if (i <= 0 || i === ref.length - 1) return null;
  return { sourceId: ref.slice(0, i), anchor: ref.slice(i + 1) };
}

export type ResolvedRef =
  | { kind: "chunk"; source: Source; chunk: Chunk }
  | { kind: "segment"; source: Source; segment: AudioSegment };

export function resolveRef(kase: Case, ref: string): ResolvedRef | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const source = kase.sources.find((s) => s.source_id === parsed.sourceId);
  if (!source) return null;
  if (source.type === "document") {
    const chunk = source.chunks.find((c) => c.chunk_id === parsed.anchor);
    return chunk ? { kind: "chunk", source, chunk } : null;
  }
  const segment = source.segments.find((s) => s.seg_id === parsed.anchor);
  return segment ? { kind: "segment", source, segment } : null;
}

export interface CitingClaim {
  artifactId: string;
  claim: Claim;
}

/**
 * ref string → every claim citing it, in artifact/claim order. Unresolvable
 * refs are indexed too, so "cited by" stays truthful even for broken refs.
 */
export function buildReverseIndex(kase: Case): Map<string, CitingClaim[]> {
  const index = new Map<string, CitingClaim[]>();
  for (const artifact of kase.artifacts) {
    for (const claim of artifact.claims) {
      for (const ref of claim.provenance) {
        let citers = index.get(ref);
        if (!citers) index.set(ref, (citers = []));
        citers.push({ artifactId: artifact.artifact_id, claim });
      }
    }
  }
  return index;
}
