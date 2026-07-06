"""Local JSON case store — one human-readable file per case.

Writes are atomic (temp file + rename, v2 §5.2): the SSE runner and the UI
read the same file the writer replaces, so a reader must never see a partial
case.
"""

import json
import os
from pathlib import Path

from periop.schemas import Case, ClaimReview


class CaseStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)

    def _path(self, case_id: str) -> Path:
        return self.root / f"{case_id}.json"

    def _atomic_write(self, path: Path, text: str) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.tmp")
        try:
            tmp.write_text(text)
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)

    def save(self, case: Case) -> Path:
        path = self._path(case.case_id)
        self._atomic_write(path, case.model_dump_json(indent=2) + "\n")
        return path

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
