"""Render case sources into a citable prompt block.

Each chunk/segment is shown with its full provenance ref (``source_id#anchor``)
so the model can cite exactly. No embeddings/RAG — the whole record set fits
in context (spec §3.3).
"""

from periop.schemas import ArtifactRecord, Case, SourceType


def preview_texts(texts: list[str], limit: int = 4, maxlen: int = 90) -> list[str]:
    """Trim a step's output to a short list of one-line previews for the SSE
    stream (ui.md §7) — the provider's live look at what an agent is drafting,
    not a copy of the full output."""
    out = []
    for text in texts[:limit]:
        text = " ".join(text.split())  # collapse embedded newlines/whitespace
        out.append(text if len(text) <= maxlen else text[: maxlen - 1].rstrip() + "…")
    return out


def render_claims(artifact: ArtifactRecord) -> str:
    """Render an artifact's claims with global refs (``artifact_id#claim_id``).

    Used when a downstream agent composes over already-generated claims (issue
    anticipation, handoff composition) rather than raw sources.
    """
    return "\n".join(
        f"[{artifact.artifact_id}#{c.claim_id}] ({c.status}) {c.text}"
        for c in artifact.claims
    )


def normalize_refs(refs: list[str]) -> list[str]:
    """Strip the display brackets/whitespace models echo from prompts.

    Prompts render citable anchors as ``[source_id#anchor]``; structured
    replies sometimes include the brackets. Apply as a field validator on
    every model-output provenance/citation field so downstream resolution
    never silently drops a claim over formatting.
    """
    return [r.strip().strip("[]") for r in refs]


def provenance_resolves(case: Case, refs: list[str]) -> bool:
    """True if every ref in ``refs`` resolves to a registered anchor."""
    if not refs:
        return False
    try:
        for ref in refs:
            case.resolve(ref)
    except (KeyError, ValueError):
        return False
    return True


def render_sources(case: Case, types: tuple[SourceType, ...] | None = None) -> str:
    """Render document chunks and/or audio segments with citable anchors."""
    blocks: list[str] = []
    for source in case.sources:
        if types is not None and source.type not in types:
            continue
        lines = [f"### {source.source_id} ({source.type})"]
        if source.type is SourceType.DOCUMENT:
            for chunk in source.chunks:
                sec = f" [{chunk.section}]" if chunk.section else ""
                lines.append(f"[{source.source_id}#{chunk.chunk_id}]{sec} {chunk.text}")
        else:
            for seg in source.segments:
                lines.append(
                    f"[{source.source_id}#{seg.seg_id}] ({seg.speaker}, "
                    f"{seg.t0:.1f}-{seg.t1:.1f}s) {seg.text}"
                )
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)
