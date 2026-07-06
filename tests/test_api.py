"""FastAPI serving layer for the review UI (spec ui.md §4).

Read-mostly API over the existing case store + audio files: case summaries,
full Case JSON (verbatim pydantic), and wav serving with HTTP Range support
so ``<audio>`` seeking works. No new persistence, no auth — local demo grade.
"""

import pytest
from fastapi.testclient import TestClient

from periop.api.app import create_app
from periop.schemas import (
    ArtifactRecord,
    AudioSegment,
    Case,
    Chunk,
    Claim,
    Source,
    SourceType,
)
from periop.store import CaseStore

# A tiny but structurally valid RIFF/WAVE payload (silence, 8 sample frames).
FAKE_WAV = (
    b"RIFF" + (36 + 16).to_bytes(4, "little") + b"WAVE"
    b"fmt " + (16).to_bytes(4, "little")
    + (1).to_bytes(2, "little") + (1).to_bytes(2, "little")
    + (22050).to_bytes(4, "little") + (44100).to_bytes(4, "little")
    + (2).to_bytes(2, "little") + (16).to_bytes(2, "little")
    + b"data" + (16).to_bytes(4, "little") + bytes(16)
)


def make_case(case_id: str) -> Case:
    return Case(
        case_id=case_id,
        sources=[
            Source(
                source_id="doc:gp-summary",
                type=SourceType.DOCUMENT,
                chunks=[Chunk(chunk_id="c001", text="On aspirin 100mg daily.", section="Medications")],
            ),
            Source(
                source_id="audio:preop-interview",
                type=SourceType.AUDIO,
                segments=[
                    AudioSegment(
                        seg_id="s017", t0=214.3, t1=221.8, speaker="PATIENT",
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
                        text="Records list aspirin as current.",
                        provenance=["doc:gp-summary#c001"],
                        status="conflicting",
                    ),
                ],
            ),
            ArtifactRecord(
                artifact_id="note:pacu-handoff",
                claims=[Claim(claim_id="c-101", text="Patient is diabetic.")],
            ),
        ],
        open_questions=["Confirm last aspirin dose date."],
    )


@pytest.fixture
def store_dirs(tmp_path):
    out_dir = tmp_path / "_out"
    case_dir = tmp_path
    store = CaseStore(out_dir)
    store.save(make_case("sg-0001"))
    store.save(make_case("sg-0002"))
    # only sg-0002 has a rendered wav on disk
    audio_dir = case_dir / "sg-0002" / "audio"
    audio_dir.mkdir(parents=True)
    (audio_dir / "preop-interview.wav").write_bytes(FAKE_WAV)
    return out_dir, case_dir


@pytest.fixture
def client(store_dirs):
    out_dir, case_dir = store_dirs
    return TestClient(create_app(out_dir=out_dir, case_dir=case_dir))


