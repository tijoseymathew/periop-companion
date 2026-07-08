"""LLM-judge matcher for semantic set metrics (spec §6).

An entailment-style equivalence check on the fast model. Uses a plain yes/no
completion rather than structured JSON: the small model reliably answers a
direct yes/no but sometimes echoes a JSON schema back, so the simpler protocol
is more robust on this hot path. Verdicts are cached per (mode, pred, gold)
pair and sampled at temperature 0 so a re-score of the same artifacts is
deterministic.

Two prompts, one per comparison mode. Claims are *statements*, so the fact
prompt asks whether they assert the same fact. Gap-analysis questions are not
statements — asked whether two equivalent questions "express the same fact",
the model correctly answers NO, which pinned gap_f1 at 0 for every run. The
question prompt instead asks directionally whether answering the generated
question would surface what the gold probe seeks: that credits
generic-vs-specific phrasing (gold's "stopped or changed any medications?" vs
a generated question naming the five listed drugs) while rejecting a question
that merely *mentions* a related detail (an "update on your GERD since
omeprazole was discontinued?" question does not cover a med-change probe —
that exact pair was the one false positive of a symmetric "same issue"
prompt).
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

SYSTEM_QUESTIONS = (
    "You judge whether one clinical interview question covers another. "
    "Answer only YES or NO. Ignore phrasing, register, and level of detail; "
    "judge what information each question would elicit from the patient."
)

PROMPT_QUESTIONS = """\
Would a patient's full answer to question A also give the interviewer the
information question B asks for?

A: {a}
B: {b}

A may be broader or more specific than B; answer YES only if answering A would
surface what B seeks. A question that merely mentions a related detail (a
drug, a date, a condition) while actually asking about something else does not
cover B. Answer YES or NO, one word.
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

    def _judge(self, mode: str, prompt: str, system: str, pred: str, gold: str) -> bool:
        key = (mode, pred, gold)
        if key not in self._cache:
            reply = self.chat.complete(
                prompt.format(a=pred, b=gold), system=system, temperature=0.0
            )
            self._cache[key] = _parse_yes(reply)
        return self._cache[key]

    def matches(self, pred: str, gold: str) -> bool:
        """Statement equivalence: do the two claims assert the same fact?"""
        return self._judge("fact", PROMPT, SYSTEM, pred, gold)

    def matches_questions(self, pred: str, gold: str) -> bool:
        """Question coverage: would answering ``pred`` surface what ``gold`` seeks?"""
        return self._judge("question", PROMPT_QUESTIONS, SYSTEM_QUESTIONS, pred, gold)
