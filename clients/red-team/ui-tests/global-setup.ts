import { chromium, type FullConfig } from "@playwright/test";

async function globalSetup(_config: FullConfig) {
  const password = process.env.TEST_PASSWORD;
  if (!password) throw new Error("TEST_PASSWORD env var is required for UI tests");

  const login = process.env.TEST_ADMIN_LOGIN;
  if (!login) throw new Error("TEST_ADMIN_LOGIN env var is required for UI tests");

  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await page.goto(`${process.env.E2E_BASE_URL || "http://localhost:3000"}/admin`);
  await page.waitForSelector("#loginEmail", { timeout: 15000 });

  await page.fill("#loginEmail", login);
  await page.fill("#loginPassword", password);
  await page.click(".login-btn");

  // Wait for sidebar to confirm successful login
  await page.waitForSelector(".sidebar", { timeout: 15000 });

  await context.storageState({ path: "ui-tests/auth.json" });
  await browser.close();
}

export default globalSetup;
