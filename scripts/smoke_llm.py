"""Live smoke test against build.nvidia.com NIMs. Not run by pytest.

Usage: uv run python scripts/smoke_llm.py
Requires NGC_API_KEY in .env or the environment.
"""

from dotenv import load_dotenv
from pydantic import BaseModel

from periop.nim import FAST_MODEL, REASONING_MODEL, fast_chat, reasoning_chat


class DoseExtraction(BaseModel):
    drug: str
    dose: float
    units: str


def main() -> None:
    load_dotenv()

    print(f"[1/2] reasoning model ({REASONING_MODEL}) — plain completion")
    reply = reasoning_chat().complete(
        system="You are a concise anesthesia documentation assistant.",
        user="In one sentence: why does a PACU handoff need provenance?",
    )
    print(f"      → {reply}\n")

    print(f"[2/2] fast model ({FAST_MODEL}) — structured extraction")
    result = fast_chat().complete_structured(
        user="Extract the drug and dose: 'gave propofol one twenty milligrams at induction'",
        schema=DoseExtraction,
    )
    print(f"      → {result!r}\n")

    print("smoke test OK")


if __name__ == "__main__":
    main()
