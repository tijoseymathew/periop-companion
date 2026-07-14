/**
 * Screen-record the sg-0031 demo case through the UI, live NIMs, IN PARTS.
 * Throwaway — not CI, not record_lifecycle.mjs (which films a hermetic,
 * single-take, stub-runner lifecycle). This one:
 *
 *   - drives the real reasoning/fast NIMs (no stub runner) for a genuinely
 *     interesting case: sg-0031, an emergency hip hemiarthroplasty with a
 *     spinal→GA conversion and an apixaban-timing record/patient conflict
 *   - attaches to an ALREADY-RUNNING backend (--base-url) instead of
 *     booting its own, so the four parts below share one case across
 *     separate Playwright sessions/processes (live generation is slow —
 *     splitting into parts means a flaky stage only costs a re-run of that
 *     part, not the whole ~10 minute lifecycle)
 *   - uploads intra-op audio as FOUR separate accumulating memos (matching
 *     the real accumulating-dictation behavior), not one continuous clip
 *   - scrolls to and pauses on the specific interesting fact per stage
 *     (the apixaban conflict, the hypotension/transfusion event, the
 *     anticipated issues, the handoff's anticoagulation note) instead of a
 *     blind fixed-pixel scroll
 *
 * Usage (see run_sg0031_demo.sh for the full orchestration):
 *   node record_sg0031_demo.mjs --part intake  --base-url http://127.0.0.1:PORT --out p1.webm
 *   node record_sg0031_demo.mjs --part preop   --base-url http://127.0.0.1:PORT --case-id ID --out p2.webm
 *   node record_sg0031_demo.mjs --part intraop --base-url http://127.0.0.1:PORT --case-id ID --out p3.webm
 *   node record_sg0031_demo.mjs --part postop  --base-url http://127.0.0.1:PORT --case-id ID --out p4.webm
 *
 * The intake part prints `CASE_ID=<id>` to stdout on success.
 */
import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const caseDir = `${repoRoot}data/cases/sg-0031`;
// Playwright's recordVideo.size is an output-canvas size, not a multiplier —
// it only ever DOWNSCALES the actual viewport capture to fit; requesting a
// size larger than the viewport (or setting deviceScaleFactor without also
// growing recordVideo.size to match) just letterboxes the real content into
// a corner of a blank canvas. The only real lever for a sharper recording is
// a bigger viewport with recordVideo.size set to the SAME dimensions.
const VIEWPORT = { width: 1920, height: 1080 };

const PATIENT_NAME = "Ang Teck Chye";
const CASE_DESCRIPTION =
  "Emergency hemiarthroplasty for a displaced left neck-of-femur fracture. " +
  "Spinal anaesthesia with sedation planned, with a general-anaesthesia " +
  "back-up given a recent anticoagulant dose.";
const GOLD_QUESTION =
  "Can you confirm exactly when the last apixaban dose was taken — the date and roughly what time?";

const INTRAOP_SESSIONS = [1, 2, 3, 4].map(
  (i) => `${caseDir}/audio/intraop-notes-${i}.wav`,
);
const PREOP_WAV = `${caseDir}/audio/preop-interview.wav`;
const POSTOP_WAV = `${caseDir}/audio/postop-interview.wav`;
const DOCS = ["gp-summary.md", "med-list.md", "prior-anesthetic-record.md"].map(
  (f) => `${caseDir}/records/${f}`,
);

// --------------------------------------------------------------------------- #
// args
// --------------------------------------------------------------------------- #

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const PART = opt("part", null); // intake | preop | intraop | postop
const BASE_URL = opt("base-url", null);
const CASE_ID = opt("case-id", null);
const OUT = opt("out", null);
const PACE = Number(opt("pace", "1"));
const HEADED = flag("headed");
const PROVIDER = opt("provider", "p-lim");
const GEN_TIMEOUT = 20 * 60 * 1000; // live reasoning-tier calls
const XCRIBE_TIMEOUT = 5 * 60 * 1000;

if (!PART || !BASE_URL || !OUT) die("need --part, --base-url and --out");
if (PART !== "intake" && !CASE_ID) die(`--part ${PART} needs --case-id`);

