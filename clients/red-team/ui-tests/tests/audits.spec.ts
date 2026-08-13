import { test, expect } from "@playwright/test";
import { screenshot } from "../helpers";
import spec from "../ui-spec.json";

const auditSpec = spec.audit_detail;

test.describe("Audits", () => {
  test("audit list renders @screenshot", async ({ page }) => {
    await page.goto("/audits");
    await page.waitForSelector(".audit-list", { timeout: 15000 });

    await screenshot(page, "audits-list");
  });

  test("audit detail tabs match spec @screenshot", async ({ page }) => {
    await page.goto("/audits");
    await page.waitForSelector(".audit-card", { timeout: 15000 });

    // Click first audit card
    await page.click(".audit-card");
    await page.waitForSelector(".ad-tabs", { timeout: 15000 });

    // Read tab labels
    const tabLabels = await page.$$eval(".ad-tab", (tabs) =>
      tabs.map((t) => (t.textContent || "").replace(/\d+$/, "").trim())
    );
    expect(tabLabels).toEqual(auditSpec.tab_order);

    // Screenshot each tab
    for (const tabName of auditSpec.tab_order) {
      await page.click(`.ad-tab:has-text("${tabName}")`);
      await page.waitForSelector(`.ad-tab-active:has-text("${tabName}")`, { timeout: 5000 });
      await screenshot(page, `audits-tab-${tabName.toLowerCase().replace(/\s+/g, "-")}`);
    }
  });

  test("health score color matches threshold @screenshot", async ({ page }) => {
    await page.goto("/audits");
    await page.waitForSelector(".audit-card", { timeout: 15000 });

    await page.click(".audit-card");
    await page.waitForSelector(".ah-health-score", { timeout: 15000 });

    // Read the health score value and its inline style color attribute
    // (browsers normalize style.color to rgb(), so we parse the raw attribute instead)
    const { score, color } = await page.$eval(".ah-health-score", (el) => ({
      score: parseInt((el.textContent || "0").replace("%", ""), 10),
      color: el.getAttribute("style")?.match(/color:\s*([^;]+)/)?.[1]?.trim() || "",
    }));

    // Determine expected color from spec thresholds
    let expectedColor: string;
    if (score >= auditSpec.health_colors.high.min) {
      expectedColor = auditSpec.health_colors.high.color;
    } else if (score >= auditSpec.health_colors.medium.min) {
      expectedColor = auditSpec.health_colors.medium.color;
    } else {
      expectedColor = auditSpec.health_colors.low.color;
    }

    expect(color).toBe(expectedColor);
    await screenshot(page, "audits-health-score");
  });
});
