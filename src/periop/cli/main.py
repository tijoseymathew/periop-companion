"""``periop`` — terminal companion to the provider workflow (spec v2).

Every command is an HTTP call against the same API the browser uses (see
``periop.cli.client``): a running server via ``--api-url``/``PERIOP_API_URL``,
or an auto-hosted app when neither is set. The CLI renders and forwards; it
owns no workflow logic — gates, error copy, and demo-case immutability are
the API's, so the two front ends can never disagree.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx

from periop.cli.client import ApiError, check, iter_sse, open_client
from periop.cli.render import render_artifact
from periop.schemas import Case, StageName

STAGE_LABEL = {"preop": "Pre-op", "intraop": "Intra-op", "postop": "Post-op"}


def _words(status: str) -> str:
    return status.replace("_", " ")


def headline(workflow: dict | None) -> str:
    """A case's headline is its first non-signed-off stage (v2 §4)."""
    if workflow is None:
        return "demo — read-only"
    for stage in StageName:
        state = workflow["stages"][stage.value]
        if state["status"] != "signed_off":
            return f"{STAGE_LABEL[stage.value]} — {_words(state['status'])}"
    return "closed"


def cmd_providers(client: httpx.Client, args) -> int:
    for p in check(client.get("/api/providers")).json():
        print(f"{p['provider_id']:<12} {p['name']} ({p['role']})")
    return 0


def cmd_list(client: httpx.Client, args) -> int:
    for row in check(client.get("/api/cases")).json():
        claims = row["claim_count"]
        flagged = row["status_counts"].get("unsupported", 0) + row[
            "status_counts"
        ].get("conflicting", 0)
        counts = f"{claims} claim{'s' if claims != 1 else ''}"
        if flagged:
            counts += f", {flagged} flagged"
        label = row.get("label") or ""
        print(f"{row['case_id']:<24} {headline(row.get('workflow')):<28} {counts:<22} {label}")
    return 0


def _print_stages(case: Case) -> None:
    for name, state in case.workflow.stages.items():
        line = f"{STAGE_LABEL[name.value]:<10} {_words(state.status.value)}"
        if state.signed_off_by:
            line += f" — signed off by {state.signed_off_by}"
        elif state.performed_by:
            line += f" — performed by {state.performed_by}"
        print(line)
    postop = case.workflow.stages[StageName.POSTOP]
    if postop.handoff_acknowledged_by:
        print(f"Handoff acknowledged by {postop.handoff_acknowledged_by}")


def cmd_show(client: httpx.Client, args) -> int:
    case = Case.model_validate(check(client.get(f"/api/cases/{args.case_id}")).json())
    print(f"{case.label or case.case_id} ({case.case_id})")
    if case.is_demo:
        print("demo — read-only")
    else:
        _print_stages(case)
    if case.open_questions:
        print("\nQuestions:")
        for q in case.open_questions:
            review = q.review.value if q.review else "unreviewed"
            why = f" (why: {q.reason})" if q.reason else ""
            print(f"  [{review}] {q.effective_text}{why}")
    for artifact in case.artifacts:
        print("\n" + render_artifact(case, artifact))
    return 0


def cmd_create(client: httpx.Client, args) -> int:
    case = check(
        client.post(
            "/api/cases", json={"label": args.label, "provider_id": args.provider}
        )
    ).json()
    print(case["case_id"])
    return 0


def _questions_ready(case: Case) -> bool:
    return bool(
        case.open_questions
        and case.workflow is not None
        and case.workflow.stages[StageName.PREOP].questions_approved_at is None
    )


def cmd_add_document(client: httpx.Client, args) -> int:
    url = f"/api/cases/{args.case_id}/sources/document"
    if args.path:
        path = Path(args.path)
        data = {"doc_type": args.doc_type}
        if args.provider:
            data["provider_id"] = args.provider
        resp = client.post(url, files={"file": (path.name, path.read_bytes())}, data=data)
    else:
        # paste: --text, or stdin so records pipe straight in
        text = args.text if args.text is not None else sys.stdin.read()
        resp = client.post(
            url,
            json={"doc_type": args.doc_type, "text": text, "provider_id": args.provider},
        )
    case = Case.model_validate(check(resp).json())
    source = case.get_source(f"doc:{args.doc_type}")
    print(f"doc:{args.doc_type} added ({len(source.chunks)} chunks)")
    if _questions_ready(case):
        n = len(case.open_questions)
        print(
            f"{n} question{'s' if n != 1 else ''} ready for review — "
            f"run: periop questions {case.case_id}"
        )
    return 0


