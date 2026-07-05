"""Fetch a stratified persona sample from Nemotron-Personas-Singapore.

Pulls rows from the Hugging Face datasets-server API (no auth needed for
this public CC-BY-4.0 dataset), stratifies across age band × sex, and writes
data/synthgen/personas_sample.jsonl for the case-generation pipeline.

Usage: uv run python scripts/fetch_personas.py [--per-stratum 6] [--seed 42]
"""

import argparse
import json
import urllib.request
from pathlib import Path

from periop.synthgen.personas import Persona, stratified_sample

DATASET = "nvidia/Nemotron-Personas-Singapore"
ROWS_URL = (
    "https://datasets-server.huggingface.co/rows"
    f"?dataset={DATASET.replace('/', '%2F')}&config=default&split=train"
)
PAGE = 100
OUT = Path("data/synthgen/personas_sample.jsonl")


def fetch_pool(pages: int, page_stride: int) -> list[Persona]:
    """Fetch ``pages`` pages of rows, striding through the dataset so the
    pool spans more than the first few thousand rows."""
    pool = []
    for i in range(pages):
        offset = i * page_stride
        with urllib.request.urlopen(f"{ROWS_URL}&offset={offset}&length={PAGE}") as resp:
            rows = json.load(resp)["rows"]
        pool.extend(Persona.model_validate(r["row"]) for r in rows)
        print(f"  fetched offset {offset} ({len(pool)} personas pooled)")
    return pool


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-stratum", type=int, default=6)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--pages", type=int, default=8)
    parser.add_argument("--page-stride", type=int, default=10_000)
    args = parser.parse_args()

    pool = fetch_pool(args.pages, args.page_stride)
    sample = stratified_sample(pool, per_stratum=args.per_stratum, seed=args.seed)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as f:
        for persona in sample:
            f.write(persona.model_dump_json() + "\n")
    print(f"wrote {len(sample)} personas → {OUT}")


if __name__ == "__main__":
    main()
