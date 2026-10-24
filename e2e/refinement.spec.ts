import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createDefaultState } from "../src/app/state";

async function seed(page: Page, locale: "zh-CN" | "en-US", theme: "dark" | "light" | "contrast") {
  const state = createDefaultState();
  state.ui.locale = locale; state.settings.appearance.theme = theme;
  state.settings.appearance.motion = "instant"; state.settings.muted = true;
  state.settings.min = 100000001; state.settings.max = 100000100;
  await page.addInitScript(state => localStorage.setItem("zhishutai.state.v4", JSON.stringify(state)), state);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

async function checkAction(page: Page) {
  const generate = page.locator(".generate-main-btn:visible");
  await expect(generate).toHaveCount(1);
  const bounds = await generate.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect.poll(() => generate.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })).toBe(true);
}

for (const locale of ["zh-CN", "en-US"] as const) for (const theme of ["dark", "light", "contrast"] as const) {
  test(`visual matrix ${locale} ${theme}`, async ({ page }) => {
    test.setTimeout(120000);
    await seed(page, locale, theme);
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".result-tile")).toHaveCount(5);
    for (const [width,height] of [[1180,820],[1024,768],[680,620],[390,844]]) {
      await page.setViewportSize({ width,height });
      if (width < 1040 && await page.locator(".inspector-close:visible").count()) await page.locator(".inspector-close:visible").click();
      await checkAction(page);
      const clipping = await page.locator(".fit-number").evaluateAll(els => els.some(el => { const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(), p = el.parentElement!.getBoundingClientRect(); return r.left < p.left - 1 || r.right > p.right + 1 || r.height > 90 || getComputedStyle(el).whiteSpace !== "nowrap"; }));
      expect(clipping).toBe(false);
      const stageContent = await page.locator(".stage-content").boundingBox();
      const resultActions = await page.locator(".selection-actions").boundingBox();
      expect(stageContent!.y + stageContent!.height).toBeLessThanOrEqual(resultActions!.y + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width < 1040) {
        await page.locator(".inspector-toggle").click();
        await checkAction(page);
        await page.keyboard.press("Escape");
        await expect(page.locator(".inspector-toggle")).toBeFocused();
      }
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations.filter(v => ["serious","critical"].includes(v.impact ?? "")), JSON.stringify(scan.violations)).toEqual([]);
      await page.screenshot({ path: `reports/视觉调优/2026-10-24/调整后截图/${locale}-${theme}-${width}.png` });
    }
  });
}

test("pins cannot cross modes; display follows result origin and history clearing", async ({ page, context }) => {
  await seed(page,"zh-CN","dark");
  await page.locator(".generate-main-btn").click();
  await page.locator(".result-value").first().click();
  await page.getByRole("button",{ name:"固定所选", exact:true }).click();
  const popup = context.waitForEvent("page");
  await page.getByRole("button",{ name:"打开展示窗口", exact:true }).click();
  const display = await popup;
  await expect(display.locator(".result-tile--range")).toHaveCount(5);
  await page.getByLabel("抽取模式").getByRole("button",{name:"骰子表达式",exact:true}).click();
  await expect(page.locator(".result-tile.pinned")).toHaveCount(0);
  await expect(page.locator(".result-source")).toContainText("范围池");
  await page.getByRole("textbox", {name:"表达式",exact:true}).fill("2d6");
  await page.locator(".generate-main-btn").click();
  await expect(display.locator(".result-tile--expression")).toHaveCount(5);
  const values = (await page.locator(".fit-number").allTextContents()).map(Number);
  expect(values.every(v=>v>=2&&v<=12)).toBe(true);
  await page.getByLabel("主导航").getByRole("button",{name:"数据洞察",exact:true}).click();
  await page.getByLabel("数据洞察视图").getByRole("button",{name:/历史/}).click();
  await page.getByRole("button",{name:"清空历史",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"确认清空",exact:true}).click();
  await expect(display.locator(".result-tile")).toHaveCount(0);
  await display.close();
});

test("probability chart and table expose every candidate", async ({page}) => {
  await seed(page,"zh-CN","light");
  await page.getByRole("spinbutton",{name:"最小值",exact:true}).fill("1");
  await page.getByRole("spinbutton",{name:"最大值",exact:true}).fill("250");
  await page.getByLabel("主导航").getByRole("button",{name:"数据洞察",exact:true}).click();
  await page.getByLabel("数据洞察视图").getByRole("button",{name:/概率/}).click();
  await page.getByRole("button",{name:"开始分析",exact:true}).click();
  await expect(page.locator(".chart-panel")).toHaveCount(1);
  await expect(page.locator(".probability-table > div")).toHaveCount(51);
  for(let i=0;i<4;i++) await page.locator(".probability-workspace > .pager").getByRole("button",{name:"下一页"}).click();
  await expect(page.locator(".probability-table")).toContainText("250");
  await expect(page.locator(".probability-workspace > .pager").getByRole("button",{name:"下一页"})).toBeDisabled();
});

