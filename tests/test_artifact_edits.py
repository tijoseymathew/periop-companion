"""Human edits to generated artifacts (v2-ui feedback).

A provider corrects or adds a claim on a stage artifact; the edit lands as a
chunk in that provider's own ``edit:<provider_id>`` source and the claim
cites it — attribution through the same provenance substrate every machine
claim uses, never an anonymous rewrite.
"""

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from periop.api.app import create_app
from periop.schemas import (
    ArtifactRecord,
    Case,
    Chunk,
    Claim,
    ClaimStatus,
    GapAnalysisState,
    OpenQuestion,
    Provider,
    Source,
    SourceType,
    StageStatus,
    Workflow,
)
from periop.store import CaseStore

PROVIDERS = [
    {"provider_id": "p-lim", "name": "Dr A. Lim", "role": "consultant"},
    {"provider_id": "p-tan", "name": "Dr B. Tan", "role": "registrar"},
]


def make_live_case(case_id: str = "live-1") -> Case:
    return Case(
        case_id=case_id,
        label="TKR Mrs W",
        workflow=Workflow(
            created_by=Provider(provider_id="p-lim", name="Dr A. Lim", role="consultant"),
            created_at=datetime.now(timezone.utc),
        ),
        sources=[
            Source(
                source_id="doc:gp-summary",
                type=SourceType.DOCUMENT,
                chunks=[Chunk(chunk_id="c0001", text="Aspirin 100mg OD, current.")],
            )
        ],
        artifacts=[
            ArtifactRecord(
                artifact_id="note:pre-anesthesia-eval",
                claims=[
                    Claim(
                        claim_id="c-001",
                        text="Aspirin stopped six days ago.",
                        provenance=["doc:gp-summary#c0001"],
                        status=ClaimStatus.CONFLICTING,
                    )
                ],
            )
        ],
    )


@pytest.fixture
def store(tmp_path):
    return CaseStore(tmp_path / "_out")


@pytest.fixture
def client(tmp_path, store):
    providers = tmp_path / "providers.json"
    providers.write_text(json.dumps(PROVIDERS))
    store.save(make_live_case())
    store.save(Case(case_id="demo-1", artifacts=make_live_case().artifacts))
    return TestClient(
        create_app(out_dir=store.root, case_dir=tmp_path, providers_path=providers)
    )


NOTE = "note:pre-anesthesia-eval"


def add(client, text, provider="p-tan", case_id="live-1", artifact=NOTE):
    return client.post(
        f"/api/cases/{case_id}/artifacts/{artifact}/claims",
        json={"text": text, "provider_id": provider},
    )


def edit(client, claim_id, text, provider="p-tan", case_id="live-1", artifact=NOTE):
    return client.put(
        f"/api/cases/{case_id}/artifacts/{artifact}/claims/{claim_id}",
        json={"text": text, "provider_id": provider},
    )


class TestAddClaim:
    def test_added_claim_cites_the_providers_edit_source(self, client):
        resp = add(client, "Patient confirms aspirin held for six days.")
        assert resp.status_code == 201
        case = Case.model_validate(resp.json())

        note = case.get_artifact(NOTE)
        claim = note.claims[-1]
        assert claim.claim_id == "h-001"
        assert claim.text == "Patient confirms aspirin held for six days."
        assert claim.status is ClaimStatus.SUPPORTED
        assert [str(r) for r in claim.provenance] == ["edit:p-tan#e001"]

        # the attestation is a real chunk in a real (resolvable) source
        chunk = case.resolve("edit:p-tan#e001")
        assert chunk.text == "Patient confirms aspirin held for six days."
        assert "added by Dr B. Tan" in chunk.section
        assert case.get_source("edit:p-tan").provided_by == "p-tan"

    def test_edits_accumulate_per_provider(self, client):
        add(client, "First addition.")
        add(client, "Second addition.")
        resp = add(client, "From another provider.", provider="p-lim")
        case = Case.model_validate(resp.json())

        assert [len(s.chunks) for s in case.sources if s.source_id.startswith("edit:")] == [2, 1]
        ids = [c.claim_id for c in case.get_artifact(NOTE).claims]
        assert ids == ["c-001", "h-001", "h-002", "h-003"]

    def test_persisted_to_the_store(self, client, store):
        add(client, "Durable fact.")
        stored = store.load("live-1")
        assert stored.get_artifact(NOTE).claims[-1].text == "Durable fact."
        assert stored.get_source("edit:p-tan") is not None

    def test_unknown_artifact_404(self, client):
        assert add(client, "x", artifact="note:nope").status_code == 404

    def test_blank_text_422(self, client):
        assert add(client, "   ").status_code == 422

    def test_unknown_provider_404(self, client):
        assert add(client, "x", provider="p-nobody").status_code == 404

    def test_demo_case_409(self, client):
        assert add(client, "x", case_id="demo-1").status_code == 409

    def test_signed_off_stage_409(self, client, store):
        def signoff(case):
            case.workflow.stages["preop"].status = StageStatus.SIGNED_OFF

        store.mutate("live-1", signoff)
        resp = add(client, "Too late.")
        assert resp.status_code == 409
        assert "reopen" in resp.json()["detail"]


