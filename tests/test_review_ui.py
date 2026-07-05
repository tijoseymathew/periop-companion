"""Minimal review UI (spec §2 MVP, §4.4): a self-contained HTML page where a
reviewer can inspect each claim and reveal the exact cited span — document
chunk text, or audio segment with speaker and (t0, t1).
"""

import pytest

from periop.schemas import (
    ArtifactRecord,
    AudioSegment,
    Case,
    Chunk,
    Claim,
    Source,
    SourceType,
)
from periop.ui.review import render_review_html, source_anchor_id, write_review


@pytest.fixture
def case() -> Case:
    return Case(
        case_id="sg-0042",
        sources=[
            Source(
                source_id="doc:gp-summary",
                type=SourceType.DOCUMENT,
                chunks=[
                    Chunk(chunk_id="c1", text="On aspirin 100mg <daily>.", section="Medications"),
                    Chunk(chunk_id="c2", text="Type 2 diabetes, well controlled."),
                ],
            ),
            Source(
                source_id="audio:preop-interview",
                type=SourceType.AUDIO,
                segments=[
                    AudioSegment(
                        seg_id="s017",
                        t0=214.3,
                        t1=221.8,
                        speaker="PATIENT",
                        text="I stopped the aspirin last Tuesday.",
                    )
                ],
            ),
        ],
        artifacts=[
            ArtifactRecord(
                artifact_id="note:pre-anesthesia-eval",
                claims=[
                    Claim(
                        claim_id="c-001",
                        text="Aspirin was discontinued 6 days prior to surgery.",
                        provenance=["audio:preop-interview#s017"],
                        status="supported",
                    ),
                    Claim(
                        claim_id="c-002",
                        text="Records list aspirin 100mg daily as <current>.",
                        provenance=["doc:gp-summary#c1"],
                        status="conflicting",
                    ),
                ],
            ),
            ArtifactRecord(
                artifact_id="note:pacu-handoff",
                claims=[
                    Claim(claim_id="c-101", text="Patient is diabetic.", status="unverified"),
                ],
            ),
        ],
    )


class TestRenderReviewHtml:
    def test_page_names_the_case_and_every_artifact(self, case):
        html = render_review_html(case)
        assert "sg-0042" in html
        assert "note:pre-anesthesia-eval" in html
        assert "note:pacu-handoff" in html

    def test_claim_text_is_html_escaped(self, case):
        html = render_review_html(case)
        assert "&lt;current&gt;" in html
        assert "<current>" not in html
        # source chunk text is escaped too
        assert "&lt;daily&gt;" in html

    def test_claim_status_is_flagged(self, case):
        html = render_review_html(case)
        for status in ("supported", "conflicting", "unverified"):
            assert f'class="claim {status}"' in html

    def test_cited_span_is_revealed_under_the_claim(self, case):
        html = render_review_html(case)
        # the audio citation carries speaker and time range so the reviewer
        # knows which clip to play
        assert "PATIENT" in html
        assert "214.3" in html and "221.8" in html
        assert "I stopped the aspirin last Tuesday." in html
        # the document citation carries its section
        assert "Medications" in html
        # citations are expandable per-claim
        assert "<details" in html and "<summary" in html

    def test_provenance_links_resolve_to_source_registry_anchors(self, case):
        html = render_review_html(case)
        for ref in ("doc:gp-summary#c1", "audio:preop-interview#s017"):
            anchor = source_anchor_id(ref)
            assert f'href="#{anchor}"' in html
            assert f'id="{anchor}"' in html

    def test_unresolvable_provenance_is_surfaced_not_hidden(self):
        case = Case(
            case_id="sg-0001",
            artifacts=[
                ArtifactRecord(
                    artifact_id="note:x",
                    claims=[
                        Claim(claim_id="c-1", text="Orphan claim.", provenance=["doc:gone#c9"])
                    ],
                )
            ],
        )
        html = render_review_html(case)
        assert "UNRESOLVED" in html
        assert "doc:gone#c9" in html

    def test_page_is_self_contained(self, case):
        html = render_review_html(case)
        assert "<script src=" not in html
        assert "<link" not in html


class TestWriteReview:
    def test_writes_html_next_to_store(self, case, tmp_path):
        path = write_review(case, tmp_path)
        assert path == tmp_path / "sg-0042.html"
        assert "note:pre-anesthesia-eval" in path.read_text()
