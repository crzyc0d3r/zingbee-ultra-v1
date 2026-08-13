import { test, expect } from "@playwright/test";
import { screenshot, waitForTable, getColumnOrder, getColumnWidth } from "../helpers";
import spec from "../ui-spec.json";

const tables = spec.tables as Record<
  string,
  { visible_cols: string[]; col_widths?: Record<string, number> }
>;

for (const [tableName, tableSpec] of Object.entries(tables)) {
  test.describe(`Admin Table: ${tableName}`, () => {
    test(`column order matches spec @screenshot`, async ({ page }) => {
      await page.goto("/admin");

      // Click the table name in the sidebar
      const navItem = page.locator(`.nav-item:has-text("${tableName}")`);
      // Some tables use display labels (e.g. "Subjects" for "subjects"), try
      // case-insensitive match via regex
      const navItemAlt = page.locator(".nav-item").filter({
        hasText: new RegExp(tableName.replace(/_/g, " "), "i"),
      });

      const target = (await navItem.count()) > 0 ? navItem : navItemAlt;
      await target.first().click();
      await waitForTable(page);

      const columns = await getColumnOrder(page);

      // DataTable prepends an "Actions" column
      const expectedCols = ["Actions", ...tableSpec.visible_cols];
      expect(columns).toEqual(expectedCols);

      await screenshot(page, `admin-${tableName}`);
    });

    if (tableSpec.col_widths) {
      for (const [colName, expectedWidth] of Object.entries(tableSpec.col_widths)) {
        test(`column "${colName}" width is ${expectedWidth}px`, async ({ page }) => {
          await page.goto("/admin");

          const navItem = page.locator(".nav-item").filter({
            hasText: new RegExp(tableName.replace(/_/g, " "), "i"),
          });
          await navItem.first().click();
          await waitForTable(page);

          const width = await getColumnWidth(page, colName);
          expect(width).toBe(`${expectedWidth}px`);
        });
      }
    }
  });
}
