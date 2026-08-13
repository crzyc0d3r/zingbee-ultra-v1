import { test, expect } from "@playwright/test";
import { screenshot, waitForTable, waitForModal, assertNoModal } from "../helpers";

test.describe("Admin Modal", () => {
  test.describe.configure({ mode: "serial" });
  test("edit modal opens and closes on save @screenshot", async ({ page }) => {
    await page.goto("/admin");

    // Navigate to subjects table
    const navItem = page.locator(".nav-item").filter({ hasText: /subjects/i });
    await navItem.first().click();
    await waitForTable(page);

    // Click Edit on first row
    const editBtn = page.locator('button[data-action="edit"]').first();
    await editBtn.click();
    await waitForModal(page);

    // Assert modal is open
    await expect(page.locator(".overlay.active")).toHaveCount(1);
    await screenshot(page, "admin-modal-open");

    // Click Save
    const saveBtn = page.locator(".overlay.active .btn.btn-primary");
    await saveBtn.click();

    // Wait for modal to close (network request + DOM update)
    await page.waitForSelector(".overlay.active", { state: "hidden", timeout: 10000 });
    await assertNoModal(page);

    await screenshot(page, "admin-modal-closed");
  });

  test("edit modal closes via X button", async ({ page }) => {
    await page.goto("/admin");

    const navItem = page.locator(".nav-item").filter({ hasText: /subjects/i });
    await navItem.first().click();
    await waitForTable(page);

    const editBtn = page.locator('button[data-action="edit"]').first();
    await editBtn.click();
    await waitForModal(page);

    // Close via X button
    await page.click(".modal-x");
    await page.waitForSelector(".overlay.active", { state: "hidden", timeout: 10000 });
    await assertNoModal(page);
  });
});
