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


def _parse_yes(reply: str) -> bool:
    m = re.search(r"\b(yes|no)\b", reply.lower())
    return m is not None and m.group(1) == "yes"


class LlmJudge:
    def __init__(self, chat=None) -> None:
        if chat is None:
            from periop.nim import fast_chat

            chat = fast_chat()
        self.chat = chat
        self._cache: dict[tuple[str, str], bool] = {}

    def matches(self, pred: str, gold: str) -> bool:
        key = (pred, gold)
        if key not in self._cache:
            reply = self.chat.complete(PROMPT.format(a=pred, b=gold), system=SYSTEM)
            self._cache[key] = _parse_yes(reply)
        return self._cache[key]
