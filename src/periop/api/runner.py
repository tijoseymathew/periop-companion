"""Pipeline runner seam for the write API (spec v2 §3).

The workflow endpoints never talk to the NIMs directly: they call an injected
runner so tests (and the hermetic e2e server) can substitute instant stubs.
The live runner constructs the existing chat tiers lazily — importing this
module must not require network or keys.
"""

from __future__ import annotations

from periop.schemas import Case


class LivePipelineRunner:
    """Default runner: the real agents against live NIMs (lazy construction)."""

    def _chats(self):
        from periop.nim import fast_chat, reasoning_chat

        return reasoning_chat(), fast_chat()

    def analyze_gaps(self, case: Case) -> None:
        from periop.agents.gap_analyst import GapAnalyst

        chat, _ = self._chats()
        GapAnalyst(chat=chat).analyze(case)
