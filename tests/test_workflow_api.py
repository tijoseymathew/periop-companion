"""Write-path API tests (spec v2 §5.2): case creation and the provider roster.

The workflow layer wraps the existing read API with a write path: a provider
picks their name (attribution, not identity), creates a case, and the case
carries a `workflow` block from birth. Seeded demo cases (no workflow block)
are writable nowhere.
"""

import json

import pytest
from fastapi.testclient import TestClient

from periop.api.app import create_app
from periop.schemas import Case, OpenQuestion, StageStatus
from periop.store import CaseStore

PROVIDERS = [
    {"provider_id": "p-lim", "name": "Dr A. Lim", "role": "consultant"},
    {"provider_id": "p-tan", "name": "Dr B. Tan", "role": "registrar"},
    {"provider_id": "p-rahman", "name": "Dr C. Rahman", "role": "consultant"},
]


@pytest.fixture
def dirs(tmp_path):
    out_dir = tmp_path / "_out"
    case_dir = tmp_path
    providers = tmp_path / "providers.json"
    providers.write_text(json.dumps(PROVIDERS))
    return out_dir, case_dir, providers


@pytest.fixture
def client(dirs):
    out_dir, case_dir, providers = dirs
    return TestClient(
        create_app(out_dir=out_dir, case_dir=case_dir, providers_path=providers)
    )


class TestProviders:
    def test_roster_served(self, client):
        resp = client.get("/api/providers")
        assert resp.status_code == 200
        assert resp.json() == PROVIDERS

    def test_missing_roster_is_empty_not_error(self, tmp_path):
        client = TestClient(
            create_app(
                out_dir=tmp_path / "_out",
                case_dir=tmp_path,
                providers_path=tmp_path / "nowhere.json",
            )
        )
        assert client.get("/api/providers").json() == []


class TestCreateCase:
    def test_creates_skeleton_case_with_workflow(self, client, dirs):
        out_dir, _, _ = dirs
        resp = client.post("/api/cases", json={"label": "Hip replacement Mrs W", "provider_id": "p-lim"})
        assert resp.status_code == 201
        case = Case.model_validate(resp.json())
        assert case.label == "Hip replacement Mrs W"
        assert case.workflow.created_by.provider_id == "p-lim"
        assert case.workflow.created_by.name == "Dr A. Lim"
        assert all(
            s.status is StageStatus.AWAITING_INPUTS for s in case.workflow.stages.values()
        )
        # persisted via the store under the derived case id
        assert CaseStore(out_dir).load(case.case_id).label == "Hip replacement Mrs W"

    def test_case_id_is_filename_safe_slug(self, client):
        resp = client.post("/api/cases", json={"label": "Hip replacement Mrs W", "provider_id": "p-lim"})
        case_id = resp.json()["case_id"]
        assert case_id == "hip-replacement-mrs-w"

    def test_duplicate_labels_get_distinct_ids(self, client):
        first = client.post("/api/cases", json={"label": "TKR", "provider_id": "p-lim"})
        second = client.post("/api/cases", json={"label": "TKR", "provider_id": "p-tan"})
        assert first.status_code == second.status_code == 201
        assert first.json()["case_id"] != second.json()["case_id"]

    def test_unknown_provider_404(self, client):
        resp = client.post("/api/cases", json={"label": "TKR", "provider_id": "p-nobody"})
        assert resp.status_code == 404
        assert "p-nobody" in resp.json()["detail"]

    def test_traversal_shaped_label_rejected(self, client):
        resp = client.post("/api/cases", json={"label": "../../etc/passwd", "provider_id": "p-lim"})
        assert resp.status_code == 422

    def test_blank_label_rejected(self, client):
        resp = client.post("/api/cases", json={"label": "   ", "provider_id": "p-lim"})
        assert resp.status_code == 422

    def test_created_case_appears_in_case_list(self, client):
        client.post("/api/cases", json={"label": "TKR", "provider_id": "p-lim"})
        ids = [s["case_id"] for s in client.get("/api/cases").json()]
        assert "tkr" in ids


# --------------------------------------------------------- document intake


class StubRunner:
    """Injectable pipeline runner: records calls, fabricates questions."""

    def __init__(self):
        self.gap_calls = []

    def analyze_gaps(self, case):
        self.gap_calls.append(case.case_id)
        first_doc = case.sources[0]
        case.open_questions = [
            OpenQuestion(
                question="Is the patient still taking aspirin?",
                reason="conflicting",
                provenance=[f"{first_doc.source_id}#{first_doc.chunks[0].chunk_id}"],
            )
        ]


