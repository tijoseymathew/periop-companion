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

    def run_stage(self, case: Case, stage: str, case_dir, emit) -> Case:
        from periop.agents.stages import run_intraop_stage, run_postop_stage
        from periop.agents.preop_stage import run_preop_stage

        chat, fast = self._chats()
        if stage == "preop":
            return run_preop_stage(case, case_dir, chat=chat, verifier_chat=fast, emit=emit)
        if stage == "intraop":
            return run_intraop_stage(case, case_dir, chat=chat, fast_chat=fast, emit=emit)
        return run_postop_stage(case, case_dir, chat=chat, fast_chat=fast, emit=emit)
