import { type Page, expect } from "@playwright/test";
import path from "path";
import { mkdirSync } from "fs";

const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

/** Save a full-page screenshot to ui-tests/screenshots/{name}.png */
export async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: true,
  });
}

/** Wait for D3 charts to render inside .dash-panel containers */
export async function waitForD3(page: Page) {
  await page.waitForSelector(".dash-panel svg path, .dash-panel svg rect", {
    timeout: 15000,
  });
  // Allow a brief settle for animations
  await page.waitForTimeout(500);
}

/** Get a computed CSS property value for an element */
export async function getCSSProp(page: Page, selector: string, prop: string): Promise<string> {
  return page.locator(selector).first().evaluate(
    (el, p) => getComputedStyle(el).getPropertyValue(p),
    prop
  );
}

/** Read all <th> text from the current visible table, returns string[] */
export async function getColumnOrder(page: Page): Promise<string[]> {
  return page.$$eval("table thead th", (ths) =>
    ths.map((th) => (th.textContent || "").trim())
  );
}

/** Get the style.width (or computed width) of a <th> matching colName */
export async function getColumnWidth(page: Page, colName: string): Promise<string> {
  return page.$$eval(
    "table thead th",
    (ths, name) => {
      const th = ths.find((t) => (t.textContent || "").trim() === name);
      if (!th) return "";
      return (th as HTMLElement).style.width || getComputedStyle(th).width;
    },
    colName
  );
}

/** Wait for at least one table body row to appear */
export async function waitForTable(page: Page) {
  await page.waitForSelector("table tbody tr", { timeout: 15000 });
}

/** Wait for the edit/detail modal to open */
export async function waitForModal(page: Page) {
  await page.waitForSelector(".overlay.active .modal", { timeout: 10000 });
}

/** Assert no modal is currently open */
export async function assertNoModal(page: Page) {
  await expect(page.locator(".overlay.active")).toHaveCount(0);
}
