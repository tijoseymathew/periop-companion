# PeriOp Companion

An agentic peri-operative documentation assistant for anesthesia providers.
Every claim in every generated note carries provenance to a source record chunk
or a timestamped, diarized audio segment.

**Status: under construction.** See [specs/v1.md](specs/v1.md) for the full
specification and [docs/progress.md](docs/progress.md) for build progress.

All data is synthetic — no PHI. Documentation-support tool only; not a medical
device and not a clinical decision-making system.

## Quickstart

```bash
uv sync          # Python 3.12 environment
uv run pytest    # run the test suite
```

Live NIM access (optional, for smoke tests) requires `NGC_API_KEY` in `.env`.
