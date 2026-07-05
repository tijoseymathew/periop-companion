"""Live pre-op stage smoke test against a generated case. Not pytest.

Usage: uv run python scripts/smoke_preop.py [sg-0001]
Runs record ingestion → gap analysis → interview → note → verification with
live NIMs and prints the note with provenance.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

from periop.agents.preop_note import PREOP_NOTE_ID
from periop.agents.preop_stage import run_preop_stage
from periop.cli.render import render_artifact
from periop.nim import fast_chat, reasoning_chat
from periop.schemas import Case, ClaimStatus


def main() -> None:
    load_dotenv()
    case_id = sys.argv[1] if len(sys.argv) > 1 else "sg-0001"
    case_dir = Path("data/cases") / case_id

    case = run_preop_stage(
        Case(case_id=case_id),
        case_dir,
        chat=reasoning_chat(),
        verifier_chat=fast_chat(),
    )

    print("\n=== GAP-ANALYSIS QUESTIONS ===")
    for q in case.open_questions:
        print(f"  - {q}")

    print("\n=== PRE-ANESTHESIA NOTE (with provenance) ===")
    note = case.get_artifact(PREOP_NOTE_ID)
    print(render_artifact(case, note))

    counts = {s: 0 for s in ClaimStatus}
    for c in note.claims:
        counts[c.status] += 1
    print("\n=== VERIFICATION SUMMARY ===")
    print("  " + ", ".join(f"{s.value}: {n}" for s, n in counts.items() if n))


if __name__ == "__main__":
    main()