function die(msg) {
  console.error(`record_sg0031_demo: ${msg}`);
  process.exit(1);
}

const beat = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * PACE)));

// --------------------------------------------------------------------------- #
// small write-API bridge (poll only — never drives the workflow)
// --------------------------------------------------------------------------- #

async function apiGet(path) {
  const r = await fetch(`${BASE_URL}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

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

async function newCaseId(before) {
  const cases = await apiGet("/api/cases");
  const fresh = cases.map((c) => c.case_id).filter((id) => !before.has(id));
  if (fresh.length !== 1) throw new Error(`expected 1 new case, saw ${fresh.length}`);
  return fresh[0];
}

// --------------------------------------------------------------------------- #
// interaction helpers — paced so the film reads
// --------------------------------------------------------------------------- #

async function chapter(title) {
  console.log(`   • ${title}`);
  await beat(600);
}

async function slowClick(page, locator, { after = 700 } = {}) {
  const el = typeof locator === "string" ? page.locator(locator) : locator;
  await el.first().scrollIntoViewIfNeeded();
  await beat(300);
  await el.first().hover().catch(() => {});
  await beat(220);
  await el.first().click();
  await beat(after);
}

async function slowType(page, locator, text, { after = 700 } = {}) {
  const el = typeof locator === "string" ? page.locator(locator) : locator;
  await el.click();
  await el.pressSequentially(text, { delay: Math.round(60 * PACE) });
  await beat(after);
}

/** Scroll to (and pause on) the first element whose text matches any of
 * `patterns` — resilient to live-model wording drift, unlike a fixed-pixel
 * scroll. Tries each pattern in order; logs (doesn't throw) if none match. */
async function highlight(page, patterns, label, pauseMs = 2200) {
  for (const p of patterns) {
    const loc = page.getByText(p).first();
    if (await loc.count().catch(() => 0)) {
      await chapter(`Highlighting — ${label}`);
      await loc.scrollIntoViewIfNeeded();
      await beat(pauseMs);
      return true;
    }
  }
  console.log(`   (skipped highlight "${label}" — no matching text on screen)`);
  return false;
}

/** Source provenance is the product's differentiator (every generated fact
 * traces to a document passage or an audio segment) — this is the moment a
 * demo has to actually show, not just scroll past. Finds the nearest
 * ancestor of the matched text that has its own source-link, opens the
 * citation modal (the exact document passage, or the audio player cued to
 * the transcript segment), pauses on it, then closes. */
async function openSource(page, patterns, label, pauseMs = 3200) {
  for (const p of patterns) {
    const fact = page.getByText(p).first();
    if (!(await fact.count().catch(() => 0))) continue;
    const row = fact.locator('xpath=ancestor::div[.//button[@data-testid="source-link"]][1]');
    const link = row.getByTestId("source-link").first();
    if (!(await link.count().catch(() => 0))) continue;
    await chapter(`Opening the source — ${label}`);
    await link.scrollIntoViewIfNeeded();
    await beat(300);
    await link.hover().catch(() => {});
    await beat(220);
    await link.click();
    await beat(600);
    // if this citation is an audio segment, actually press play — a real
    // click-to-play interaction, not just a static transcript excerpt
    // exact: true matters here — the source-link button's own visible text
    // ("Play the dictation") otherwise substring-matches "play" too, and
    // Playwright will keep retrying a click on that now-obscured link behind
    // the modal overlay instead of ever finding the real player button
    const playBtn = page.getByRole("button", { name: "play", exact: true });
    if (await playBtn.count().catch(() => 0)) {
      await playBtn.first().click();
      await beat(Math.min(pauseMs, 2600));
      await page.getByRole("button", { name: "pause", exact: true }).first().click().catch(() => {});
    } else {
      await beat(pauseMs);
    }
    const closeBtn = page.getByRole("button", { name: "Close", exact: true });
    if (await closeBtn.count().catch(() => 0)) {
      await closeBtn.first().click();
      await beat(700);
    }
    return true;
  }
  console.log(`   (skipped source-open "${label}" — no citation found)`);
  return false;
}

/** Tick the first recommended-equipment checkbox (pre-op brief only) — pure
 * client state until it rides along with the sign-off click. */
async function tickEquipment(page, label = "the recommended equipment") {
  const box = page.locator('input[type="checkbox"]').first();
  if (!(await box.count().catch(() => 0))) {
    console.log(`   (no equipment recommendations to tick)`);
    return false;
  }
  await chapter(`Reserving ${label}`);
  await box.scrollIntoViewIfNeeded();
  await beat(300);
  await box.check();
  await beat(900);
  return true;
}

/** Provider correction: click the pencil on a claim whose "Edit: ..." accessible
 * name matches one of `keywords`, append `appendText`, save. Demonstrates
 * that generated claims are editable, not just read-only output. */
async function editClaim(page, keywords, appendText, label) {
  for (const kw of keywords) {
    const pattern = new RegExp(`Edit:.*${kw}`, "i");
    const pencil = page.getByRole("button", { name: pattern });
    if (!(await pencil.count().catch(() => 0))) continue;
    await chapter(`Correcting a claim — ${label}`);
    await pencil.first().scrollIntoViewIfNeeded();
    await beat(300);
    await pencil.first().click();
    await beat(400);
    const box = page.getByRole("textbox", { name: pattern });
    await box.first().click();
    await box.first().press("End");
    await box.first().pressSequentially(appendText, { delay: 35 });
    await beat(500);
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await beat(900);
    return true;
  }
  console.log(`   (skipped edit "${label}" — no matching claim found)`);
  return false;
}

/** Provider addition: fill the "+ Add" line under a story-so-far / anticipated-
 * issues list with a new provider-asserted fact. */
async function addLine(page, placeholder, text, label) {
  const input = page.getByPlaceholder(placeholder);
  if (!(await input.count().catch(() => 0))) {
    console.log(`   (skipped add-line "${label}" — input not found)`);
    return false;
  }
  await chapter(`Adding — ${label}`);
  await input.first().click();
  await input.first().pressSequentially(text, { delay: 30 });
  await beat(400);
  await page.getByRole("button", { name: "+ Add", exact: true }).first().click();
  await beat(900);
  return true;
}

/** Ask the live case assistant a question — a real agent turn with
 * search/read tools over this case's own records (same cost class as a
 * stage generation), not a canned answer. */
async function askAssistant(page, question, label, pauseMs = 2600) {
  const openBtn = page.getByRole("button", { name: /Ask about this case/ });
  if (!(await openBtn.count().catch(() => 0))) {
    console.log(`   (skipped chat "${label}" — assistant pill not found)`);
    return false;
  }
  await chapter(`Asking the case assistant — ${label}`);
  await slowClick(page, openBtn, { after: 800 });
  const input = page.getByPlaceholder("Ask about this case…");
  await input.click();
  await input.pressSequentially(question, { delay: 25 });
  await beat(500);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await beat(600);
  await page
    .getByText("Thinking…")
    .waitFor({ state: "detached", timeout: GEN_TIMEOUT })
    .catch(() => {});
  await beat(pauseMs);
  await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  await beat(600);
  return true;
}

async function waitForBrief(page) {
  await page
    .getByText(/^(Key facts|PACU handoff)$/)
    .first()
    .waitFor({ timeout: GEN_TIMEOUT });
  await beat(1000);
}

// --------------------------------------------------------------------------- #
// parts
// --------------------------------------------------------------------------- #

async function selectProvider(page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Cases" }).waitFor();
  await chapter(`Picking a provider (${PROVIDER})`);
  await page.locator('select[aria-label="Working as"]').selectOption(PROVIDER);
  await beat(900);
}

async function openCase(page) {
  await chapter(`Opening ${PATIENT_NAME}'s case`);
  await slowClick(page, page.getByRole("button", { name: new RegExp(PATIENT_NAME) }), {
    after: 900,
  });
  await waitForBrief(page);
}

async function partIntake(page) {
  await selectProvider(page);

  await chapter("Filtering the department worklist");
  await slowClick(page, page.getByRole("button", { name: /Waiting for you/ }), { after: 900 });
  await slowClick(page, page.getByRole("button", { name: /All cases/ }), { after: 900 });
  const search = page.getByPlaceholder("Search patient or case number");
  await slowType(page, search, "Ang", { after: 700 });
  await search.fill("");
  await beat(500);

  const before = new Set((await apiGet("/api/cases")).map((c) => c.case_id));

  await chapter("Starting a new case intake");
  await slowClick(page, page.getByRole("button", { name: /New case intake/ }), { after: 900 });
  await chapter("Naming the patient");
  await slowType(page, 'input[placeholder*="James Whitfield"]', PATIENT_NAME, { after: 400 });
  await chapter("Describing the case — this becomes the operative plan");
  await slowType(page, 'textarea[placeholder*="Elective open right"]', CASE_DESCRIPTION, {
    after: 600,
  });

  const docInput = page.locator('input[type="file"][accept*="text/plain"]');
  await chapter("Dropping in the prior records — GP summary, med list, prior anaesthetic");
  await docInput.setInputFiles(DOCS);
  await page.getByText("prior-anesthetic-record.md").waitFor();
  await beat(1400);

  await chapter("Creating the intake — records save, question prep begins");
  await slowClick(page, page.getByRole("button", { name: /Create intake/ }), { after: 600 });
  // transient chrome-strip status (App.tsx buildingLabel) — best-effort, the
  // real gate below ("Review the questions") is what actually matters
  await page
    .getByText(/Saving the records|Preparing the interview questions|Reading the records for gaps/)
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => console.log("   (building-status flash not caught — carrying on)"));
  const caseId = await newCaseId(before);
  console.log(`     case_id = ${caseId}`);

  const review = page.getByText("Review the questions");
  await review.waitFor({ timeout: GEN_TIMEOUT }); // real reasoning-tier gap analysis
  await chapter("Reviewing the clarifying questions the GapAnalyst raised");
  await beat(1600);
  // did the live GapAnalyst already catch the apixaban-timing conflict?
  await highlight(page, [/apixaban/i], "a GapAnalyst question already on the money", 2000);
  await chapter("Adding the one question that must not be missed");
  await slowType(page, 'input[placeholder="Add your own question…"]', GOLD_QUESTION, {
    after: 300,
  });
  await slowClick(page, page.getByRole("button", { name: "+ Add question" }), { after: 900 });
  await beat(1200);

  console.log(`CASE_ID=${caseId}`);
}

