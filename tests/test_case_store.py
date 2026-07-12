"""Case store tests: local JSON persistence for Case objects (spec §3.1 storage layer)."""

import threading

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
        assert [q.question for q in store.load("sg-0042").open_questions] == [
            "Allergy status?"
        ]

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


class TestAtomicSave:
    def test_save_leaves_no_temp_files(self, store, tmp_path):
        store.save(Case(case_id="sg-0042"))
        leftovers = [p for p in (tmp_path / "cases").iterdir() if p.suffix != ".json"]
        assert leftovers == []

    def test_interrupted_save_keeps_prior_version_intact(self, store, monkeypatch):
        # the SSE runner and the UI read the same file the writer replaces
        # (spec v2 §5.2) — a failed write must never leave a partial file
        store.save(Case(case_id="sg-0042"))
        import periop.store as store_mod

        def boom(src, dst):
            raise OSError("disk full")

        monkeypatch.setattr(store_mod.os, "replace", boom)
        with pytest.raises(OSError):
            store.save(Case(case_id="sg-0042", open_questions=["x"]))
        monkeypatch.undo()
        assert store.load("sg-0042").open_questions == []


class TestMutate:
    """Read-modify-write under the process-wide lock (v2-speed §3.2).

    Background question prep writes the case from its own thread while the
    API keeps serving uploads; whole-object saves of stale copies would eat
    each other's updates. ``mutate`` re-applies a delta to the freshest copy
    so concurrent writers compose instead of clobbering.
    """

    def test_mutate_applies_delta_and_returns_fresh_case(self, store):
        store.save(Case(case_id="sg-0042"))

        def relabel(case):
            case.label = "TKR Mrs W"

        result = store.mutate("sg-0042", relabel)
        assert result.label == "TKR Mrs W"
        assert store.load("sg-0042").label == "TKR Mrs W"

    def test_mutate_missing_case_raises(self, store):
        with pytest.raises(KeyError):
            store.mutate("sg-9999", lambda c: None)

    def test_concurrent_writers_never_lose_updates(self, store):
        # two threads each append their own marker via mutate; both must
        # survive regardless of interleaving
        store.save(Case(case_id="sg-0042"))
        barrier = threading.Barrier(2)

        def writer(text):
            def apply(case):
                case.anticipated_issues = [*case.anticipated_issues, text]

            barrier.wait()
            for _ in range(20):
                store.mutate("sg-0042", apply)

        threads = [threading.Thread(target=writer, args=(t,)) for t in ("a", "b")]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        issues = store.load("sg-0042").anticipated_issues
        assert issues.count("a") == 20
        assert issues.count("b") == 20

    def test_concurrent_plain_saves_do_not_crash_on_tmp_collision(self, store):
        # the gap-analysis worker and a request handler can save the same
        # case at once; distinct temp names keep both writes atomic
        store.save(Case(case_id="sg-0042"))
        errors = []

        def saver():
            try:
                for _ in range(50):
                    store.save(Case(case_id="sg-0042"))
            except Exception as e:  # pragma: no cover - the failure under test
                errors.append(e)

        threads = [threading.Thread(target=saver) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
        store.load("sg-0042")  # file is intact, parseable JSON
