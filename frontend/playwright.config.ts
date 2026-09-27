import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    reducedMotion: "reduce",
    baseURL: "http://127.0.0.1:5179",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "../.venv/bin/python ../backend/e2e_server.py",
      url: "http://127.0.0.1:8019/api/health",
      reuseExistingServer: false,
    },
    {
      command:
        "API_TARGET=http://127.0.0.1:8019 npm run dev -- --port 5179 --strictPort",
      url: "http://127.0.0.1:5179",
      reuseExistingServer: false,
    },
  ],
});
