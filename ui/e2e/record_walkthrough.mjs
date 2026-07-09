/**
 * Screen-record the PeriOp Catch-Up UI end-to-end with Playwright. Not CI.
 *
 * The sibling of scripts/e2e_lifecycle_timing.py: where that walks the *write
 * API* over HTTP and times every leg, this drives the *browser* through the
 * same case and films it, so the review flow can be watched rather than read.
 * It boots the real FastAPI server against the hermetic e2e fixture store
 * (e2e/setup-fixture.mjs — the committed sg-0002 case plus a synthetic
 * audio case) with the stub runner, so there is no network, no live NIMs,
 * and committed bundles are never mutated.
 *
 * The point is legibility, not speed. Every interaction is deliberately paced
 * (Playwright `slowMo` plus explicit beats between steps) and long sections are
 * scrolled smoothly rather than jumped, so a reviewer watching the .webm can
 * follow what the operator did and how the UI responded:
 *
 *   worklist  → pick a provider · toggle segments · search
 *   brief     → read the story · scroll key facts / theatre / issues
 *   source    → open a citation · step through cited sources · close
 *   review    → mark a "needs you now" item reviewed
 *   audio     → open an audio citation · play the dictation
 *
 * The video is written to e2e/.recordings/ (gitignored) as a single .webm.
 * Chromium records one file per browser context at the viewport size; we flush
 * it on context close and rename it to a stable, human-readable name.
 *
 * Usage:
 *   # build the UI if needed, boot a throwaway server, film the walk:
 *   node ui/e2e/record_walkthrough.mjs
 *
 *   # slower/faster overall pace (default 1.0; higher = slower & more readable):
 *   node ui/e2e/record_walkthrough.mjs --pace 1.5
 *
 *   # watch it happen (non-headless) and force a fresh production build:
 *   node ui/e2e/record_walkthrough.mjs --headed --build
 *
 * Run from the repo root (paths below resolve relative to ui/). Requires the
 * UI's dev deps (`cd ui && npm install`) — it reuses the Playwright chromium
 * the e2e suite already installs.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const uiRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureDir = fileURLToPath(new URL("./.fixture", import.meta.url));
const outDir = fileURLToPath(new URL("./.recordings", import.meta.url));
const distDir = `${uiRoot}dist`;

const VIEWPORT = { width: 1440, height: 900 };

// --------------------------------------------------------------------------- #
// args
// --------------------------------------------------------------------------- #

const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(`--${name}`);
}
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const PACE = Number(opt("pace", "1")); // 1.0 = default; higher = slower
const HEADED = flag("headed");
const FORCE_BUILD = flag("build");
const PROVIDER = opt("provider", "p-lim"); // "Dr A. Lim (consultant)"

// A beat between steps, scaled by --pace so the whole film can be slowed at once.
const beat = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * PACE)));

// --------------------------------------------------------------------------- #
// server boot
// --------------------------------------------------------------------------- #

function die(msg) {
  console.error(`record_walkthrough: ${msg}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit" });
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
    p.on("error", reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealthy(baseUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  die(`server never became healthy at ${baseUrl}`);
}

async function ensureBuild() {
  if (FORCE_BUILD || !existsSync(`${distDir}/index.html`)) {
    console.log("→ building UI (vite build)…");
    await run("npm", ["run", "build"], uiRoot);
  } else {
    console.log("→ reusing existing ui/dist (pass --build to rebuild)");
  }
}

async function bootServer() {
  // rebuild the hermetic fixture store, exactly as the e2e config does
  await run("node", [`${uiRoot}e2e/setup-fixture.mjs`], repoRoot);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`→ booting server on ${baseUrl} (fixture: ${fixtureDir})`);
  const server = spawn(
    "uv",
    ["run", "uvicorn", "periop.api.app:app", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        PERIOP_CASE_DIR: fixtureDir,
        PERIOP_OUT_DIR: `${fixtureDir}/_out`,
        // hermetic: the real server with instant stub artifacts, no NIMs
        PERIOP_STUB_RUNNER: "1",
        // never export traces even if .env has real credentials
        LANGFUSE_PUBLIC_KEY: "",
        LANGFUSE_SECRET_KEY: "",
        LANGFUSE_BASE_URL: "",
      },
    },
  );
  await waitHealthy(baseUrl);
  return { server, baseUrl };
}

// --------------------------------------------------------------------------- #
// interaction helpers — deliberately paced so the film reads
// --------------------------------------------------------------------------- #

/** Announce a chapter both in the console and via a brief pause. */
async function chapter(page, title) {
  console.log(`   • ${title}`);
  await beat(600);
}

