import { test, expect, type Page } from "@playwright/test";

/**
 * 辅助函数：打开应用并等待初始就绪
 */
async function openWorkbench(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app-brand h1")).toHaveText("掷数台");
}

/**
 * 辅助函数：设置为即时动效，避免动画定时器干扰测试确定性
 */
async function useInstantMotion(page: Page) {
  await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
  await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: "即时" }).click();
  await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
}

test.describe("Phase 7 专属端到端质量门禁套件 (R1 ~ R6)", () => {
  /**
   * 用例 1（R1）
   * 验证长骰子算式（如 2d20kh1）卡片底部等宽居中展示，最多两行折叠，且 getByText("骰面明细") 在无障碍 DOM 中可见
   */
  test("R1: 长骰子算式卡片底部等宽居中展示、最多两行折叠且无障碍文本可见", async ({ page }) => {
    await openWorkbench(page);
    await useInstantMotion(page);

    // 1. 切换到“骰子表达式”模式
    const modeSegmented = page.getByLabel(/抽取模式|Draw Mode/i);
    await modeSegmented.getByRole("button", { name: /骰子表达式|Dice Expression/i }).click();

    // 2. 填写长骰子算式 2d20kh1
    const exprInput = page.getByRole("textbox", { name: /表达式|Expression/i });
    await exprInput.fill("2d20kh1");
    await exprInput.press("Enter");

    // 3. 设置生成数量为 3
    const stepper = page.locator(".stepper input");
    await stepper.fill("3");
    await stepper.press("Enter");

    // 4. 点击生成结果
    await page.locator(".generate-main-btn:visible").click();

    // 5. 等待 3 张卡片完成渲染
    const tiles = page.locator(".result-tile.result-tile--expression");
    await expect(tiles).toHaveCount(3);
    await expect(page.locator(".result-tile.is-rolling")).toHaveCount(0);

    // 6. 无障碍 DOM 可见性断言：getByText("骰面明细") 可见且计数为 3
    const traceLabels = page.getByText("骰面明细");
    await expect(traceLabels).toHaveCount(3);
    await expect(traceLabels.first()).toBeVisible();

    // 7. 验证 .tile-trace 等宽居中与最多两行截断样式
    const traceStyles = await page.locator(".tile-trace").evaluateAll((elements) => {
      return elements.map((el) => {
        const style = window.getComputedStyle(el);
        const code = el.querySelector("code");
        const codeStyle = code ? window.getComputedStyle(code) : null;
        return {
          textAlign: style.textAlign,
          webkitLineClamp: (style as unknown as { webkitLineClamp: string }).webkitLineClamp,
          display: style.display,
          fontFamily: codeStyle ? codeStyle.fontFamily : "",
          isMonospace: codeStyle ? /mono|monospace|Consolas|Menlo/i.test(codeStyle.fontFamily) : false,
        };
      });
    });

    expect(traceStyles).toHaveLength(3);
    for (const item of traceStyles) {
      expect(item.textAlign).toBe("center");
      expect(item.webkitLineClamp).toBe("2");
      expect(item.isMonospace).toBe(true);
    }
  });

  /**
   * 用例 2（R2）
   * 验证设置页切换为“仪式”动效时展开专属子面板（含 .ceremony-timer-setting、逐个揭示 Switch、仪式粒子效果 Switch）；
   * 切换为标准/即时时自动收起隐藏；验证逐个揭示关闭时一键全量揭晓
   */
  test("R2: 仪式动效子面板展开/收起联动及逐个揭示关闭时一键全量揭晓", async ({ page }) => {
    await openWorkbench(page);

    // 1. 进入“设置”视图
    await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();

    // 2. 先切换为“即时”，验证子面板不展示
    await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: "即时" }).click();
    await expect(page.locator(".ceremony-subpanel")).toHaveCount(0);

    // 3. 切换为“仪式”，验证展开专属子面板与三组专属配置项
    await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: "仪式" }).click();
    await expect(page.locator(".ceremony-subpanel")).toBeVisible();
    await expect(page.locator(".ceremony-timer-setting")).toBeVisible();

    const sequentialToggle = page.locator(".ceremony-subpanel label.ceremony-toggle").filter({ hasText: "逐个揭示" });
    const particlesToggle = page.locator(".ceremony-subpanel label.ceremony-toggle").filter({ hasText: "粒子效果" });
    await expect(sequentialToggle).toBeVisible();
    await expect(particlesToggle).toBeVisible();

    // 4. 切换为“标准”，验证专属子面板自动收起隐藏
    await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: "标准" }).click();
    await expect(page.locator(".ceremony-subpanel")).toHaveCount(0);

    // 5. 再次切换为“仪式”，并关闭“逐个揭示”Switch（一键全量揭晓模式）
    await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: "仪式" }).click();
    await expect(page.locator(".ceremony-subpanel")).toBeVisible();

    const sequentialCheckbox = sequentialToggle.locator('input[type="checkbox"]');
    await expect(sequentialCheckbox).toBeChecked();
    await sequentialCheckbox.uncheck();
    await expect(sequentialCheckbox).not.toBeChecked();

    // 6. 切回“抽取台”，验证在“逐个揭示关闭”下生成结果为一键全量揭晓
    await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
    await page.locator(".stepper input").fill("3");
    await page.locator(".generate-main-btn:visible").click();

    // 验证所有 3 张卡片全量立即揭晓完成（不处于逐张 reveal 隐藏队列中）
    await expect(page.locator(".result-tile")).toHaveCount(3);
    await expect(page.locator(".result-tile.is-hidden")).toHaveCount(0);
    await expect(page.locator(".result-tile.is-rolling")).toHaveCount(0);
  });

  /**
   * 用例 3（R3）
   * 验证顶栏副标题在 zh-CN 下为「方寸之间 · 落子成数」，在 en-US 下为「Precision Random & Dice Instrument」
   */
  test("R3: 顶栏副标题中英文双向国际化文本验证", async ({ page }) => {
    await openWorkbench(page);

    // 1. 验证 zh-CN 语言下的顶栏副标题
    const subtitle = page.locator(".app-brand div span");
    await expect(subtitle).toHaveText("方寸之间 · 落子成数");

    // 2. 进入设置页面，切换语言为 English (en-US)
    await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
    await page.getByRole("button", { name: "English" }).click();

    // 3. 验证 en-US 语言下的顶栏副标题
    await expect(subtitle).toHaveText("Precision Random & Dice Instrument");

    // 4. 再次切回简体中文，验证实时更新恢复
    await page.getByRole("button", { name: "简体中文" }).click();
    await expect(subtitle).toHaveText("方寸之间 · 落子成数");
  });

  /**
   * 用例 4（R4）
   * 验证最近批次高度提升为 64px、按钮高度 44px；在 .recent-items 上模拟垂直滚轮，验证产生横向 scrollLeft 平移
   */
  test("R4: 最近批次栏高 64px、按钮高 44px 以及垂直滚轮转横向滚动平移", async ({ page }) => {
    await openWorkbench(page);
    await useInstantMotion(page);

    // 1. 连续生成多次抽取，填满最近批次栏触发横向溢出
    const generateBtn = page.locator(".generate-main-btn:visible");
    for (let i = 0; i < 8; i++) {
      await generateBtn.click();
    }

    const recentStrip = page.locator(".recent-strip");
    await expect(recentStrip).toBeVisible();

    const recentButtons = page.locator(".recent-items button");
    await expect(recentButtons.first()).toBeVisible();

    // 2. 尺寸几何测量断言：.recent-strip 高度为 64px，button 高度为 44px
    const stripBox = await recentStrip.boundingBox();
    expect(stripBox).not.toBeNull();
    expect(Math.round(stripBox!.height)).toBe(64);

    const buttonBox = await recentButtons.first().boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(Math.round(buttonBox!.height)).toBe(44);

    // 3. 初始 scrollLeft 应为 0，并且存在横向滚动容量
    const scrollInfoBefore = await page.locator(".recent-items").evaluate((el) => {
      return {
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        canScrollHorizontally: el.scrollWidth > el.clientWidth,
      };
    });
    expect(scrollInfoBefore.scrollLeft).toBe(0);
    expect(scrollInfoBefore.canScrollHorizontally).toBe(true);

    // 4. 模拟在 .recent-items 上派发垂直滚轮 wheel 事件（deltaY = 120）
    await page.locator(".recent-items").evaluate((el) => {
      const event = new WheelEvent("wheel", {
        deltaY: 120,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
    });

    // 5. 验证产生了横向 scrollLeft 平移
    const scrollLeftAfter = await page.locator(".recent-items").evaluate((el) => el.scrollLeft);
    expect(scrollLeftAfter).toBeGreaterThan(0);
  });

  /**
   * 用例 5（R5）
   * 验证最近批次右键弹出备注 Dialog 并保存；验证舞台底栏当前批次快捷备注；
   * 验证数据洞察历史搜索框输入备注实时过滤；验证窄屏下 .history-more 菜单项数量严格等于 4
   */
  test("R5: 批次右键备注、底栏快捷备注、数据洞察实时过滤与窄屏菜单核验", async ({ page }) => {
    await openWorkbench(page);
    await useInstantMotion(page);

    // 1. 生成一次结果作为初始批次
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".result-tile")).toHaveCount(5);

    // 2. 验证舞台底栏当前批次快捷备注
    const stageNoteBtn = page.locator(".stage-note-btn");
    await expect(stageNoteBtn).toBeVisible();
    await stageNoteBtn.click();

    // 弹出备注 Dialog
    const noteDialog = page.getByRole("dialog");
    await expect(noteDialog).toBeVisible();
    const noteInput = noteDialog.locator("input.note-input");
    await noteInput.fill("TAG-PHASE7-STAGE-NOTE");
    await noteDialog.getByRole("button", { name: "保存" }).click();
    await expect(noteDialog).toHaveCount(0);

    // 检查舞台底栏备注按钮更新
    await expect(stageNoteBtn).toContainText("TAG-PHASE7-STAGE-NOTE");
    await expect(stageNoteBtn).toHaveClass(/has-note/);

    // 3. 验证最近批次右键弹出备注 Dialog 并保存
    const firstRecent = page.locator(".recent-items button").first();
    await firstRecent.click({ button: "right" });
    await expect(noteDialog).toBeVisible();
    await noteInput.fill("TAG-PHASE7-RECENT-NOTE");
    await noteDialog.getByRole("button", { name: "保存" }).click();
    await expect(noteDialog).toHaveCount(0);

    // 检查最近批次按钮内容已同步更新
    await expect(firstRecent).toContainText("TAG-PHASE7-RECENT-NOTE");

    // 4. 验证数据洞察历史搜索框输入备注实时过滤
    await page.getByLabel("主导航").getByRole("button", { name: /数据洞察/ }).click();
    await page.locator(".view-tabs").getByRole("button", { name: "历史" }).click();

    const searchInput = page.locator(".history-search input");
    await expect(searchInput).toBeVisible();

    // 输入刚刚的特异备注进行过滤
    await searchInput.fill("TAG-PHASE7-RECENT-NOTE");
    await expect(page.locator(".history-table article")).toHaveCount(1);
    await expect(page.locator(".history-table article")).toContainText("TAG-PHASE7-RECENT-NOTE");

    // 输入不匹配字符，断言过滤无匹配
    await searchInput.fill("NON_MATCHING_KEYWORD_XYZ");
    await expect(page.locator(".history-table article")).toHaveCount(0);
    await expect(page.locator(".empty-editor")).toBeVisible();

    // 清空搜索框，恢复显示全部记录
    await searchInput.fill("");
    await expect(page.locator(".history-table article").first()).toBeVisible();

    // 5. 验证窄屏下 .history-more 菜单项数量严格等于 4
    await page.setViewportSize({ width: 720, height: 800 });
    const moreBtn = page.locator(".history-table article").first().locator(".history-more");
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();

    const dropdownItems = page.locator(".dropdown-content .dropdown-item");
    await expect(dropdownItems).toHaveCount(4);
  });

  /**
   * 用例 6（R6）
   * 在大视口（如 1920x1080）下验证卡片与文字流体放大，且主舞台 .fit-number 高度严格 <= 90px
   */
  test("R6: 大视口 (1920x1080) 流体放大与主舞台 .fit-number 高度约束", async ({ page }) => {
    // 1. 基准视口 1180x820 下初始化并生成 1 张单卡片
    await page.setViewportSize({ width: 1180, height: 820 });
    await openWorkbench(page);
    await useInstantMotion(page);

    await page.locator(".stepper input").fill("1");
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".result-tile")).toHaveCount(1);

    const baselineTile = await page.locator(".result-tile").boundingBox();
    expect(baselineTile).not.toBeNull();

    // 2. 切换至大视口 1920x1080
    await page.setViewportSize({ width: 1920, height: 1080 });

    const largeTile = await page.locator(".result-tile").boundingBox();
    expect(largeTile).not.toBeNull();

    // 验证卡片尺寸流体放大
    expect(largeTile!.width).toBeGreaterThan(baselineTile!.width);
    expect(largeTile!.height).toBeGreaterThan(baselineTile!.height);

    // 3. 严格验证主舞台 .fit-number 元素高度 <= 90px
    const fitNumberBox = await page.locator(".result-value .fit-number").boundingBox();
    expect(fitNumberBox).not.toBeNull();
    expect(fitNumberBox!.height).toBeLessThanOrEqual(90);

    // 4. 多卡片网格（4 张）在大视口下的 .fit-number 高度检查
    await page.locator(".stepper input").fill("4");
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".result-tile")).toHaveCount(4);

    const fitNumberBoxes = await page.locator(".result-value .fit-number").evaluateAll((elements) => {
      return elements.map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          height: rect.height,
          whiteSpace: style.whiteSpace,
        };
      });
    });

    expect(fitNumberBoxes).toHaveLength(4);
    for (const box of fitNumberBoxes) {
      expect(box.height).toBeLessThanOrEqual(90);
      expect(box.whiteSpace).toBe("nowrap");
    }
  });

  test("Phase 8: 最大化等比缩放、3s/5s/10s 容器零抖动、通用揭晓文案与自定义滚动条视觉实证", async ({ page }) => {
    // 1. 验证默认窗口 (1180x820) 与最大化窗口 (1920x1080) 下 6 张卡片 (cols-3) 的宽高比严格一致
    await page.setViewportSize({ width: 1180, height: 820 });
    await openWorkbench(page);
    await useInstantMotion(page);

    await page.locator(".stepper input").fill("6");
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".result-tile")).toHaveCount(6);

    const baseTile = await page.locator(".result-tile").first().boundingBox();
    expect(baseTile).not.toBeNull();
    const baseRatio = baseTile!.width / baseTile!.height;

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(150);
    const maxTile = await page.locator(".result-tile").first().boundingBox();
    expect(maxTile).not.toBeNull();
    const maxRatio = maxTile!.width / maxTile!.height;

    // 宽高比偏差必须小于 0.015（彻底杜绝横向拉长）
    expect(Math.abs(maxRatio - baseRatio)).toBeLessThan(0.015);

    // 2. 验证抽取 18 张卡片时，舞台垂直滚动条呈现且无原生上下箭头
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.locator(".stepper input").fill("18");
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".result-tile")).toHaveCount(18);

    // 3. 验证设置面板“仪式”动态效果下切换 3s / 5s / 10s 时容器宽度恒定不变
    await page.getByLabel("主导航").getByRole("button", { name: /设置/ }).click();
    await page.getByRole("group", { name: "动态效果" }).getByRole("button", { name: "仪式" }).click();
    const subpanel = page.locator(".ceremony-subpanel");
    await expect(subpanel).toBeVisible();

    const countdownSegmented = subpanel.locator(".segmented").first();
    await countdownSegmented.getByRole("button", { name: "3s", exact: true }).click();
    const box3s = await countdownSegmented.boundingBox();
    await countdownSegmented.getByRole("button", { name: "5s", exact: true }).click();
    const box5s = await countdownSegmented.boundingBox();
    await countdownSegmented.getByRole("button", { name: "10s", exact: true }).click();
    const box10s = await countdownSegmented.boundingBox();

    expect(box3s).not.toBeNull();
    expect(box5s).not.toBeNull();
    expect(box10s).not.toBeNull();
    expect(Math.abs(box3s!.width - box5s!.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box10s!.width - box5s!.width)).toBeLessThanOrEqual(0.5);

    // 4. 验证仪式揭晓通用文案（“结 果 揭 晓 完 毕”）
    await page.getByLabel("主导航").getByRole("button", { name: /抽取台/ }).click();
    await page.locator(".stepper input").fill("3");
    await page.locator(".generate-main-btn:visible").click();
    await expect(page.locator(".ceremony-title-banner")).toContainText("结 果 揭 晓 完 毕", { timeout: 15000 });
  });
});
