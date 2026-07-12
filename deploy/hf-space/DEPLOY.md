# Deploy to a Hugging Face Docker Space

A **Docker Space** gives PeriOp Companion a public live URL
(`https://huggingface.co/spaces/<you>/periop-companion`). Hugging Face builds
the repo-root `Dockerfile` and exposes port **7860** (its Docker-Space default,
which our image already listens on).

The public Space runs the **keyless demo** by default. Adding your own
`NGC_API_KEY` secret upgrades it to live generation on hosted NVIDIA NIMs — no
GPU, no key baked into any image. See the mode logic in
[`docker/entrypoint.sh`](../../docker/entrypoint.sh).

---

## Fastest path — duplicate an existing Space

If a PeriOp Companion Space already exists, open it and click
**⋮ → Duplicate this Space**. In your copy, go to **Settings → Variables and
secrets → New secret** and add `NGC_API_KEY` (see *Getting a NIM key* below),
then **Restart**. Done.

## From this repo — create a fresh Space

You need a Hugging Face account and the CLI: `pip install -U huggingface_hub`,
then `hf auth login` (older CLIs: `huggingface-cli login`).

1. **Create the Space** (Docker SDK):

   ```bash
   hf repo create periop-companion --repo-type space --space_sdk docker
   ```

   …or click **New → Space**, pick **Docker → Blank**, on the website.

2. **Push the app to the Space.** From a clone of this repo:

   ```bash
   # add the Space as a second remote (HTTPS; use your username)
   git remote add space https://huggingface.co/spaces/<your-username>/periop-companion

   # the Space's README must carry the HF frontmatter — use the prepared one
   cp deploy/hf-space/README.md README.md      # on a throwaway branch, see note

   git add README.md && git commit -m "HF Space metadata"
   git push space HEAD:main
   ```

   > **Keeping the GitHub README intact:** the frontmatter README is only needed
   > on the *Space's* `main`. Do this on a dedicated `hf-space` branch you push
   > to the Space (`git push space hf-space:main`) so your GitHub `main` keeps
   > the clean README. The Space just needs the root `Dockerfile` (already
   > present) plus this README for its title/emoji.

3. **Watch it build.** The Space page shows the Docker build log; first build
   installs Python + Node deps and builds the SPA (a few minutes). When it
   flips to **Running**, open the Space URL — the keyless demo is live.

4. **Go live (optional).** In **Settings → Variables and secrets**, add a
   secret named `NGC_API_KEY`. **Restart** the Space; the entrypoint detects the
   key and switches to live NIM generation.

---

## Getting a NIM key

1. Sign in at <https://build.nvidia.com> (free; backs onto
   <https://developer.nvidia.com/nim>).
2. Pick any model (e.g. *llama-3.3-nemotron-super-49b*) and click
   **Get API Key** (top-right). The key looks like `nvapi-…`.
3. The same key authorizes the reasoning and fast tiers this app uses. It is
   **yours** — it stays in your Space's secrets, never in the image or git.

## Notes & limits

- **Storage is ephemeral.** Cases created in a running Space live in the
  container's filesystem and reset on rebuild/restart. That's fine for a demo;
  attach a persistent volume if you need durability.
- **Free CPU hardware is enough** — the default hosted-NIM path needs no GPU.
- **Speech (ASR/TTS) needs self-hosted NIMs.** With a hosted key, live LLM
  generation (gap analysis, note writing) works; the diarized-audio pipeline
  runs against local speech NIMs — see [`docs/selfhosted.md`](../../docs/selfhosted.md).
  The keyless demo exercises the whole UI, audio provenance included, from
  committed cases.
