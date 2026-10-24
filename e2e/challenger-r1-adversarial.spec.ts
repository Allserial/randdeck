import { test, expect, type Page } from "@playwright/test";

/**
 * 通过真实 UI 操作配置骰子表达式模式并生成结果
 */
async function setupAndRollExpression(
  page: Page,
  options: {
    expression: string;
    count: number;
    locale?: "zh-CN" | "en-US";
    theme?: "dark" | "light" | "contrast";
  }
) {
  const { expression, count, locale = "zh-CN", theme = "dark" } = options;

  await page.goto("/");
  // 确保主题与即时动效以获得确定性渲染
  await page.evaluate(
    ({ t }) => {
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.setAttribute("data-motion", "instant");
    },
    { t: theme }
  );

  // 1. 切换语言（如需）
  if (locale === "en-US") {
    const langBtn = page.getByRole("button", { name: /English|语言|Language/i });
    if ((await langBtn.count()) > 0) {
      await langBtn.first().click();
    }
  }

  // 2. 切换到“骰子表达式”模式
  const modeBtn = page
    .getByLabel(/抽取模式|Draw Mode/i)
    .getByRole("button", { name: /骰子表达式|Dice Expression/i });
  await modeBtn.click();

  // 3. 填写表达式
  const exprInput = page.getByRole("textbox", { name: /表达式|Expression/i });
  await exprInput.fill(expression);
  await exprInput.press("Enter");

  // 4. 设置生成数量
  const countInput = page.locator(".stepper input");
  await countInput.fill(String(count));
  await countInput.press("Enter");

  // 5. 点击生成结果
  const generateBtn = page.locator(".generate-main-btn:visible");
  await generateBtn.click();

  // 6. 等待结果卡片完成渲染且非滚动中
  await expect(page.locator(".result-tile.result-tile--expression")).toHaveCount(count);
  await expect(page.locator(".result-tile.is-rolling")).toHaveCount(0);
}

test.describe("R1 对抗性验证：长算式排版与5列卡片空间约束", () => {
  const expressions = [
    { name: "检定保留最高", expr: "2d20kh1" },
    { name: "属性生成保留前三", expr: "4d6kh3" },
    { name: "复合算式", expr: "2d6+1+1d4" },
    { name: "超长复合算式", expr: "1d20+5+2d6+2+1d4" },
    { name: "极端长算式", expr: "3d100+10+2d20kh1" },
  ];

  const viewports = [
    { name: "大屏ContainerQueries", width: 1440, height: 900 },
    { name: "基准视口", width: 1180, height: 820 },
    { name: "紧凑视口", width: 1024, height: 768 },
    { name: "窄屏小尺寸", width: 760, height: 600 },
  ];

  for (const exp of expressions) {
    test(`长算式 [${exp.name}: ${exp.expr}] 在 5 列卡片及各视口下的几何与盒模型约束`, async ({ page }) => {
      // 5 张卡片触发 cols-5 网格
      await setupAndRollExpression(page, { expression: exp.expr, count: 5 });

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        if (vp.width < 1040 && (await page.locator(".inspector-close:visible").count()) > 0) {
          await page.locator(".inspector-close:visible").click();
        }

        // 提取每张卡片的几何测量指标
        const metrics = await page.locator(".result-tile").evaluateAll((tiles) => {
          return tiles.map((tile, i) => {
            const tileRect = tile.getBoundingClientRect();
            const footer = tile.querySelector(".tile-footer");
            const trace = tile.querySelector(".tile-trace");
            const copyBtn = tile.querySelector(".tile-copy");

            const footerRect = footer ? footer.getBoundingClientRect() : null;
            const traceRect = trace ? trace.getBoundingClientRect() : null;

            return {
              index: i,
              tileHeight: tileRect.height,
              tileWidth: tileRect.width,
              scrollHeight: tile.scrollHeight,
              clientHeight: tile.clientHeight,
              hasTileVerticalOverflow: tile.scrollHeight > tile.clientHeight + 1,
              hasFooter: Boolean(footer),
              hasTrace: Boolean(trace),
              traceBottom: traceRect ? traceRect.bottom : 0,
              footerTop: footerRect ? footerRect.top : 0,
              footerBottom: footerRect ? footerRect.bottom : 0,
              tileBottom: tileRect.bottom,
              // trace 底部是否越过了 footer 顶部（重叠压盖判定，允许 1px 亚像素误差）
              isFooterOverlappedByTrace:
                Boolean(traceRect && footerRect) && traceRect!.bottom > footerRect!.top + 1,
              // footer 底部是否被挤出卡片底边界（允许 1px 亚像素误差）
              isFooterPushedOutside:
                Boolean(footerRect) && footerRect!.bottom > tileRect.bottom + 1,
              copyBtnVisible: Boolean(copyBtn && (copyBtn as HTMLElement).offsetWidth > 0),
            };
          });
        });

        // 严格断言验证每一张卡片
        for (const m of metrics) {
          expect(m.hasTrace, `算式 ${exp.expr} 卡片 ${m.index} 必须包含 .tile-trace`).toBe(true);
          expect(m.hasFooter, `算式 ${exp.expr} 卡片 ${m.index} 必须包含 .tile-footer`).toBe(true);

          expect(
            m.hasTileVerticalOverflow,
            `视口 ${vp.name} 算式 ${exp.expr} 卡片 ${m.index} 产生纵向溢出：scrollHeight=${m.scrollHeight}, clientHeight=${m.clientHeight}`
          ).toBe(false);

          expect(
            m.isFooterOverlappedByTrace,
            `视口 ${vp.name} 算式 ${exp.expr} 卡片 ${m.index} 算式与底栏重叠压盖：traceBottom=${m.traceBottom}, footerTop=${m.footerTop}`
          ).toBe(false);

          expect(
            m.isFooterPushedOutside,
            `视口 ${vp.name} 算式 ${exp.expr} 卡片 ${m.index} 底栏被挤出卡片底边缘：footerBottom=${m.footerBottom}, tileBottom=${m.tileBottom}`
          ).toBe(false);

          expect(
            m.copyBtnVisible,
            `视口 ${vp.name} 算式 ${exp.expr} 卡片 ${m.index} 复制按钮未能正常渲染/尺寸为0`
          ).toBe(true);
        }
      }
    });
  }

  test("测试 10 张卡片双行 5 列下的算式包裹与最多两行限制", async ({ page }) => {
    await setupAndRollExpression(page, { expression: "1d20+5+2d6+2+1d4", count: 10 });
    await expect(page.locator(".result-tile")).toHaveCount(10);

    const debugInfo = await page.locator(".tile-trace").evaluateAll((traces) => {
      return traces.map((trace) => {
        const style = window.getComputedStyle(trace);
        const code = trace.querySelector("code");
        const codeWidth = code ? code.getBoundingClientRect().width : 0;
        const traceWidth = trace.getBoundingClientRect().width;
        return {
          display: style.display,
          webkitLineClamp: (style as any).webkitLineClamp,
          codeWidth,
          traceWidth,
          diff: codeWidth - traceWidth,
        };
      });
    });

    console.log("TEST 6 DEBUG INFO:", JSON.stringify(debugInfo[0]));
    expect(debugInfo.length).toBe(10);
    for (const info of debugInfo) {
      expect(info.webkitLineClamp).toBe("2");
      // code 是内联元素换行，其 getBoundingClientRect().width 是所有行联合 bounding box 宽度还是什么？
      expect(info.codeWidth).toBeLessThanOrEqual(info.traceWidth + 2);
    }
  });
});

