import { describe, expect, it } from "vitest";
import { applyStatsDelta, createEmptyStats, createStatsDelta, resetStats } from "./stats";

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
});
