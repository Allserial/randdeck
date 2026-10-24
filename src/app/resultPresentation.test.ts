import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultState } from "./state";
import { getPinScopeKey } from "./resultPresentation";
import { snapshotState, useAppStore } from "./store";
import { executeDraw, prepareDraw } from "../domain/draw";
import { SeededRandomSource } from "../domain/random";
import { formatProbability } from "../features/insights/formatProbability";

beforeEach(() => useAppStore.setState({ ...createDefaultState(), hydrated: false, currentResults: [], resultPresentation: null, resultInteraction: { transactionId: null, selectedIndices: [], pinnedIndices: [], rollingIndices: null } }));
describe("presentation-only state", () => {
  it("ignores quantity, appearance and inactive pools but tracks active rules", () => {
    const s = createDefaultState(); const key = getPinScopeKey(s.settings, s.pools);
    expect(getPinScopeKey({ ...s.settings, count: 9, muted: true }, { ...s.pools, customEntries: [{ id: "test", value: 9, tags: [] }] })).toBe(key);
    expect(getPinScopeKey({ ...s.settings, min: 2 }, s.pools)).not.toBe(key);
    expect(getPinScopeKey({ ...s.settings, noDup: true }, s.pools)).not.toBe(key);
    expect(getPinScopeKey({ ...s.settings, excludeInput: "3 5 odd" }, s.pools)).toBe(getPinScopeKey({ ...s.settings, excludeInput: "ODD,5,3,3" }, s.pools));
  });
  it("releases pins on probability changes without changing old results or stats", () => {
    const transaction = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(9));
    useAppStore.getState().commitTransaction(transaction);
    useAppStore.getState().setResultInteraction({ transactionId: transaction.id, selectedIndices: [0], pinnedIndices: [0] });
    useAppStore.getState().updateSettings({ count: 3 });
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([0]);
    const stats = structuredClone(useAppStore.getState().stats);
    useAppStore.getState().updateSettings({ mode: "expression" });
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([]);
    expect(useAppStore.getState().currentResults).toEqual(transaction.results);
    expect(useAppStore.getState().resultPresentation?.mode).toBe("range");
    expect(useAppStore.getState().stats).toEqual(stats);
    expect(snapshotState()).not.toHaveProperty("resultPresentation");
  });
  it("retains context after deleting a row, clears it with history, and marks recalls", () => {
    const transaction = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(7));
    useAppStore.getState().commitTransaction(transaction);
    const id = useAppStore.getState().history[0].id;
    useAppStore.getState().recallHistory(id);
    expect(useAppStore.getState().resultPresentation?.historical).toBe(true);
    expect(useAppStore.getState().resultPresentation?.pinScopeKey).toBeNull();
    useAppStore.getState().deleteHistory(id);
    expect(useAppStore.getState().resultPresentation?.mode).toBe("range");
    useAppStore.getState().clearHistory();
    expect(useAppStore.getState().resultPresentation).toBeNull();
  });
  it("retains pins through invalid input until a different valid rule is committed", () => {
    const transaction = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(9));
    useAppStore.getState().commitTransaction(transaction);
    useAppStore.getState().setResultInteraction({ transactionId: transaction.id, selectedIndices: [0], pinnedIndices: [0] });
    useAppStore.getState().updateSettings({ excludeInput: "invalid" });
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([0]);
    expect(getPinScopeKey(useAppStore.getState().settings, useAppStore.getState().pools)).toBeNull();
    useAppStore.getState().updateSettings({ excludeInput: "" });
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([0]);
    useAppStore.getState().updateSettings({ excludeInput: "3" });
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([]);
  });
  it("does not round a tiny nonzero probability to zero", () => {
    expect(formatProbability(0.00000001, "en-US")).toBe("<0.001%");
    expect(formatProbability(0, "en-US")).toBe("0%");
  });
});