def _minimal_pdf(text: str) -> bytes:
    """A structurally valid single-page PDF with one text run."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_at}\n%%EOF\n".encode()
    )
    return bytes(out)


@pytest.fixture
def runner():
    return StubRunner()


@pytest.fixture
def wclient(dirs, runner):
    """Client with a stub pipeline runner and one live + one demo case."""
    out_dir, case_dir, providers = dirs
    store = CaseStore(out_dir)
    store.save(Case(case_id="sg-demo"))  # no workflow → immutable demo data
    client = TestClient(
        create_app(
            out_dir=out_dir, case_dir=case_dir, providers_path=providers, runner=runner
        )
    )
    client.post("/api/cases", json={"label": "TKR Mrs W", "provider_id": "p-lim"})
    return client


GP_TEXT = "# GP Summary\n\n## Medications\n\nAspirin 100mg OD, current.\n"


def paste(client, case_id, doc_type, text, provider="p-lim"):
    return client.post(
        f"/api/cases/{case_id}/sources/document",
        json={"doc_type": doc_type, "text": text, "provider_id": provider},
    )


class TestDocumentPaste:
    def test_paste_creates_chunked_source(self, wclient):
        resp = paste(wclient, "tkr-mrs-w", "gp-summary", GP_TEXT)
        assert resp.status_code == 201
        case = Case.model_validate(resp.json())
        src = case.get_source("doc:gp-summary")
        assert src is not None
        assert src.chunks[0].text == "Aspirin 100mg OD, current."
        assert src.chunks[0].section == "Medications"
        assert src.provided_by == "p-lim"
        assert src.captured_at is not None

    def test_paste_written_to_records_dir_for_reingest(self, wclient, dirs):
        _, case_dir, _ = dirs
        paste(wclient, "tkr-mrs-w", "gp-summary", GP_TEXT)
        assert (case_dir / "tkr-mrs-w" / "records" / "gp-summary.md").read_text() == GP_TEXT

    def test_slot_is_append_only(self, wclient):
        paste(wclient, "tkr-mrs-w", "gp-summary", GP_TEXT)
        resp = paste(wclient, "tkr-mrs-w", "gp-summary", "different text")
        assert resp.status_code == 409

    def test_unknown_doc_type_rejected(self, wclient):
        resp = paste(wclient, "tkr-mrs-w", "malware/../x", GP_TEXT)
        assert resp.status_code == 422

    def test_blank_text_rejected(self, wclient):
        resp = paste(wclient, "tkr-mrs-w", "gp-summary", "   ")
        assert resp.status_code == 422

    def test_demo_case_is_immutable(self, wclient):
        resp = paste(wclient, "sg-demo", "gp-summary", GP_TEXT)
        assert resp.status_code == 409
        assert "demo" in resp.json()["detail"]

    def test_unknown_case_404(self, wclient):
        assert paste(wclient, "nope", "gp-summary", GP_TEXT).status_code == 404


class TestDocumentUpload:
    def _upload(self, client, filename, content, doc_type="gp-summary"):
        return client.post(
            "/api/cases/tkr-mrs-w/sources/document",
            files={"file": (filename, content)},
            data={"doc_type": doc_type, "provider_id": "p-lim"},
        )

    def test_txt_upload_ingested(self, wclient):
        resp = self._upload(wclient, "summary.txt", GP_TEXT.encode())
        assert resp.status_code == 201
        case = Case.model_validate(resp.json())
        assert case.get_source("doc:gp-summary").chunks

    def test_pdf_upload_text_extracted(self, wclient):
        resp = self._upload(wclient, "summary.pdf", _minimal_pdf("Aspirin 100mg daily."))
        assert resp.status_code == 201
        case = Case.model_validate(resp.json())
        chunks = case.get_source("doc:gp-summary").chunks
        assert any("Aspirin 100mg daily." in c.text for c in chunks)

    def test_unsupported_extension_rejected(self, wclient):
        resp = self._upload(wclient, "records.docx", b"binary")
        assert resp.status_code == 422

    def test_oversize_upload_rejected(self, wclient):
        resp = self._upload(wclient, "big.txt", b"x" * (5 * 1024 * 1024 + 1))
        assert resp.status_code == 413


class TestGapAnalystTrigger:
    def test_runs_once_op_plan_and_a_record_exist(self, wclient, runner):
        paste(wclient, "tkr-mrs-w", "gp-summary", GP_TEXT)
        assert runner.gap_calls == []  # no op plan yet
        resp = paste(wclient, "tkr-mrs-w", "op-plan", "# Op Plan\n\nLaparoscopic chole.\n")
        assert runner.gap_calls == ["tkr-mrs-w"]
        case = Case.model_validate(resp.json())
        assert case.open_questions[0].question == "Is the patient still taking aspirin?"
        assert case.open_questions[0].provenance  # cites the triggering chunk

    def test_op_plan_alone_does_not_trigger(self, wclient, runner):
        paste(wclient, "tkr-mrs-w", "op-plan", "# Op Plan\n\nLap chole.\n")
        assert runner.gap_calls == []

    def test_not_rerun_once_questions_exist(self, wclient, runner):
        paste(wclient, "tkr-mrs-w", "gp-summary", GP_TEXT)
        paste(wclient, "tkr-mrs-w", "op-plan", "# Op Plan\n\nLap chole.\n")
        paste(wclient, "tkr-mrs-w", "med-list", "# Meds\n\nAspirin.\n")
        assert runner.gap_calls == ["tkr-mrs-w"]

    def test_questions_persisted_to_store(self, wclient, runner, dirs):
        out_dir, _, _ = dirs
        paste(wclient, "tkr-mrs-w", "gp-summary", GP_TEXT)
        paste(wclient, "tkr-mrs-w", "op-plan", "# Op Plan\n\nLap chole.\n")
        stored = CaseStore(out_dir).load("tkr-mrs-w")
        assert stored.open_questions[0].reason == "conflicting"


# --------------------------------------------------------- question review


class TestQuestionReview:
    @pytest.fixture
    def prepared(self, wclient):
        """Case with intake done and GapAnalyst questions present."""
        paste(wclient, "tkr-mrs-w", "gp-summary", GP_TEXT)
        paste(wclient, "tkr-mrs-w", "op-plan", "# Op Plan\n\nLap chole.\n")
        return wclient

    def _reviewed(self):
        return [
            {
                "question": "Is the patient still taking aspirin?",
                "reason": "conflicting",
                "provenance": ["doc:gp-summary#c001"],
                "review": "edited",
                "edited_text": "When exactly did you last take aspirin?",
            },
            {"question": "Any prior anaesthetic problems?", "review": "approved"},
            {"question": "Do you smoke?", "review": "dismissed"},
        ]

    def test_review_persists_and_stamps_gate(self, prepared, dirs):
        out_dir, _, _ = dirs
        resp = prepared.put(
            "/api/cases/tkr-mrs-w/questions",
            json={"questions": self._reviewed(), "provider_id": "p-lim"},
        )
        assert resp.status_code == 200
        case = Case.model_validate(resp.json())
        assert [q.review for q in case.open_questions] == [
            "edited", "approved", "dismissed",
        ]
        assert case.workflow.stages["preop"].questions_approved_at is not None
        stored = CaseStore(out_dir).load("tkr-mrs-w")
        assert stored.open_questions[0].edited_text == (
            "When exactly did you last take aspirin?"
        )
        # dismissals are kept, never deleted (v2 §4.1)
        assert stored.open_questions[2].review == "dismissed"

    def test_every_question_needs_an_explicit_review(self, prepared):
        resp = prepared.put(
            "/api/cases/tkr-mrs-w/questions",
            json={
                "questions": [{"question": "Unreviewed?"}],
                "provider_id": "p-lim",
            },
        )
        assert resp.status_code == 422

    def test_unresolvable_provenance_rejected(self, prepared):
        resp = prepared.put(
            "/api/cases/tkr-mrs-w/questions",
            json={
                "questions": [
                    {
                        "question": "Q?",
                        "provenance": ["doc:nope#c999"],
                        "review": "approved",
                    }
                ],
                "provider_id": "p-lim",
            },
        )
        assert resp.status_code == 422

    def test_demo_case_409(self, wclient):
        resp = wclient.put(
            "/api/cases/sg-demo/questions",
            json={"questions": [], "provider_id": "p-lim"},
        )
        assert resp.status_code == 409

    def test_unknown_case_404(self, wclient):
        resp = wclient.put(
            "/api/cases/nope/questions",
            json={"questions": [], "provider_id": "p-lim"},
        )
        assert resp.status_code == 404


# ------------------------------------------------------------- audio upload


def make_wav(seconds=0.1, rate=16000) -> bytes:
    """Valid mono 16-bit PCM wav of silence."""
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


def upload_audio(client, case_id, kind, content, filename="rec.wav", confirm=False):
    return client.post(
        f"/api/cases/{case_id}/sources/audio",
        params={"confirm": "true"} if confirm else {},
        files={"file": (filename, content)},
        data={"kind": kind, "provider_id": "p-lim"},
    )


class TestAudioUpload:
    def test_wav_upload_lands_in_audio_dir(self, wclient, dirs):
        _, case_dir, _ = dirs
        resp = upload_audio(wclient, "tkr-mrs-w", "preop-interview", make_wav())
        assert resp.status_code == 201
        wav = case_dir / "tkr-mrs-w" / "audio" / "preop-interview.wav"
        assert wav.is_file()
        import wave

        with wave.open(str(wav), "rb") as w:
            assert w.getnchannels() == 1

    def test_upload_marks_stage_ready_to_generate(self, wclient):
        resp = upload_audio(wclient, "tkr-mrs-w", "preop-interview", make_wav())
        case = Case.model_validate(resp.json())
        stage = case.workflow.stages["preop"]
        assert stage.status is StageStatus.READY_TO_GENERATE
        assert stage.inputs_recorded_at is not None

    def test_interview_replacement_needs_confirmation(self, wclient):
        upload_audio(wclient, "tkr-mrs-w", "preop-interview", make_wav())
        resp = upload_audio(wclient, "tkr-mrs-w", "preop-interview", make_wav())
        assert resp.status_code == 409
        assert "confirm" in resp.json()["detail"].lower()
        resp = upload_audio(
            wclient, "tkr-mrs-w", "preop-interview", make_wav(), confirm=True
        )
        assert resp.status_code == 201

    def test_intraop_memos_append(self, wclient, dirs):
        _, case_dir, _ = dirs
        upload_audio(wclient, "tkr-mrs-w", "intraop-notes", make_wav(seconds=0.1))
        resp = upload_audio(wclient, "tkr-mrs-w", "intraop-notes", make_wav(seconds=0.1))
        assert resp.status_code == 201
        import wave

        wav = case_dir / "tkr-mrs-w" / "audio" / "intraop-notes.wav"
        with wave.open(str(wav), "rb") as w:
            duration = w.getnframes() / w.getframerate()
        assert duration == pytest.approx(0.2, abs=0.01)
        case = Case.model_validate(resp.json())
        assert case.workflow.stages["intraop"].status is StageStatus.READY_TO_GENERATE

    def test_unknown_kind_rejected(self, wclient):
        resp = upload_audio(wclient, "tkr-mrs-w", "elevator-music", make_wav())
        assert resp.status_code == 422

    def test_oversize_rejected(self, wclient):
        resp = upload_audio(
            wclient, "tkr-mrs-w", "preop-interview", b"x" * (50 * 1024 * 1024 + 1)
        )
        assert resp.status_code == 413

    def test_demo_case_409(self, wclient):
        resp = upload_audio(wclient, "sg-demo", "preop-interview", make_wav())
        assert resp.status_code == 409

    def test_garbage_wav_rejected(self, wclient):
        import shutil

        if shutil.which("ffmpeg"):
            pytest.skip("ffmpeg present — it does its own validation")
        resp = upload_audio(wclient, "tkr-mrs-w", "preop-interview", b"not audio")
        assert resp.status_code == 422

    def test_non_wav_without_ffmpeg_says_what_to_do(self, wclient, monkeypatch):
        # spec v2 §6.7: errors name the next action
        import periop.tools.audio as audio_mod

        monkeypatch.setattr(audio_mod, "ffmpeg_available", lambda: False)
        resp = upload_audio(
            wclient, "tkr-mrs-w", "preop-interview", b"\x1aE\xdf\xa3webm-ish",
            filename="rec.webm",
        )
        assert resp.status_code == 503
        assert "ffmpeg" in resp.json()["detail"]


@pytest.mark.skipif(
    __import__("shutil").which("ffmpeg") is None,
    reason="ffmpeg not installed — normalization path exercised where present",
)
class TestFfmpegNormalization:
    def test_webm_opus_normalized_to_16k_mono_wav(self, wclient, dirs, tmp_path):
        import subprocess
        import wave

        _, case_dir, _ = dirs
        webm = tmp_path / "rec.webm"
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3",
             "-c:a", "libopus", str(webm)],
            check=True, capture_output=True,
        )
        resp = upload_audio(
            wclient, "tkr-mrs-w", "preop-interview", webm.read_bytes(), filename="rec.webm"
        )
        assert resp.status_code == 201
        with wave.open(str(case_dir / "tkr-mrs-w" / "audio" / "preop-interview.wav"), "rb") as w:
            assert w.getframerate() == 16000
            assert w.getnchannels() == 1
