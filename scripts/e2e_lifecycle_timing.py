"""End-to-end lifecycle timing against the write API (spec v2 §4–5). Not CI.

Point this at a generated-data case bundle (records/ + audio/, as produced by
scripts/generate_cases.py and scripts/render_audio.py) and it walks that case
through the entire provider workflow over HTTP — create → paste records →
GapAnalyst question prep → approve → upload interview/memo audio → run each
stage → sign off → acknowledge handoff — recording how long every step takes.

The point is granularity. Three clocks are captured:

  1. Per HTTP request: client-side wall time of every create/upload/signoff call.
  2. GapAnalyst prep: from the upload that triggers it to `complete`, by polling
     the case exactly as the intake screen does.
  3. Stage runs: every SSE frame (stage_start · agent_start · agent_end ·
     artifact_complete · complete) is timestamped as it arrives, so you get
     per-agent latency inside a stage, not just the stage total. This is the
     most granular signal — a Super-49B note-writer vs. its Nano verifier, the
     ASR leg vs. the LLM leg — and it is where the minutes actually go.

Audio is uploaded as the real wav (the fresh case has no gold `scripts/`, so
the stage run takes the Parakeet ASR path), so timings include the full
ASR + LLM cost of a live case, not the offline gold-transcript shortcut.

Usage:
    # boot a throwaway server (live NIMs from .env) in a scratch dir and walk:
    uv run python scripts/e2e_lifecycle_timing.py data/cases/sg-0006

    # or drive an already-running server, and save the raw timings:
    uv run python scripts/e2e_lifecycle_timing.py data/cases/sg-0006 \
        --base-url http://127.0.0.1:8000 --json-out /tmp/timing.json

    # re-render the waterfall from a saved report, no server needed:
    uv run python scripts/e2e_lifecycle_timing.py --chart-from /tmp/timing.json

A terminal waterfall prints at the end of every run (suppress with --no-chart):
each step, and each SSE frame within a stage run, drawn as a bar placed by its
real start offset with width proportional to duration — so the granular story
(which agent leg owns the minutes) reads at a glance.

Boots its own server by default; the case is created through the API under a
fresh id, so committed demo bundles are never mutated. On local hardware the
reasoning tier can take many minutes per stage — the SSE frames print live so
you can watch progress.
"""

from __future__ import annotations

import argparse
import json
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[1]

# ANSI colour per phase for the waterfall (SGR codes)
PHASE_ANSI = {"intake": "36", "preop": "32", "intraop": "33", "postop": "35"}

# generate_cases.py names, matching the API's DOC_TYPES slots; anything else
# folds into the single free-form "other" slot (append-only, so at most one)
KNOWN_DOC_TYPES = {"gp-summary", "med-list", "prior-anesthetic-record", "op-plan"}

# audio filename stem -> API kind, and the default provider that owns the stage
AUDIO_KINDS = {
    "preop-interview": ("preop", "preop"),
    "intraop-notes": ("intraop", "intraop"),
    "postop-interview": ("postop", "postop"),
}


def die(message: str) -> None:
    sys.exit(f"e2e_lifecycle_timing: {message}")


# --------------------------------------------------------------------------- #
# timing record
# --------------------------------------------------------------------------- #


@dataclass
class Step:
    phase: str
    name: str
    seconds: float
    status: int | None = None
    detail: str = ""
    # only set for stage runs: per-SSE-frame breakdown
    events: list[dict] = field(default_factory=list)
    # offset (s) of this step's start from the walk's t0, filled in on add()
    start: float = 0.0