async function partPreop(page) {
  await selectProvider(page);
  await chapter(`Opening ${PATIENT_NAME}'s case for pre-op`);
  await slowClick(page, page.getByRole("button", { name: new RegExp(PATIENT_NAME) }), {
    after: 900,
  });

  const audioInput = page.locator('input[type="file"][accept*="audio"]');
  await chapter("Uploading the pre-op interview — the reviewed questions travel with it");
  await audioInput.setInputFiles(PREOP_WAV);
  await waitTranscribed(CASE_ID, "preop");
  await chapter("The transcript lands moments after the upload");
  await page.getByText("✓ transcribed").waitFor({ timeout: XCRIBE_TIMEOUT });
  await beat(1400);

  await chapter("The pre-op brief generates itself — live reasoning-tier NIM");
  await waitForBrief(page);
  await beat(800);

  // the interesting bit: the daughter's correction (apixaban taken yesterday,
  // not 3 days ago) should surface as a flagged/conflicting key fact
  await highlight(
    page,
    [/apixaban/i, /conflicting/i, /anticoagul/i],
    "the apixaban-timing conflict the interview revealed",
    2600,
  );
  // the key insight isn't just that a conflict was flagged — it's that it
  // traces straight back to the exact moment the daughter corrected it
  await openSource(
    page,
    [/apixaban/i, /conflicting/i],
    "the interview segment where the daughter corrects the record",
  );

  // provider corrections: the generated note is a draft, not a verdict —
  // edit the flagged claim in place and add a fact of our own
  await editClaim(
    page,
    ["apixaban"],
    " — confirmed directly with the daughter at bedside.",
    "the apixaban timing claim",
  );
  await addLine(
    page,
    "Add to the story so far…",
    "Discussed anticoagulant timing with the orthopaedic team before proceeding.",
    "a provider note on the anticoagulant discussion",
  );
  await tickEquipment(page, "the recommended airway equipment");

  await chapter("Signing off the pre-op note");
  await slowClick(page, page.getByRole("button", { name: "Sign off pre-op" }), { after: 1400 });
}

