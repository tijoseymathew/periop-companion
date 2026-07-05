"""Deterministic section/paragraph chunking for citable provenance anchors.

No embeddings, no RAG: prior records are small enough to fit in context.
Chunking exists purely so provenance links have stable anchors — the same
document always yields the same chunk ids.
"""

import re

from periop.schemas import Chunk, Source, SourceType

_HEADING = re.compile(r"^#{1,6}\s+(.*\S)\s*$")


def chunk_text(text: str) -> list[Chunk]:
    """Split markdown/plain text into paragraph chunks with stable ids.

    Headings are not chunks themselves; they set the ``section`` of the
    paragraphs that follow. Chunk ids are ``c001``, ``c002``, … in document
    order.
    """
    chunks: list[Chunk] = []
    section: str | None = None
    paragraph: list[str] = []

    def flush() -> None:
        body = "\n".join(paragraph).strip()
        paragraph.clear()
        if body:
            chunks.append(Chunk(chunk_id=f"c{len(chunks) + 1:03d}", text=body, section=section))

    for line in text.splitlines():
        heading = _HEADING.match(line)
        if heading:
            flush()
            section = heading.group(1)
        elif line.strip():
            paragraph.append(line.rstrip())
        else:
            flush()
    flush()
    return chunks


def ingest_document(source_id: str, text: str) -> Source:
    """Chunk a prior-record document into a citable Source."""
    return Source(source_id=source_id, type=SourceType.DOCUMENT, chunks=chunk_text(text))
