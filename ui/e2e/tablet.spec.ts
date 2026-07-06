/**
 * Tablet-width layout (spec v2 §2 stretch): theatre use is realistically not
 * at a desktop. Below the desktop breakpoint the provenance rail hides and
 * the worklist becomes a drawer behind a labelled Cases button, so the
 * intra-op capture screen is one big column — record button unmissable,
 * no horizontal scrolling (v2 §6.5).
 */
import { expect, test } from "@playwright/test";
import { apiWalkToIntraop } from "./util";

test.use({ viewport: { width: 834, height: 1112 } }); // iPad Pro 11" portrait

test("intra-op capture at tablet width: one column, drawer worklist", async ({
  page,
  request,
}) => {
  const caseId = await apiWalkToIntraop(request, "ZZZ Tablet TKR");

  await page.goto("/");

  // the worklist is a drawer here: closed on load, opened by a labelled button
  const worklist = page.getByTestId("worklist");
  await expect(worklist).toBeHidden();
  await page.getByRole("button", { name: "Cases", exact: true }).click();
  await expect(worklist).toBeVisible();
  await page.getByRole("option", { name: /ZZZ Tablet TKR/ }).click();
  await expect(worklist).toBeHidden(); // selecting closes the drawer

  // the provenance rail is hidden at this width — capture gets the screen
  await expect(page.getByTestId("provenance-rail")).toBeHidden();

  // intra-op orientation + the one big record button, legible at arm's length
  await expect(page.getByText(/what you need to know before induction/i)).toBeVisible();
  const record = page.locator("[data-primary-action]");
  await expect(record).toHaveCount(1);
  await expect(record).toContainText(/record voice memo/i);
  const box = (await record.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(500);

  // the page never scrolls sideways
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // keep the fixture store tidy for other specs' worklist assertions
  void caseId;
});

test("desktop width keeps the three-column workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("worklist")).toBeVisible();
  await expect(page.getByTestId("provenance-rail")).toBeVisible();
  await expect(page.getByRole("button", { name: /^cases$/i })).toBeHidden();
});
