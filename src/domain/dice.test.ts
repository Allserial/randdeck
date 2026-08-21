import { describe, expect, it } from "vitest";
import type { RandomSource } from "./random";
import { describeDiceExpression, evaluateDiceExpression, parseDiceExpression } from "./dice";

class SequenceSource implements RandomSource {
  constructor(private values: number[]) {}
  nextUint32() { return this.values.shift() ?? 0; }
}

describe("dice AST", () => {
  it("evaluates d20 and arithmetic", () => {
    const result = evaluateDiceExpression(parseDiceExpression("d20+2"), new SequenceSource([19]));
    expect(result.total).toBe(22);
  });

  it("keeps the highest three dice", () => {
    const result = evaluateDiceExpression(parseDiceExpression("4d6kh3"), new SequenceSource([0, 1, 2, 5]));
    expect(result.total).toBe(11);
    expect(result.faces.filter((face) => face.kept)).toHaveLength(3);
  });

  it("supports explosions, rerolls, and success counts", () => {
    expect(evaluateDiceExpression(parseDiceExpression("1d6!"), new SequenceSource([5, 2])).total).toBe(9);
    expect(evaluateDiceExpression(parseDiceExpression("1d20r<3"), new SequenceSource([0, 9])).total).toBe(10);
    expect(evaluateDiceExpression(parseDiceExpression("3d6>=5"), new SequenceSource([3, 4, 5])).total).toBe(2);
  });

  it("rejects unsafe syntax and division by zero", () => {
    expect(() => parseDiceExpression("window.alert(1)")).toThrow(/不支持/);
    expect(() => evaluateDiceExpression(parseDiceExpression("1/0"), new SequenceSource([]))).toThrow(/除以零/);
  });

  it("describes parsed expressions", () => {
    expect(describeDiceExpression(parseDiceExpression("2d6+3"))).toContain("投掷 2 个 6 面骰");
  });
});
