import { describe, expect, it } from "vitest";
import { createDefaultState } from "../app/state";
import { formatDrawSummary } from "./drawSummary";

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
});
