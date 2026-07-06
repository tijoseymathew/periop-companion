/**
 * Live intra-op dictation e2e (spec v2 §2 stretch): a fake microphone feeds
 * the real WebSocket path — PCM up, partial/final transcript events down
 * from the fake streaming transcriber (PERIOP_STUB_RUNNER=1) — and stop
 * lands the segments on the case like any memo, ready to generate.
 */
import { expect, test } from "@playwright/test";
import { apiWalkToIntraop } from "./util";

test("dictating a voice note streams the transcript live and saves segments", async ({
  page,
  request,
}) => {
  await apiWalkToIntraop(request, "ZZZ Dictation Chole");

  await page.goto("/");
  await page.getByLabel(/working as/i).selectOption("p-tan");
  await page.getByRole("option", { name: /ZZZ Dictation Chole/ }).click();

  // dictation-first capture screen, orientation pinned above it
  await expect(page.getByText(/what you need to know before induction/i)).toBeVisible();
  await page.getByRole("button", { name: /start dictating/i }).click();

  // words appear while speaking (fake transcriber emits one partial per frame)
  await expect(page.getByTestId("live-transcript")).toContainText("Propofol one twenty…");

  await page.getByRole("button", { name: /stop dictating/i }).click();

  // saved: the workflow moves on to generation…
  await expect(
    page.getByRole("button", { name: /generate intra-op record/i }),
  ).toBeVisible();

  // …and the streamed words are a citable transcript segment on the case
  const kase = await (
    await request.get("/api/cases/zzz-dictation-chole")
  ).json();
  const source = kase.sources.find(
    (s: { source_id: string }) => s.source_id === "audio:intraop-notes",
  );
  expect(source.segments).toHaveLength(1);
  expect(source.segments[0].text).toBe("[08:02] Propofol one twenty milligrams.");
  expect(source.segments[0].speaker).toBe("PROVIDER");
});
