"""ClaimVerifier (spec §4.3): re-check each claim against its cited spans.

An NLI-style pass on the fast model: does the cited text entail the claim,
contradict it, or fail to support it → supported / unsupported / conflicting.
Unsupported/conflicting claims are flagged in place, never dropped.

Execution is ``periop.adk.verifier.ClaimVerifierAgent``: an ADK agent that
fans one generate→validate verdict step out over the artifact's claims, one
independent verdict per claim. The ``ClaimVerifier`` class is a facade over
that agent for standalone callers.
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


def render_spans(case: Case, claim) -> str:
    lines = []
    for ref in claim.provenance:
        try:
            anchor = case.resolve(ref)
        except (KeyError, ValueError):
            lines.append(f"[{ref}] (missing)")
            continue
        lines.append(f"[{ref}] {anchor.text}")
    return "\n".join(lines) or "(no citations)"


class ClaimVerifier:
    """Facade: run the ADK claim-verifier agent standalone over one artifact."""

    def __init__(self, chat) -> None:
        self.chat = chat

    def verify(self, case: Case, artifact_id: str, forward_looking: bool = False) -> None:
        from periop.adk.runtime import run_agent, sync_case
        from periop.adk.verifier import ClaimVerifierAgent

        agent = ClaimVerifierAgent.build(
            name="claim_verifier",
            chat=self.chat,
            artifact_id=artifact_id,
            forward_looking=forward_looking,
        )
        result, _ = run_agent(agent, case)
        sync_case(case, result)
