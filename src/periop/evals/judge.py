"""LLM-judge matcher for semantic set metrics (spec §6).

An entailment-style equivalence check on the fast model. Uses a plain yes/no
completion rather than structured JSON: the small model reliably answers a
direct yes/no but sometimes echoes a JSON schema back, so the simpler protocol
is more robust on this hot path. Verdicts are cached per (pred, gold) pair.
"""

import re

SYSTEM = (
    "You judge whether two short clinical statements express the same fact. "
    "Answer only YES or NO. Ignore phrasing and register; judge the fact."
)

PROMPT = """\
Do these two statements express the same clinical fact (does one entail the other)?

A: {a}
B: {b}

Answer YES if they assert the same fact, otherwise NO. Answer with one word.
"""

QUESTION_SYSTEM = (
    "You judge whether two clinical clarification questions probe the same "
    "underlying information gap. Answer only YES or NO. Ignore phrasing, "
    "scope and register; judge whether answering one would answer the other's "
    "core concern."
)

QUESTION_PROMPT = """\
Do these two pre-anesthesia clarification questions target the same information gap
(e.g. both probe whether a specific medication is still being taken)?

A: {a}
B: {b}

Answer YES if a patient's answer to either would resolve the same clinical concern,
otherwise NO. Answer with one word.
"""


def _parse_yes(reply: str) -> bool:
    m = re.search(r"\b(yes|no)\b", reply.lower())
    return m is not None and m.group(1) == "yes"


class LlmJudge:
    def __init__(self, chat=None) -> None:
        if chat is None:
            from periop.nim import fast_chat

            chat = fast_chat()
        self.chat = chat
        self._cache: dict[tuple[str, str, str], bool] = {}

    def matches(self, pred: str, gold: str) -> bool:
        return self._judged("fact", PROMPT, SYSTEM, pred, gold)

    def question_matches(self, pred: str, gold: str) -> bool:
        """Intent-equivalence for questions: facts entail, questions probe."""
        return self._judged("question", QUESTION_PROMPT, QUESTION_SYSTEM, pred, gold)

    def _judged(self, kind: str, prompt: str, system: str, pred: str, gold: str) -> bool:
        key = (kind, pred, gold)
        if key not in self._cache:
            # Greedy decoding: a judge must be deterministic — at the default
            # temperature borderline verdicts flip between runs.
            reply = self.chat.complete(
                prompt.format(a=pred, b=gold), system=system, temperature=0
            )
            self._cache[key] = _parse_yes(reply)
        return self._cache[key]
