"""GapAnalyst tests (spec §3.3 step 2).

Given chunked record sources, produce prioritized clarification questions,
each tagged with a reason (missing / stale / conflicting) and provenance to
the triggering chunk. Provenance must resolve against the case.
"""

import pytest
from pydantic import ValidationError

from periop.agents.gap_analyst import ClarificationQuestion, GapAnalyst, GapQuestions, QuestionReason
from periop.schemas import Case
from periop.tools.chunker import ingest_document


GP_SUMMARY = """\
# GP Summary

## Medications

Aspirin 100mg OD, current.

## Allergies

No known drug allergies recorded.
"""


@pytest.fixture
def case():
    c = Case(case_id="sg-0001")
    c.add_source(ingest_document("doc:gp-summary", GP_SUMMARY))
    return c


class TestSchema:
    def test_reason_is_constrained(self):
        with pytest.raises(ValidationError):
            ClarificationQuestion(
                question="q", reason="because", provenance=["doc:gp-summary#c001"]
            )

    def test_valid_question(self):
        q = ClarificationQuestion(
            question="Is the patient still on aspirin?",
            reason=QuestionReason.CONFLICTING,
            provenance=["doc:gp-summary#c001"],
        )
        assert q.reason == QuestionReason.CONFLICTING


class FakeChat:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append({"user": user, "schema": schema})
        return self.result


class TestGapAnalyst:
    def test_prompt_includes_chunk_ids_for_citation(self, case):
        fake = FakeChat(GapQuestions(questions=[]))
        GapAnalyst(chat=fake).analyze(case)
        prompt = fake.calls[0]["user"]
        assert "doc:gp-summary#c001" in prompt
        assert "Aspirin 100mg OD" in prompt

    def test_returns_questions_and_stores_on_case(self, case):
        result = GapQuestions(
            questions=[
                ClarificationQuestion(
                    question="Any prior anesthetic problems?",
                    reason=QuestionReason.MISSING,
                    provenance=["doc:gp-summary#c001"],
                )
            ]
        )
        analyst = GapAnalyst(chat=FakeChat(result))
        questions = analyst.analyze(case)
        assert questions[0].reason == QuestionReason.MISSING
        stored = case.open_questions[0]
        assert stored.question == "Any prior anesthetic problems?"
        assert stored.reason == "missing"
        assert stored.provenance == ["doc:gp-summary#c001"]
        assert stored.review is None  # unreviewed until the provider approves

    def test_bracketed_provenance_refs_are_normalized_and_kept(self, case):
        result = GapQuestions(
            questions=[
                ClarificationQuestion(
                    question="valid but bracket-echoed", reason=QuestionReason.MISSING,
                    provenance=["[doc:gp-summary#c001]"],
                ),
            ]
        )
        questions = GapAnalyst(chat=FakeChat(result)).analyze(case)
        assert len(questions) == 1
        assert questions[0].provenance == ["doc:gp-summary#c001"]

    def test_drops_questions_with_unresolvable_provenance(self, case):
        result = GapQuestions(
            questions=[
                ClarificationQuestion(
                    question="valid", reason=QuestionReason.MISSING,
                    provenance=["doc:gp-summary#c001"],
                ),
                ClarificationQuestion(
                    question="hallucinated citation", reason=QuestionReason.STALE,
                    provenance=["doc:nonexistent#c9"],
                ),
            ]
        )
        questions = GapAnalyst(chat=FakeChat(result)).analyze(case)
        assert [q.question for q in questions] == ["valid"]