async function partIntraop(page) {
  await selectProvider(page);
  await openCase(page); // reopens onto the intra-op capture screen

  // idempotent resume: a prior interrupted attempt may have already gotten
  // the memos uploaded and/or the record generated (live generation is slow
  // and this script has a habit of dying on the LAST click, not the run
  // itself) — never redo an upload/generate that already landed.
  const already = await apiGet(`/api/cases/${CASE_ID}`);
  const hasRecord = already.artifacts?.some((a) => a.artifact_id === "record:intra-op");

  if (!hasRecord) {
    const inputsRecorded = !!already.workflow?.stages?.intraop?.inputs_recorded_at;
    if (!inputsRecorded) {
      await chapter("Opening the case for theatre — recording the first voice memo");
      await slowClick(page, page.getByRole("button", { name: /Record voice memo/ }), {
        after: 800,
      });
      const audioInput = page.locator('input[type="file"][accept*="audio"]');

      const labels = [
        "spinal placement + sedation",
        "the block goes patchy — converting to GA",
        "hypotension + transfusion",
        "closing + extubation",
      ];
      for (let i = 0; i < INTRAOP_SESSIONS.length; i++) {
        await chapter(`Theatre memo ${i + 1}/4 — ${labels[i]}`);
        await audioInput.setInputFiles(INTRAOP_SESSIONS[i]);
        await waitTranscribed(CASE_ID, "intraop");
        await page.getByTestId("transcript").waitFor({ timeout: XCRIBE_TIMEOUT });
        await beat(1400);
      }
    } else {
      console.log("   (memos already recorded from a prior attempt — resuming from here)");
    }

    await chapter("Generating the theatre record (live SSE, real reasoning + fast NIMs)");
    await slowClick(page, page.getByRole("button", { name: /Generate intra-op record/ }), {
      after: 500,
    });
    // unlike preop/postop, the intra-op brief's "Key facts" column (the
    // preop note) is already on screen before this stage's own generation
    // finishes — waitForBrief's heading check is a false-positive here, so
    // wait for the sign-off button itself, which only renders once the run
    // (EventExtractor → IntraOpRecordWriter → IssueAnticipator → ClaimVerifier)
    // has actually completed.
    await page
      .getByRole("button", { name: "Sign off intra-op" })
      .waitFor({ timeout: GEN_TIMEOUT });
    await beat(800);
  } else {
    console.log("   (theatre record already generated from a prior attempt — resuming from here)");
  }

  await highlight(
    page,
    [/70\D*40/, /phenylephrine/i, /hypotens/i, /transfusion/i, /blood loss/i],
    "the hypotension + transfusion event in the theatre timeline",
    2600,
  );
  // the timeline traces back to the actual dictated audio, not just text —
  // click-to-play provenance is the point of the theatre timeline
  await openSource(
    page,
    [/70\D*40/, /phenylephrine/i, /hypotens/i, /transfusion/i, /blood loss/i],
    "the anesthetist's own dictation of the hypotensive episode",
  );
  await highlight(
    page,
    [/bleed/i, /transfusion/i, /anticoagul/i, /neuromuscular/i, /analges/i],
    "an anticipated post-op issue",
    2600,
  );
  await editClaim(
    page,
    ["bleed", "transfusion", "blood"],
    " — group and screen already done, crossmatch on standby.",
    "an anticipated issue",
  );
  await addLine(
    page,
    "Add an anticipated issue…",
    "Monitor urine output hourly given CKD stage 3 and intra-op blood loss.",
    "a renal-monitoring issue given the blood loss",
  );

  await chapter("Signing off intra-op");
  await slowClick(page, page.getByRole("button", { name: "Sign off intra-op" }), { after: 1400 });
}