class Recorder:
    """Ordered log of timed steps plus a running phase total."""

    def __init__(self) -> None:
        self.steps: list[Step] = []
        self.started_at = datetime.now(timezone.utc)
        self.mono0 = time.perf_counter()

    def add(self, step: Step) -> Step:
        # add() fires right as the step finishes, so its start is now-minus-dur
        step.start = (time.perf_counter() - self.mono0) - step.seconds
        self.steps.append(step)
        marker = f"[{step.status}]" if step.status is not None else "     "
        print(f"  {marker} {step.seconds:8.2f}s  {step.phase:<8} {step.name}"
              + (f"  ({step.detail})" if step.detail else ""))
        return step

    def report(self) -> dict:
        phases: dict[str, float] = {}
        for s in self.steps:
            phases[s.phase] = phases.get(s.phase, 0.0) + s.seconds
        return {
            "started_at": self.started_at.isoformat(),
            "total_seconds": round(sum(s.seconds for s in self.steps), 3),
            "phase_seconds": {k: round(v, 3) for k, v in phases.items()},
            "steps": [
                {
                    "phase": s.phase,
                    "name": s.name,
                    "start": round(s.start, 3),
                    "seconds": round(s.seconds, 3),
                    "status": s.status,
                    "detail": s.detail,
                    "events": s.events,
                }
                for s in self.steps
            ],
        }


class Client:
    """httpx wrapper that times every request into the recorder."""

    def __init__(self, base_url: str, rec: Recorder) -> None:
        # stage runs on live NIMs can take many minutes; no read timeout
        self._c = httpx.Client(base_url=base_url, timeout=httpx.Timeout(30.0, read=None))
        self.rec = rec

    def close(self) -> None:
        self._c.close()

    def request(self, phase: str, name: str, method: str, url: str, **kw) -> httpx.Response:
        t0 = time.perf_counter()
        resp = self._c.request(method, url, **kw)
        dt = time.perf_counter() - t0
        detail = "" if resp.is_success else _err(resp)
        self.rec.add(Step(phase, name, dt, resp.status_code, detail))
        return resp

    def run_stage_sse(self, phase: str, case_id: str, stage: str, provider: str) -> Step:
        """POST the stage run and time each SSE frame as it arrives."""
        events: list[dict] = []
        t0 = time.perf_counter()
        last = t0
        status = None
        with self._c.stream(
            "POST",
            f"/api/cases/{case_id}/stages/{stage}/run",
            json={"provider_id": provider},
        ) as resp:
            status = resp.status_code
            if not resp.is_success:
                resp.read()
                step = Step(phase, f"run {stage}", time.perf_counter() - t0,
                            status, _err(resp))
                return self.rec.add(step)
            ev_name = None
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    ev_name = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    now = time.perf_counter()
                    payload = line[len("data:"):].strip()
                    try:
                        data = json.loads(payload)
                    except json.JSONDecodeError:
                        data = {"raw": payload}
                    frame = {
                        "event": ev_name,
                        "t_offset": round(now - t0, 3),
                        "delta": round(now - last, 3),
                        "data": data,
                    }
                    events.append(frame)
                    print(f"      +{frame['t_offset']:7.2f}s  (Δ{frame['delta']:6.2f}s)"
                          f"  {ev_name}: {json.dumps(data)}")
                    last = now
                    ev_name = None
        total = time.perf_counter() - t0
        completed = any(e["event"] == "complete" for e in events)
        errored = next((e for e in events if e["event"] == "error"), None)
        detail = "completed" if completed else (
            f"error: {errored['data']}" if errored else "no completion frame")
        step = Step(phase, f"run {stage}", total, status, detail)
        step.events = events
        return self.rec.add(step)


def _err(resp: httpx.Response) -> str:
    try:
        return f"error: {resp.json().get('detail', resp.text)}"
    except Exception:
        return f"error: {resp.text[:200]}"


# --------------------------------------------------------------------------- #
# lifecycle walk
# --------------------------------------------------------------------------- #


