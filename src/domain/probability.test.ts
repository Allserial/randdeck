import { describe, expect, it } from "vitest";
import { parseDiceExpression } from "./dice";
import { analyzeExact, analyzeProbabilityLocal, simulateProbability } from "./probability";

describe("probability engine", () => {
  it("normalizes exact weighted probabilities", () => {
    const report = analyzeExact({ mode: "weighted", count: 2, noDup: false, candidates: [{ id: "a", value: 1, weight: 1, tags: [] }, { id: "b", value: 2, weight: 3, tags: [] }] });
    expect(report.method).toBe("exact");
    expect(report.points.find((point) => point.value === 2)?.probability).toBeCloseTo(0.75);
  });

  it("computes unweighted inclusion probability without replacement", () => {
    const report = analyzeExact({ mode: "custom", count: 2, noDup: true, candidates: [1, 2, 3, 4].map((value) => ({ id: String(value), value, weight: 1, tags: [] })) });
    expect(report.points[0].expectedCount).toBeCloseTo(0.5);
  });

  it("computes the exact 2d6 distribution", () => {
    const ast = parseDiceExpression("2d6"); const report = analyzeExact({ mode: "expression", count: 1, noDup: false, candidates: [], expression: { source: "2d6", ast, constrained: false } });
    expect(report.points[0].value).toBe(2);
    expect(report.points.at(-1)?.value).toBe(12);
    expect(report.points.reduce((sum, point) => sum + point.probability, 0)).toBeCloseTo(1);
    expect(report.points.find((point) => point.value === 7)?.probability).toBeCloseTo(1 / 6);
  });

  it("falls back to seeded simulation for exploding dice", async () => {
    const ast = parseDiceExpression("1d6!"); const report = await analyzeProbabilityLocal({ mode: "expression", count: 1, noDup: false, candidates: [], expression: { source: "1d6!", ast, constrained: false } }, { samples: 500, seed: 123 });
    expect(report.method).toBe("simulation");
    expect(report.seed).toBe(123);
    expect(report.points.some((point) => point.value > 6)).toBe(true);
  });

  it("supports cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(simulateProbability({ mode: "range", count: 1, noDup: false, candidates: [{ id: "1", value: 1, weight: 1, tags: [] }] }, { samples: 100, seed: 1, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
