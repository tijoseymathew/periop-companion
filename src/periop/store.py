"""Local JSON case store — one human-readable file per case."""

from pathlib import Path

from periop.schemas import Case


class CaseStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)

    def _path(self, case_id: str) -> Path:
        return self.root / f"{case_id}.json"

    def save(self, case: Case) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        path = self._path(case.case_id)
        path.write_text(case.model_dump_json(indent=2) + "\n")
        return path

    def load(self, case_id: str) -> Case:
        path = self._path(case_id)
        if not path.exists():
            raise KeyError(f"no such case: {case_id}")
        return Case.model_validate_json(path.read_text())

    def list_case_ids(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return sorted(p.stem for p in self.root.glob("*.json"))
