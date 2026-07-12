#!/usr/bin/env bash
# One-time Dev Container / Codespaces setup: system deps, Python env, SPA build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing ffmpeg (audio normalization)"
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends ffmpeg

echo "==> Installing uv"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

echo "==> Syncing Python environment (uv sync)"
uv sync

echo "==> Building the review UI (ui/dist)"
( cd ui && npm ci && npm run build )

# seed a local .env so live mode is one edit away (no key => stub demo)
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Wrote .env from .env.example — add your NGC_API_KEY to go live."
fi

echo "==> Setup complete. The app starts automatically on attach."
echo "    Manual start: bash .devcontainer/start.sh"