def cmd_questions(client: httpx.Client, args) -> int:
    case = Case.model_validate(check(client.get(f"/api/cases/{args.case_id}")).json())
    for i, q in enumerate(case.open_questions):
        review = q.review.value if q.review else "unreviewed"
        why = f" (why: {q.reason})" if q.reason else ""
        print(f"{i:>3} [{review}] {q.effective_text}{why}")
    return 0


def cmd_approve_questions(client: httpx.Client, args) -> int:
    resp = check(client.get(f"/api/cases/{args.case_id}"))
    questions = resp.json()["open_questions"]
    for i, q in enumerate(questions):
        q["review"] = "dismissed" if i in args.dismiss else "approved"
    check(
        client.put(
            f"/api/cases/{args.case_id}/questions",
            json={"questions": questions, "provider_id": args.provider},
        )
    )
    approved = len(questions) - len(args.dismiss)
    print(
        f"{approved} approved, {len(args.dismiss)} dismissed — "
        "pre-op question gate passed"
    )
    return 0


def cmd_add_audio(client: httpx.Client, args) -> int:
    path = Path(args.path)
    data = {"kind": args.kind}
    if args.provider:
        data["provider_id"] = args.provider
    check(
        client.post(
            f"/api/cases/{args.case_id}/sources/audio",
            params={"confirm": "true"} if args.confirm else None,
            files={"file": (path.name, path.read_bytes())},
            data=data,
        )
    )
    print(f"{args.kind} recorded for {args.case_id}")
    return 0


def cmd_run(client: httpx.Client, args) -> int:
    """Stream the stage run's SSE progress as lines, not a spinner (v2 §2)."""
    failed = None
    with client.stream(
        "POST",
        f"/api/cases/{args.case_id}/stages/{args.stage}/run",
        json={"provider_id": args.provider},
    ) as resp:
        if resp.status_code != 200:
            resp.read()
            check(resp)
        for event, data in iter_sse(resp.iter_lines()):
            if event == "status":
                print(data.get("message", ""))
            elif event == "stage_start":
                print(f"generating the {args.stage} output …")
            elif event == "agent_start":
                print(f"  {data.get('agent', '?')} …")
            elif event == "agent_end":
                print(f"  {data.get('agent', '?')}: {data.get('summary', 'done')}")
            elif event == "artifact_complete":
                print(f"  ✓ {data.get('artifact_id')} ({data.get('claims', '?')} claims)")
            elif event == "complete":
                print(
                    f"{args.stage} generated — review: periop show {args.case_id}, "
                    f"then: periop signoff {args.case_id} {args.stage}"
                )
            elif event == "error":
                failed = data.get("message", "stage run failed")
    if failed:
        print(f"error: {failed}", file=sys.stderr)
        return 1
    return 0


def cmd_signoff(client: httpx.Client, args) -> int:
    check(
        client.post(
            f"/api/cases/{args.case_id}/stages/{args.stage}/signoff",
            json={"provider_id": args.provider},
        )
    )
    print(f"{args.stage} signed off by {args.provider}")
    return 0


def cmd_reopen(client: httpx.Client, args) -> int:
    check(
        client.post(
            f"/api/cases/{args.case_id}/stages/{args.stage}/reopen",
            json={"provider_id": args.provider},
        )
    )
    print(f"{args.stage} reopened for review (prior artifacts kept)")
    return 0


