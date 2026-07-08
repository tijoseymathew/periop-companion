/**
 * The full provider lifecycle (spec v2 §8): three provider identities walk one
 * case from creation to acknowledged handoff against the real FastAPI server
 * with the instant stub runner (PERIOP_STUB_RUNNER=1) — create → records →
 * question review → interview audio → generate (SSE progress) → sign off →
 * intra-op memos → generate → sign off → post-op → handoff → acknowledge →
 * sign off. Navigation is the top Stepper. Demo cases stay read-only.
 */
import { expect, test, type Page } from "@playwright/test";
import { makeWav } from "./util";

async function uploadAudio(page: Page, name: string) {
  await page
    .getByLabel(/upload audio/i)
    .setInputFiles({ name, mimeType: "audio/wav", buffer: makeWav() });
}

async function workAs(page: Page, providerId: string) {
  await page.getByLabel(/working as/i).selectOption(providerId);
}

/** Confirm the sign-off checkpoint and sign (reachable via the stepper pill). */
async function signOff(page: Page) {
  await page.getByRole("button", { name: "Sign off", exact: true }).click();
  await expect(page.getByRole("heading", { name: /sign off —/i })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /sign off as/i }).click();
}

test("three providers walk one case from creation to acknowledged handoff", async ({
  page,
}) => {
  await page.goto("/");

  // ---- Dr A (pre-op clinic) ------------------------------------------------
  await workAs(page, "p-lim");
  await page.getByRole("button", { name: /start a new case/i }).click();
  await page.getByLabel(/case label/i).fill("ZZZ E2E TKR Mrs W");
  await page.getByRole("button", { name: /create case/i }).click();

  // intake: paste the GP summary, then the op plan
  await expect(page.getByRole("heading", { name: "Records intake" })).toBeVisible();
  await page.getByLabel(/document type/i).selectOption("gp-summary");
  await page
    .getByLabel(/paste the document text/i)
    .fill("# GP Summary\n\n## Medications\n\nAspirin 100mg OD, current.");
  await page.getByRole("button", { name: /add document/i }).click();
  await expect(page.getByText(/added/i)).toBeVisible();
  await page.getByLabel(/document type/i).selectOption("op-plan");
  await page.getByLabel(/paste the document text/i).fill("# Op Plan\n\nLaparoscopic chole.");
  await page.getByRole("button", { name: /add document/i }).click();

  // the GapAnalyst ran at intake: find gaps, review, and approve
  await page.getByRole("button", { name: /find gaps in the record/i }).click();
  await expect(page.getByRole("heading", { name: "Clarifying questions" })).toBeVisible();
  await expect(page.getByText("Is the patient still taking aspirin?")).toBeVisible();
  await expect(page.getByRole("button", { name: /doc:gp-summary#c/ })).toBeVisible();
  await page.getByRole("button", { name: /approve & start interview/i }).click();

  // interview: upload path (the always-works fallback, v2 §10)
  await expect(page.getByRole("heading", { name: "Pre-op interview" })).toBeVisible();
  await uploadAudio(page, "preop-interview.wav");

  // generate with visible SSE progress, then the ledger appears
  await page.getByRole("button", { name: /generate pre-op note/i }).click();
  await expect(page.getByTestId("run-progress")).toBeVisible();
  await expect(page.getByText("Aspirin was stopped six days before surgery.")).toBeVisible();

  // the ledger surfaces the conflict, and per-claim review actions annotate it
  await expect(page.getByText("Conflicting").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark reviewed" }).first().click();
  await page.getByRole("button", { name: "Flag", exact: true }).nth(1).click();

  await signOff(page);
  await expect(page.getByRole("button", { name: /Pre-op evaluation/ })).toContainText(/signed off/);

  // ---- Dr B (theatre) — has never met the patient --------------------------
  await workAs(page, "p-tan");
  await page.getByRole("button", { name: /Intra-op record/ }).click();
  await expect(page.getByRole("heading", { name: /intra-op — voice memos/i })).toBeVisible();
  await uploadAudio(page, "memo-1.wav");
  await page.getByRole("button", { name: /done — generate record/i }).click();
  await page.getByRole("button", { name: /generate intra-op record/i }).click();
  await expect(page.getByText("Propofol 120 mg given at 08:02.")).toBeVisible();
  await signOff(page);
  await expect(page.getByRole("button", { name: /Intra-op record/ })).toContainText(/signed off/);

  // ---- Dr C (recovery) -----------------------------------------------------
  await workAs(page, "p-rahman");
  await page.getByRole("button", { name: /PACU handoff/ }).first().click(); // the stage node
  await expect(page.getByRole("heading", { name: "Post-op interview" })).toBeVisible();
  await uploadAudio(page, "postop-interview.wav");
  await page.getByRole("button", { name: /generate handoff & post-op note/i }).click();
  await expect(page.getByText("Aspirin held pre-op; restart per surgical team.")).toBeVisible();

  // step to the handoff, acknowledge (received, traceable), then sign off
  await page.getByRole("button", { name: "PACU handoff", exact: true }).click(); // the substep pill
  await expect(
    page.getByRole("heading", { name: /PACU handoff — receiving care/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /acknowledge handoff/i }).click();
  await expect(page.getByText(/handoff acknowledged/i)).toBeVisible();
  await signOff(page);

  // back on the worklist the case reads Complete, and it is Dr C's
  await page.getByRole("button", { name: /← Worklist/ }).click();
  const row = page.getByRole("button", { name: /ZZZ E2E TKR Mrs W/ });
  await expect(row).toContainText("Complete");
  await page.getByRole("button", { name: /my cases/i }).click();
  await expect(page.getByRole("button", { name: /ZZZ E2E TKR Mrs W/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /sg-0002/ })).toHaveCount(0);
});

test("demo cases stay read-only: no primary action anywhere", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /sg-0002/ }).click();
  await page.getByRole("button", { name: /Pre-op evaluation/ }).click();
  await expect(page.getByRole("heading", { name: /note:pre-anesthesia-eval/i })).toBeVisible();
  // reviewable everywhere, writable nowhere: no primary action on the note
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
});
