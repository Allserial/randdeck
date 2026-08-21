import { describe, expect, it } from "vitest";
import { SeededRandomSource, drawUnweighted, isExcluded, parseExclusionInput, parseIntegerList, randomIndex, type RandomSource } from "./random";

class SequenceSource implements RandomSource {
  constructor(private values: number[]) {}
  nextUint32() { return this.values.shift() ?? 0; }
}

describe("random domain", () => {
  it("parses Chinese separators and keeps 357 as one number", () => {
    expect(parseIntegerList("3，5 7\n357")).toEqual({ values: [3, 5, 7, 357], invalidTokens: [] });
  });

  it("parses ranges, negative numbers, odd and even exclusions", () => {
    const parsed = parseExclusionInput("-10..-1, 3, 奇数, 偶数, nope");
    expect(parsed.invalidTokens).toEqual(["nope"]);
    expect(isExcluded(-5, parsed.tokens)).toBe(true);
    expect(isExcluded(8, parsed.tokens)).toBe(true);
  });

  it("accepts case-insensitive English odd/even keywords", () => {
    const parsed = parseExclusionInput("ODD, even");
    expect(parsed.invalidTokens).toEqual([]);
    expect(isExcluded(3, parsed.tokens)).toBe(true);
    expect(isExcluded(4, parsed.tokens)).toBe(true);
  });

  it("deduplicates equivalent exclusion tokens", () => {
    expect(parseExclusionInput("3,3,1..4,1..4").tokens).toHaveLength(2);
  });

  it("uses rejection sampling without leaving the index range", () => {
    const source = new SequenceSource([0xffff_ffff, 17]);
    expect(randomIndex(10, source)).toBe(7);
  });

  it("draws without replacement", () => {
    const result = drawUnweighted([1, 2, 3, 4], 4, false, new SeededRandomSource(42));
    expect(new Set(result).size).toBe(4);
  });
});
