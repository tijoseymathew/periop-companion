"""CLI: run a full case and print every artifact with provenance.

    uv run python -m periop.cli.run_case sg-0001

Uses the live NIMs (reasoning + fast tiers). The run is persisted to the case
store; provenance for every claim is printed so a reviewer can trace or play
each cited span.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

from periop.agents.stages import run_case_stages
from periop.cli.render import render_artifact
from periop.nim import fast_chat, reasoning_chat
from periop.schemas import Case, ClaimStatus
from periop.store import CaseStore

CASE_ROOT = Path("data/cases")


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print("usage: python -m periop.cli.run_case <case_id>", file=sys.stderr)
        return 2
    case_id = argv[0]
    case_dir = CASE_ROOT / case_id
    if not case_dir.is_dir():
        print(f"no case bundle at {case_dir}", file=sys.stderr)
        return 1

    case = run_case_stages(
        Case(case_id=case_id), case_dir, chat=reasoning_chat(), fast_chat=fast_chat()
    )
    CaseStore(CASE_ROOT / "_out").save(case)

    for artifact in case.artifacts:
        print("\n" + render_artifact(case, artifact))

    total = sum(len(a.claims) for a in case.artifacts)
    unsupported = sum(
        1 for a in case.artifacts for c in a.claims
        if c.status in (ClaimStatus.UNSUPPORTED, ClaimStatus.CONFLICTING)
    )
    print(f"\n{len(case.artifacts)} artifacts, {total} claims, {unsupported} flagged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
