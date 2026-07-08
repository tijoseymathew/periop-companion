/**
 * U2 exit criterion (ui.md §11): click a PACU-handoff claim's audio chip →
 * hear the exact pre-op interview clip (seek to t0, auto-pause at t1) — plus
 * the timestamp-only degradation when no wav is rendered.
 */
import { expect, test } from "@playwright/test";

function audioState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const el = document.querySelector("audio");
    return el ? { currentTime: el.currentTime, paused: el.paused, src: el.src } : null;
  });
}

test("PACU-handoff claim plays the cited pre-op interview clip with auto-pause", async ({
  page,
}) => {
  await page.goto("/");
  // sg-audio opens on its handoff note (its only artifact)
  await page.getByRole("button", { name: /sg-audio/ }).click();
  await page.getByRole("button", { name: /^audio:preop-interview#s001$/ }).click();

  // the cited segment (s001: 1.0–2.0s) is highlighted and the clip plays
  await expect(page.getByTestId("segment-s001")).toHaveAttribute("data-highlighted", "true");
  await expect
    .poll(async () => (await audioState(page))?.paused, { message: "clip should start" })
    .toBe(false);
  const playing = await audioState(page);
  expect(playing!.src).toContain("/api/cases/sg-audio/audio/audio%3Apreop-interview");
  expect(playing!.currentTime).toBeGreaterThanOrEqual(1.0);
  await expect(page.getByTestId("clip-marker")).toBeVisible();

  // while playing, the transcript follows along
  await expect(page.getByTestId("segment-s001")).toHaveAttribute("data-playing", "true");

  // auto-pause at t1=2.0 — never past the cited span
  await expect
    .poll(async () => (await audioState(page))?.paused, { message: "clip should auto-pause" })
    .toBe(true);
  const stopped = await audioState(page);
  expect(stopped!.currentTime).toBeGreaterThanOrEqual(2.0);
  expect(stopped!.currentTime).toBeLessThan(2.5);
  await expect(page.getByTestId("clip-marker")).toHaveCount(0);
});

test("transcript segment click seeks the loaded recording", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /sg-audio/ }).click();
  // the Interview tab shows the transcript for the case's recording
  await page.getByText("I stopped the aspirin.").click();
  await expect.poll(async () => (await audioState(page))?.currentTime).toBeGreaterThanOrEqual(1.0);
});

test("missing wav degrades to timestamp-only highlight (sg-0002 has no wav)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /sg-0002/ }).click();
  await page.getByRole("button", { name: /Pre-op evaluation/ }).click();
  const chip = page.getByRole("button", { name: /^audio:preop-interview#s\d+$/ }).first();
  const segId = (await chip.textContent())!.match(/#(s\d+)/)![1];
  await chip.click();
  await expect(page.getByText(/timestamp-only mode/)).toBeVisible();
  await expect(page.getByTestId(`segment-${segId}`)).toHaveAttribute("data-highlighted", "true");
  // the player returns to its idle state rather than erroring
  await expect(page.getByText(/no recording loaded/i)).toBeVisible();
});
