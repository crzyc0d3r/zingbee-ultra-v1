import { test } from "@playwright/test";
import { screenshot } from "../helpers";

test.describe("Home", () => {
  test("start screen with SubjectGrid renders @screenshot", async ({ page }) => {
    await page.goto("/");

    // Wait for the start screen to appear (it shows when no chat is active)
    await page.waitForSelector("#startScreen, .start-screen", { timeout: 15000 });

    await screenshot(page, "home-start-screen");
  });
});
