import { describe, expect, it } from "vitest";
import { createDefaultState } from "../app/state";
import { executeDraw, prepareDraw, prepareShuffle } from "./draw";
import { SeededRandomSource } from "./random";
import { SHUFFLE_ALGORITHM } from "./shuffle";

describe("draw transactions", () => {
  it("excludes 3, 5 and 7 from a 1..10 range", () => {
    const state = createDefaultState(); state.settings = { ...state.settings, min: 1, max: 10, count: 7, excludeInput: "3,5,7", noDup: true };
    const plan = prepareDraw(state);
    expect(plan.candidateEntries.map((entry) => entry.value)).toEqual([1, 2, 4, 6, 8, 9, 10]);
    expect(executeDraw(plan, new SeededRandomSource(12)).results.map((result) => result.value).sort((a, b) => a - b)).toEqual([1, 2, 4, 6, 8, 9, 10]);
  });

  it("supports exclusions in custom and weighted modes", () => {
    const custom = createDefaultState(); custom.settings = { ...custom.settings, mode: "custom", excludeInput: "2..3" }; custom.pools.customEntries = [1, 2, 3, 4].map((value) => ({ id: String(value), value, tags: [] }));
    expect(prepareDraw(custom).candidateEntries.map((entry) => entry.value)).toEqual([1, 4]);
    const weighted = createDefaultState(); weighted.settings = { ...weighted.settings, mode: "weighted", excludeInput: "偶数" }; weighted.pools.weightedEntries = [1, 2, 3].map((value) => ({ id: String(value), value, weight: value, tags: [] }));
    expect(prepareDraw(weighted).candidateEntries.map((entry) => entry.value)).toEqual([1, 3]);
  });

  it("applies used values only to the matching pool fingerprint", () => {
    const state = createDefaultState(); state.settings = { ...state.settings, min: 1, max: 4, count: 1, noDup: true };
    const first = prepareDraw(state); state.drawState = { ...state.drawState, poolFingerprint: first.poolFingerprint, usedValues: [1, 2] };
    expect(prepareDraw(state).candidateEntries.map((entry) => entry.value)).toEqual([3, 4]);
    state.settings.max = 5;
    expect(prepareDraw(state).candidateEntries.map((entry) => entry.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it("creates a stats delta and session round metadata", () => {
    const state = createDefaultState(); state.settings.count = 2; const plan = prepareDraw(state);
    const transaction = executeDraw(plan, new SeededRandomSource(7), { id: "s", name: "测试", startedAt: new Date(0).toISOString(), configSnapshot: state.settings, poolsSnapshot: state.pools, poolFingerprint: plan.poolFingerprint, transactionIds: [], transactionRecords: [], roundCount: 2 });
    expect(transaction.statsDelta.draws).toBe(2);
    expect(transaction.session?.round).toBe(3);
  });

  it("shuffles the full remaining candidate order with a distinct algorithm id", () => {
    const state = createDefaultState(); state.settings = { ...state.settings, min: 1, max: 5, excludeInput: "3", noDup: false };
    const plan = prepareShuffle(state);
    expect(plan.operationKind).toBe("shuffle");
    expect(plan.count).toBe(4);
    const transaction = executeDraw(plan, new SeededRandomSource(21));
    expect(transaction.operation.kind).toBe("shuffle");
    expect(transaction.algorithmVersion).toBe(SHUFFLE_ALGORITHM);
    expect(transaction.results.map((result) => result.value).sort((left, right) => left - right)).toEqual([1, 2, 4, 5]);
  });

  it("ignores leftover tagFilter in range mode but applies it in custom mode", () => {
    const state = createDefaultState();
    state.settings = {
      ...state.settings,
      min: 1,
      max: 10,
      count: 5,
      tagFilter: { selectedTags: ["不存在的标签"], combine: "any" },
    };
    // 范围模式不受 tagFilter 影响，抽满全部 10 个候选
    const rangePlan = prepareDraw(state);
    expect(rangePlan.candidateEntries.map((e) => e.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // 自定义模式正确过滤
    state.settings.mode = "custom";
    state.pools.customEntries = [
      { id: "1", value: 101, tags: ["tagA"] },
      { id: "2", value: 102, tags: ["tagB"] },
    ];
    state.settings.tagFilter.selectedTags = ["tagA"];
    const customPlan = prepareDraw(state);
    expect(customPlan.candidateEntries.map((e) => e.value)).toEqual([101]);
  });
});