def walk(client: Client, case_dir: Path, label: str, providers: dict[str, str]) -> str:
    rec = client.rec

    # --- intake: create + paste records ---------------------------------- #
    resp = client.request("intake", "create case", "POST", "/api/cases",
                          json={"label": label, "provider_id": providers["preop"]})
    if resp.status_code != 201:
        die(f"case creation failed: {_err(resp)}")
    case_id = resp.json()["case_id"]
    print(f"  → case_id = {case_id}")

    records = sorted((case_dir / "records").glob("*.md"))
    if not records:
        die(f"no records/*.md under {case_dir}")
    gap_triggered = False
    for md in records:
        doc_type = md.stem if md.stem in KNOWN_DOC_TYPES else "other"
        resp = client.request("intake", f"upload {md.name}", "POST",
                             f"/api/cases/{case_id}/sources/document",
                             json={"doc_type": doc_type, "text": md.read_text(),
                                   "provider_id": providers["preop"]})
        if resp.status_code == 201:
            state = resp.json()["workflow"]["stages"]["preop"].get("gap_analysis")
            gap_triggered = gap_triggered or state in ("pending", "running", "complete")

    # --- intake: GapAnalyst question prep (background) ------------------- #
    if not gap_triggered:
        # nothing auto-launched it (missing op-plan?) — ask explicitly
        client.request("intake", "launch question prep", "POST",
                       f"/api/cases/{case_id}/questions/analyze")
    questions = _time_gap_analysis(client, case_id)

    # --- intake: approve the question list ------------------------------ #
    reviewed = [{**q, "review": "approved"} for q in questions]
    client.request("intake", "approve questions", "PUT",
                   f"/api/cases/{case_id}/questions",
                   json={"questions": reviewed, "provider_id": providers["preop"]})

    # --- per-stage: upload audio, run (SSE), sign off ------------------- #
    for stem, (stage, prov_key) in AUDIO_KINDS.items():
        provider = providers[prov_key]
        # intraop memos accumulate (v2 §4.2 step 2): if the case bundle has
        # several per-session wavs (intraop-notes-1.wav, -2.wav, ...) upload
        # them one at a time, each waiting for its own transcription to
        # settle, instead of one continuous dictation — this is how the
        # anesthetist actually uses the recorder across a real case.
        sessions = sorted((case_dir / "audio").glob(f"{stem}-*.wav")) if stem == "intraop-notes" else []
        wavs = sessions if sessions else [case_dir / "audio" / f"{stem}.wav"]
        if not wavs[0].is_file():
            die(f"missing audio: {wavs[0]}")
        for i, wav in enumerate(wavs, start=1):
            label = f"upload {wav.name}" if len(wavs) > 1 else f"upload {stem}.wav"
            with wav.open("rb") as fh:
                client.request(stage, label, "POST",
                               f"/api/cases/{case_id}/sources/audio",
                               files={"file": (wav.name, fh, "audio/wav")},
                               data={"kind": stem, "provider_id": provider})
            # upload-time transcription runs in the background; the run gate
            # 409s until it settles, so wait (and time the ASR leg) here
            note = f"session {i}/{len(wavs)}" if len(wavs) > 1 else None
            _time_transcription(client, case_id, stage, note=note)
        step = client.run_stage_sse(stage, case_id, stage, provider)
        if "completed" not in step.detail:
            die(f"{stage} run did not complete: {step.detail}")
        client.request(stage, f"sign off {stage}", "POST",
                       f"/api/cases/{case_id}/stages/{stage}/signoff",
                       json={"provider_id": provider})

    # --- postop: acknowledge the handoff -------------------------------- #
    client.request("postop", "acknowledge handoff", "POST",
                   f"/api/cases/{case_id}/handoff/ack",
                   json={"provider_id": providers["postop"]})
    return case_id


def _time_transcription(client: Client, case_id: str, stage: str,
                        timeout_s: float = 1800.0, note: str | None = None) -> None:
    """Poll until the stage's upload-time transcription settles; time the wait.

    "failed" is not fatal — the stage run transcribes at generate time.
    """
    rec = client.rec
    t0 = time.perf_counter()
    polls = 0
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        polls += 1
        case = client._c.get(f"/api/cases/{case_id}").json()
        state = case["workflow"]["stages"][stage].get("transcription")
        if state in ("complete", "failed"):
            dt = time.perf_counter() - t0
            detail = f"{polls} polls" if state == "complete" else \
                f"failed ({case['workflow']['stages'][stage].get('transcription_error')}) — " \
                "the stage run transcribes instead"
            if note:
                detail = f"{note}, {detail}"
            rec.add(Step(stage, "upload-time transcription", dt, None, detail))
            return
        time.sleep(1.0)
    die("transcription never settled within timeout")