test.describe("R1 对抗性质疑：Playwright getByText('骰面明细') 可见性稳定性核验", () => {
  test("中文环境下所有 5 张卡片的 '骰面明细' 均能稳定断言 toBeVisible", async ({ page }) => {
    await setupAndRollExpression(page, { expression: "2d20kh1", count: 5, locale: "zh-CN" });
    await expect(page.locator(".result-tile.result-tile--expression")).toHaveCount(5);

    // 严厉断言第 1 个与全部 5 个“骰面明细”
    const traceLabels = page.getByText("骰面明细");
    await expect(traceLabels).toHaveCount(5);
    await expect(traceLabels.first()).toBeVisible();

    for (let i = 0; i < 5; i++) {
      await expect(traceLabels.nth(i)).toBeVisible();
    }

    // 深入检查 DOM 属性与盒模型
    const domProps = await page.locator(".tile-trace .sr-only").evaluateAll((nodes) => {
      return nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return {
          width: rect.width,
          height: rect.height,
          opacity: style.opacity,
          visibility: style.visibility,
          display: style.display,
        };
      });
    });

    expect(domProps).toHaveLength(5);
    for (const prop of domProps) {
      expect(prop.width).toBeGreaterThanOrEqual(1);
      expect(prop.height).toBeGreaterThanOrEqual(1);
      expect(prop.opacity).toBe("1");
      expect(prop.visibility).toBe("visible");
      expect(prop.display).not.toBe("none");
    }
  });

  test("在不同 deviceScaleFactor (1x, 1.25x, 1.5x, 2x) 下 toBeVisible() 零抖动稳定通过", async ({ browser }) => {
    for (const dsf of [1, 1.25, 1.5, 2]) {
      const context = await browser.newContext({
        deviceScaleFactor: dsf,
        viewport: { width: 1180, height: 820 },
        locale: "zh-CN",
      });
      const page = await context.newPage();
      await setupAndRollExpression(page, { expression: "2d6+1+1d4", count: 5 });

      await expect(page.getByText("骰面明细").first()).toBeVisible();
      await expect(page.getByText("骰面明细")).toHaveCount(5);
      await context.close();
    }
  });
});
