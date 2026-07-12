#!/bin/sh
# Boot the PeriOp Companion server, choosing the runtime mode from the
# environment. POSIX sh — runs on the slim python image (and Hugging Face).
set -eu

# --- pick the mode ---------------------------------------------------------
# Honor an explicit PERIOP_STUB_RUNNER (set to 1 to force the demo, 0 to force
# live). Otherwise: live when a NIM API key is present, keyless stub demo when
# it is not — so a public Space is explorable with no secrets, and adding an
# NGC_API_KEY secret upgrades it to live generation on the next restart.
if [ -z "${PERIOP_STUB_RUNNER:-}" ]; then
  if [ -n "${NGC_API_KEY:-}${NVIDIA_API_KEY:-}" ]; then
    echo "[periop] NIM API key detected -> LIVE mode (hosted NIMs on build.nvidia.com; no GPU)."
  else
    export PERIOP_STUB_RUNNER=1
    echo "[periop] No NIM API key -> STUB demo mode (no network; synthetic cases; instant stage runs)."
    echo "[periop]   Set NGC_API_KEY to enable live generation. See docs/deploy.md."
  fi
fi

# --- bind address / port ---------------------------------------------------
# $PORT (some hosts inject it) wins, then PERIOP_API_PORT, then the 7860 default.
export PERIOP_API_HOST="${PERIOP_API_HOST:-0.0.0.0}"
export PERIOP_API_PORT="${PORT:-${PERIOP_API_PORT:-7860}}"

echo "[periop] Serving API + review UI on http://${PERIOP_API_HOST}:${PERIOP_API_PORT}"
exec python -m periop.api
