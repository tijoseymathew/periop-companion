"""Render the HTML review page for a processed case (spec §2 MVP, §4.4).

Reads a saved Case from the output store and writes a self-contained HTML
review page next to it. Offline — no NIM calls.

Usage: uv run python scripts/render_review.py [case_id ...]
       (no args → render every case in the store)
"""

import argparse
from pathlib import Path

from periop.store import CaseStore
from periop.ui.review import write_review

STORE = Path("data/cases/_out")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case_ids", nargs="*", help="case ids (default: all in store)")
    parser.add_argument("--store", type=Path, default=STORE)
    args = parser.parse_args()

    store = CaseStore(args.store)
    case_ids = args.case_ids or store.list_case_ids()
    if not case_ids:
        raise SystemExit(f"no cases found in {args.store}")
    for case_id in case_ids:
        path = write_review(store.load(case_id), args.store)
        print(f"{case_id} → {path}")


if __name__ == "__main__":
    main()
