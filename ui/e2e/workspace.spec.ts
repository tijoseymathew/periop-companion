/** U1 exit criteria (ui.md §11): sg-0002 fully browsable, citation → highlight. */
import { expect, test, type Page } from "@playwright/test";

/** Open sg-0002 from the worklist and step to its pre-op claim review. */
async function openPreop(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /sg-0002/ }).click();
  await page.getByRole("button", { name: /Pre-op evaluation/ }).click();
  await expect(page.getByRole("heading", { name: /note:pre-anesthesia-eval/i })).toBeVisible();
}

test("worklist lists sg-0002 as review-only and opens it", async ({ page }) => {
  await page.goto("/");
  const row = page.getByRole("button", { name: /sg-0002/ });
  await expect(row).toContainText("Review only"); // demo cases are review-only (v2 §5.1)
  await row.click();
  await page.getByRole("button", { name: /Pre-op evaluation/ }).click();
  await expect(page.getByRole("heading", { name: /note:pre-anesthesia-eval/i })).toBeVisible();
});

test("doc-chunk citation click highlights the chunk in the source panel (U1 exit)", async ({
  page,
}) => {
  await openPreop(page);
  await page.getByRole("button", { name: /doc:gp-summary#c001/ }).first().click();
  const chunk = page.getByTestId("chunk-c001");
  await expect(chunk).toHaveAttribute("data-highlighted", "true");
  await expect(chunk).toBeInViewport();
  await expect(page.getByRole("tab", { name: "Documents" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("stepper nodes walk the three stages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /sg-0002/ }).click();
  await page.getByRole("button", { name: /Intra-op record/ }).click();
  await expect(page.getByRole("heading", { name: /record:intra-op/i })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible(); // intra-op events table
  await page.getByRole("button", { name: /PACU handoff/ }).click();
  await expect(
    page.getByRole("heading", { name: /PACU handoff — receiving care/i }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /note:pre-anesthesia-eval/i })).toHaveCount(0);
});

test("status filter toggle hides matching claims", async ({ page }) => {
  await openPreop(page);
  const rows = page.getByTestId("claim-text");
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "filter supported" }).click();
  await expect.poll(() => rows.count()).toBeLessThan(before);
  await page.getByRole("button", { name: "filter supported" }).click();
  await expect.poll(() => rows.count()).toBe(before);
});

test("audio citation highlights the transcript segment (no wav rendered here)", async ({
  page,
}) => {
  await openPreop(page);
  const chip = page.getByRole("button", { name: /^audio:preop-interview#s\d+$/ }).first();
  const segId = (await chip.textContent())!.match(/#(s\d+)/)![1];
  await chip.click();
  const segment = page.getByTestId(`segment-${segId}`);
  await expect(segment).toHaveAttribute("data-highlighted", "true");
  await expect(segment).toBeInViewport();
});

test("keyboard: arrows walk claims, Enter resolves the citation (U4)", async ({ page }) => {
  await openPreop(page);
  await page.getByTestId("claim-text").first().waitFor();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-active="true"]')).toHaveCount(1);
  await page.keyboard.press("Enter");
  // sg-0002's first pre-op claim cites doc:gp-summary#c001
  await expect(page.getByTestId("chunk-c001")).toHaveAttribute("data-highlighted", "true");
});

test("reverse index jumps from a segment back to a citing claim", async ({ page }) => {
  await openPreop(page);
  await page.getByRole("tab", { name: "Interview" }).click();
  const citedBy = page.getByRole("button", { name: /cited by \d+ claims?/ }).first();
  await citedBy.click();
  await citedBy.locator("xpath=following-sibling::ul//button").first().click();
  await expect(page.locator('[data-active="true"]')).toBeVisible();
});