class TestHealth:
    def test_ok(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestCaseList:
    def test_summaries_sorted_by_case_id(self, client):
        resp = client.get("/api/cases")
        assert resp.status_code == 200
        summaries = resp.json()
        assert [s["case_id"] for s in summaries] == ["sg-0001", "sg-0002"]

    def test_summary_counts(self, client):
        summary = client.get("/api/cases").json()[0]
        assert summary["artifact_count"] == 2
        assert summary["claim_count"] == 3
        assert summary["status_counts"] == {
            "supported": 1,
            "unsupported": 0,
            "conflicting": 1,
            "inference": 0,
            "unverified": 1,
        }

    def test_has_audio_reflects_wavs_on_disk(self, client):
        by_id = {s["case_id"]: s for s in client.get("/api/cases").json()}
        assert by_id["sg-0002"]["has_audio"] is True
        assert by_id["sg-0001"]["has_audio"] is False

    def test_empty_store_lists_nothing(self, tmp_path):
        client = TestClient(create_app(out_dir=tmp_path / "nowhere", case_dir=tmp_path))
        assert client.get("/api/cases").json() == []


class TestCaseDetail:
    def test_full_case_round_trips_through_schemas(self, client):
        resp = client.get("/api/cases/sg-0002")
        assert resp.status_code == 200
        case = Case.model_validate(resp.json())
        assert case.case_id == "sg-0002"
        assert [a.artifact_id for a in case.artifacts] == [
            "note:pre-anesthesia-eval",
            "note:pacu-handoff",
        ]
        # provenance refs serialize in the compact string form the UI parses
        assert resp.json()["artifacts"][0]["claims"][0]["provenance"] == [
            "audio:preop-interview#s017"
        ]

    def test_unknown_case_is_structured_404(self, client):
        resp = client.get("/api/cases/sg-9999")
        assert resp.status_code == 404
        assert "sg-9999" in resp.json()["detail"]


class TestAudio:
    def test_serves_wav(self, client):
        resp = client.get("/api/cases/sg-0002/audio/audio:preop-interview")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/wav"
        assert resp.content == FAKE_WAV

    def test_range_requests_supported_for_seeking(self, client):
        resp = client.get(
            "/api/cases/sg-0002/audio/audio:preop-interview",
            headers={"Range": "bytes=0-3"},
        )
        assert resp.status_code == 206
        assert resp.content == b"RIFF"
        assert resp.headers["content-range"] == f"bytes 0-3/{len(FAKE_WAV)}"

    def test_missing_wav_404_hints_at_render_script(self, client):
        # sg-0001 has the audio source but no rendered wav (wavs are gitignored)
        resp = client.get("/api/cases/sg-0001/audio/audio:preop-interview")
        assert resp.status_code == 404
        assert "render_audio" in resp.json()["detail"]

    def test_source_must_exist_in_case(self, client):
        resp = client.get("/api/cases/sg-0002/audio/audio:nonexistent")
        assert resp.status_code == 404

    def test_document_source_has_no_audio(self, client):
        resp = client.get("/api/cases/sg-0002/audio/doc:gp-summary")
        assert resp.status_code == 404

    def test_path_traversal_rejected(self, client, store_dirs):
        _, case_dir = store_dirs
        (case_dir / "secret.wav").write_bytes(b"nope")
        resp = client.get("/api/cases/sg-0002/audio/audio:..%2F..%2Fsecret")
        assert resp.status_code == 404


class TestStaticUI:
    def test_serves_built_spa_when_dist_exists(self, store_dirs, tmp_path):
        out_dir, case_dir = store_dirs
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<!doctype html><title>PeriOp Companion — Review</title>")
        client = TestClient(create_app(out_dir=out_dir, case_dir=case_dir, ui_dist=dist))
        resp = client.get("/")
        assert resp.status_code == 200
        assert "PeriOp Companion" in resp.text
        # the SPA mount must not shadow the API
        assert client.get("/api/health").json() == {"status": "ok"}

    def test_no_mount_without_a_build(self, store_dirs, tmp_path):
        out_dir, case_dir = store_dirs
        client = TestClient(create_app(out_dir=out_dir, case_dir=case_dir, ui_dist=tmp_path / "missing"))
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 404


class TestErrorShape:
    def test_errors_are_json_not_html(self, client):
        resp = client.get("/api/cases/sg-9999")
        assert resp.headers["content-type"].startswith("application/json")


class TestWorklistSummary:
    def test_summary_carries_label_and_workflow(self, store_dirs):
        out_dir, case_dir = store_dirs
        from periop.schemas import Provider, Workflow

        live = make_case("live-1")
        live.label = "TKR Mrs W"
        live.workflow = Workflow(
            created_by=Provider(provider_id="p-lim", name="Dr A. Lim", role="consultant"),
            created_at="2026-07-06T09:12:00+08:00",
        )
        live.workflow.stages["preop"].performed_by = "p-lim"
        CaseStore(out_dir).save(live)
        client = TestClient(create_app(out_dir=out_dir, case_dir=case_dir))
        by_id = {s["case_id"]: s for s in client.get("/api/cases").json()}
        assert by_id["live-1"]["label"] == "TKR Mrs W"
        assert by_id["live-1"]["workflow"]["stages"]["preop"]["performed_by"] == "p-lim"
        # demo cases have neither — the UI renders them read-only
        assert by_id["sg-0001"]["label"] is None
        assert by_id["sg-0001"]["workflow"] is None
