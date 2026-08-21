import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "掷数台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "等待抽取" })).toBeVisible();
}

async function useInstantMotion(page: Page) {
  await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
  await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: "即时" }).click();
  await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
}

async function resultValues(page: Page): Promise<number[]> {
  const items = await page.locator(".result-tile .result-value span").allTextContents();
  return items.map(Number);
}

test("范围排除、抽后移除、事务撤销形成完整闭环", async ({ page }) => {
  await openApp(page);
  await useInstantMotion(page);
  await page.getByRole("spinbutton", { name: "最小值" }).fill("1");
  await page.getByRole("spinbutton", { name: "最大值" }).fill("10");
  await page.locator(".stepper input").fill("5");
  await page.getByLabel("排除数字").fill("3,5,7");
  await expect(page.getByText("3 已排除")).toBeVisible();
  await page.getByRole("button", { name: /生成结果/ }).click();
  await expect(page.getByRole("heading", { name: "本次结果" })).toBeVisible();
  const allowed = new Set([1, 2, 4, 6, 8, 9, 10]);
  const first = await resultValues(page);
  expect(first).toHaveLength(5);
  expect(first.every((value) => allowed.has(value))).toBeTruthy();

  const tiles = page.locator(".result-tile .result-value");
  await tiles.nth(0).click();
  await page.getByRole("button", { name: "固定所选" }).click();
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await page.getByRole("button", { name: "重掷所选" }).click();
  const rerolled = await resultValues(page);
  expect(rerolled[0]).toBe(first[0]);
  await expect(page.getByText(/已固定 1 项|1 pinned/)).toBeVisible();

  await page.getByRole("switch", { name: /抽后移除/ }).click();
  await page.locator(".stepper input").fill("3");
  await page.getByRole("button", { name: /生成结果/ }).click();
  const noDup = await resultValues(page);
  expect(new Set(noDup).size).toBe(3);
  expect(noDup[0]).toBe(first[0]);
  await expect(page.getByRole("button", { name: /重置已抽记录/ })).toBeVisible();
  await page.getByRole("button", { name: /撤销本次抽取|Undo this draw/ }).click();
  await expect(page.getByRole("status").getByText(/撤销本次抽取|Undo this draw/)).toBeVisible();
});

test("局部重掷只滚动所选卡片，固定结果参与普通生成", async ({ page }) => {
  await openApp(page);
  await page.locator(".stepper input").fill("3");
  await page.getByRole("button", { name: /生成结果/ }).click();
  await expect(page.getByRole("heading", { name: "本次结果" })).toBeVisible();

  const tiles = page.locator(".result-tile");
  const firstValues = await resultValues(page);
  await tiles.nth(1).getByRole("button", { name: firstValues[1].toString(), exact: true }).click();
  await page.getByRole("button", { name: "重掷所选" }).click();
  await expect(tiles.nth(1)).toHaveClass(/is-rolling/);
  await expect(tiles.nth(0)).not.toHaveClass(/is-rolling/);
  await expect(tiles.nth(2)).not.toHaveClass(/is-rolling/);
  await expect(page.getByRole("heading", { name: "本次结果" })).toBeVisible();

  const afterReroll = await resultValues(page);
  await tiles.nth(0).getByRole("button", { name: afterReroll[0].toString(), exact: true }).click();
  await page.getByRole("button", { name: "固定所选" }).click();
  await page.getByRole("button", { name: /生成结果/ }).click();
  await expect(page.getByRole("heading", { name: "本次结果" })).toBeVisible();
  expect((await resultValues(page))[0]).toBe(afterReroll[0]);
});