/** Move to, hover, then click — a human-legible click, not an instant one. */
async function slowClick(page, locator, { after = 700 } = {}) {
  const el = typeof locator === "string" ? page.locator(locator) : locator;
  await el.first().scrollIntoViewIfNeeded();
  await beat(350);
  await el.first().hover().catch(() => {});
  await beat(250);
  await el.first().click();
  await beat(after);
}

/**
 * Smoothly scroll the case brief's main column by `delta` px. Finds the nearest
 * scrollable ancestor of the "The story so far" eyebrow so it keeps working if
 * the layout shifts, and steps the scroll so the motion is watchable.
 */
async function smoothScroll(page, delta, { steps = 34, stepMs = 55 } = {}) {
  await page.evaluate(
    async ({ delta, steps, stepMs }) => {
      const anchor = [...document.querySelectorAll("*")].find(
        (e) => e.childElementCount === 0 && e.textContent?.trim() === "The story so far",
      );
      let el = anchor;
      while (el && el.scrollHeight <= el.clientHeight + 2) el = el.parentElement;
      const container = el || document.scrollingElement;
      const per = delta / steps;
      for (let i = 0; i < steps; i++) {
        container.scrollBy(0, per);
        await new Promise((r) => setTimeout(r, stepMs));
      }
    },
    { delta, steps, stepMs: Math.round(stepMs * PACE) },
  );
  await beat(500);
}

// --------------------------------------------------------------------------- #
// the walk
// --------------------------------------------------------------------------- #

