"""Case store tests: local JSON persistence for Case objects (spec §3.1 storage layer)."""

import pytest

from periop.schemas import Case
from periop.store import CaseStore


@pytest.fixture
def store(tmp_path):
    return CaseStore(tmp_path / "cases")


class TestCaseStore:
    def test_save_and_load_round_trip(self, store):
        case = Case(case_id="sg-0042", patient_profile_ref="personas/uuid-1")
        store.save(case)
        assert store.load("sg-0042") == case

    def test_load_missing_case_raises(self, store):
        with pytest.raises(KeyError, match="sg-9999"):
            store.load("sg-9999")

    def test_save_overwrites_existing(self, store):
        store.save(Case(case_id="sg-0042"))
        updated = Case(case_id="sg-0042", open_questions=["Allergy status?"])
        store.save(updated)
        assert store.load("sg-0042").open_questions == ["Allergy status?"]

    def test_list_case_ids_sorted(self, store):
        for cid in ["sg-0042", "sg-0001", "sg-0100"]:
            store.save(Case(case_id=cid))
        assert store.list_case_ids() == ["sg-0001", "sg-0042", "sg-0100"]

    def test_creates_directory_lazily(self, tmp_path):
        store = CaseStore(tmp_path / "nested" / "cases")
        assert store.list_case_ids() == []
        store.save(Case(case_id="sg-0001"))
        assert store.list_case_ids() == ["sg-0001"]

    def test_files_are_human_readable_json(self, store, tmp_path):
        store.save(Case(case_id="sg-0042"))
        path = tmp_path / "cases" / "sg-0042.json"
        assert path.exists()
        assert '"case_id": "sg-0042"' in path.read_text()
