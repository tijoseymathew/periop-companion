"""LLM-judge matcher tests (spec §6): semantic equivalence via the fast model."""

from periop.evals.judge import LlmJudge


class FakeChat:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []
        self.kwargs = []

    def complete(self, user, system=None, **kwargs):
        self.calls.append(user)
        self.kwargs.append(kwargs)
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


class TestLlmJudgeQuestions:
    def test_uses_question_prompt(self):
        judge = LlmJudge(chat=FakeChat(["yes"]))
        judge.matches_questions("Any med changes?", "Stopped any medications?")
        assert "answer to question A" in judge.chat.calls[0]
        assert "Any med changes?" in judge.chat.calls[0]

    def test_parses_verdict(self):
        judge = LlmJudge(chat=FakeChat(["YES", "No."]))
        assert judge.matches_questions("a", "b")
        assert not judge.matches_questions("c", "d")

    def test_cache_is_per_mode(self):
        # same pair judged as fact and as question must be two separate calls
        chat = FakeChat(["no", "yes"])
        judge = LlmJudge(chat=chat)
        assert not judge.matches("a", "b")
        assert judge.matches_questions("a", "b")
        assert len(chat.calls) == 2

    def test_temperature_pinned_to_zero(self):
        chat = FakeChat(["yes", "yes"])
        judge = LlmJudge(chat=chat)
        judge.matches("a", "b")
        judge.matches_questions("a", "b")
        assert all(kw.get("temperature") == 0.0 for kw in chat.kwargs)
