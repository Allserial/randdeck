import { describe, expect, it } from "vitest";
import type { RandomSource } from "./random";
import { drawWeightedEntries, parseWeightedCsv, validateWeightedEntries, weightedEntriesToCsv } from "./weighted";

class SequenceSource implements RandomSource {
  constructor(private values: number[]) {}
  nextUint32() { return this.values.shift() ?? 0; }
}

const entries = [
  { id: "a", value: 1, weight: 1, tags: [] },
  { id: "b", value: 2, weight: 9, tags: ["高权重"] },
];

describe("weighted pool", () => {
  it("rejects duplicate values and invalid weights", () => {
    const result = validateWeightedEntries([...entries, { id: "c", value: 2, weight: 0, tags: [] }]);
    expect(result.errors.join(" ")).toMatch(/重复|权重/);
  });

  it("draws dynamically without replacement", () => {
    const result = drawWeightedEntries(entries, 2, false, new SequenceSource([8, 0]));
    expect(result.map((entry) => entry.value)).toEqual([2, 1]);
  });

  it("round trips quoted CSV fields", () => {
    const csv = weightedEntriesToCsv([{ id: "a", value: 7, weight: 4, tags: ["A,B", "C"] }]);
    const parsed = parseWeightedCsv(csv);
    expect(parsed[0]).toMatchObject({ value: 7, weight: 4, tags: ["A,B", "C"] });
  });
});
