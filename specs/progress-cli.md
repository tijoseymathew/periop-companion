# Build progress — workflow CLI

Resumable checklist for the provider-workflow CLI on the `cli` branch: a
terminal companion to the v2 write API ([specs/v2.md](v2.md)) that
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

- [x] `periop create <label> --provider` — prints the new case id (slug
      uniqueness is the API's); `--provider` defaults from `PERIOP_PROVIDER`
- [x] `periop add-document <case> <doc-type> [file]` — file upload, `--text`,
      or stdin paste; GapAnalyst runs as a background generation once op plan +
      ≥1 record exist (v2-speed §3.2), and the CLI names the next step
      (`periop questions <case>`, which reports progress until the questions land)
- [x] `periop questions <case>` — indexed question list with review state
- [x] `periop approve-questions <case> --provider [--dismiss N]` — approves the
      generated questions, passing the pre-op gate; dismissals kept, never
      deleted (v2 §4.1)

## C4 — Stage commands

- [x] `periop add-audio <case> <kind> <file> [--confirm]` — wav upload,
      normalized server-side; intra-op kind appends memos; interview
      replacement requires `--confirm` (API 409 otherwise)
- [x] `periop run <case> <stage> --provider` — streams the ui.md §7 SSE events
      as progress lines; the run executes inside the shared NAT `Runner`,
      pinned by the nat_bridge WORKFLOW_START/END log bracket
- [x] `periop signoff / reopen / ack-handoff` — three-provider walk to an
      acknowledged handoff covered end-to-end

## C5 — Conformance + docs

- [x] CLI lifecycle-conformance test: a full three-provider CLI walk of a
      synthetic bundle reproduces the batch pipeline's ledger (v2 §7, CLI
      edition) — passed unmodified on first run, which is the point: the CLI
      layer adds no behavior to fork
- [x] README: quickstart line + "Terminal workflow (CLI)" section

## C6 — Agent skill

- [x] `.agents/skills/periop-provider-workflow/SKILL.md` (NVIDIA/NemoClaw
      style: frontmatter with trigger keywords + Apache-2.0, prerequisites,
      numbered steps, common mistakes) teaching a coding agent to drive the
      workflow CLI end-to-end — drop-in ready for a NemoClaw
      `.agents/skills/` directory
