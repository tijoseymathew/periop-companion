"""Live ASR eval against the Parakeet NIM: KER A/B + diarization accuracy.

Usage: uv run python scripts/eval_asr.py [case_id ...]

Not run by pytest. Needs TTS-rendered audio (scripts/render_audio.py) and a
reachable Parakeet NIM (PERIOP_ASR_GRPC_URL, default localhost:50051 — see
configs/selfhosted.env). Per case:

- intraop-notes: transcribe with and without anesthesia-lexicon word boosting
  → clinical-term KER delta (spec §6 A/B)
- pre/post-op interviews: diarized transcription → time-weighted speaker
  attribution accuracy vs the TTS gold timing manifest

Writes evals/asr_report.json.
"""

import json
from pathlib import Path

from dotenv import load_dotenv

from periop.agents.lexicon import ANESTHESIA_LEXICON
from periop.evals.metrics import keyword_error_rate, speaker_attribution_accuracy
from periop.tools.asr import ParakeetAsr, asr_grpc_url_from_env

CASES_DIR = Path("data/cases")
REPORT_PATH = Path("evals/asr_report.json")


def gold_text(case_dir: Path, name: str) -> str:
    data = json.loads((case_dir / "scripts" / f"{name}.json").read_text())
    parts = data["notes"] if name == "intraop-notes" else data["turns"]
    return " ".join(p["text"] for p in parts)


def eval_case(case_dir: Path) -> dict:
    audio = case_dir / "audio"
    result: dict = {"case_id": case_dir.name}

    # --- intra-op voice notes: word-boosting A/B on the lexicon-dense audio
    wav = audio / "intraop-notes.wav"
    if wav.exists():
        reference = gold_text(case_dir, "intraop-notes")
        ab = {}
        for label, boost in (("boosted", ANESTHESIA_LEXICON), ("unboosted", None)):
            asr = ParakeetAsr(boosted_words=boost)
            source = asr.transcribe(wav, "audio:intraop-notes", diarize=False)
            hypothesis = " ".join(s.text for s in source.segments)
            ab[label] = {
                "ker": round(keyword_error_rate(hypothesis, reference, ANESTHESIA_LEXICON), 4),
                "words": len(hypothesis.split()),
            }
        result["intraop_ker"] = ab

    # --- interviews: diarization quality vs the TTS timing manifest
    for name in ("preop-interview", "postop-interview"):
        wav = audio / f"{name}.wav"
        manifest = audio / f"{name}.segments.json"
        if not (wav.exists() and manifest.exists()):
            continue
        source = ParakeetAsr().transcribe(wav, f"audio:{name}", diarize=True)
        gold_segments = json.loads(manifest.read_text())["segments"]
        result[name] = {
            "speaker_attribution_accuracy": round(
                speaker_attribution_accuracy(source.segments, gold_segments), 4
            ),
            "asr_segments": len(source.segments),
            "gold_segments": len(gold_segments),
            "ker": round(
                keyword_error_rate(
                    " ".join(s.text for s in source.segments),
                    gold_text(case_dir, name),
                    ANESTHESIA_LEXICON,
                ),
                4,
            ),
        }
    return result


def main() -> None:
    load_dotenv()
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("case_ids", nargs="*")
    args = parser.parse_args()
    case_dirs = (
        [CASES_DIR / cid for cid in args.case_ids]
        if args.case_ids
        else sorted(p for p in CASES_DIR.iterdir() if (p / "audio").is_dir())
    )
    print(f"ASR endpoint: {asr_grpc_url_from_env()}")
    results = []
    for case_dir in case_dirs:
        print(f"{case_dir.name}…")
        result = eval_case(case_dir)
        results.append(result)
        print(json.dumps(result, indent=2))

    REPORT_PATH.parent.mkdir(exist_ok=True)
    REPORT_PATH.write_text(json.dumps({"cases": results}, indent=2))
    print(f"report -> {REPORT_PATH}")


if __name__ == "__main__":
    main()
