import { test } from "@playwright/test";
import { screenshot, waitForD3 } from "../helpers";

test.describe("Admin Dashboard", () => {
  test("renders dashboard with D3 charts @screenshot", async ({ page }) => {
    await page.goto("/admin");

    // Click Dashboard nav item
    await page.click('.nav-item:has-text("Dashboard")');
    await waitForD3(page);

    await screenshot(page, "admin-dashboard");
  });
});