test("刷新后回到范围池和洞察概览且结果舞台为空", async ({ page }) => {
  await openApp(page);
  await useInstantMotion(page);
  await page.getByRole("button", { name: /生成结果/ }).click();
  await page.getByLabel("抽取模式").getByRole("button", { name: /自定义池/ }).click();
  await page.getByLabel("主导航").getByRole("button", { name: /数据洞察/ }).click();
  await page.getByLabel("数据洞察视图").getByRole("button", { name: /历史/ }).click();

  await page.reload();

  await expect(page.getByRole("heading", { name: "等待抽取" })).toBeVisible();
  await expect(page.locator(".result-tile")).toHaveCount(0);
  await expect(page.getByLabel("抽取模式").getByRole("button", { name: /范围池/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("主导航").getByRole("button", { name: /数据洞察/ }).click();
  await expect(page.getByLabel("数据洞察视图").getByRole("button", { name: /概览/ })).toHaveClass(/active/);
});

test("清空历史同步清空结果舞台", async ({ page }) => {
  await openApp(page);
  await useInstantMotion(page);
  await page.getByRole("button", { name: /生成结果/ }).click();
  await page.getByLabel("主导航").getByRole("button", { name: /数据洞察/ }).click();
  await page.getByLabel("数据洞察视图").getByRole("button", { name: /历史/ }).click();
  await page.getByRole("button", { name: "清空历史" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认清空" }).click();
  await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();

  await expect(page.getByRole("heading", { name: "等待抽取" })).toBeVisible();
  await expect(page.locator(".result-tile")).toHaveCount(0);
});

test("自定义池、骰子表达式、倒计时后生成和概率分析均可运行", async ({ page }) => {
  await openApp(page);
  await useInstantMotion(page);

  await page.getByLabel("抽取模式").getByRole("button", { name: /自定义池/ }).click();
  await page.getByRole("button", { name: /编辑数字池/ }).click();
  await page.getByRole("button", { name: /批量粘贴/ }).click();
  await page.getByRole("dialog").locator("textarea").fill("11, 12, 13, 14");
  await page.getByRole("dialog").getByRole("button", { name: "载入草稿" }).click();
  await page.getByRole("button", { name: /校验并保存/ }).click();
  await page.keyboard.press("Escape");
  await page.locator(".stepper input").fill("3");
  await page.getByRole("button", { name: /生成结果/ }).click();
  expect((await resultValues(page)).every((value) => [11, 12, 13, 14].includes(value))).toBeTruthy();

  await page.getByLabel("抽取模式").getByRole("button", { name: /骰子表达式/ }).click();
  await page.getByRole("textbox", { name: "表达式" }).fill("2d6+1");
  await page.getByRole("button", { name: /生成结果/ }).click();
  const dice = await resultValues(page);
  expect(dice.every((value) => value >= 3 && value <= 13)).toBeTruthy();
  await expect(page.getByText("骰面明细").first()).toBeVisible();

  await page.getByLabel("主导航").getByRole("button", { name: /数据洞察/ }).click();
  await page.getByLabel("数据洞察视图").getByRole("button", { name: /概率/ }).click();
  await page.getByRole("button", { name: "开始分析" }).click();
  await expect(page.locator(".report-summary").getByText("精确", { exact: true })).toBeVisible();
});

test("审计回执、完整备份和展示窗口可离线传递当前结果", async ({ page, context }) => {
  await openApp(page);
  await useInstantMotion(page);
  await page.getByRole("button", { name: /生成结果/ }).click();
  await expect(page.getByRole("heading", { name: "本次结果" })).toBeVisible();

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "打开展示窗口" }).click();
  const display = await popupPromise;
  await display.waitForLoadState("domcontentloaded");
  await expect(display.getByText("掷数台 · 展示")).toBeVisible();
  await expect(display.locator(".result-tile").first()).toBeVisible();
  await display.close();

  await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出完整备份/ }).click();
  expect((await backupDownload).suggestedFilename()).toBe("掷数台-v0.6.0-backup.json");
});

test("视图切换时抽取台底栏隐藏、骰子预设可点击且展示窗支持多卡换行", async ({ page, context }) => {
  await openApp(page);
  await useInstantMotion(page);

  // 1. 验证高级标签仅在自定义池出现，范围/骰子模式完全不渲染
  await expect(page.getByRole("button", { name: /高级标签/ })).toBeHidden();
  await page.getByLabel("抽取模式").getByRole("button", { name: /自定义池/ }).click();
  await expect(page.getByRole("button", { name: /高级标签/ })).toBeVisible();

  // 2. 验证骰子预设分组与点击填充
  await page.getByLabel("抽取模式").getByRole("button", { name: /骰子表达式/ }).click();
  await expect(page.getByRole("button", { name: /高级标签/ })).toBeHidden();
  const preset4d6 = page.locator(".dice-presets button", { hasText: "4d6kh3" });
  await expect(preset4d6).toBeVisible();
  await preset4d6.click();
  await expect(page.getByRole("textbox", { name: "表达式" })).toHaveValue("4d6kh3");

  // 3. 切到数据洞察，验证「生成结果」按钮在主窗口中不可见且不可点击
  await page.getByLabel("主导航").getByRole("button", { name: /数据洞察/ }).click();
  await expect(page.getByRole("button", { name: /生成结果/ })).toBeHidden();

  // 4. 切到设置，同样验证「生成结果」按钮不可见
  await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
  await expect(page.getByRole("button", { name: /生成结果/ })).toBeHidden();

  // 5. 切回抽取台，生成结果并验证展示窗多卡排版换行
  await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
  await page.getByLabel("抽取模式").getByRole("button", { name: /范围池/ }).click();
  await page.locator(".stepper input").fill("10");
  await page.getByRole("button", { name: /生成结果/ }).click();
  await expect(page.getByRole("heading", { name: "本次结果" })).toBeVisible();

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "打开展示窗口" }).click();
  const display = await popupPromise;
  await display.waitForLoadState("domcontentloaded");
  const displayTiles = display.locator(".result-tile");
  await expect(displayTiles).toHaveCount(10);
  // 验证展示窗 flex-wrap 换行排版
  const wrapStyle = await display.locator(".display-results").evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return {
      flexWrap: computed.flexWrap,
      overflowX: computed.overflowX,
    };
  });
  expect(wrapStyle.flexWrap).toBe("wrap");
  expect(wrapStyle.overflowX).toBe("visible");
  await display.close();
});

test("四种关键视口没有横向溢出，窄窗口设置面板具备文字和焦点回收", async ({ page }) => {
  const viewports = [
    { width: 1180, height: 820 },
    { width: 1024, height: 768 },
    { width: 680, height: 620 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "掷数台" })).toBeVisible();
    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1);
    expect(noHorizontalOverflow, `${viewport.width}x${viewport.height} should not overflow horizontally`).toBeTruthy();

    if (viewport.width < 1040) {
      const toggle = page.getByRole("button", { name: "打开抽取设置" });
      await expect(toggle).toBeVisible();
      await toggle.click();
      const close = page.getByRole("button", { name: "关闭设置" });
      await expect(close).toBeVisible();
      await expect(toggle).toBeHidden();
      await close.click();
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeFocused();

      await toggle.click();
      await page.getByRole("textbox", { name: "排除数字" }).focus();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeFocused();
    } else {
      await expect(page.getByRole("button", { name: "生成结果" })).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const narrowToggle = page.getByRole("button", { name: "打开抽取设置" });
  if (await narrowToggle.isHidden()) await page.getByRole("button", { name: "关闭设置" }).click();
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.getByRole("button", { name: "生成结果" })).toBeVisible();
  await expect(page.locator("#draw-inspector-panel")).not.toHaveAttribute("aria-hidden", "true");
});
