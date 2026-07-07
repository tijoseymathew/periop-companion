"""ClaimVerifier (spec §4.3): re-check each claim against its cited spans.

An NLI-style pass on the fast model: does the cited text entail the claim,
contradict it, or fail to support it → supported / unsupported / conflicting.
Unsupported/conflicting claims are flagged in place, never dropped.

Verdicts are independent, so the per-claim calls fan out over a bounded
thread pool (spec v2-speed §3.3) — ``PERIOP_VERIFIER_CONCURRENCY`` tunes it
(default 4; ``0``/``1`` = sequential, the knob for rate-limited hosted
endpoints). The ledger is identical to the sequential version: workers
mutate their own ``Claim`` in place and never touch artifact order.
"""

import contextvars
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from pydantic import BaseModel, Field

from periop.schemas import Case, ClaimStatus


class VerifierVerdict(BaseModel):
    status: ClaimStatus
    rationale: str = Field(description="One line on why")


SYSTEM = (
    "You are a claim verifier. Given a claim and the exact source spans cited "
    "for it, decide whether the spans support the claim. Judge only from the "
    "spans; do not use outside knowledge."
)

PROMPT = """\
Claim: {claim}

Cited source spans:
{spans}

Does the cited text support the claim?
- "supported": the spans entail the claim.
- "conflicting": the spans contradict the claim (or the spans disagree with
  each other about it).
- "unsupported": the spans neither entail nor contradict — insufficient basis.
"""

# Anticipated issues are risk projections: spans can support the risk factors
# but never entail the projected outcome, so pure entailment reads every such
# claim "unsupported". Forward-looking mode verifies the evidence instead.
FORWARD_LOOKING_PROMPT = """\
Claim (a forward-looking risk projection): {claim}

Cited source spans:
{spans}

Judge the claim's evidence, not the prediction itself:
- "inference": the claim projects a risk/outcome and the spans support the
  risk factors it is based on.
- "supported": the spans fully entail the claim (no projection involved).
- "conflicting": the spans contradict the claim's stated basis.
- "unsupported": the spans do not support the risk factors the claim cites.
"""


def _concurrency() -> int:
    return int(os.environ.get("PERIOP_VERIFIER_CONCURRENCY") or 4)


class ClaimVerifier:
    def __init__(self, chat) -> None:
        self.chat = chat

    def verify(self, case: Case, artifact_id: str, forward_looking: bool = False) -> None:
        artifact = case.get_artifact(artifact_id)
        if artifact is None:
            raise KeyError(f"no such artifact: {artifact_id}")
        prompt = FORWARD_LOOKING_PROMPT if forward_looking else PROMPT

        workers = min(_concurrency(), len(artifact.claims))
        if workers <= 1:
            for claim in artifact.claims:
                self._verify_one(case, claim, prompt)
            return

        # traced_llm_call reaches NAT's step stream through contextvars, which
        # a bare ThreadPoolExecutor does not propagate — without copy_context
        # every verification call silently drops off the trace. One copy per
        # task: a single Context object cannot be entered concurrently.
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [
                pool.submit(
                    contextvars.copy_context().run, self._verify_one, case, claim, prompt
                )
                for claim in artifact.claims
            ]
            for future in as_completed(futures):
                future.result()  # re-raise the first failure, same as the loop

    def _verify_one(self, case: Case, claim, prompt: str) -> None:
        spans = self._render_spans(case, claim)
        verdict = self.chat.complete_structured(
            prompt.format(claim=claim.text, spans=spans),
            schema=VerifierVerdict,
            system=SYSTEM,
        )
        claim.status = verdict.status

    @staticmethod
    def _render_spans(case: Case, claim) -> str:
        lines = []
        for ref in claim.provenance:
            try:
                anchor = case.resolve(ref)
            except (KeyError, ValueError):
                lines.append(f"[{ref}] (missing)")
                continue
            lines.append(f"[{ref}] {anchor.text}")
        return "\n".join(lines) or "(no citations)"
