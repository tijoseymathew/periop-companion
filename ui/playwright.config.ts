/**
 * Headless e2e against the real FastAPI server (ui.md §10) pointed at a
 * hermetic fixture store (e2e/.fixture — the committed sg-0002.json plus a
 * generated wav; see e2e/setup-fixture.mjs). No network, no live NIMs.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const fixtureDir = fileURLToPath(new URL("./e2e/.fixture", import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  // one worker: the server holds a single-run lock (one generation at a time),
  // so specs that trigger stage runs must not overlap
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8123",
    headless: true,
    // PW_VIDEO=1 records each test (used to capture the README demo)
    video: process.env.PW_VIDEO ? "on" : "off",
    // live dictation e2e: a fake mic that never prompts (tone generator)
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  webServer: {
    // setup-fixture.mjs runs first so the fixture store always exists before
    // uvicorn imports the app (which reads the env dirs at import time)
    command:
      "node ui/e2e/setup-fixture.mjs && uv run uvicorn periop.api.app:app --host 127.0.0.1 --port 8123",
    cwd: "..",
    url: "http://127.0.0.1:8123/api/health",
    reuseExistingServer: false,
    env: {
      PERIOP_OUT_DIR: `${fixtureDir}/_out`,
      PERIOP_CASE_DIR: fixtureDir,
      // hermetic lifecycle e2e: the real server with instant stub artifacts
      PERIOP_STUB_RUNNER: "1",
    },
  },
});