class TestEditClaim:
    def test_edit_rewrites_text_and_appends_attribution(self, client):
        resp = edit(client, "c-001", "Aspirin stopped seven days ago, per patient.")
        assert resp.status_code == 200
        case = Case.model_validate(resp.json())

        claim = case.get_artifact(NOTE).claims[0]
        assert claim.text == "Aspirin stopped seven days ago, per patient."
        # the original citation is kept for context; the attestation is added
        assert [str(r) for r in claim.provenance] == [
            "doc:gp-summary#c0001",
            "edit:p-tan#e001",
        ]
        assert claim.status is ClaimStatus.SUPPORTED
        chunk = case.resolve("edit:p-tan#e001")
        assert "edited by Dr B. Tan" in chunk.section

    def test_unknown_claim_404(self, client):
        assert edit(client, "c-999", "x").status_code == 404

    def test_signed_off_stage_409(self, client, store):
        def signoff(case):
            case.workflow.stages["preop"].status = StageStatus.SIGNED_OFF

        store.mutate("live-1", signoff)
        assert edit(client, "c-001", "Too late.").status_code == 409


class TestQuestionEditAttribution:
    """PUT /questions stamps edit provenance for reworded and added questions."""

    @pytest.fixture
    def prepared(self, client, store):
        def seed(case):
            case.open_questions = [
                OpenQuestion(question="Is the patient still taking aspirin?")
            ]
            case.workflow.stages["preop"].gap_analysis = GapAnalysisState.COMPLETE

        store.mutate("live-1", seed)
        return client

    def _put(self, client, questions):
        return client.put(
            "/api/cases/live-1/questions",
            json={"questions": questions, "provider_id": "p-lim"},
        )

    def test_edited_question_cites_the_provider(self, prepared):
        resp = self._put(
            prepared,
            [
                {
                    "question": "Is the patient still taking aspirin?",
                    "review": "edited",
                    "edited_text": "When did you last take aspirin?",
                }
            ],
        )
        assert resp.status_code == 200
        case = Case.model_validate(resp.json())
        q = case.open_questions[0]
        assert q.provenance == ["edit:p-lim#e001"]
        assert case.resolve("edit:p-lim#e001").text == "When did you last take aspirin?"

    def test_added_question_cites_the_provider(self, prepared):
        resp = self._put(
            prepared,
            [
                {"question": "Is the patient still taking aspirin?", "review": "approved"},
                {"question": "Any anticoagulants besides aspirin?", "review": "approved"},
            ],
        )
        assert resp.status_code == 200
        case = Case.model_validate(resp.json())
        assert case.open_questions[0].provenance == []  # untouched → unstamped
        added = case.open_questions[1]
        assert added.provenance == ["edit:p-lim#e001"]
        chunk = case.resolve("edit:p-lim#e001")
        assert chunk.text == "Any anticoagulants besides aspirin?"
        assert "added by Dr A. Lim" in chunk.section

    def test_untouched_approvals_stay_unstamped(self, prepared):
        resp = self._put(
            prepared,
            [{"question": "Is the patient still taking aspirin?", "review": "approved"}],
        )
        case = Case.model_validate(resp.json())
        assert case.open_questions[0].provenance == []
        assert case.get_source("edit:p-lim") is None
