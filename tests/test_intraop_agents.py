"""IntraOpRecordWriter + IssueAnticipator tests (spec §3.4 steps 3-4)."""

import pytest

from periop.agents.event_extractor import ExtractedEvent
from periop.agents.intraop_record import INTRAOP_RECORD_ID, IntraOpRecordWriter
from periop.agents.issue_anticipator import (
    ANTICIPATED_ISSUES_ID,
    AnticipatedIssue,
    AnticipatedIssues,
    IssueAnticipator,
)
from periop.agents.preop_note import PREOP_NOTE_ID, WriterClaim, WriterOutput
from periop.schemas import ArtifactRecord, Case, Claim, SourceType
from periop.tools.ingest import transcript_from_voice_notes


@pytest.fixture
def case(tmp_path):
    import json

    path = tmp_path / "intraop-notes.json"
    path.write_text(
        json.dumps(
            {
                "notes": [
                    {"t": "08:02", "text": "Propofol one twenty milligrams."},
                    {"t": "08:20", "text": "Sevoflurane maintenance."},
                ]
            }
        )
    )
    c = Case(case_id="sg-0001")
    c.add_source(transcript_from_voice_notes(path, "audio:intraop-notes"))
    # a pre-op note already exists (PONV history claim)
    c.add_artifact(
        ArtifactRecord(
            artifact_id=PREOP_NOTE_ID,
            claims=[
                Claim(
                    claim_id="c-001",
                    text="History of severe PONV after prior anesthetic.",
                    provenance=["audio:intraop-notes#s001"],
                )
            ],
        )
    )
    return c


def _events():
    return [
        ExtractedEvent(t="08:02", category="dose", value="propofol 120", units="mg",
                       provenance=["audio:intraop-notes#s001"]),
        ExtractedEvent(t="08:20", category="agent", value="sevoflurane",
                       provenance=["audio:intraop-notes#s002"]),
    ]


class FakeChat:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append(user)
        return self.result


class TestIntraOpRecordWriter:
    def test_writes_record_claims_from_events(self, case):
        out = WriterOutput(
            claims=[
                WriterClaim(text="Induced with propofol 120 mg at 08:02.",
                            section="Agents", provenance=["audio:intraop-notes#s001"]),
                WriterClaim(text="Maintained on sevoflurane from 08:20.",
                            section="Agents", provenance=["audio:intraop-notes#s002"]),
            ]
        )
        writer = IntraOpRecordWriter(chat=FakeChat(out))
        artifact = writer.write(case, _events())
        assert artifact.artifact_id == INTRAOP_RECORD_ID
        assert len(artifact.claims) == 2
        assert case.get_artifact(INTRAOP_RECORD_ID) is artifact

    def test_event_log_shown_to_writer(self, case):
        writer = IntraOpRecordWriter(chat=FakeChat(WriterOutput(claims=[])))
        writer.write(case, _events())
        assert "propofol 120" in writer.chat.calls[0]

    def test_drops_dangling_provenance(self, case):
        out = WriterOutput(
            claims=[
                WriterClaim(text="ok", section="Agents",
                            provenance=["audio:intraop-notes#s001"]),
                WriterClaim(text="bad", section="Agents",
                            provenance=["audio:ghost#s9"]),
            ]
        )
        artifact = IntraOpRecordWriter(chat=FakeChat(out)).write(case, _events())
        assert [c.text for c in artifact.claims] == ["ok"]


class TestIssueAnticipator:
    def test_issues_carry_cross_stage_provenance(self, case):
        IntraOpRecordWriter(chat=FakeChat(WriterOutput(claims=[
            WriterClaim(text="Sevoflurane maintenance.", section="Agents",
                        provenance=["audio:intraop-notes#s002"]),
        ]))).write(case, _events())

        issues = AnticipatedIssues(issues=[
            AnticipatedIssue(
                issue="High PONV risk: prior severe PONV plus volatile maintenance.",
                provenance=["audio:intraop-notes#s001", "audio:intraop-notes#s002"],
            )
        ])
        anticipator = IssueAnticipator(chat=FakeChat(issues))
        artifact = anticipator.anticipate(case)
        assert artifact.artifact_id == ANTICIPATED_ISSUES_ID
        # provenance spans both the pre-op history and the intra-op agent
        assert len(artifact.claims[0].provenance) == 2
        assert case.anticipated_issues == [issues.issues[0].issue]

    def test_prompt_includes_both_stages(self, case):
        IntraOpRecordWriter(chat=FakeChat(WriterOutput(claims=[]))).write(case, _events())
        anticipator = IssueAnticipator(chat=FakeChat(AnticipatedIssues(issues=[])))
        anticipator.anticipate(case)
        prompt = anticipator.chat.calls[0]
        assert "PONV" in prompt  # pre-op claim
        assert "propofol 120" in prompt  # intra-op event
