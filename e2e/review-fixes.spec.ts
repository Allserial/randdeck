import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app-brand h1")).toHaveText("掷数台");
}

async function setMotion(page: Page, motion: "即时" | "仪式") {
  await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
  await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: motion, exact: true }).click();
  await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
}

async function setCount(page: Page, count: number) {
  await page.locator(".stepper input").fill(String(count));
  await page.locator(".stepper input").press("Enter");
}

test("F02: navigation and Escape cancel a ceremony during its opening animation", async ({ page }) => {
  await openApp(page);
  await setMotion(page, "仪式");
  for (const action of ["navigation", "Escape"]) {
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".result-stage")).toHaveClass(/is-drawing/);
    if (action === "navigation") {
      await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
      await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
    } else {
      await page.keyboard.press("Escape");
    }
    await expect(page.locator(".result-stage")).not.toHaveClass(/is-drawing/);
    // Wait beyond intro plus the full default five-card reveal, where the stale operation used to commit.
    await page.waitForTimeout(2800);
    await expect(page.locator(".result-tile")).toHaveCount(0);
    await expect(page.locator(".recent-items button")).toHaveCount(0);
    await expect(page.locator(".ceremony-title-banner")).toHaveCount(0);
  }
});

test("F03: removing the displayed history does not expose another batch's stage note", async ({ page }) => {
  await openApp(page);
  await setMotion(page, "即时");
  await page.locator(".generate-main-btn:visible").click();
  await page.locator(".stage-note-btn").click();
  await page.getByRole("dialog").locator("input.note-input").fill("KEEP-A-NOTE");
  await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  await page.locator(".generate-main-btn:visible").click();
  await page.getByLabel("主导航").getByRole("button", { name: /数据洞察/ }).click();
  await page.locator(".view-tabs").getByRole("button", { name: "历史", exact: true }).click();
  await expect(page.locator(".history-table article")).toHaveCount(2);
  await page.locator(".history-table article").first().getByRole("button", { name: "删除该批", exact: true }).click();
  await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
  await expect(page.locator(".stage-note-btn")).toHaveCount(0);
  await page.getByLabel("主导航").getByRole("button", { name: /数据洞察/ }).click();
  await expect(page.locator(".history-table article")).toHaveCount(1);
  await expect(page.locator(".history-table article")).toContainText("KEEP-A-NOTE");
});

test("F04: dense dice results fit at supported desktop widths for 11, 20 and 50 cards", async ({ page }, testInfo) => {
  await openApp(page);
  await setMotion(page, "即时");
  await page.getByLabel("抽取模式").getByRole("button", { name: "骰子表达式", exact: true }).click();
  await page.getByRole("textbox", { name: "表达式", exact: true }).fill("1d20+5+2d6+2+1d4");
  for (const count of [11, 20, 50]) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await setCount(page, count);
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".result-tile")).toHaveCount(count);
    for (const width of [760, 680, 1180]) {
      await page.setViewportSize({ width, height: 700 });
      if (await page.locator(".inspector-close:visible").count()) await page.locator(".inspector-close:visible").click();
      const metrics = await page.locator(".result-tile").evaluateAll((tiles) => tiles.map((tile) => {
        const value = tile.querySelector(".result-value")!.getBoundingClientRect();
        const text = tile.querySelector(".fit-number")!.getBoundingClientRect();
        const footer = tile.querySelector(".tile-footer")!.getBoundingClientRect();
        const card = tile.getBoundingClientRect();
        return { valueHeight: value.height, textHeight: text.height,
          topInset: text.top - value.top, bottomInset: value.bottom - text.bottom,
          leftInset: text.left - value.left, rightInset: value.right - text.right,
          footerInset: card.bottom - footer.bottom, overflow: tile.scrollHeight - tile.clientHeight };
      }));
      for (const metric of metrics) {
        expect(metric.topInset, `${count} cards at ${width}px: ${JSON.stringify(metric)}`).toBeGreaterThanOrEqual(-0.5);
        expect(metric.bottomInset).toBeGreaterThanOrEqual(-0.5);
        expect(metric.leftInset).toBeGreaterThanOrEqual(-0.5);
        expect(metric.rightInset).toBeGreaterThanOrEqual(-0.5);
        expect(metric.footerInset).toBeGreaterThanOrEqual(-0.5);
        expect(metric.overflow).toBeLessThanOrEqual(1);
      }
      await testInfo.attach(`dense-${count}-${width}.json`, { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
      if (count === 50 && width < 1000) await page.screenshot({ path: testInfo.outputPath(`dense-dice-${width}.png`) });
    }
  }
});

