# Build progress — workflow CLI

Resumable checklist for the provider-workflow CLI on the `cli` branch: a
terminal companion to the v2 write API ([specs/v2.md](../specs/v2.md)) that
drives the **same** FastAPI app over HTTP — against a running server
(`--api-url` / `PERIOP_API_URL`) or auto-hosted on an ephemeral localhost
port for the life of the command. Same conventions as
[progress-v2.md](progress-v2.md): every item lands as one or more commits with
tests written first (red) then implementation (green); if a session is
interrupted, resume from the first unchecked item.

Design rule: the CLI owns no workflow logic. Stage gates, error copy, demo-case
immutability, and the NAT session (v2-nat §3.2 — auto-hosted stage runs execute
inside the same NAT `Runner` the server uses) are all the API's; the CLI is a
re-plumbing, not a fork, pinned by a CLI lifecycle-conformance test mirroring
v2 §7's.

- Python: `uv run pytest` · CLI: `uv run periop --help`

## C1 — Client transport

- [x] `periop.cli.client.serve_app` — uvicorn on `127.0.0.1:0` in a background
      thread, app lifespan entered (NAT session live), clean shutdown
- [x] `open_client(api_url)` — remote when a URL is given, else self-hosted
      `create_app()` from the `PERIOP_*` env; no read timeout (stage runs block
      for minutes on Super 49B)
- [x] `check()` surfaces the API's structured next-action `detail` as `ApiError`;
      `iter_sse()` parses the ui.md §7 event vocabulary
- [x] `httpx` promoted from dev to runtime dependency

## C2 — Read commands

- [x] `periop providers` — the roster, one line per provider
- [x] `periop list` — the worklist: case id, label, headline stage + status in
      words (first non-signed-off stage, v2 §4; demo cases marked read-only),
      claim counts with flagged counts
- [x] `periop show <case>` — workflow status per stage, open questions with
      review state, artifacts rendered with claim-level provenance (reuses
      `periop.cli.render`)
- [x] `periop` console script + `python -m periop.cli` entry point

## C3 — Intake commands

- [ ] `periop create <label> --provider` — prints the new case id
- [ ] `periop add-document <case> <doc-type> [file]` — file, `--text`, or stdin;
      GapAnalyst auto-runs server-side once op plan + ≥1 record exist
- [ ] `periop approve-questions <case> --provider [--dismiss N]` — approves the
      generated questions, passing the pre-op gate; dismissals kept

## C4 — Stage commands

- [ ] `periop add-audio <case> <kind> <file> [--confirm]` — wav upload,
      normalized server-side; intra-op kind appends memos
- [ ] `periop run <case> <stage> --provider` — streams SSE progress as
      human-readable lines; auto-hosted runs assert the NAT bracket
- [ ] `periop signoff / reopen / ack-handoff`

## C5 — Conformance + docs

- [ ] CLI lifecycle-conformance test: a full three-provider CLI walk of a
      synthetic bundle reproduces the batch pipeline's ledger (v2 §7, CLI edition)
- [ ] README: CLI section under the provider workflow

## C6 — Agent skill

- [ ] `.agents/skills/` SKILL.md (NVIDIA/NemoClaw style) teaching a coding agent
      to drive the workflow CLI end-to-end
