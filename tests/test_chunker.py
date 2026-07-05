"""Deterministic chunker tests.

Spec §3.3 step 1: no vector embeddings/RAG — chunking exists purely to give
provenance links stable, citable anchors (deterministic section/paragraph
chunking).
"""

from periop.schemas import SourceType
from periop.tools.chunker import chunk_text, ingest_document

GP_SUMMARY = """\
# GP Summary — Mdm Tan

## Medications

Aspirin 100mg OD, started 2019.

Metformin 500mg BD.

## Past History

Community-acquired pneumonia, 2015, fully resolved.
"""


class TestChunkText:
    def test_paragraphs_become_chunks_with_sequential_ids(self):
        chunks = chunk_text("First paragraph.\n\nSecond paragraph.")
        assert [c.chunk_id for c in chunks] == ["c001", "c002"]
        assert chunks[0].text == "First paragraph."
        assert chunks[1].text == "Second paragraph."

    def test_headings_set_section_and_are_not_chunks(self):
        chunks = chunk_text(GP_SUMMARY)
        assert [c.text for c in chunks] == [
            "Aspirin 100mg OD, started 2019.",
            "Metformin 500mg BD.",
            "Community-acquired pneumonia, 2015, fully resolved.",
        ]
        assert chunks[0].section == "Medications"
        assert chunks[1].section == "Medications"
        assert chunks[2].section == "Past History"

    def test_deterministic(self):
        assert chunk_text(GP_SUMMARY) == chunk_text(GP_SUMMARY)

    def test_multiline_paragraph_is_one_chunk(self):
        chunks = chunk_text("Line one\nline two of the same paragraph.\n\nNext.")
        assert len(chunks) == 2
        assert chunks[0].text == "Line one\nline two of the same paragraph."

    def test_blank_input_yields_no_chunks(self):
        assert chunk_text("") == []
        assert chunk_text("\n\n  \n") == []

    def test_text_before_any_heading_has_no_section(self):
        chunks = chunk_text("Preamble.\n\n# Title\n\nBody.")
        assert chunks[0].section is None
        assert chunks[1].section == "Title"


class TestIngestDocument:
    def test_builds_document_source(self):
        src = ingest_document("doc:gp-summary-2024", GP_SUMMARY)
        assert src.source_id == "doc:gp-summary-2024"
        assert src.type == SourceType.DOCUMENT
        assert src.get_anchor("c001").text == "Aspirin 100mg OD, started 2019."
