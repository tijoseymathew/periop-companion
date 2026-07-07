/**
 * Tablet-width intra-op capture (brief §4.3): theatre use is realistically not
 * at a desktop. The intra-op voice-memo screen must stay one legible column
 * with an unmissable record control and never scroll sideways.
 */
import { expect, test } from "@playwright/test";
import { apiWalkToIntraop } from "./util";

test.use({ viewport: { width: 834, height: 1112 } }); // iPad Pro 11" portrait

test("intra-op capture at tablet width: one big control, no sideways scroll", async ({
  page,
  request,
}) => {
  await apiWalkToIntraop(request, "ZZZ Tablet TKR");

  await page.goto("/");
  await page.getByLabel(/working as/i).selectOption("p-tan");
  await page.getByRole("button", { name: /ZZZ Tablet TKR/ }).click();

  await expect(page.getByRole("heading", { name: /intra-op — voice memos/i })).toBeVisible();

  // one prominent, arm's-length record control
  const record = page.locator("[data-primary-action]:visible");
  await expect(record).toHaveCount(1);
  await expect(record).toContainText(/start dictating/i);
  const box = (await record.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);

  // the page never scrolls sideways
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
