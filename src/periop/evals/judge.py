"""LLM-judge matcher for semantic set metrics (spec §6).

An entailment-style equivalence check on the fast model: does a generated
claim/question express the same clinical fact as a gold one? Verdicts are
cached per (pred, gold) pair so aggregate scoring stays cheap.
"""

from pydantic import BaseModel

from periop.nim import fast_chat

SYSTEM = (
    "You judge whether two short clinical statements express the same fact. "
    "Answer only about semantic equivalence, ignoring phrasing/register."
)

PROMPT = """\
Do these two statements express the same clinical fact (one entails the other)?

A: {a}
B: {b}

equivalent = true only if they assert the same fact.
"""


class JudgeVerdict(BaseModel):
    equivalent: bool


class LlmJudge:
    def __init__(self, chat=None) -> None:
        self.chat = chat or fast_chat()
        self._cache: dict[tuple[str, str], bool] = {}

    def matches(self, pred: str, gold: str) -> bool:
        key = (pred, gold)
        if key not in self._cache:
            verdict = self.chat.complete_structured(
                PROMPT.format(a=pred, b=gold), schema=JudgeVerdict, system=SYSTEM
            )
            self._cache[key] = verdict.equivalent
        return self._cache[key]
