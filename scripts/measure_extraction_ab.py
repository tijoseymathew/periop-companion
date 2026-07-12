"""Intra-op extraction A/B over the full case set: Nano-only vs Nano→Super.

The `extraction_ab` harness (`periop.evals.ab`) has only ever run as a mock
unit test — no real measurement of whether the Super verify pass earns its
~60 s/case cost exists. This script runs both arms live over every gold case
and records per-arm F1 *and the actual event lists*, so disagreements can be
hand-audited (an F1 mean hides safety-relevant dose corrections behind the
gold's agent/dose granularity split).

Usage: uv run python scripts/measure_extraction_ab.py [--only sg-0001 ...]
Writes evals/traces/extraction-ab-n30.json.
"""

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv

from periop.agents.event_extractor import EventExtractor
from periop.evals.metrics import extraction_f1
from periop.nim import fast_chat, reasoning_chat
from periop.schemas import Case, Event
from periop.synthgen.bundle import load_gold
from periop.tools.ingest import transcript_from_voice_notes

CASE_ROOT = Path("data/cases")
OUT = Path("evals/traces/extraction-ab-n30.json")
NOTES = "scripts/intraop-notes.json"


def complete_cases() -> list[str]:
    return sorted(
        d.name for d in CASE_ROOT.iterdir()
        if d.is_dir() and (d / "gold" / "gold.json").exists()
        and (d / NOTES).exists()
    )


def _case_with_notes(notes_path: Path) -> Case:
    case = Case(case_id="ab")
    case.add_source(transcript_from_voice_notes(notes_path, "audio:intraop-notes"))
    return case


def _to_events(extracted) -> list[Event]:
    return [
        Event(t=e.t, category=e.category, value=e.value, units=e.units,
              provenance=e.provenance)
        for e in extracted
    ]


def _dump(events: list[Event]) -> list[dict]:
    return [e.model_dump(mode="json") for e in events]


def run_case(case_id: str, fast, reasoning) -> dict:
    case_dir = CASE_ROOT / case_id
    notes_path = case_dir / NOTES
    gold = load_gold(case_dir).events

    nano_only = EventExtractor(fast_chat=fast, reasoning_chat=reasoning, verify=False)
    nano_events = _to_events(nano_only.extract(_case_with_notes(notes_path), "audio:intraop-notes"))

    two_pass = EventExtractor(fast_chat=fast, reasoning_chat=reasoning, verify=True)
    verified_events = _to_events(two_pass.extract(_case_with_notes(notes_path), "audio:intraop-notes"))

    nano_prf = extraction_f1(nano_events, gold)
    super_prf = extraction_f1(verified_events, gold)
    return {
        "case_id": case_id,
        "n_gold": len(gold),
        "nano_only": {
            "f1": nano_prf.f1, "precision": nano_prf.precision, "recall": nano_prf.recall,
            "n_events": len(nano_events), "events": _dump(nano_events),
        },
        "nano_then_super": {
            "f1": super_prf.f1, "precision": super_prf.precision, "recall": super_prf.recall,
            "n_events": len(verified_events), "events": _dump(verified_events),
        },
        "delta_f1": super_prf.f1 - nano_prf.f1,
        "gold_events": _dump(gold),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="limit to these case ids")
    args = parser.parse_args()

    load_dotenv()
    fast, reasoning = fast_chat(), reasoning_chat()

    case_ids = complete_cases()
    if args.only:
        case_ids = [c for c in case_ids if c in set(args.only)]

    results = []
    for i, case_id in enumerate(case_ids, 1):
        row = run_case(case_id, fast, reasoning)
        results.append(row)
        n, s = row["nano_only"], row["nano_then_super"]
        print(f"[{i}/{len(case_ids)}] {case_id}: "
              f"nano_f1={n['f1']:.3f} (P{n['precision']:.2f}/R{n['recall']:.2f}, {n['n_events']}ev) "
              f"super_f1={s['f1']:.3f} (P{s['precision']:.2f}/R{s['recall']:.2f}, {s['n_events']}ev) "
              f"Δ={row['delta_f1']:+.3f}",
              flush=True)

    n = len(results)
    mean = lambda key, arm: sum(r[arm][key] for r in results) / n if n else 0.0
    summary = {
        "n_cases": n,
        "means": {
            "nano_only_f1": mean("f1", "nano_only"),
            "nano_only_precision": mean("precision", "nano_only"),
            "nano_only_recall": mean("recall", "nano_only"),
            "nano_then_super_f1": mean("f1", "nano_then_super"),
            "nano_then_super_precision": mean("precision", "nano_then_super"),
            "nano_then_super_recall": mean("recall", "nano_then_super"),
        },
        "per_case": results,
    }
    summary["means"]["delta_f1"] = (
        summary["means"]["nano_then_super_f1"] - summary["means"]["nano_only_f1"]
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(summary, indent=2) + "\n")

    m = summary["means"]
    print(f"\nAggregate over {n} cases:")
    print(f"  nano_only        f1={m['nano_only_f1']:.3f} "
          f"P={m['nano_only_precision']:.3f} R={m['nano_only_recall']:.3f}")
    print(f"  nano_then_super  f1={m['nano_then_super_f1']:.3f} "
          f"P={m['nano_then_super_precision']:.3f} R={m['nano_then_super_recall']:.3f}")
    print(f"  delta_f1={m['delta_f1']:+.3f}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
