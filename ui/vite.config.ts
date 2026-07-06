import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // ws: true so the live-dictation WebSocket proxies in dev too
    proxy: { "/api": { target: "http://localhost:8000", ws: true } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"], // e2e/ belongs to Playwright
  },
});