async function partPostop(page) {
  await selectProvider(page);
  await openCase(page); // reopens onto the post-op capture screen

  await chapter("To recovery — the post-op interview");
  await slowClick(page, page.getByRole("button", { name: /Record post-op interview/ }), {
    after: 800,
  });
  const audioInput = page.locator('input[type="file"][accept*="audio"]');
  await audioInput.setInputFiles(POSTOP_WAV);
  await waitTranscribed(CASE_ID, "postop");
  await page.getByTestId("transcript").waitFor({ timeout: XCRIBE_TIMEOUT });
  await beat(1400);

  await chapter("The PACU handoff & post-op note generate themselves (live SSE)");
  // "PACU handoff" is also a WriterColumn title on this same CaptureScreen
  // while the run is still streaming (postopColumns in CaptureScreen.tsx),
  // so waitForBrief's heading match is a false-positive here too (same
  // class of bug as intra-op) — wait for the real terminal action instead.
  await page.getByRole("button", { name: "Acknowledge handoff" }).waitFor({ timeout: GEN_TIMEOUT });
  await beat(800);

  await highlight(
    page,
    [/anticoagul/i, /apixaban/i, /renal|kidney/i, /blood pressure/i],
    "the handoff's anticoagulation / renal follow-up note",
    2600,
  );
  await openSource(
    page,
    [/anticoagul/i, /apixaban/i, /renal|kidney/i, /blood pressure/i],
    "what this handoff note is grounded in",
  );
  await highlight(page, [/recall/i, /throat/i, /nausea/i], "the post-anaesthesia evaluation", 2200);

  // tie the whole case together: ask the live assistant the exact question
  // that mattered from the very first screen — a real agent turn over this
  // case's own records, not a canned answer
  await askAssistant(
    page,
    "When exactly was the last apixaban dose, and did the timing meet neuraxial anaesthesia guidance?",
    "closing the loop on the apixaban timing",
  );

  await chapter("Acknowledging the handoff — taking over the patient");
  await slowClick(page, page.getByRole("button", { name: "Acknowledge handoff" }), { after: 1800 });
  await page.getByText("You now hold this patient.").waitFor();
  await beat(1500);

  await chapter("Back to the worklist");
  await slowClick(page, page.getByRole("button", { name: "Back to Worklist" }), { after: 900 });
  await page.getByRole("heading", { name: "Cases" }).waitFor();
  await beat(1200);

  // full circle: the equipment ticked at pre-op sign-off is a real
  // reservation, tagged to this case, in the shared equipment store
  const stockBtn = page.getByRole("button", { name: "Equipment stock" });
  if (await stockBtn.count().catch(() => 0)) {
    await chapter("Checking the equipment store — confirming the reservation");
    await slowClick(page, stockBtn, { after: 1200 });
    await highlight(page, [new RegExp(CASE_ID, "i")], "this case's equipment reservation", 2400);
    await slowClick(page, page.getByRole("button", { name: "‹ Worklist" }), { after: 900 });
    await page.getByRole("heading", { name: "Cases" }).waitFor();
  }
}

const PARTS = { intake: partIntake, preop: partPreop, intraop: partIntraop, postop: partPostop };

// --------------------------------------------------------------------------- #
// main
// --------------------------------------------------------------------------- #

async function main() {
  const outDir = dirname(OUT);
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: !HEADED, slowMo: Math.round(150 * PACE) });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    recordVideo: { dir: outDir, size: VIEWPORT },
  });
  const page = await context.newPage();

  let failed = null;
  try {
    console.log(`→ filming part "${PART}" on ${BASE_URL}\n`);
    await PARTS[PART](page);
  } catch (e) {
    failed = e;
    console.error(`\n✗ part "${PART}" failed: ${e.stack || e}`);
  } finally {
    const video = page.video();
    const tmpPath = video ? await video.path() : null;
    await context.close(); // flushes the .webm to disk
    await browser.close();

    if (tmpPath && existsSync(tmpPath)) {
      cpSync(tmpPath, OUT);
      rmSync(tmpPath, { force: true });
      console.log(`\n${failed ? "✗ partial" : "✓"} video saved → ${OUT}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => die(e.stack || String(e)));
