"""Live NAT-trace smoke (spec v2-nat §5, W8d). Not pytest, never CI.

Proves the live API path is observed exactly like the batch path: boots the
real server (live NIMs, real LANGFUSE_* credentials), drives one pre-op stage
run through ``POST /api/cases/{id}/stages/preop/run``, then fetches the
resulting trace back out of Langfuse and writes it next to the batch
profiler artifacts.

Usage:
    uv run python scripts/smoke_live_trace.py [--out evals/traces/live-preop-trace.json]

Needs: live NIMs from .env, all three LANGFUSE_* vars, the sg-0001 bundle.
The run happens in a scratch directory — committed demo cases stay untouched.
The reasoning tier on local hardware can take 15+ minutes for the note; the
SSE stream is printed as it arrives so you can watch progress.
"""

import argparse
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[1]
BUNDLE = REPO / "data" / "cases" / "sg-0001"


def die(message: str) -> None:
    sys.exit(f"smoke_live_trace: {message}")


def wait_for(url: str, timeout_s: float) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except OSError:
            time.sleep(0.5)
    die(f"server never became healthy at {url}")


def langfuse_get(path: str) -> dict:
    base = os.environ["LANGFUSE_BASE_URL"].rstrip("/")
    auth = base64.b64encode(
        f"{os.environ['LANGFUSE_PUBLIC_KEY']}:{os.environ['LANGFUSE_SECRET_KEY']}".encode()
    ).decode()
    req = urllib.request.Request(
        f"{base}{path}", headers={"Authorization": f"Basic {auth}"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="evals/traces/live-preop-trace.json")
    args = parser.parse_args()

    load_dotenv(REPO / ".env")
    missing = [
        v
        for v in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL")
        if not os.environ.get(v)
    ]
    if missing:
        die(f"set {', '.join(missing)} (this smoke needs real credentials)")
    if not BUNDLE.is_dir():
        die(f"bundle not found: {BUNDLE}")

    started_at = datetime.now(timezone.utc)
    scratch = Path(tempfile.mkdtemp(prefix="periop-smoke-trace-"))
    case_root = scratch / "cases"
    out_dir = case_root / "_out"
    port = _free_port()
    env = os.environ | {
        "PERIOP_CASE_DIR": str(case_root),
        "PERIOP_OUT_DIR": str(out_dir),
    }
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "periop.api.app:app",
         "--host", "127.0.0.1", "--port", str(port)],
        cwd=REPO, env=env,
    )
    try:
        base = f"http://127.0.0.1:{port}"
        wait_for(f"{base}/api/health", 60)

        # create the case through the API, then stage the bundle inputs and
        # stamp the question gate directly (the same shortcut the lifecycle
        # tests use) so the run costs one note-writer + one verifier call
        resp = _post_json(f"{base}/api/cases", {"label": "Trace smoke", "provider_id": "p-lim"})
        case_id = resp["case_id"]
        case_dir = case_root / case_id
        shutil.copytree(BUNDLE / "records", case_dir / "records")
        shutil.copytree(BUNDLE / "scripts", case_dir / "scripts")

        from periop.schemas import OpenQuestion, QuestionReviewState, StageStatus
        from periop.store import CaseStore

        store = CaseStore(out_dir)
        case = store.load(case_id)
        case.open_questions = [
            OpenQuestion(
                question="Is the patient still taking aspirin?",
                reason="conflicting",
                review=QuestionReviewState.APPROVED,
            )
        ]
        state = case.workflow.stages["preop"]
        state.questions_approved_at = started_at
        state.status = StageStatus.READY_TO_GENERATE
        store.save(case)

        print(f"→ running preop stage for {case_id} (live NIMs — expect 15+ min)")
        run = urllib.request.Request(
            f"{base}/api/cases/{case_id}/stages/preop/run",
            data=json.dumps({"provider_id": "p-lim"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        completed = False
        with urllib.request.urlopen(run, timeout=7200) as stream:
            for raw in stream:
                line = raw.decode().rstrip()
                if line:
                    print(f"  {line}")
                completed = completed or line == "event: complete"
        if not completed:
            die("stage run did not complete — see SSE error above")

        saved = store.load(case_id)
        note = saved.get_artifact("note:pre-anesthesia-eval")
        assert note is not None and note.claims, "note missing after complete"
        print(f"✓ note generated with {len(note.claims)} claims")
    finally:
        server.terminate()
        server.wait(timeout=15)

    # give the batched OTLP exporter a moment, then find our trace (filter
    # client-side: the newest trace stamped after this smoke started)
    print("→ querying Langfuse for the trace")
    trace = None
    for _ in range(30):
        time.sleep(2)
        listing = langfuse_get("/api/public/traces?limit=10")
        fresh = [
            t
            for t in listing.get("data", [])
            if datetime.fromisoformat(t["timestamp"].replace("Z", "+00:00")) >= started_at
        ]
        if fresh:
            trace = fresh[0]
            break
    if trace is None:
        die("no trace arrived in Langfuse — check the exporter warning in server logs")

    # observations ingest asynchronously after the trace row appears — wait
    # for the count to stabilize so the saved artifact isn't a partial
    full, last_count = None, -1
    for _ in range(30):
        candidate = langfuse_get(f"/api/public/traces/{trace['id']}")
        count = len(candidate.get("observations", []))
        if count and count == last_count:
            full = candidate
            break
        last_count = count
        time.sleep(5)
    if full is None or not full.get("observations"):
        die("trace never gained observations — partial ingestion?")
    out_path = REPO / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(full, indent=2, default=str) + "\n")
    observations = full.get("observations", [])
    print(f"✓ trace {trace['id']} ({len(observations)} observations) → {args.out}")
    print(f"  view it at {os.environ['LANGFUSE_BASE_URL'].rstrip('/')}"
          f"/project/…/traces/{trace['id']}")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _post_json(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


if __name__ == "__main__":
    main()
