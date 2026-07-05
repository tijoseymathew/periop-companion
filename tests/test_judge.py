"""LLM-judge matcher tests (spec §6): semantic equivalence via the fast model."""

from periop.evals.judge import LlmJudge, JudgeVerdict


class FakeChat:
    def __init__(self, verdicts):
        self.verdicts = list(verdicts)
        self.calls = []

    def complete_structured(self, user, schema, system=None, **kwargs):
        self.calls.append(user)
        return JudgeVerdict(equivalent=self.verdicts.pop(0))


class TestLlmJudge:
    def test_returns_true_on_equivalent(self):
        judge = LlmJudge(chat=FakeChat([True]))
        assert judge.matches("Aspirin stopped 6 days ago.", "Discontinued aspirin preop.")

    def test_returns_false_on_distinct(self):
        judge = LlmJudge(chat=FakeChat([False]))
        assert not judge.matches("On metformin.", "Penicillin allergy.")

    def test_prompt_contains_both_texts(self):
        judge = LlmJudge(chat=FakeChat([True]))
        judge.matches("text A here", "text B here")
        assert "text A here" in judge.chat.calls[0]
        assert "text B here" in judge.chat.calls[0]

    def test_caches_repeated_pairs(self):
        chat = FakeChat([True, False])
        judge = LlmJudge(chat=chat)
        judge.matches("a", "b")
        judge.matches("a", "b")  # served from cache
        assert len(chat.calls) == 1
