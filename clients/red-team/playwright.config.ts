import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./ui-tests/tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "html",

  globalSetup: "./ui-tests/global-setup.ts",

  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    ignoreHTTPSErrors: true,
    storageState: "ui-tests/auth.json",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // No webServer — connect to running dev server (two-process HTTPS stack)
});
