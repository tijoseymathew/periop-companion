"""RecordIngestor + gold-transcript transcriber tests (spec §3.3 steps 1 & 4).

The transcriber's gold path converts a scripted interview into diarized,
timestamped segments deterministically — the ASR path (Parakeet NIM) plugs in
behind the same Source shape once TTS audio exists.
"""

from periop.schemas import Case, SourceType
from periop.synthgen.bundle import write_bundle
from periop.tools.ingest import ingest_records, transcript_from_script
from periop.tools.chunker import ingest_document
from tests.test_case_designer import make_design
from tests.test_personas import make_persona
from tests.test_scripts_gen import make_gold, make_interview, make_intraop


import pytest


@pytest.fixture
def case_dir(tmp_path):
    d = tmp_path / "sg-0001"
    write_bundle(
        d,
        design=make_design(),
        persona=make_persona("u1", 63, "Female"),
        preop=make_interview(),
        intraop=make_intraop(),
        postop=make_interview(),
        gold_artifacts=make_gold(),
    )
    return d


class TestIngestRecords:
    def test_registers_all_record_documents(self, case_dir):
        case = Case(case_id="sg-0001")
        ingest_records(case, case_dir)
        ids = {s.source_id for s in case.sources}
        assert ids == {
            "doc:gp-summary",
            "doc:med-list",
            "doc:op-plan",
            "doc:prior-anesthetic-record",
        }
        assert all(s.type == SourceType.DOCUMENT for s in case.sources)

    def test_chunks_are_resolvable(self, case_dir):
        case = Case(case_id="sg-0001")
        ingest_records(case, case_dir)
        chunk = case.resolve("doc:gp-summary#c001")
        assert chunk.text

    def test_idempotent_on_reingest(self, case_dir):
        case = Case(case_id="sg-0001")
        ingest_records(case, case_dir)
        ingest_records(case, case_dir)  # must not raise or duplicate
        assert len([s for s in case.sources if s.source_id == "doc:gp-summary"]) == 1


class TestTranscriptFromScript:
    def test_turns_become_diarized_segments(self, case_dir):
        source = transcript_from_script(
            case_dir / "scripts/preop-interview.json", source_id="audio:preop-interview"
        )
        assert source.type == SourceType.AUDIO
        assert [s.speaker for s in source.segments] == ["PROVIDER", "PATIENT"]
        assert source.segments[0].seg_id == "s001"

    def test_timestamps_are_monotonic_and_wordcount_scaled(self, case_dir):
        source = transcript_from_script(
            case_dir / "scripts/preop-interview.json", source_id="audio:preop-interview"
        )
        segs = source.segments
        assert segs[0].t0 == 0.0
        for a, b in zip(segs, segs[1:]):
            assert b.t0 >= a.t1 > a.t0

    def test_deterministic(self, case_dir):
        path = case_dir / "scripts/preop-interview.json"
        a = transcript_from_script(path, source_id="audio:x")
        b = transcript_from_script(path, source_id="audio:x")
        assert a == b
