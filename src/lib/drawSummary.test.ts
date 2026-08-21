import { describe, expect, it } from "vitest";
import { createDefaultState } from "../app/state";
import { resources } from "../i18n/resources";
import { formatDrawSummary } from "./drawSummary";

function translator(locale: "zh-CN" | "en-US") {
  return ((key: string, options: Record<string, unknown> = {}) => {
    const value = key.split(".").reduce<unknown>((current, part) => (
      current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined
    ), resources[locale].translation);
    return String(value ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(options[name] ?? ""));
  }) as never;
}

const status = (overrides: Partial<Parameters<typeof formatDrawSummary>[2]> = {}) => ({
  sourceCount: 100,
  candidateCount: 97,
  usedCount: 0,
  exclusionHits: 3,
  error: "",
  ...overrides,
});

describe("formatDrawSummary", () => {
  it("formats a range summary with active constraints", () => {
    const state = createDefaultState();
    state.settings.excludeInput = "3,5,7";
    state.settings.noDup = true;
    expect(formatDrawSummary(state.settings, state.pools, status())).toMatchObject({
      visible: "范围 1–100 · 可抽 97 · 本次 5 · 排除 3 · 抽后移除",
      invalid: false,
    });
  });

  it("formats custom and expression summaries without zero-value noise", () => {
    const state = createDefaultState();
    state.pools.customEntries = [
      { id: "1", value: 1, tags: [] },
      { id: "2", value: 2, tags: [] },
    ];
    state.settings.mode = "custom";
    expect(formatDrawSummary(state.settings, state.pools, status({ candidateCount: 2, exclusionHits: 0 }))).toMatchObject({
      visible: "自定义池 2 项 · 可抽 2 · 本次 5",
    });

    state.settings.mode = "expression";
    state.settings.expression = { ...state.settings.expression, source: "2d6", evaluation: "single" };
    expect(formatDrawSummary(state.settings, state.pools, status())).toMatchObject({ visible: "骰子 2d6 · 单次" });
  });

  it("returns the first pool error as an invalid summary", () => {
    const state = createDefaultState();
    const result = formatDrawSummary(state.settings, state.pools, status({ error: "范围必须是整数" }));
    expect(result.invalid).toBe(true);
    expect(result.error).toBe("范围必须是整数");
    expect(result.accessible).toContain("配置无效");
  });

  it("formats complete English summaries without Chinese fallback text", () => {
    const state = createDefaultState("en-US");
    const en = translator("en-US");
    const range = formatDrawSummary(state.settings, state.pools, status(), en);
    expect(range.visible).toBe("Range 1–100 · 97 available · 5 this time · exclude 3");
    expect(range.accessible).toBe(`Draw configuration: ${range.visible}`);

    state.settings.mode = "expression";
    state.settings.expression = { ...state.settings.expression, source: "", evaluation: "single" };
    expect(formatDrawSummary(state.settings, state.pools, status(), en)).toMatchObject({
      visible: "Dice not entered · Single roll",
      accessible: "Draw configuration: Dice not entered · Single roll",
    });

    state.settings.expression = { ...state.settings.expression, source: "2d6", evaluation: "batch" };
    state.settings.count = 4;
    expect(formatDrawSummary(state.settings, state.pools, status(), en).visible).toBe("Dice 2d6 · 4 batch rolls");
  });
});
