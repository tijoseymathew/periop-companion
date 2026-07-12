"""Measure the GapAnalyst's defect-catch rate on one case (spec §6 companion).

gap_recall in a single eval run is one Bernoulli draw: the analyst either asks
a question covering the gold probe or it doesn't. This script draws N fresh
GapAnalyst samples (no pipeline, one LLM call each) and judges every kept
question against the gold probe with the question judge, printing per-sample
verdicts so a reviewer can audit the judge itself — its known error direction
is occasional false positives on questions that mention a documented
medication change while asking about something else (see evals/README.md,
finding 4).

Usage: uv run python scripts/measure_gap_catch.py [case_id] [n_samples]
"""

import json
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

from periop.agents.gap_analyst import GapAnalyst
from periop.evals.judge import LlmJudge
from periop.nim import fast_chat, reasoning_chat
from periop.schemas import Case
from periop.tools.ingest import ingest_records


def main() -> None:
    case_id = sys.argv[1] if len(sys.argv) > 1 else "sg-0002"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    load_dotenv()
    case_dir = Path("data/cases") / case_id
    gold_questions = json.loads((case_dir / "gold" / "gold.json").read_text())["questions"]
    judge = LlmJudge(chat=fast_chat())
    chat = reasoning_chat()

    catches = 0
    for i in range(n):
        case = Case(case_id=case_id)
        ingest_records(case, case_dir)
        t0 = time.time()
        questions = GapAnalyst(chat=chat).analyze(case)
        verdicts = [
            (any(judge.matches_questions(q.question, g) for g in gold_questions), q.question)
            for q in questions
        ]
        caught = any(v for v, _ in verdicts)
        catches += caught
        print(f"--- sample {i + 1}/{n}: {'CATCH' if caught else 'miss'} "
              f"({len(questions)} questions, {time.time() - t0:.0f}s)", flush=True)
        for v, q in verdicts:
            print(f"    {'MATCH' if v else '     '} {q}", flush=True)

    print(f"\n{case_id}: catch rate {catches}/{n}")


if __name__ == "__main__":
    main()
