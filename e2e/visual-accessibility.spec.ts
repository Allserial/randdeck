import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function assertNoViewportOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

test("首屏无严重无障碍问题、无外部网络请求", async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (!["127.0.0.1", "localhost"].includes(url.hostname)) external.push(request.url()); });
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待抽取" })).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  const blocking = scan.violations.filter((item) => ["serious", "critical"].includes(item.impact || ""));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await assertNoViewportOverflow(page);
});

for (const viewport of [
  { name: "desktop-1180x820", width: 1180, height: 820 },
  { name: "compact-1024x768", width: 1024, height: 768 },
  { name: "minimum-680x620", width: 680, height: 620 },
  { name: "mobile-390x844", width: 390, height: 844 },
]) {
  test(`响应式视觉证据 ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "等待抽取" })).toBeVisible();
    await assertNoViewportOverflow(page);
    await page.screenshot({ path: `reports/playwright/${viewport.name}.png`, fullPage: false, animations: "disabled" });
  });
}

test("高对比主题与减少动态效果保持可操作", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto("/");
  await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
  await page.getByRole("group", { name: "主题" }).getByRole("button", { name: "高对比" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
  await page.getByRole("button", { name: /生成结果/ }).click();
  await expect(page.getByRole("heading", { name: "本次结果" })).toBeVisible();
  await page.screenshot({ path: "reports/playwright/high-contrast-reduced-motion.png", fullPage: true, animations: "disabled" });
});

test("骰子表达式使用 2D 骰面而不是 WebGL", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("抽取模式").getByRole("button", { name: /骰子/ }).click();
  await page.getByRole("group", { name: "求值方式" }).getByRole("button", { name: "单次" }).click();
  await page.getByRole("textbox", { name: "表达式" }).fill("2d6");
  await page.getByRole("button", { name: /生成结果/ }).click();
  await expect(page.getByRole("heading", { name: "本次结果" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".die-face")).toHaveCount(2);
  await expect(page.locator("[data-testid=dice-canvas] canvas")).toHaveCount(0);
  await page.screenshot({ path: "reports/playwright/2d-dice.png", fullPage: false, animations: "disabled" });
});
