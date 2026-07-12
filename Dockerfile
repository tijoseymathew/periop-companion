# PeriOp Companion — single-image full app (FastAPI + built React SPA).
#
# Serves the API and the review UI from one process on port 7860, the default
# Hugging Face Spaces port. The same image runs a local `docker run`, a Dev
# Container / GitHub Codespace, or a Hugging Face Docker Space.
#
# Runtime mode is chosen at boot by docker/entrypoint.sh:
#   * NGC_API_KEY set  -> LIVE  (hosted NIMs on build.nvidia.com, no GPU)
#   * no key           -> STUB  (keyless demo: synthetic cases, instant runs)
#
# See docs/deploy.md for the full guide.

# ---- stage 1: build the React SPA into ui/dist ----------------------------
FROM node:20-bookworm-slim AS ui-build
WORKDIR /ui
# install deps against the lockfile first for layer caching
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
# then the sources and build (tsc --noEmit && vite build -> /ui/dist)
COPY ui/ ./
RUN npm run build

# ---- stage 2: python runtime ----------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

# ffmpeg normalizes uploaded/recorded audio to 16 kHz mono wav; without it the
# app still runs (PCM wav uploads pass through). git is handy for `uv`/tooling.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# uv: fast, reproducible installs from the committed uv.lock
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Hugging Face Spaces run the container as uid 1000 ("user") with a writable
# home; a non-root user is also good hygiene everywhere else.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/app/.venv/bin:/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PERIOP_API_HOST=0.0.0.0 \
    PERIOP_API_PORT=7860
WORKDIR /home/user/app

# dependency layer (cached until pyproject.toml / uv.lock change)
COPY --chown=user pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-install-project --no-dev

# the project itself (README is referenced by pyproject as the package readme)
COPY --chown=user src/ ./src/
COPY --chown=user README.md ./
RUN uv sync --frozen --no-dev

# runtime assets: NAT/workflow configs, synthetic case store, helper scripts,
# and the SPA built in stage 1
COPY --chown=user configs/ ./configs/
COPY --chown=user data/ ./data/
COPY --chown=user scripts/ ./scripts/
COPY --chown=user docker/entrypoint.sh ./docker/entrypoint.sh
COPY --chown=user --from=ui-build /ui/dist ./ui/dist

EXPOSE 7860
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
