"""A/B experiment harness tests (spec §6)."""

from periop.evals.ab import extraction_ab, ExtractionAB
from periop.schemas import Event


class TieredChat:
    def __init__(self, name, events):
        self.name = name
        self.model = name
        self._events = events
        self.calls = 0

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls += 1
        return schema(events=[e.model_dump(mode="json") for e in self._events])


def _ev(t, val):
    return Event(t=t, category="dose", value=val, units="mg",
                 provenance=["audio:intraop-notes#s001"])


class TestExtractionAB:
    def test_reports_f1_for_both_arms(self, tmp_path):
        import json

        notes = tmp_path / "intraop-notes.json"
        notes.write_text(json.dumps({"notes": [{"t": "08:02", "text": "propofol one twenty"}]}))
        gold = [_ev("08:02", "propofol 120")]

        # nano-only arm gets the dose wrong; nano→super arm corrects it
        nano_wrong = [_ev("08:02", "propofol 100")]
        corrected = [_ev("08:02", "propofol 120")]

        result = extraction_ab(
            notes_path=notes,
            gold_events=gold,
            fast_chat=TieredChat("nano", nano_wrong),
            reasoning_chat=TieredChat("super", corrected),
        )
        assert isinstance(result, ExtractionAB)
        assert result.nano_only_f1 == 0.0
        assert result.nano_then_super_f1 == 1.0
        assert result.delta == 1.0
