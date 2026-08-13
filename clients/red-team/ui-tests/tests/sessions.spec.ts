import { test, expect } from "@playwright/test";
import { screenshot } from "../helpers";

test.describe("Sessions", () => {
  test("session list renders @screenshot", async ({ page }) => {
    await page.goto("/sessions");
    await page.waitForSelector(".page-sessions", { timeout: 15000 });

    // Wait for either the table rows or empty state (CSS comma = OR)
    await page.waitForSelector("table tbody tr, .empty", { timeout: 15000 });
    const rendered = await page.locator("table tbody tr, .empty").count();
    expect(rendered).toBeGreaterThan(0);

    await screenshot(page, "sessions-list");
  });

  test("session detail renders on click @screenshot", async ({ page }) => {
    await page.goto("/sessions");
    await page.waitForSelector(".page-sessions", { timeout: 15000 });

    // Wait for table to potentially load
    await page.waitForSelector("table tbody tr, .empty", { timeout: 15000 });

    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    test.skip(count === 0, "No session rows available -- skipping detail test");

    await rows.first().click();
    // Wait for detail panel to appear
    await page.waitForSelector("[class*='detail'], [class*='Detail']", { timeout: 10000 });
    await screenshot(page, "sessions-detail");
  });
});
