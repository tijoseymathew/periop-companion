/** U1 exit criteria (ui.md §11): sg-0002 fully browsable, citation → highlight. */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("case list loads and auto-selects sg-0002", async ({ page }) => {
  const option = page.getByRole("option", { name: /sg-0002/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(option).toContainText("5 artifacts · 82 claims");
  await expect(page.getByRole("tab", { name: "Pre-op" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /note:pre-anesthesia-eval/ })).toBeVisible();
});

test("doc-chunk citation click highlights the chunk in the source panel (U1 exit)", async ({
  page,
}) => {
  await page.getByRole("button", { name: "doc:gp-summary#c001" }).first().click();
  const chunk = page.getByTestId("chunk-c001");
  await expect(chunk).toHaveAttribute("data-highlighted", "true");
  await expect(chunk).toBeInViewport();
  await expect(page.getByRole("tab", { name: "doc:gp-summary" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("stage tabs walk the three stages", async ({ page }) => {
  await page.getByRole("tab", { name: "Intra-op" }).click();
  await expect(page.getByRole("heading", { name: /record:intra-op/ })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible(); // intra-op events table
  await page.getByRole("tab", { name: "Post-op" }).click();
  await expect(page.getByRole("heading", { name: /note:pacu-handoff/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /note:pre-anesthesia-eval/ })).toHaveCount(0);
});

test("status filter toggle hides matching claims", async ({ page }) => {
  const rows = page.getByTestId("claim-text");
  await expect(rows.first()).toBeVisible(); // wait out the async case load
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
  // find a chip citing the pre-op interview and click it
  const chip = page.getByRole("button", { name: /^audio:preop-interview#s\d+$/ }).first();
  const ref = await chip.textContent();
  const segId = ref!.split("#")[1];
  await chip.click();
  const segment = page.getByTestId(`segment-${segId}`);
  await expect(segment).toHaveAttribute("data-highlighted", "true");
  await expect(segment).toBeInViewport();
});

test("reverse index jumps from a segment back to a citing claim", async ({ page }) => {
  await page.getByRole("tab", { name: "audio:preop-interview" }).click();
  const citedBy = page.getByRole("button", { name: /cited by \d+ claims?/ }).first();
  await citedBy.click();
  // the expanded list shows citing claims; click the first one
  await citedBy.locator("xpath=following-sibling::ul//button").first().click();
  await expect(page.locator('[data-active="true"]')).toBeVisible();
});