test("dense results keep actions reachable and narrow history actions work", async ({ page }) => {
  await seed(page, "en-US", "light");
  await page.locator(".stepper input").fill("50");
  await page.locator(".generate-main-btn:visible").click();
  await expect(page.locator(".result-tile")).toHaveCount(50);
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator(".inspector-close:visible").count()) await page.locator(".inspector-close:visible").click();
  await checkAction(page);
  await page.getByLabel("Main navigation").getByRole("button", { name: "Insights", exact: true }).click();
  await page.locator(".view-tabs button").nth(1).click();
  await page.locator(".history-more").first().click();
  await expect(page.getByRole("menuitem")).toHaveCount(4);
  await page.getByRole("menuitem").first().click();
  await expect(page.locator(".result-tile")).toHaveCount(50);
  await expect(page.locator(".result-source")).toContainText("History");
  await checkAction(page);
  await page.screenshot({ path: "reports/视觉调优/2026-10-24/调整后截图/50项历史回放-390.png" });
});

test("long negative decimal values stay complete and display selection does not open a window", async ({ page, context }) => {
  await seed(page, "zh-CN", "dark");
  await page.getByLabel("抽取模式").getByRole("button", { name: "骰子表达式", exact: true }).click();
  await page.getByRole("textbox", { name: "表达式", exact: true }).fill("-123456789/7");
  await page.locator(".generate-main-btn:visible").click();
  const original = String(-123456789 / 7);
  await expect(page.locator(".fit-number").first()).toHaveText(original);
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator(".inspector-close:visible").count()) await page.locator(".inspector-close:visible").click();
  expect(await page.locator(".fit-number").evaluateAll(els => els.every(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const r = range.getBoundingClientRect(), p = el.parentElement!.getBoundingClientRect();
    return r.left >= p.left && r.right <= p.right && getComputedStyle(el).whiteSpace === "nowrap";
  }))).toBe(true);
  await page.screenshot({ path: "reports/视觉调优/2026-10-24/调整后截图/长负数小数-390.png" });
  await page.getByLabel("主导航").getByRole("button", { name: "设置", exact: true }).click();
  const before = context.pages().length;
  await page.locator(".display-modes").getByRole("button", { name: "全屏演示", exact: true }).click();
  expect(context.pages().length).toBe(before);
});

test("countdown keyboard controls commit once and forced colors remain operable", async ({ page }) => {
  await seed(page, "zh-CN", "contrast");
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.getByLabel("主导航").getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: "仪式" }).click();
  await page.locator(".ceremony-timer-setting button").filter({ hasText: "3" }).click();
  await page.getByLabel("主导航").getByRole("button", { name: "抽取台", exact: true }).click();
  await expect(page.locator(".countdown-sub-btn")).toBeVisible();
  await page.getByLabel("排除数字", { exact: true }).focus();
  await page.keyboard.press("Shift+Space");
  await expect(page.locator(".ceremony-countdown-hero")).toHaveCount(0);
  await page.getByLabel("排除数字", { exact: true }).fill("");
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("Shift+Enter");
  await expect(page.locator(".result-tile")).toHaveCount(0);
  await page.keyboard.press("Shift+Space");
  await expect(page.locator(".ceremony-countdown-hero")).toBeVisible();
  await page.keyboard.press("Shift+Space");
  await expect(page.locator(".ceremony-countdown-hero")).toBeHidden({ timeout: 8000 });
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  await expect(page.locator(".recent-items > button")).toHaveCount(1);
  await expect(page.locator(".result-tile")).toHaveCount(5);
  await checkAction(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  if (!await page.locator(".inspector-close:visible").count()) await page.locator(".inspector-toggle").click();
  await page.locator('#draw-inspector-panel button[aria-keyshortcuts="Shift+Space"]').click();
  await expect(page.locator(".ceremony-countdown-hero")).toBeVisible();
  await page.locator("[data-inspector-heading]").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ceremony-countdown-hero")).toHaveCount(0);
  await expect(page.locator(".recent-items > button")).toHaveCount(1);
});