def cmd_ack_handoff(client: httpx.Client, args) -> int:
    check(
        client.post(
            f"/api/cases/{args.case_id}/handoff/ack",
            json={"provider_id": args.provider},
        )
    )
    print(f"handoff acknowledged by {args.provider}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="periop",
        description="PeriOp Companion provider workflow, from the terminal.",
    )
    parser.add_argument(
        "--api-url",
        default=os.environ.get("PERIOP_API_URL") or None,
        help="running API server to drive; omit to auto-host the app "
        "(env: PERIOP_API_URL, dirs: PERIOP_CASE_DIR / PERIOP_OUT_DIR / PERIOP_PROVIDERS)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("providers", help="list the provider roster")
    p.set_defaults(func=cmd_providers)

    p = sub.add_parser("list", help="the worklist: every case with its headline status")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("show", help="one case: stages, questions, claim ledger with provenance")
    p.add_argument("case_id")
    p.set_defaults(func=cmd_show)

    def provider_arg(p: argparse.ArgumentParser) -> None:
        p.add_argument(
            "--provider",
            default=os.environ.get("PERIOP_PROVIDER") or None,
            required="PERIOP_PROVIDER" not in os.environ,
            help="acting provider id, stamped as attribution (env: PERIOP_PROVIDER)",
        )

    p = sub.add_parser("create", help="start a case (label + acting provider)")
    p.add_argument("label")
    provider_arg(p)
    p.set_defaults(func=cmd_create)

    p = sub.add_parser(
        "add-document",
        help="add a prior record or the op plan: file (.txt/.md/.pdf), --text, or stdin",
    )
    p.add_argument("case_id")
    p.add_argument(
        "doc_type",
        choices=("gp-summary", "med-list", "prior-anesthetic-record", "op-plan", "other"),
    )
    p.add_argument("path", nargs="?", help="file to upload; omit to paste --text or stdin")
    p.add_argument("--text", help="paste the document text inline")
    provider_arg(p)
    p.set_defaults(func=cmd_add_document)

    p = sub.add_parser("questions", help="the GapAnalyst's clarification questions")
    p.add_argument("case_id")
    p.set_defaults(func=cmd_questions)

    p = sub.add_parser(
        "approve-questions",
        help="approve the question list (dismissals kept, never deleted)",
    )
    p.add_argument("case_id")
    p.add_argument(
        "--dismiss", type=int, action="append", default=[], metavar="N",
        help="dismiss the question at this index (repeatable)",
    )
    provider_arg(p)
    p.set_defaults(func=cmd_approve_questions)

    p = sub.add_parser(
        "add-audio",
        help="upload a stage's audio (wav works everywhere; other formats need "
        "ffmpeg on the server)",
    )
    p.add_argument("case_id")
    p.add_argument("kind", choices=("preop-interview", "intraop-notes", "postop-interview"))
    p.add_argument("path")
    p.add_argument(
        "--confirm", action="store_true",
        help="replace an already-recorded interview (intra-op memos always append)",
    )
    provider_arg(p)
    p.set_defaults(func=cmd_add_audio)

    p = sub.add_parser(
        "run",
        help="generate a stage's output, streaming progress (runs inside the "
        "NAT session — minutes on live NIMs)",
    )
    p.add_argument("case_id")
    p.add_argument("stage", choices=("preop", "intraop", "postop"))
    provider_arg(p)
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("signoff", help="assert 'I have reviewed this stage's output'")
    p.add_argument("case_id")
    p.add_argument("stage", choices=("preop", "intraop", "postop"))
    provider_arg(p)
    p.set_defaults(func=cmd_signoff)

    p = sub.add_parser("reopen", help="reopen a signed-off stage (recorded; artifacts kept)")
    p.add_argument("case_id")
    p.add_argument("stage", choices=("preop", "intraop", "postop"))
    provider_arg(p)
    p.set_defaults(func=cmd_reopen)

    p = sub.add_parser("ack-handoff", help="acknowledge receipt of the PACU handoff")
    p.add_argument("case_id")
    provider_arg(p)
    p.set_defaults(func=cmd_ack_handoff)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        with open_client(args.api_url) as client:
            return args.func(client, args)
    except ApiError as e:
        print(f"error: {e.detail}", file=sys.stderr)
        return 1
    except httpx.ConnectError as e:
        print(f"error: cannot reach the API at {args.api_url}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
