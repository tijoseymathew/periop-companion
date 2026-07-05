"""Render case sources into a citable prompt block.

Each chunk/segment is shown with its full provenance ref (``source_id#anchor``)
so the model can cite exactly. No embeddings/RAG — the whole record set fits
in context (spec §3.3).
"""

from periop.schemas import Case, SourceType


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
