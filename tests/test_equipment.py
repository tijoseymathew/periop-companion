"""Equipment store: fixed catalog, per-case reservations, atomic ledger."""

import pytest

from periop.equipment import CATALOG, CATALOG_BY_ID, EquipmentStore


@pytest.fixture
def store(tmp_path):
    return EquipmentStore(tmp_path / "_out")


class TestCatalog:
    def test_catalog_ids_unique(self):
        assert len(CATALOG_BY_ID) == len(CATALOG)

    def test_fresh_store_everything_available(self, store):
        levels = store.stock_levels()
        assert len(levels) == len(CATALOG)
        assert all(l.available == l.total and l.reserved == 0 for l in levels)


class TestReserve:
    def test_reserve_marks_assignment(self, store):
        r = store.reserve("ett-7.0", "sg-0001", 2, "p-lim")
        assert (r.case_id, r.qty, r.by) == ("sg-0001", 2, "p-lim")
        level = next(l for l in store.stock_levels() if l.item_id == "ett-7.0")
        assert level.reserved == 2
        assert level.available == level.total - 2
        assert level.reservations[0].case_id == "sg-0001"

    def test_reservations_persist_across_instances(self, tmp_path):
        EquipmentStore(tmp_path).reserve("bougie", "sg-0001", 1, "p-lim")
        assert EquipmentStore(tmp_path).case_reservations("sg-0001")[0].item_id == "bougie"

    def test_over_reserving_fails_and_names_the_shortfall(self, store):
        total = CATALOG_BY_ID["video-laryngoscope"].total
        store.reserve("video-laryngoscope", "sg-0001", total, "p-lim")
        with pytest.raises(ValueError, match="only 0 of"):
            store.reserve("video-laryngoscope", "sg-0002", 1, "p-tan")

    def test_unknown_item_rejected(self, store):
        with pytest.raises(KeyError):
            store.reserve("flux-capacitor", "sg-0001", 1, "p-lim")

    def test_zero_quantity_rejected(self, store):
        with pytest.raises(ValueError, match="at least 1"):
            store.reserve("ett-7.0", "sg-0001", 0, "p-lim")


class TestRelease:
    def test_release_all_returns_whole_hold(self, store):
        store.reserve("iv-18g", "sg-0001", 2, "p-lim")
        store.reserve("iv-18g", "sg-0001", 3, "p-lim")
        assert store.release("iv-18g", "sg-0001") == 5
        assert store.case_reservations("sg-0001") == []

    def test_partial_release_splits_a_reservation(self, store):
        store.reserve("iv-20g", "sg-0001", 4, "p-lim")
        assert store.release("iv-20g", "sg-0001", 1) == 1
        held = store.case_reservations("sg-0001")
        assert [r.qty for r in held] == [3]

    def test_release_never_touches_other_cases(self, store):
        store.reserve("lma-4", "sg-0001", 1, "p-lim")
        store.reserve("lma-4", "sg-0002", 1, "p-tan")
        assert store.release("lma-4", "sg-0001") == 1
        assert [r.case_id for r in store.case_reservations("sg-0002")] == ["sg-0002"]

    def test_release_with_nothing_held_is_zero(self, store):
        assert store.release("lma-3", "sg-0001") == 0
