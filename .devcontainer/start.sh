#!/usr/bin/env bash
# Start the PeriOp Companion server for Dev Container / Codespaces.
# Idempotent: if something already answers on the port, just report and exit
# (so re-attaching doesn't fail on a port-in-use error).
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.local/bin:$PATH"

# load .env if present (never overrides real env vars)
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

export PERIOP_API_HOST="${PERIOP_API_HOST:-0.0.0.0}"
export PERIOP_API_PORT="${PERIOP_API_PORT:-8000}"

# already running? bail out cleanly.
if curl -sf "http://localhost:${PERIOP_API_PORT}/api/cases" >/dev/null 2>&1; then
  echo "[periop] Already serving on port ${PERIOP_API_PORT} — open the forwarded port."
  exit 0
fi

# no key => keyless stub demo (auto), key => live generation.
if [ -z "${PERIOP_STUB_RUNNER:-}" ] && [ -z "${NGC_API_KEY:-}${NVIDIA_API_KEY:-}" ]; then
  export PERIOP_STUB_RUNNER=1
  echo "[periop] No NIM API key -> STUB demo mode. Add NGC_API_KEY to .env for live generation."
else
  [ -n "${NGC_API_KEY:-}${NVIDIA_API_KEY:-}" ] && echo "[periop] NIM API key detected -> LIVE mode."
fi

echo "[periop] Starting on http://${PERIOP_API_HOST}:${PERIOP_API_PORT} (open the forwarded 'PeriOp Companion' port)"
exec uv run python -m periop.api
