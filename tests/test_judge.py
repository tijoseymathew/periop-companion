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


class TestQuestionMatches:
    # Fact-entailment is the wrong test for questions: "Is the patient still
    # taking Enalapril?" and "Have you stopped or changed any medications,
    # particularly Enalapril?" assert no facts, but probe the same gap
    # (observed live: the fact prompt returns NO for exactly that pair).

    def test_uses_question_intent_prompt(self):
        judge = LlmJudge(chat=FakeChat(["yes"]))
        judge.question_matches("Is the patient still taking Enalapril?",
                               "Have you stopped any medications?")
        prompt = judge.chat.calls[0].lower()
        assert "question" in prompt
        assert "same" in prompt or "gap" in prompt

    def test_yes_no_parsing_and_cache(self):
        chat = FakeChat(["  YES."])
        judge = LlmJudge(chat=chat)
        assert judge.question_matches("q1", "q2")
        assert judge.question_matches("q1", "q2")
        assert len(chat.calls) == 1

    def test_question_and_fact_caches_are_separate(self):
        chat = FakeChat(["no", "yes"])
        judge = LlmJudge(chat=chat)
        assert not judge.matches("a", "b")
        assert judge.question_matches("a", "b")

    def test_judge_decodes_greedily(self):
        # Verdicts must not flip between runs; temperature 0 on every call.
        chat = FakeChat(["yes", "yes"])
        judge = LlmJudge(chat=chat)
        judge.matches("a", "b")
        judge.question_matches("a", "b")
        assert all(k.get("temperature") == 0 for k in chat.kwargs)
