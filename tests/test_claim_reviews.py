"""Per-claim review actions (spec v2 §2 stretch): mark reviewed / flag.

Review actions are provider annotations on the review pass, not edits to the
ledger — they live in a sidecar file (`_out/<case_id>.review.json`) so the
case JSON the pipeline writes stays byte-identical. The unchanged invariant
(ui.md): review actions operate on claims and stages, never on text.
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
    Provider,
    Source,
    SourceType,
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
                    ),
                    Claim(claim_id="c-002", text="No known allergies."),
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


def review(client, ref, state, provider="p-tan", case_id="live-1"):
    return client.post(
        f"/api/cases/{case_id}/claim-reviews",
        json={"ref": ref, "state": state, "provider_id": provider},
    )


class TestClaimReviewApi:
    def test_empty_reviews_for_untouched_case(self, client):
        resp = client.get("/api/cases/live-1/claim-reviews")
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_mark_reviewed_round_trip(self, client):
        resp = review(client, "note:pre-anesthesia-eval#c-001", "reviewed")
        assert resp.status_code == 200
        entry = resp.json()["note:pre-anesthesia-eval#c-001"]
        assert entry["state"] == "reviewed"
        assert entry["by"] == "p-tan"
        assert entry["at"]  # timestamped
        # persisted: a fresh GET sees it
        assert client.get("/api/cases/live-1/claim-reviews").json() == resp.json()

    def test_flag_then_clear(self, client):
        review(client, "note:pre-anesthesia-eval#c-002", "flagged")
        resp = review(client, "note:pre-anesthesia-eval#c-002", None)
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_reflag_overwrites_attribution(self, client):
        review(client, "note:pre-anesthesia-eval#c-001", "reviewed", provider="p-lim")
        resp = review(client, "note:pre-anesthesia-eval#c-001", "flagged", provider="p-tan")
        entry = resp.json()["note:pre-anesthesia-eval#c-001"]
        assert entry == {"state": "flagged", "by": "p-tan", "at": entry["at"]}

    def test_unknown_claim_404(self, client):
        resp = review(client, "note:pre-anesthesia-eval#c-999", "reviewed")
        assert resp.status_code == 404
        assert "c-999" in resp.json()["detail"]

    def test_malformed_ref_404(self, client):
        assert review(client, "no-hash-here", "reviewed").status_code == 404

    def test_unknown_state_422(self, client):
        resp = review(client, "note:pre-anesthesia-eval#c-001", "starred")
        assert resp.status_code == 422

    def test_unknown_provider_404(self, client):
        resp = review(client, "note:pre-anesthesia-eval#c-001", "reviewed", provider="p-nobody")
        assert resp.status_code == 404

    def test_demo_case_writes_409_but_reads_ok(self, client):
        resp = review(client, "note:pre-anesthesia-eval#c-001", "reviewed", case_id="demo-1")
        assert resp.status_code == 409
        assert client.get("/api/cases/demo-1/claim-reviews").json() == {}

    def test_sidecar_never_touches_the_case_file(self, client, store):
        before = (store.root / "live-1.json").read_text()
        review(client, "note:pre-anesthesia-eval#c-001", "flagged")
        assert (store.root / "live-1.json").read_text() == before
        assert (store.root / "live-1.review.json").is_file()


class TestClaimReviewStore:
    def test_load_missing_is_empty(self, store):
        assert store.load_claim_reviews("nope") == {}

    def test_save_and_load_round_trip(self, store):
        from periop.schemas import ClaimReview, ClaimReviewState

        reviews = {
            "a#c-1": ClaimReview(
                state=ClaimReviewState.FLAGGED,
                by="p-lim",
                at=datetime.now(timezone.utc),
            )
        }
        store.save_claim_reviews("live-1", reviews)
        loaded = store.load_claim_reviews("live-1")
        assert loaded["a#c-1"].state is ClaimReviewState.FLAGGED
        assert loaded["a#c-1"].by == "p-lim"

    def test_sidecar_files_stay_out_of_the_case_list(self, store):
        from periop.schemas import ClaimReview, ClaimReviewState

        store.save(make_live_case("live-1"))
        store.save_claim_reviews(
            "live-1",
            {"a#c-1": ClaimReview(state=ClaimReviewState.REVIEWED, by="p-lim", at=datetime.now(timezone.utc))},
        )
        assert store.list_case_ids() == ["live-1"]

    def test_atomic_write_leaves_no_temp_files(self, store):
        from periop.schemas import ClaimReview, ClaimReviewState

        store.save_claim_reviews(
            "live-1",
            {"a#c-1": ClaimReview(state=ClaimReviewState.REVIEWED, by="p-lim", at=datetime.now(timezone.utc))},
        )
        assert [p.name for p in store.root.glob(".*")] == []
