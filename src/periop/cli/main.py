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

import httpx

from periop.cli.client import ApiError, check, open_client
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
