/**
 * Screen-record the PeriOp Catch-Up UI through the *entire* case lifecycle with
 * Playwright. Not CI.
 *
 * The browser-side sibling of scripts/e2e_lifecycle_timing.py: where that walks
 * the write API over HTTP and times every leg, this drives the *browser*
 * through the same lifecycle and films it, so the whole provider workflow can
 * be watched rather than read. It creates a fresh case and takes it all the way
 * to a signed-off, acknowledged handoff:
 *
 *   worklist → new case intake → describe the case + stage the GP summary
 *   intake   → create intake (build ring) → review the questions, add one
 *   pre-op   → upload the interview (approves the review) → transcript lands
 *              → the brief generates itself → sign off
 *   intra-op → voice memo → transcript lands → generate the record → sign off
 *   post-op  → post-op interview → the handoff generates itself → acknowledge
 *
 * It boots the real FastAPI server against the hermetic e2e fixture store
 * (e2e/setup-fixture.mjs — a couple of seed cases for worklist context) with
 * the stub runner, so there is no network, no live NIMs, and committed bundles
 * are never mutated. Generation is instant but streams the same SSE the live
 * pipeline does, so the "Generating…" screen fills in for real, and uploaded
 * audio is "transcribed" by the stub in the background exactly like live ASR.
 *
 * Every step is a real click. (The read-only apiGet polls below just wait for
 * background work to settle — they never drive the workflow.)
 *
 * The point is legibility, not speed. Every interaction is deliberately paced
 * (Playwright `slowMo` plus explicit beats, scaled by --pace) and long sections
 * are scrolled smoothly rather than jumped, so a reviewer watching the .webm can
 * follow both what the operator did and how the UI responded. The video is
 * written to e2e/.recordings/ (gitignored) as a single .webm.
 *
 * Usage:
 *   # build the UI if needed, boot a throwaway server, film the lifecycle:
 *   node ui/e2e/record_lifecycle.mjs
 *
 *   # slower/faster overall pace (default 1.0; higher = slower & more readable):
 *   node ui/e2e/record_lifecycle.mjs --pace 1.4
 *
 *   # watch it happen (non-headless) and force a fresh production build:
 *   node ui/e2e/record_lifecycle.mjs --headed --build
 *
 *   # live: real NIMs for note/record generation too (not just transcription
 *   # and gap analysis, which always run for real regardless of the stub
 *   # flag), and real recorded audio instead of the synthetic tone — much
 *   # slower, needs reachable NIM endpoints (.env / configs/selfhosted.env):
 *   node ui/e2e/record_lifecycle.mjs --live \
 *     --preop-wav /path/to/preop-interview.wav \
 *     --intraop-wav /path/to/intraop-notes.wav \
 *     --postop-wav /path/to/postop-interview.wav
 *
 * Run from the repo root (paths below resolve relative to ui/). Requires the
 * UI's dev deps (`cd ui && npm install`) — it reuses the Playwright chromium
 * the e2e suite already installs.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const flag = (name) => argv.includes(`--${name}`);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const PACE = Number(opt("pace", "1")); // 1.0 = default; higher = slower
const HEADED = flag("headed");
const FORCE_BUILD = flag("build");
const PROVIDER = opt("provider", "p-lim"); // "Dr A. Lim (consultant)"

// --live: real NIMs for stage generation, real recorded audio in place of the
// synthetic tone. Transcription and gap analysis are never stubbed either
// way — this only swaps the stage-run (note/record) generation.
const LIVE = flag("live");
const PREOP_WAV = opt("preop-wav", null);
const INTRAOP_WAV = opt("intraop-wav", null);
const POSTOP_WAV = opt("postop-wav", null);
// live generation can take a long time (real reasoning-tier LLM calls);
// hermetic stub artifacts land instantly.
const GEN_TIMEOUT = LIVE ? 20 * 60 * 1000 : 30000;
const XCRIBE_TIMEOUT = LIVE ? 5 * 60 * 1000 : 15000;

// A beat between steps, scaled by --pace so the whole film can be slowed at once.
const beat = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * PACE)));

let BASE_URL = ""; // filled in on boot; used by the small API bridge

// --------------------------------------------------------------------------- #
// server boot + input files
// --------------------------------------------------------------------------- #

function die(msg) {
  console.error(`record_lifecycle: ${msg}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
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
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
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
  await run("node", [`${uiRoot}e2e/setup-fixture.mjs`], repoRoot); // seed cases
  const port = await freePort();
  BASE_URL = `http://127.0.0.1:${port}`;
  console.log(
    `→ booting server on ${BASE_URL} (fixture: ${fixtureDir})${LIVE ? " [live: real NIM generation]" : ""}`,
  );
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
        // hermetic by default: instant stub artifacts, no NIMs. --live drops
        // this so stage generation hits the real reasoning/fast NIMs from
        // .env / the parent shell env (transcription and gap analysis run
        // for real either way).
        ...(LIVE ? {} : { PERIOP_STUB_RUNNER: "1" }),
        LANGFUSE_PUBLIC_KEY: "",
        LANGFUSE_SECRET_KEY: "",
        LANGFUSE_BASE_URL: "",
      },
    },
  );
  await waitHealthy(BASE_URL, LIVE ? 120000 : 60000);
  return server;
}

/** Valid PCM wav: mono, 16-bit, 8 kHz, `seconds` of a soft 440 Hz tone. */
function makeWav(seconds) {
  const rate = 8000;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Write the throwaway inputs the intake screen uploads (docs + interviews).
 * The operative plan is typed into the case-description field, not uploaded.
 * --live substitutes real recorded audio (per stage) for the synthetic tone;
 * the three stages otherwise share one short clip. */
function writeInputs() {
  const dir = mkdtempSync(join(tmpdir(), "periop-record-"));
  writeFileSync(
    join(dir, "gp-summary.md"),
    "# GP summary\n\nAmara Okafor, 62. Hypertension on amlodipine.\n\n" +
      "Aspirin 100 mg daily, started after a TIA in 2019.\n\nNo known drug allergies.\n",
  );
  if (LIVE) {
    for (const [flagName, path] of [
      ["--preop-wav", PREOP_WAV],
      ["--intraop-wav", INTRAOP_WAV],
      ["--postop-wav", POSTOP_WAV],
    ]) {
      if (!path || !existsSync(path)) die(`--live needs ${flagName} pointing at a real .wav`);
    }
    return { dir, gp: join(dir, "gp-summary.md"), wav: PREOP_WAV, intraopWav: INTRAOP_WAV, postopWav: POSTOP_WAV };
  }
  const wav = join(dir, "interview.wav");
  writeFileSync(wav, makeWav(4));
  return { dir, gp: join(dir, "gp-summary.md"), wav, intraopWav: wav, postopWav: wav };
}

// --------------------------------------------------------------------------- #
// small write-API bridge (only for the pre-op question approval seam)
// --------------------------------------------------------------------------- #

async function apiGet(path) {
  const r = await fetch(`${BASE_URL}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

/** Poll until a stage's uploaded audio has been transcribed server-side —
 * the UI shows the transcript moments later via its own poll. */
async function waitTranscribed(caseId, stage, timeoutMs = XCRIBE_TIMEOUT) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const c = await apiGet(`/api/cases/${caseId}`);
    last = c.workflow?.stages?.[stage]?.transcription;
    if (last === "complete" || last === "failed") return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${stage} transcription stuck at ${last}`);
}

/** The case_id that appeared since `before` (a Set of prior ids). */
async function newCaseId(before) {
  const cases = await apiGet("/api/cases");
  const fresh = cases.map((c) => c.case_id).filter((id) => !before.has(id));
  if (fresh.length !== 1) throw new Error(`expected 1 new case, saw ${fresh.length}`);
  return fresh[0];
}

// --------------------------------------------------------------------------- #
// interaction helpers — deliberately paced so the film reads
// --------------------------------------------------------------------------- #

async function chapter(title) {
  console.log(`   • ${title}`);
  await beat(600);
}

/** Move to, hover, then click — a human-legible click, not an instant one. */
async function slowClick(page, locator, { after = 700 } = {}) {
  const el = typeof locator === "string" ? page.locator(locator) : locator;
  await el.first().scrollIntoViewIfNeeded();
  await beat(300);
  await el.first().hover().catch(() => {});
  await beat(220);
  await el.first().click();
  await beat(after);
}

/** Type into a field character-by-character so the typing is watchable. */
async function slowType(page, locator, text, { after = 700 } = {}) {
  const el = typeof locator === "string" ? page.locator(locator) : locator;
  await el.click();
  await el.pressSequentially(text, { delay: Math.round(60 * PACE) });
  await beat(after);
}

/** Smoothly scroll the brief's main column by `delta` px (steps the motion). */
async function smoothScroll(page, delta, { steps = 30, stepMs = 55 } = {}) {
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
  await beat(400);
}

/** Wait for the generating screen's SSE checklist to hand off to the brief.
 * "Key facts" is the anchor because it survives the layout fork: pre-op
 * briefs read story-in-rail + key facts, later stages read three columns. */
async function waitForBrief(page) {
  await page.getByText("Key facts").first().waitFor({ timeout: GEN_TIMEOUT });
  await beat(1000);
}

// --------------------------------------------------------------------------- #
// the lifecycle walk
// --------------------------------------------------------------------------- #

async function walk(page, inputs) {
  // --- worklist: who am I --------------------------------------------------
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Cases" }).waitFor();
  await chapter("Worklist — the department's cases");
  await beat(1000);
  await chapter(`Picking a provider (${PROVIDER})`);
  await page.locator('select[aria-label="Working as"]').selectOption(PROVIDER);
  await beat(900);

  // --- new case intake: describe the case, stage the records ---------------
  const before = new Set((await apiGet("/api/cases")).map((c) => c.case_id));
  await chapter("Starting a new case intake");
  await slowClick(page, page.getByRole("button", { name: /New case intake/ }), { after: 900 });
  await chapter("Naming the patient");
  await slowType(page, 'input[placeholder*="James Whitfield"]', "Amara Okafor", { after: 400 });
  await chapter("Describing the case — this becomes the operative plan");
  await slowType(
    page,
    'textarea[placeholder*="Elective open right"]',
    "Elective laparoscopic cholecystectomy for symptomatic gallstones. GA, day case.",
    { after: 600 },
  );

  const docInput = page.locator('input[type="file"][accept*="text/plain"]');
  await chapter("Dropping in the GP summary");
  await docInput.setInputFiles(inputs.gp);
  await page.getByText("gp-summary.md").waitFor();
  await beat(1200);

  // --- create intake: records land, question prep runs on the build ring ---
  await chapter("Creating the intake — records save, question prep begins");
  await slowClick(page, page.getByRole("button", { name: /Create intake/ }), { after: 600 });
  await page.getByText("Building the intake").first().waitFor({ timeout: 15000 });
  const caseId = await newCaseId(before);
  console.log(`     case_id = ${caseId}`);

  // --- interview: review the clarification questions (no approve gate) -----
  const review = page.getByText("Review the questions");
  // gap analysis is a real reasoning-tier LLM call whether or not --live is set
  await review.waitFor({ timeout: LIVE ? GEN_TIMEOUT : 30000 }); // the flow flips when prep lands
  await chapter("Reviewing the clarifying questions");
  await beat(1400); // read the questions
  await chapter("Adding a question of our own");
  await slowType(page, 'input[placeholder="Add your own question…"]', "Any loose teeth or dental work?", {
    after: 300,
  });
  await slowClick(page, page.getByRole("button", { name: "+ Add question" }), { after: 900 });

  // --- interview: upload the recording — the reviewed list travels with it -
  const audioInput = page.locator('input[type="file"][accept*="audio"]');
  await chapter("Uploading the pre-op interview — the review is approved with it");
  await audioInput.setInputFiles(inputs.wav);
  await waitTranscribed(caseId, "preop");
  await chapter("The transcript lands moments after the upload");
  await page.getByText("✓ transcribed").waitFor({ timeout: XCRIBE_TIMEOUT });
  await beat(1400);

  // --- pre-op: auto-generate → review → sign off ---------------------------
  await chapter("The pre-op brief generates itself (live SSE)");
  await waitForBrief(page);
  await chapter("Reading the pre-op brief");
  await smoothScroll(page, 420);
  await smoothScroll(page, -420);
  const markReviewed = page.getByRole("button", { name: "Mark reviewed" }).first();
  if (await markReviewed.count()) {
    await chapter('Marking the "needs you now" item reviewed');
    await slowClick(page, markReviewed, { after: 1000 });
  }
  await chapter("Signing off the pre-op note");
  await slowClick(page, page.getByRole("button", { name: "Sign off pre-op" }), { after: 1200 });

  // --- intra-op: record memo → generate → sign off ------------------------
  await runCaptureStage(page, {
    caseId,
    stage: "intraop",
    open: "Opening the case for theatre",
    actionButton: /Record voice memo/,
    capture: "Adding an intra-op voice memo — transcribed as it lands",
    generateButton: /Generate intra-op record/,
    generate: "Generating the theatre record (live SSE)",
    signOff: "Sign off intra-op",
    wav: inputs.intraopWav,
  });

  // --- post-op: interview → generate → acknowledge ------------------------
  await chapter("Opening the case for recovery");
  await slowClick(page, page.getByRole("button", { name: /Amara Okafor/ }), { after: 900 });
  await waitForBrief(page);
  await chapter("To recovery — the post-op interview");
  await slowClick(page, page.getByRole("button", { name: /Record post-op interview/ }), {
    after: 800,
  });
  await audioInput.setInputFiles(inputs.postopWav);
  await waitTranscribed(caseId, "postop");
  await page.getByTestId("transcript").waitFor({ timeout: XCRIBE_TIMEOUT });
  await beat(1200);
  await chapter("The PACU handoff & post-op note generate themselves (live SSE)");
  await waitForBrief(page);
  await chapter("Reading the final handoff brief");
  await smoothScroll(page, 520);
  await smoothScroll(page, 520);
  await smoothScroll(page, -1040, { steps: 40 });
  await chapter("Acknowledging the handoff — taking over the patient");
  await slowClick(page, page.getByRole("button", { name: "Acknowledge handoff" }), { after: 1600 });
  await page.getByText("You now hold this patient.").waitFor();
  await beat(1500);

  await chapter("Back to the worklist — the case is complete");
  await slowClick(page, page.getByRole("button", { name: /Worklist/ }), { after: 900 });
  await page.getByRole("heading", { name: "Cases" }).waitFor();
  await slowClick(page, 'button:has-text("All cases")', { after: 1400 });
  await chapter("Done");
  await beat(1200);
}

/** Reopen the case → follow its primary action into the capture screen →
 * add audio → watch the transcript land → generate → sign off. */
async function runCaptureStage(page, c) {
  await chapter(c.open);
  await slowClick(page, page.getByRole("button", { name: /Amara Okafor/ }), { after: 900 });
  await waitForBrief(page);
  await chapter(c.capture);
  await slowClick(page, page.getByRole("button", { name: c.actionButton }), { after: 800 });
  const audioInput = page.locator('input[type="file"][accept*="audio"]');
  await audioInput.setInputFiles(c.wav);
  await waitTranscribed(c.caseId, c.stage);
  await page.getByTestId("transcript").waitFor({ timeout: XCRIBE_TIMEOUT });
  await beat(1200);
  await chapter(c.generate);
  await slowClick(page, page.getByRole("button", { name: c.generateButton }), { after: 500 });
  await waitForBrief(page);
  await smoothScroll(page, 460);
  await smoothScroll(page, -460);
  await chapter(`Signing off (${c.signOff})`);
  await slowClick(page, page.getByRole("button", { name: c.signOff }), { after: 1200 });
}

// --------------------------------------------------------------------------- #
// main
// --------------------------------------------------------------------------- #

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const inputs = writeInputs();

  await ensureBuild();
  const server = await bootServer();

  const browser = await chromium.launch({
    headless: !HEADED,
    slowMo: Math.round(150 * PACE),
  });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    recordVideo: { dir: outDir, size: VIEWPORT },
  });
  const page = await context.newPage();

  let failed = null;
  try {
    console.log(`→ filming the full lifecycle on ${BASE_URL}\n`);
    await walk(page, inputs);
  } catch (e) {
    failed = e;
    console.error(`\n✗ walk failed: ${e.stack || e}`);
  } finally {
    const video = page.video();
    const tmpPath = video ? await video.path() : null;
    await context.close(); // flushes the .webm to disk
    await browser.close();
    server.kill("SIGTERM");
    rmSync(inputs.dir, { recursive: true, force: true });

    if (tmpPath && existsSync(tmpPath)) {
      const finalPath = `${outDir}/catchup-lifecycle.webm`;
      cpSync(tmpPath, finalPath);
      rmSync(tmpPath, { force: true });
      console.log(`\n${failed ? "✗ partial" : "✓"} video saved → ${finalPath}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => die(e.stack || String(e)));
