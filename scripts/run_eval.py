"""Eval harness runner (spec §6). Not pytest.

Runs the full pipeline over every generated case, scores each against its gold
with the LLM judge, and writes evals/report.json + a markdown summary.
Resumable: a case whose output already exists in the store is scored without
re-running the pipeline unless --rerun is passed.

Usage: uv run python scripts/run_eval.py [--rerun] [--ab]
"""

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv

from periop.agents.stages import run_case_stages
from periop.evals.harness import aggregate, evaluate_case
from periop.evals.judge import LlmJudge
from periop.nim import fast_chat, reasoning_chat
from periop.schemas import Case
from periop.store import CaseStore
from periop.synthgen.bundle import GoldCase, load_gold

CASE_ROOT = Path("data/cases")
OUT = Path("evals/report.json")


def complete_cases() -> list[str]:
    return sorted(
        d.name for d in CASE_ROOT.iterdir()
        if d.is_dir() and (d / "gold" / "gold.json").exists()
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rerun", action="store_true", help="re-run pipeline even if cached")
    parser.add_argument("--only", nargs="*", help="limit to these case ids")
    args = parser.parse_args()

    load_dotenv()
    store = CaseStore(CASE_ROOT / "_out")
    judge = LlmJudge(chat=fast_chat())
    reasoning, fast = reasoning_chat(), fast_chat()

    case_ids = complete_cases()
    if args.only:
        case_ids = [c for c in case_ids if c in set(args.only)]

    reports = []
    failures = []
    for case_id in case_ids:
        case_dir = CASE_ROOT / case_id
        try:
            try:
                if not args.rerun:
                    case = store.load(case_id)
                else:
                    raise KeyError
            except KeyError:
                case = run_case_stages(
                    Case(case_id=case_id), case_dir, chat=reasoning, fast_chat=fast
                )
                store.save(case)

            gold = load_gold(case_dir)
            report = evaluate_case(
                case, gold, matches=judge.matches,
                matches_questions=judge.matches_questions,
            )
        except Exception as exc:  # one bad case must not sink the whole run
            failures.append(case_id)
            print(f"✗ {case_id}: {type(exc).__name__}: {exc}")
            continue
        reports.append(report)
        print(f"{case_id}: gap_f1={report.gap_f1:.2f} "
              f"preop_recall={report.preop_claim_recall:.2f} "
              f"distractor_leak={report.distractor_leakage:.2f} "
              f"handoff_halluc={report.handoff_hallucination_rate:.2f}")

    means = aggregate(reports)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"n_cases": len(reports), "means": means,
         "per_case": [r.model_dump() for r in reports]},
        indent=2,
    ) + "\n")
    print(f"\nAggregate over {len(reports)} cases:")
    for k, v in means.items():
        print(f"  {k}: {v:.3f}")
    print(f"\nwrote {OUT}")
    if failures:
        print(f"{len(failures)} case(s) failed: {' '.join(failures)} — re-run to resume.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
