import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const expectAccessible = async (page: Page) => {
  const results = await new AxeBuilder({ page }).exclude(".js-plotly-plot").analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
};

const expectNoHorizontalOverflow = async (page: Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
};

test("PN and NPN shells remain responsive, themed and accessible", async ({ page }) => {
  for (const route of ["index.html", "bjt.html"]) {
    await page.goto(`./${route}`);
    await expect(page.getByRole("link", { name: "Device Lab" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Device laboratories" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const themeToggle = page.getByRole("button", { name: /^Use (dark|light) theme$/ });
    const initialPressed = await themeToggle.getAttribute("aria-pressed");
    await themeToggle.click();
    await expect(themeToggle).toHaveAttribute("aria-pressed", initialPressed === "true" ? "false" : "true");
    await expectAccessible(page);
  }
});

test("PN sweep produces accessible data and keeps plot controls outside data", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("./index.html");
  await page.getByRole("button", { name: "Calculate I–V sweep" }).click();
  await expect(page.getByRole("contentinfo", { name: "Calculation status" }).getByRole("status").first()).toContainText("67-point sweep converged");
  await expect(page.getByRole("region", { name: "Diode sweep outcome" })).toBeVisible();

  const frame = page.locator(".scientific-plot-frame").first();
  const toolbar = frame.locator(".scientific-plot-frame__toolbar");
  const plot = frame.locator(".scientific-plot-surface");
  await expect(toolbar).toBeVisible();
  const [toolbarBounds, plotBounds] = await Promise.all([toolbar.boundingBox(), plot.boundingBox()]);
  expect((toolbarBounds?.y ?? 0) + (toolbarBounds?.height ?? 0)).toBeLessThanOrEqual(plotBounds?.y ?? 0);
  await frame.getByText("Data table", { exact: true }).click();
  await expect(frame.getByRole("table")).toBeVisible();
  await expectAccessible(page);
  expect(pageErrors).toEqual([]);
});

test("NPN calculation can be cancelled without publishing partial results", async ({ page }) => {
  await page.goto("./bjt.html");
  await page.getByRole("button", { name: "Calculate characteristic grid" }).click();
  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByRole("contentinfo", { name: "Calculation status" }).getByRole("status").first()).toContainText("Calculation cancelled. No partial characteristic grid was kept.");
  await expect(page.getByRole("button", { name: "Calculate characteristic grid" })).toBeVisible();
  await expect(page.getByRole("region", { name: "NPN characteristic outcome" })).not.toContainText("Result current");
});

test("Plotly load failure is announced and offers retry", async ({ page }) => {
  await page.route("**/*plotly*", (route) => route.abort());
  await page.goto("./index.html");
  await expect(page.getByRole("alert").filter({ hasText: "Plot unavailable" }).first()).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry plot" }).first();
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByRole("alert").filter({ hasText: "Plot unavailable" }).first()).toBeVisible();
});
