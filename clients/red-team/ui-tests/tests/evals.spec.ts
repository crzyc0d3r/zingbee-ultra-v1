import { test, expect } from "@playwright/test";
import { screenshot } from "../helpers";

test.describe("Evals", () => {
  test("evals page renders @screenshot", async ({ page }) => {
    await page.goto("/evals");
    await page.waitForSelector(".page-evals", { timeout: 15000 });

    // Wait for either the toolbar (loaded state) or empty state
    await page.waitForSelector(".toolbar, .empty", { timeout: 15000 });
    const rendered = await page.locator(".toolbar, .empty").count();
    expect(rendered).toBeGreaterThan(0);

    await screenshot(page, "evals-list");
  });
});
