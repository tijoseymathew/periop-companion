/**
 * The full provider lifecycle (spec v2 §8): three provider identities walk
 * one case from creation to acknowledged handoff against the real FastAPI
 * server with the instant stub runner (PERIOP_STUB_RUNNER=1) — create →
 * records → question review → interview audio → generate (SSE progress) →
 * sign off → memos → intra-op → post-op → acknowledge. Demo cases stay
 * read-only throughout.
 */
import { expect, test, type Page } from "@playwright/test";

/** Valid PCM wav: mono, 16-bit, 16 kHz — accepted without ffmpeg server-side. */
function makeWav(seconds = 0.2): Buffer {
  const rate = 16000;
  const n = Math.round(rate * seconds);
  const data = Buffer.alloc(n * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function uploadAudio(page: Page, name: string) {
  await page
    .getByLabel(/upload audio/i)
    .setInputFiles({ name, mimeType: "audio/wav", buffer: makeWav() });
}

async function workAs(page: Page, providerId: string) {
  await page.getByLabel(/working as/i).selectOption(providerId);
}

test("three providers walk one case from creation to acknowledged handoff", async ({
  page,
}) => {
  await page.goto("/");

  // ---- Dr A (pre-op clinic) ------------------------------------------------
  await workAs(page, "p-lim");
  await page.getByRole("button", { name: /new case/i }).click();
  await page.getByLabel(/case label/i).fill("ZZZ E2E TKR Mrs W");
  await page.getByRole("button", { name: /create case/i }).click();

  // intake: paste the GP summary, then the op plan
  await expect(page.getByText(/add the patient's records/i)).toBeVisible();
  await page.getByLabel(/document type/i).selectOption("gp-summary");
  await page.getByLabel(/paste the document text/i).fill(
    "# GP Summary\n\n## Medications\n\nAspirin 100mg OD, current.",
  );
  await page.getByRole("button", { name: /add document/i }).click();
  await expect(page.getByText("Added ✓")).toBeVisible();
  await page.getByLabel(/document type/i).selectOption("op-plan");
  await page.getByLabel(/paste the document text/i).fill("# Op Plan\n\nLaparoscopic chole.");
  await page.getByRole("button", { name: /add document/i }).click();

  // the GapAnalyst ran at intake: review and approve, chip cites the chunk
  await expect(page.getByText("Is the patient still taking aspirin?")).toBeVisible();
  await expect(page.getByRole("button", { name: /doc:gp-summary#c/ })).toBeVisible();
  await page.getByRole("button", { name: /approve questions/i }).click();

  // interview: upload path (the always-works fallback, v2 §10)
  await expect(page.getByText(/record or upload the patient interview/i)).toBeVisible();
  await uploadAudio(page, "preop-interview.wav");

  // generate with visible SSE progress, then the ledger appears
  await page.getByRole("button", { name: /generate pre-op note/i }).click();
  await expect(page.getByTestId("run-progress")).toBeVisible();
  await expect(
    page.getByText("Aspirin was stopped six days before surgery."),
  ).toBeVisible();

  // sign-off surfaces the conflict, and is allowed
  await expect(page.getByText(/1 conflicting/i)).toBeVisible();

  // per-claim review actions (stretch): mark one reviewed, flag the other —
  // both land in the sign-off summary
  await page.getByRole("button", { name: "Mark reviewed" }).first().click();
  await expect(page.getByText(/1 of 2 claims marked reviewed/i)).toBeVisible();
  await page.getByRole("button", { name: "Flag", exact: true }).nth(1).click();
  await expect(page.getByText(/1 flagged by a reviewer/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /c-002 · flagged/ })).toBeVisible();

  await page.getByRole("button", { name: /sign off pre-op/i }).click();
  await expect(page.getByRole("tab", { name: /Pre-op.*signed off/i })).toBeVisible();

  // ---- Dr B (theatre) — has never met the patient ---------------------------
  await workAs(page, "p-tan");
  await page.getByRole("tab", { name: /Intra-op/i }).click();
  await expect(page.getByText(/what you need to know before induction/i)).toBeVisible();
  await expect(page.getByText("Records still list aspirin as current.")).toBeVisible();
  await uploadAudio(page, "memo-1.wav");
  await page.getByRole("button", { name: /generate intra-op record/i }).click();
  await expect(page.getByText("Propofol 120 mg given at 08:02.")).toBeVisible();

  // department dashboard (stretch): the case sits in the review queue, named
  // with its stage and who generated it; the row navigates back to the case
  await page.getByRole("button", { name: /department/i }).click();
  await expect(page.getByRole("heading", { name: "Department" })).toBeVisible();
  const queueRow = page.getByRole("button", { name: /ZZZ E2E TKR Mrs W/ });
  await expect(queueRow).toContainText(/Intra-op · generated by Dr B\. Tan/);
  await queueRow.click();

  await page.getByRole("button", { name: /sign off intra-op/i }).click();
  await expect(page.getByRole("tab", { name: /Intra-op.*signed off/i })).toBeVisible();

  // ---- Dr C (recovery) -------------------------------------------------------
  await workAs(page, "p-rahman");
  await page.getByRole("tab", { name: /Post-op/i }).click();
  await uploadAudio(page, "postop-interview.wav");
  await page.getByRole("button", { name: /generate handoff/i }).click();
  await expect(
    page.getByText("Aspirin held pre-op; restart per surgical team."),
  ).toBeVisible();
  // acknowledge first (received, traceable, acknowledged), then sign off
  await page.getByRole("button", { name: /acknowledge handoff/i }).click();
  await page.getByRole("button", { name: /sign off post-op/i }).click();

  // the worklist row reads Complete
  await expect(
    page.getByRole("option", { name: /ZZZ E2E TKR Mrs W/ }).getByText("Complete"),
  ).toBeVisible();

  // "my cases" (stretch): Dr C acknowledged the handoff, so the case is hers;
  // the seeded demo cases are nobody's
  await page.getByRole("button", { name: /my cases/i }).click();
  await expect(page.getByRole("option", { name: /ZZZ E2E TKR Mrs W/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /sg-0002/ })).toHaveCount(0);
});

test("demo cases stay read-only: no primary action anywhere", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("option", { name: /sg-0002/ }).click();
  // fully reviewable…
  await expect(
    page.getByRole("heading", { name: /note:pre-anesthesia-eval/ }),
  ).toBeVisible();
  // …but writable nowhere: no sign-off/generate/record button exists
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
});
