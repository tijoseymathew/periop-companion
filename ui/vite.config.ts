import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // ws: true so the live-dictation WebSocket proxies in dev too.
    // PERIOP_API_PORT mirrors the server env var — needed when a local NIM
    // already holds :8000 and the API runs elsewhere.
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.PERIOP_API_PORT ?? "8000"}`,
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"], // e2e/ belongs to Playwright
  },
});
