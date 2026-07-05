"""Render case interview scripts to audio via the Magpie TTS NIM. Not run by pytest.

Usage: uv run python scripts/render_audio.py [case_id ...] [--force]

Requires a reachable TTS NIM (PERIOP_TTS_BASE_URL, default http://localhost:9001
— see configs/selfhosted.env). Resumable: existing renditions are skipped
unless --force. Outputs, per case:

    data/cases/<id>/audio/<script>.wav            # concatenated dialogue
    data/cases/<id>/audio/<script>.segments.json  # gold timing manifest
"""

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from periop.tools.tts import MagpieTts, render_dialogue

CASES_DIR = Path("data/cases")

# script file -> how to obtain dialogue turns from its JSON
SCRIPTS = {
    "preop-interview": lambda d: d["turns"],
    "postop-interview": lambda d: d["turns"],
    "intraop-notes": lambda d: [
        {"speaker": "PROVIDER", "text": n["text"]} for n in d["notes"]
    ],
}


def render_case(case_dir: Path, tts: MagpieTts, force: bool) -> None:
    audio_dir = case_dir / "audio"
    for name, get_turns in SCRIPTS.items():
        script_path = case_dir / "scripts" / f"{name}.json"
        if not script_path.exists():
            continue
        wav_path = audio_dir / f"{name}.wav"
        manifest_path = audio_dir / f"{name}.segments.json"
        if wav_path.exists() and manifest_path.exists() and not force:
            print(f"  {name}: exists, skipping")
            continue
        turns = get_turns(json.loads(script_path.read_text()))
        segments = render_dialogue(turns, tts, wav_path)
        manifest_path.write_text(json.dumps({"segments": segments}, indent=2))
        print(f"  {name}: {len(segments)} segments -> {wav_path}")


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("case_ids", nargs="*", help="default: every case in data/cases")
    parser.add_argument("--force", action="store_true", help="re-render existing audio")
    args = parser.parse_args()

    case_dirs = (
        [CASES_DIR / cid for cid in args.case_ids]
        if args.case_ids
        else sorted(p for p in CASES_DIR.iterdir() if (p / "scripts").is_dir())
    )
    tts = MagpieTts()
    print(f"TTS endpoint: {tts.base_url}")
    for case_dir in case_dirs:
        if not (case_dir / "scripts").is_dir():
            sys.exit(f"no scripts directory in {case_dir}")
        print(f"{case_dir.name}:")
        render_case(case_dir, tts, force=args.force)


if __name__ == "__main__":
    main()
