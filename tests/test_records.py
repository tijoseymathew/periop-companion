"""Prior-records pack tests (spec §5).

Records render the *flawed* RecordView (defect baked in, distractors
included), never the truth fields — the truth surfaces only in the interview
script. Rendering is deterministic templates so chunk ids stay stable.
"""

from periop.synthgen.records import render_records_pack
from periop.tools.chunker import chunk_text
from tests.test_case_designer import make_design
from tests.test_personas import make_persona


class TestRenderRecordsPack:
    def setup_method(self):
        self.design = make_design()
        self.persona = make_persona("u1", 63, "Female")
        self.pack = render_records_pack(self.design, self.persona)

    def test_pack_contains_expected_documents(self):
        assert set(self.pack) == {
            "doc:gp-summary",
            "doc:med-list",
            "doc:prior-anesthetic-record",
            "doc:op-plan",
        }

    def test_med_list_shows_record_view_not_truth(self):
        # The records still believe aspirin is current (the planted conflict).
        assert "Aspirin" in self.pack["doc:med-list"]
        assert "stopped" not in self.pack["doc:med-list"].lower()

    def test_gp_summary_includes_distractors(self):
        assert "pneumonia" in self.pack["doc:gp-summary"].lower()

    def test_gp_summary_never_leaks_defect_truth(self):
        assert self.design.defect.truth not in self.pack["doc:gp-summary"]

    def test_op_plan_names_surgery_and_urgency(self):
        assert self.design.surgery in self.pack["doc:op-plan"]
        assert "elective" in self.pack["doc:op-plan"].lower()

    def test_documents_are_chunkable_with_sections(self):
        chunks = chunk_text(self.pack["doc:gp-summary"])
        assert len(chunks) >= 3
        assert any(c.section == "Medications" for c in chunks)

    def test_no_prior_anesthesia_drops_document(self):
        design = self.design.model_copy(deep=True)
        design.records.prior_anesthesia = None
        pack = render_records_pack(design, self.persona)
        assert "doc:prior-anesthetic-record" not in pack

    def test_deterministic(self):
        assert render_records_pack(self.design, self.persona) == self.pack