def _time_gap_analysis(client: Client, case_id: str, timeout_s: float = 1800.0) -> list[dict]:
    """Poll the case until pre-op gap_analysis settles; time the whole wait."""
    rec = client.rec
    t0 = time.perf_counter()
    polls = 0
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        polls += 1
        case = client._c.get(f"/api/cases/{case_id}").json()
        state = case["workflow"]["stages"]["preop"].get("gap_analysis")
        if state == "complete":
            dt = time.perf_counter() - t0
            qs = case.get("open_questions", [])
            rec.add(Step("intake", "GapAnalyst prep", dt, None,
                         f"{len(qs)} questions, {polls} polls"))
            return qs
        if state == "failed":
            err = case["workflow"]["stages"]["preop"].get("gap_analysis_error")
            die(f"gap analysis failed: {err}")
        time.sleep(1.0)
    die("gap analysis never completed within timeout")
    return []  # unreachable


# --------------------------------------------------------------------------- #
# server boot / summary
# --------------------------------------------------------------------------- #


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_healthy(base_url: str, timeout_s: float) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"{base_url}/api/health", timeout=2).status_code == 200:
                return
        except httpx.HTTPError:
            time.sleep(0.5)
    die(f"server never became healthy at {base_url}")


def print_summary(rec: Recorder) -> None:
    report = rec.report()
    print("\n" + "=" * 70)
    print("TIMING SUMMARY")
    print("=" * 70)
    for phase, secs in report["phase_seconds"].items():
        print(f"  {phase:<10} {secs:8.2f}s")
    print("-" * 70)
    print(f"  {'TOTAL':<10} {report['total_seconds']:8.2f}s")

    # slowest agent legs across all stage runs, most granular takeaway
    legs: list[tuple[float, str, str]] = []
    for s in rec.steps:
        for e in s.events:
            if e["event"] in ("agent_end", "artifact_complete"):
                d = e["data"]
                who = d.get("agent") or d.get("artifact_id") or e["event"]
                legs.append((e["delta"], s.name, str(who)))
    if legs:
        print("\n  slowest agent legs (Δ within a stage run):")
        for delta, stage, who in sorted(legs, reverse=True)[:8]:
            print(f"    {delta:8.2f}s  {stage:<14} {who}")


def _wrap(text: str, code: str, color: bool) -> str:
    return f"\033[{code}m{text}\033[0m" if color else text


def _bar(start: float, dur: float, total: float, track_w: int) -> tuple[int, int]:
    s = min(int(round(start / total * track_w)), track_w - 1)
    length = max(1, int(round(dur / total * track_w)))
    return s, min(length, track_w - s)


