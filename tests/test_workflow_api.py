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
from periop.schemas import Case, StageStatus
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
