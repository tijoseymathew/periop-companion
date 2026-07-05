"""LLM-judge matcher tests (spec §6): semantic equivalence via the fast model."""

from periop.evals.judge import LlmJudge


class FakeChat:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def complete(self, user, system=None, **kwargs):
        self.calls.append(user)
        return self.replies.pop(0)


class TestLlmJudge:
    def test_returns_true_on_yes(self):
        judge = LlmJudge(chat=FakeChat(["YES"]))
        assert judge.matches("Aspirin stopped 6 days ago.", "Discontinued aspirin preop.")

    def test_returns_false_on_no(self):
        judge = LlmJudge(chat=FakeChat(["No, these differ."]))
        assert not judge.matches("On metformin.", "Penicillin allergy.")

    def test_parses_yes_from_verbose_reply(self):
        judge = LlmJudge(chat=FakeChat(["Yes — both say the aspirin was stopped."]))
        assert judge.matches("a", "b")

    def test_prompt_contains_both_texts(self):
        judge = LlmJudge(chat=FakeChat(["yes"]))
        judge.matches("text A here", "text B here")
        assert "text A here" in judge.chat.calls[0]
        assert "text B here" in judge.chat.calls[0]

    def test_caches_repeated_pairs(self):
        chat = FakeChat(["yes", "no"])
        judge = LlmJudge(chat=chat)
        judge.matches("a", "b")
        judge.matches("a", "b")  # served from cache
        assert len(chat.calls) == 1
