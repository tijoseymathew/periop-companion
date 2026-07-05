"""IssueAnticipator (spec §3.4 step 4): pre-op + intra-op → anticipated issues.

Each anticipated post-op issue is a claim whose provenance spans BOTH stages
(e.g. PONV risk from pre-op history + intra-op volatile use). The model may
cite source spans directly or cite existing claims (``artifact_id#claim_id``),
which inherit that claim's source provenance — the prompt shows both kinds of
ref, and models routinely cite the claim. Unresolvable citations are dropped
per-ref; an issue is dropped only when nothing it cites resolves.
"""

from pydantic import BaseModel, Field

from periop.agents.context import render_claims, render_sources
from periop.agents.intraop_record import INTRAOP_RECORD_ID
from periop.agents.preop_note import PREOP_NOTE_ID
from periop.schemas import ArtifactRecord, Case, Claim

ANTICIPATED_ISSUES_ID = "note:anticipated-issues"


class AnticipatedIssue(BaseModel):
    issue: str
    provenance: list[str] = Field(
        description="source_id#anchor refs to the pre-op AND/OR intra-op evidence"
    )


class AnticipatedIssues(BaseModel):
    issues: list[AnticipatedIssue]


SYSTEM = (
    "You anticipate post-operative issues for anesthesia handoff. Each issue "
    "must be justified by specific pre-op history and/or intra-op events, cited "
    "to the underlying source spans. You do not speculate beyond the evidence."
)

PROMPT = """\
Given this patient's pre-op note and intra-op course, list the post-operative
issues the PACU team should watch for (e.g. PONV risk, airway watch, glycemic
control, analgesia, hemodynamic watch).

Pre-op note claims:
{preop}

Intra-op record claims:
{intraop}

Source spans (cite these ids as provenance):
{sources}

Each issue: `issue` (the concern + why), `provenance` (the bracketed id(s) —
source spans and/or claims, pre-op and/or intra-op — that justify it, exactly
as shown above; citing a claim inherits its provenance). Cite evidence from
BOTH stages where the risk arises from their combination.
"""


class IssueAnticipator:
    def __init__(self, chat) -> None:
        self.chat = chat

    def anticipate(self, case: Case) -> ArtifactRecord:
        preop = case.get_artifact(PREOP_NOTE_ID)
        intraop = case.get_artifact(INTRAOP_RECORD_ID)
        event_log = "\n".join(
            f"- {e.t} [{e.category}] {e.value} {e.units or ''} "
            f"({', '.join(str(r) for r in e.provenance)})"
            for e in case.intraop_events
        )
        prompt = PROMPT.format(
            preop=render_claims(preop) if preop else "(none)",
            intraop=(render_claims(intraop) if intraop else "(none)")
            + ("\n\nIntra-op event log:\n" + event_log if event_log else ""),
            sources=render_sources(case),
        )
        out = self.chat.complete_structured(prompt, schema=AnticipatedIssues, system=SYSTEM)
        claims: list[Claim] = []
        for issue in out.issues:
            provenance = self._resolve_refs(case, issue.provenance)
            if provenance:
                claims.append(
                    Claim(
                        claim_id=f"c-{len(claims) + 1:03d}",
                        text=issue.issue,
                        provenance=provenance,
                    )
                )
        artifact = ArtifactRecord(artifact_id=ANTICIPATED_ISSUES_ID, claims=claims)
        case.add_artifact(artifact)
        case.anticipated_issues = [c.text for c in claims]
        return artifact

    @staticmethod
    def _resolve_refs(case: Case, refs: list[str]) -> list[str]:
        """Source refs kept as-is; claim refs inherit the claim's provenance;
        anything else dropped. Refs are normalized first — models sometimes
        echo the display brackets or pad with whitespace."""
        resolved: list[str] = []
        for ref in refs:
            ref = ref.strip().strip("[]")
            try:
                case.resolve(ref)
            except (KeyError, ValueError):
                cited = case.get_claim(ref)
                if cited is not None:
                    resolved.extend(str(r) for r in cited.provenance)
                continue
            resolved.append(ref)
        return list(dict.fromkeys(resolved))