async function walk(page) {
  // --- worklist ---------------------------------------------------------- #
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Cases" }).waitFor();
  await chapter(page, "Worklist — the department's cases");
  await beat(1200);

  // pick who you are (attribution only) — the app's one bit of setup
  await chapter(page, `Picking a provider (${PROVIDER})`);
  await page.locator('select[aria-label="Working as"]').selectOption(PROVIDER);
  await beat(1100);

  // segment toggle: peek at "waiting for you", then settle on all cases
  await chapter(page, "Toggling worklist segments");
  await slowClick(page, 'button:has-text("Waiting for you")');
  await beat(900);
  await slowClick(page, 'button:has-text("All cases")');
  await beat(600);

  // search, then clear
  await chapter(page, "Searching the worklist");
  const search = page.locator('input[placeholder="Search patient or case number"]');
  await search.click();
  await search.pressSequentially("sg-0002", { delay: Math.round(140 * PACE) });
  await beat(1100);
  await search.fill("");
  await beat(500);

  // --- open the rich case → brief --------------------------------------- #
  await chapter(page, "Opening case sg-0002 → the patient brief");
  await slowClick(page, page.getByRole("button", { name: /sg-0002/ }), { after: 900 });
  await page.getByText("The story so far").waitFor();
  await beat(1600); // let the reader take in the story + attention items

  // read the brief top-to-bottom
  await chapter(page, "Reading the brief — key facts");
  await smoothScroll(page, 460);
  await beat(1200);
  await chapter(page, "Reading the brief — theatre timeline");
  await smoothScroll(page, 520);
  await beat(1200);
  await chapter(page, "Reading the brief — anticipated issues");
  await smoothScroll(page, 520);
  await beat(1400);

  // back up to a citation
  await smoothScroll(page, -820, { steps: 40 });
  await beat(700);

  // --- source modal: open a citation, step through cited sources -------- #
  await chapter(page, "Opening a source — the original, highlighted");
  const sourceLink = page.getByRole("button", { name: /^See (the source|sources)/ }).first();
  await slowClick(page, sourceLink, { after: 1200 });
  await page.getByText("Source for this fact").waitFor();
  await beat(1600);

  // step through each cited source in the left rail, if more than one
  const citedButtons = page.locator('button:has-text("doc:"), button:has-text("audio:")');
  const cited = await citedButtons.count();
  for (let i = 1; i < Math.min(cited, 3); i++) {
    await chapter(page, `Stepping to cited source ${i + 1}/${cited}`);
    await slowClick(page, citedButtons.nth(i), { after: 1200 });
  }
  await chapter(page, "Closing the source modal");
  await slowClick(page, 'button[aria-label="Close"]', { after: 900 });

  // --- review a "needs you now" item ------------------------------------ #
  const markReviewed = page.getByRole("button", { name: "Mark reviewed" }).first();
  if (await markReviewed.count()) {
    await chapter(page, 'Marking a "needs you now" item reviewed');
    await slowClick(page, markReviewed, { after: 1400 });
  }

  // --- audio: open an audio citation and play the dictation ------------- #
  await chapter(page, "Back to the worklist");
  await slowClick(page, page.getByRole("button", { name: /Worklist/ }), { after: 900 });
  await page.getByRole("heading", { name: "Cases" }).waitFor();

  const audioRow = page.getByRole("button", { name: /sg-audio/ });
  if (await audioRow.count()) {
    await chapter(page, "Opening the audio case → play a dictation");
    await slowClick(page, page.locator('button:has-text("All cases")'));
    await slowClick(page, audioRow, { after: 900 });
    await page.getByText("The story so far").waitFor().catch(() => {});
    await beat(800);
    const audioSource = page.getByRole("button", { name: /^See (the source|sources)/ }).first();
    if (await audioSource.count()) {
      await slowClick(page, audioSource, { after: 1200 });
      const play = page.getByRole("button", { name: /play/i }).first();
      if (await play.count()) {
        await slowClick(page, play, { after: 2600 }); // let the tone play
      }
      await beat(1200);
      await slowClick(page, 'button[aria-label="Close"]', { after: 800 });
    }
    await slowClick(page, page.getByRole("button", { name: /Worklist/ }), { after: 900 });
  }

  await chapter(page, "Done");
  await beat(1400);
}

// --------------------------------------------------------------------------- #
// main
// --------------------------------------------------------------------------- #

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await ensureBuild();
  const { server, baseUrl } = await bootServer();

  const browser = await chromium.launch({
    headless: !HEADED,
    slowMo: Math.round(160 * PACE), // every action gets a visible beat
  });
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: VIEWPORT,
    recordVideo: { dir: outDir, size: VIEWPORT },
  });
  const page = await context.newPage();

  let failed = null;
  try {
    console.log(`→ filming the walkthrough on ${baseUrl}\n`);
    await walk(page);
  } catch (e) {
    failed = e;
    console.error(`\n✗ walk failed: ${e.stack || e}`);
  } finally {
    const video = page.video();
    const tmpPath = video ? await video.path() : null;
    await context.close(); // flushes the .webm to disk
    await browser.close();
    server.kill("SIGTERM");

    if (tmpPath && existsSync(tmpPath)) {
      const finalPath = `${outDir}/catchup-walkthrough.webm`;
      cpSync(tmpPath, finalPath);
      rmSync(tmpPath, { force: true });
      console.log(`\n${failed ? "✗ partial" : "✓"} video saved → ${finalPath}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => die(e.stack || String(e)));