def render_waterfall(report: dict, expand: bool = True) -> None:
    """A terminal waterfall: every step (and every SSE frame within a stage
    run) as a bar placed by start offset, width proportional to duration."""
    steps = report.get("steps", [])
    if not steps:
        print("(no steps to chart)")
        return
    # tolerate reports written before per-step start offsets existed
    if "start" not in steps[0]:
        acc = 0.0
        for s in steps:
            s["start"] = acc
            acc += s["seconds"]

    total = max((s["start"] + s["seconds"]) for s in steps) or 1.0
    color = sys.stdout.isatty()
    cols = shutil.get_terminal_size((100, 24)).columns
    label_w = min(36, max(len(f"{s['phase']} {s['name']}") for s in steps) + 2)
    dur_w = 8
    track_w = max(20, cols - label_w - dur_w - 4)
    line_w = label_w + track_w + dur_w + 4

    print("\n" + "=" * min(cols, line_w))
    print(f"WATERFALL  (total {total:.2f}s · each cell ≈ {total / track_w * 1000:.0f} ms)")
    print("=" * min(cols, line_w))

    def row(phase: str, label: str, start: float, dur: float, indent: bool) -> None:
        text = ("  └ " if indent else "") + label
        if len(text) > label_w:
            text = text[: label_w - 1] + "…"
        s, length = _bar(start, dur, total, track_w)
        track = " " * s + "█" * length + " " * (track_w - s - length)
        code = PHASE_ANSI.get(phase, "37")
        if indent:
            code = "2;" + code  # dim the sub-legs
        print(f"{text.ljust(label_w)} │{_wrap(track, code, color)}│ {dur:6.2f}s")

    for s in steps:
        row(s["phase"], f"{s['phase']} {s['name']}", s["start"], s["seconds"], False)
        if not expand:
            continue
        for e in s.get("events", []):
            delta = e["delta"]
            off = s["start"] + e["t_offset"] - delta
            d = e.get("data", {})
            who = d.get("agent") or d.get("artifact_id") or ""
            row(s["phase"], f"{e['event']} {who}".strip(), off, delta, True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("case_dir", type=Path, nargs="?",
                   help="generated case bundle (records/ + audio/)")
    p.add_argument("--chart-from", type=Path,
                   help="render the waterfall from a saved --json-out report and exit")
    p.add_argument("--no-chart", action="store_true", help="skip the end-of-run waterfall")
    p.add_argument("--base-url", help="drive an already-running server instead of booting one")
    p.add_argument("--label", help="case label (default: e2e-<dirname>-<timestamp>)")
    p.add_argument("--preop-provider", default="p-lim")
    p.add_argument("--intraop-provider", default="p-tan")
    p.add_argument("--postop-provider", default="p-rahman")
    p.add_argument("--json-out", type=Path, help="write the full timing report as JSON")
    args = p.parse_args()

    # standalone: just draw the chart for a previously saved report
    if args.chart_from:
        render_waterfall(json.loads(args.chart_from.read_text()))
        return

    if args.case_dir is None:
        die("case_dir is required (or pass --chart-from to render a saved report)")
    case_dir = args.case_dir.resolve()
    if not (case_dir / "records").is_dir() or not (case_dir / "audio").is_dir():
        die(f"{case_dir} is not a generated case bundle (needs records/ and audio/)")
    label = args.label or f"e2e {case_dir.name} {datetime.now():%H%M%S}"
    providers = {
        "preop": args.preop_provider,
        "intraop": args.intraop_provider,
        "postop": args.postop_provider,
    }

    server = None
    scratch = None
    base_url = args.base_url
    if base_url is None:
        # throwaway server in a scratch store so committed bundles stay clean
        import os
        import tempfile

        scratch = Path(tempfile.mkdtemp(prefix="periop-e2e-"))
        port = _free_port()
        base_url = f"http://127.0.0.1:{port}"
        env = os.environ | {
            "PERIOP_CASE_DIR": str(scratch / "cases"),
            "PERIOP_OUT_DIR": str(scratch / "cases" / "_out"),
        }
        print(f"→ booting server on {base_url} (scratch: {scratch})")
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "periop.api.app:app",
             "--host", "127.0.0.1", "--port", str(port)],
            cwd=REPO, env=env,
        )
        _wait_healthy(base_url, 60)
    else:
        _wait_healthy(base_url, 10)

    rec = Recorder()
    client = Client(base_url, rec)
    print(f"→ walking {case_dir.name} through the lifecycle on {base_url}\n")
    try:
        case_id = walk(client, case_dir, label, providers)
        print(f"\n✓ case {case_id} completed the full lifecycle")
        print_summary(rec)
        if not args.no_chart:
            render_waterfall(rec.report())
        if args.json_out:
            report = rec.report()
            report["case_id"] = case_id
            report["case_dir"] = str(case_dir)
            args.json_out.write_text(json.dumps(report, indent=2) + "\n")
            print(f"\n→ full report written to {args.json_out}")
    finally:
        client.close()
        if server is not None:
            server.terminate()
            server.wait(timeout=15)


if __name__ == "__main__":
    main()
