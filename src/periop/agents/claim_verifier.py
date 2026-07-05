"""ClaimVerifier (spec §4.3): re-check each claim against its cited spans.

An NLI-style pass on the fast model: does the cited text entail the claim,
contradict it, or fail to support it → supported / unsupported / conflicting.
Unsupported/conflicting claims are flagged in place, never dropped.
"""

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


class ClaimVerifier:
    def __init__(self, chat) -> None:
        self.chat = chat

    def verify(self, case: Case, artifact_id: str, forward_looking: bool = False) -> None:
        artifact = case.get_artifact(artifact_id)
        if artifact is None:
            raise KeyError(f"no such artifact: {artifact_id}")
        prompt = FORWARD_LOOKING_PROMPT if forward_looking else PROMPT
        for claim in artifact.claims:
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
