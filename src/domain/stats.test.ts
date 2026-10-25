import { describe, expect, it } from "vitest";
import { applyStatsDelta, createEmptyStats, createStatsDelta, normalizeStatsDelta, resetStats } from "./stats";

describe("statistics ledger", () => {
  it("applies and reverts the same delta", () => {
    const initial = createEmptyStats(); const delta = createStatsDelta("expression", [{ value: 7, total: 7, faces: [{ value: 3 }, { value: 4 }], tags: ["成功"] }]);
    const recorded = applyStatsDelta(initial, delta);
    expect(recorded.byMode.expression).toMatchObject({ draws: 1, values: { "7": 1 }, faces: { "3": 1, "4": 1 }, tags: { 成功: 1 } });
    expect(applyStatsDelta(recorded, delta, -1)).toEqual(initial);
  });

  it("resets only the selected mode", () => {
    const state = createEmptyStats(); state.byMode.range.draws = 8; state.byMode.custom.draws = 3;
    const next = resetStats(state, "range");
    expect(next.byMode.range.draws).toBe(0);
    expect(next.byMode.custom.draws).toBe(3);
  });

  it("counts prototype-named labels as own numeric entries and reverses them", () => {
    const labels = ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"];
    const delta = createStatsDelta("custom", [{ value: 1, total: 1, faces: [], tags: labels }]);
    labels.forEach((label) => {
      expect(Object.hasOwn(delta.tags, label)).toBe(true);
      expect(delta.tags[label]).toBe(1);
    });
    const recorded = applyStatsDelta(applyStatsDelta(createEmptyStats(), delta), delta);
    labels.forEach((label) => expect(recorded.byMode.custom.tags[label]).toBe(2));
    const reverted = applyStatsDelta(applyStatsDelta(recorded, delta, -1), delta, -1);
    expect(reverted).toEqual(createEmptyStats());
    expect(Object.getPrototypeOf(recorded.byMode.custom.tags)).toBe(Object.prototype);
  });

  it("repairs legacy inherited-method concatenation in retained deltas", () => {
    const corrupted = JSON.parse('{"constructor":"function Object() { [native code] }111","__proto__":2,"toString":"function toString() { [native code] }1"}');
    const delta = normalizeStatsDelta({ mode: "custom", draws: 3, values: { 1: 3 }, faces: {}, tags: corrupted });
    expect(delta?.tags.constructor).toBe(3);
    expect(delta?.tags.toString).toBe(1);
    expect(Object.hasOwn(delta!.tags, "__proto__")).toBe(true);
    expect(delta?.tags.__proto__).toBe(2);
  });
});
