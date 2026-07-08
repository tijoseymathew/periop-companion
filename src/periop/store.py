"""Local JSON case store — one human-readable file per case.

Writes are atomic (temp file + rename, v2 §5.2): the SSE runner and the UI
read the same file the writer replaces, so a reader must never see a partial
case. Concurrent writers (a request handler and the background question-prep
worker, v2-speed §3.2) use :meth:`CaseStore.mutate` so read-modify-write
cycles compose instead of clobbering each other with stale whole-object saves.
"""

import json
import os
import threading
from collections.abc import Callable
from pathlib import Path

from periop.schemas import Case, ClaimReview

# One lock per process: writes are rare and small, and every CaseStore is a
# throwaway wrapper around the same on-disk root, so instance-level locks
# would not actually serialize anything.
_WRITE_LOCK = threading.Lock()


class CaseStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)

    def _path(self, case_id: str) -> Path:
        return self.root / f"{case_id}.json"

    def _atomic_write(self, path: Path, text: str) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        # thread-unique temp name: two writers replacing the same case must
        # not share a temp file, or one's os.replace strands the other's
        tmp = path.with_name(f".{path.name}.{threading.get_ident()}.tmp")
        try:
            tmp.write_text(text)
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)

    def save(self, case: Case) -> Path:
        path = self._path(case.case_id)
        self._atomic_write(path, case.model_dump_json(indent=2) + "\n")
        return path

    def mutate(self, case_id: str, fn: Callable[[Case], None]) -> Case:
        """Load → ``fn(case)`` → save, atomically w.r.t. other mutates.

        Writers that hold a case across a long operation (an LLM call, a
        whole request) re-apply their delta to the freshest copy here rather
        than saving their stale object over someone else's update.
        """
        with _WRITE_LOCK:
            case = self.load(case_id)
            fn(case)
            self.save(case)
        return case

    def load(self, case_id: str) -> Case:
        path = self._path(case_id)
        if not path.exists():
            raise KeyError(f"no such case: {case_id}")
        return Case.model_validate_json(path.read_text())

    def list_case_ids(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return sorted(
            p.stem for p in self.root.glob("*.json") if not p.name.endswith(".review.json")
        )

    # ---- per-claim review sidecar (v2 §2 stretch) --------------------------
    # Review actions annotate the review pass; the case JSON the pipeline
    # writes stays byte-identical, so they live beside it, keyed by
    # ``artifact_id#claim_id``.

    def _reviews_path(self, case_id: str) -> Path:
        return self.root / f"{case_id}.review.json"

    def load_claim_reviews(self, case_id: str) -> dict[str, ClaimReview]:
        path = self._reviews_path(case_id)
        if not path.exists():
            return {}
        raw = json.loads(path.read_text())
        return {ref: ClaimReview.model_validate(entry) for ref, entry in raw.items()}

    def save_claim_reviews(self, case_id: str, reviews: dict[str, ClaimReview]) -> Path:
        path = self._reviews_path(case_id)
        payload = {ref: json.loads(r.model_dump_json()) for ref, r in reviews.items()}
        self._atomic_write(path, json.dumps(payload, indent=2) + "\n")
        return path
