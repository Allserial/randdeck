import { describe, expect, it } from "vitest";
import { evaluateTagExpression, matchesTagFilter, parseTagExpression, tagsForValue } from "./tags";

describe("tag rules", () => {
  it("evaluates comparison, modulo, set and negation", () => {
    expect(evaluateTagExpression(parseTagExpression("value >= 1 && value <= 10"), 7)).toBe(true);
    expect(evaluateTagExpression(parseTagExpression("value % 2 == 0"), 7)).toBe(false);
    expect(evaluateTagExpression(parseTagExpression("!(value in [1, 3, 5])"), 7)).toBe(true);
  });

  it("rejects property access and functions", () => {
    expect(() => parseTagExpression("value.constructor == 1")).toThrow();
    expect(() => parseTagExpression("fetch(value) == 1")).toThrow();
  });

  it("supports union and intersection filters", () => {
    expect(matchesTagFilter(["偶数", "小"], ["偶数", "大"], "any")).toBe(true);
    expect(matchesTagFilter(["偶数", "小"], ["偶数", "大"], "all")).toBe(false);
    expect(tagsForValue(4, [{ id: "1", label: "偶数", expression: "value % 2 == 0" }])).toEqual(["偶数"]);
  });
});
