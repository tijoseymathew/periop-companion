"""CLI rendering of claims with their provenance (spec §4.4, M2 exit).

Each claim is shown with its status and, beneath it, the exact cited span —
document chunk text, or audio segment with speaker and (t0, t1) so a reviewer
knows which clip to play.
"""

from periop.schemas import ArtifactRecord, AudioSegment, Case, Chunk, Claim

_STATUS_MARK = {
    "supported": "✓",
    "unsupported": "?",
    "conflicting": "✗",
    "unverified": "·",
}


def _render_anchor(ref: str, anchor: Chunk | AudioSegment) -> str:
    if isinstance(anchor, AudioSegment):
        return (
            f"      ↳ [{ref}] ({anchor.speaker}, {anchor.t0:.1f}-{anchor.t1:.1f}s) "
            f'"{anchor.text}"'
        )
    section = f" [{anchor.section}]" if anchor.section else ""
    return f'      ↳ [{ref}]{section} "{anchor.text}"'


def render_claim_provenance(case: Case, claim: Claim) -> str:
    mark = _STATUS_MARK.get(claim.status, "·")
    lines = [f"  {mark} ({claim.status}) {claim.text}"]
    for ref in claim.provenance:
        try:
            anchor = case.resolve(ref)
        except (KeyError, ValueError):
            lines.append(f"      ↳ [{ref}] (UNRESOLVED)")
            continue
        lines.append(_render_anchor(str(ref), anchor))
    return "\n".join(lines)


def render_artifact(case: Case, artifact: ArtifactRecord) -> str:
    lines = [f"# {artifact.artifact_id} ({len(artifact.claims)} claims)"]
    for claim in artifact.claims:
        lines.append(render_claim_provenance(case, claim))
    return "\n".join(lines)