test("F07: countdown generation retains fixed cards and their interaction state", async ({ page }) => {
  await openApp(page);
  await setMotion(page, "即时");
  await setCount(page, 3);
  await page.locator(".generate-main-btn:visible").click();
  const pinned = page.locator(".result-tile").nth(1);
  const value = await pinned.locator(".fit-number").innerText();
  await pinned.locator(".result-value").click();
  await page.getByRole("button", { name: "固定所选", exact: true }).click();
  await setMotion(page, "仪式");
  await page.locator(".countdown-sub-btn:visible").click();
  await expect(page.locator(".ceremony-title-banner")).toBeVisible({ timeout: 12000 });
  await page.getByRole("button", { name: "立即全部揭晓 (空格)", exact: true }).click();
  await expect(page.locator(".ceremony-return-btn")).toBeVisible();
  await page.locator(".ceremony-return-btn").click();
  await expect(pinned).toHaveClass(/pinned/);
  await expect(pinned.locator(".fit-number")).toHaveText(value);
  await expect(page.locator(".recent-items button")).toHaveCount(2);
});

test("F08/F09: root-array JSON imports and exported CSV preserves tagged candidates", async ({ page }) => {
  await openApp(page);
  await page.getByLabel("抽取模式").getByRole("button", { name: "自定义池", exact: true }).click();
  await page.getByRole("button", { name: "编辑数字池", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.locator('input[type="file"]');
  await input.setInputFiles({ name: "pool.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([
    { value: 7, tags: ["2026", "红色"] }, { value: -8, tags: ["blue,quoted"] },
  ])) });
  await expect(dialog.getByRole("spinbutton", { name: "数字 1", exact: true })).toHaveValue("7");
  await expect(dialog.getByRole("textbox", { name: "标签 1", exact: true })).toHaveValue("2026|红色");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  await dialog.getByRole("spinbutton", { name: "数字 1", exact: true }).fill("999");
  await input.setInputFiles({ name: "roundtrip.csv", mimeType: "text/csv", buffer: Buffer.concat(chunks) });
  await expect(dialog.getByRole("spinbutton", { name: "数字 1", exact: true })).toHaveValue("7");
  await expect(dialog.getByRole("spinbutton", { name: "数字 2", exact: true })).toHaveValue("-8");
  await expect(dialog.getByRole("textbox", { name: "标签 1", exact: true })).toHaveValue("2026|红色");
  await expect(dialog.getByRole("textbox", { name: "标签 2", exact: true })).toHaveValue("blue,quoted");
  await expect(dialog.locator(".editor-toolbar p")).toContainText("2/500");
  await dialog.getByRole("button", { name: "校验并保存", exact: true }).click();
});

test("F11: Escape discards a focused quantity draft without submitting it", async ({ page }) => {
  await openApp(page);
  const input = page.getByRole("textbox", { name: "生成数量", exact: true });
  await input.fill("12");
  await input.press("Escape");
  await expect(input).toHaveValue("5");
  await setMotion(page, "即时");
  await page.locator(".generate-main-btn:visible").click();
  await expect(page.locator(".result-tile")).toHaveCount(5);
});

test("F12: muting during sequential reveals prevents new Web Audio notes", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as Window & { __audioStarts: number };
    state.__audioStarts = 0;
    const original = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (this: OscillatorNode, ...args: Parameters<OscillatorNode["start"]>) {
      state.__audioStarts += 1;
      return original.apply(this, args);
    };
  });
  await openApp(page);
  await setMotion(page, "仪式");
  await setCount(page, 10);
  await page.locator(".generate-main-btn:visible").click();
  await expect(page.locator(".ceremony-title-banner")).toBeVisible();
  await page.getByRole("button", { name: "静音", exact: true }).click();
  const before = await page.evaluate(() => (window as unknown as Window & { __audioStarts: number }).__audioStarts);
  expect(before).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as Window & { __audioStarts: number }).__audioStarts)).toBe(before);
  await page.getByRole("button", { name: "开启音效", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __audioStarts: number }).__audioStarts)).toBeGreaterThan(before);
});
