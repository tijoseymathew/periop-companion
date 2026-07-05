"""Generate synthetic case bundles with the live reasoning NIM. Not pytest.

Usage: uv run python scripts/generate_cases.py --n 5

Resumable by design: case ↔ persona mapping is a seeded shuffle of the
committed persona sample, and every bundle piece skips existing files — on a
rate limit, just re-run.
"""

import argparse
import random
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

from periop.nim import reasoning_chat
from periop.synthgen.bundle import generate_case
from periop.synthgen.personas import load_personas

PERSONAS = Path("data/synthgen/personas_sample.jsonl")
OUT_ROOT = Path("data/cases")
SHUFFLE_SEED = 2026


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=5, help="number of cases (from index 1)")
    parser.add_argument("--start", type=int, default=1, help="first case index")
    args = parser.parse_args()

    load_dotenv()
    personas = load_personas(PERSONAS)
    random.Random(SHUFFLE_SEED).shuffle(personas)  # stable case↔persona mapping
    chat = reasoning_chat()

    failures = 0
    for index in range(args.start, args.start + args.n):
        persona = personas[(index - 1) % len(personas)]
        label = f"sg-{index:04d} ({persona.sex}, {persona.age}, {persona.occupation})"
        t0 = time.time()
        try:
            case_dir = generate_case(persona, index=index, chat=chat, out_root=OUT_ROOT)
            print(f"✓ {label} → {case_dir} [{time.time() - t0:.0f}s]")
        except Exception as exc:  # keep going; re-run completes the gaps
            failures += 1
            print(f"✗ {label}: {type(exc).__name__}: {exc}", file=sys.stderr)

    if failures:
        print(f"{failures} case(s) incomplete — re-run to resume.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
