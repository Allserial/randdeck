import { beforeEach, describe, expect, it } from "vitest";
import type { AppState } from "../domain/types";
import { createDefaultState } from "./state";
import { initializeStore, useAppStore } from "./store";
import { executeDraw, prepareDraw } from "../domain/draw";
import { SeededRandomSource } from "../domain/random";
import type { PersistenceAdapter } from "../platform/persistence";

class MemoryAdapter implements PersistenceAdapter {
  envelope: { current?: unknown; lastKnownGood?: unknown } | null = null;

  async load() {
    return this.envelope;
  }

  async save(value: { current?: unknown; lastKnownGood?: unknown }) {
    this.envelope = structuredClone(value);
  }
}

beforeEach(() => {
  useAppStore.setState({ ...createDefaultState(), hydrated: true, hydrationSource: "test", warnings: [], currentResults: [], previewResults: [], isDrawing: false, error: "", toast: "", revision: 0 });
});

describe("atomic store operations", () => {
  it("remembers counts independently for range, custom and expression modes", () => {
    const store = useAppStore.getState();

    store.updateSettings({ mode: "range", count: 7 });
    store.updateSettings({ mode: "custom" });
    expect(useAppStore.getState().settings.count).toBe(5);

    store.updateSettings({ count: 3 });
    store.updateSettings({ mode: "expression" });
    expect(useAppStore.getState().settings.count).toBe(5);

    store.updateSettings({ count: 4 });
    store.updateSettings({ mode: "range" });
    expect(useAppStore.getState().settings.count).toBe(7);
    store.updateSettings({ mode: "custom" });
    expect(useAppStore.getState().settings.count).toBe(3);
    store.updateSettings({ mode: "expression" });
    expect(useAppStore.getState().settings.count).toBe(4);
    expect(useAppStore.getState().ui.countByMode).toEqual({ range: 7, custom: 3, expression: 4 });
  });

  it("does not overwrite batch count memory when expression evaluation is single", () => {
    const store = useAppStore.getState();
    store.updateSettings({ mode: "expression", count: 4 });
    store.updateSettings({ expression: { ...useAppStore.getState().settings.expression, evaluation: "single" } });

    expect(useAppStore.getState().settings.count).toBe(4);
    expect(useAppStore.getState().ui.countByMode.expression).toBe(4);
  });

  it("forces the range roll view with an empty stage and resets insights to overview on hydration", async () => {
    const adapter = new MemoryAdapter();
    const source = createDefaultState();
    const transaction = executeDraw(prepareDraw(source), new SeededRandomSource(11));
    source.ui.activeView = "insights";
    source.ui.insightsTab = "history";
    source.settings.mode = "expression";
    source.settings.min = 9;
    source.history = [{
      id: "persisted-history",
      transactionId: transaction.id,
      createdAt: transaction.createdAt,
      mode: transaction.mode,
      config: transaction.configSnapshot,
      results: transaction.results,
      operation: transaction.operation,
      statsDelta: transaction.statsDelta,
      poolFingerprint: transaction.poolFingerprint,
      usedAdded: transaction.usedAdded,
      legacy: false,
    }];
    source.drawState.lastTransactionId = transaction.id;
    adapter.envelope = { current: source };

    await initializeStore(adapter);

    expect(useAppStore.getState().ui.activeView).toBe("roll");
    expect(useAppStore.getState().ui.insightsTab).toBe("overview");
    expect(useAppStore.getState().settings.mode).toBe("range");
    expect(useAppStore.getState().currentResults).toEqual([]);
    expect(useAppStore.getState().drawState.lastTransactionId).toBeNull();
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().settings.min).toBe(9);
    expect((adapter.envelope?.current as AppState).ui.activeView).toBe("roll");
    expect((adapter.envelope?.current as AppState).ui.insightsTab).toBe("overview");
    expect((adapter.envelope?.current as AppState).settings.mode).toBe("range");
  });

  it("restores last known good state and still starts on the roll view", async () => {
    const adapter = new MemoryAdapter();
    const recovery = createDefaultState();
    recovery.ui.activeView = "settings";
    recovery.settings.max = 88;
    adapter.envelope = { current: { version: 5, bad: true }, lastKnownGood: recovery };

    await initializeStore(adapter);

    expect(useAppStore.getState().hydrationSource).toBe("v5-last-known-good");
    expect(useAppStore.getState().settings.max).toBe(88);
    expect(useAppStore.getState().ui.activeView).toBe("roll");
  });

  it("commits and reverts history, statistics and used values together", () => {
    useAppStore.getState().updateSettings({ min: 1, max: 4, count: 2, noDup: true });
    const state = useAppStore.getState(); const transaction = executeDraw(prepareDraw(state), new SeededRandomSource(4));
    state.commitTransaction(transaction);
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(2);
    expect(useAppStore.getState().drawState.usedValues).toHaveLength(2);
    expect(useAppStore.getState().revertTransaction(transaction.id)).toBe(true);
    expect(useAppStore.getState().history).toHaveLength(0);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(0);
    expect(useAppStore.getState().drawState.usedValues).toHaveLength(0);
  });

  it("allows draw settings to change because sessions no longer lock the inspector", () => {
    useAppStore.getState().updateSettings({ min: 999, muted: true });
    expect(useAppStore.getState().settings.min).toBe(999);
    expect(useAppStore.getState().settings.muted).toBe(true);
  });

  it("deleting ordinary history does not alter statistics", () => {
    const state = useAppStore.getState(); const transaction = executeDraw(prepareDraw(state), new SeededRandomSource(1)); state.commitTransaction(transaction);
    const historyId = useAppStore.getState().history[0].id; useAppStore.getState().deleteHistory(historyId);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(transaction.results.length);
  });

  it("clearing history also clears the result stage without clearing statistics", () => {
    const transaction = executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(5));
    useAppStore.getState().commitTransaction(transaction);
    useAppStore.getState().setResultInteraction({
      transactionId: transaction.id,
      selectedIndices: [0],
      pinnedIndices: [0],
    });

    useAppStore.getState().clearHistory();

    expect(useAppStore.getState().history).toEqual([]);
    expect(useAppStore.getState().currentResults).toEqual([]);
    expect(useAppStore.getState().drawState.lastTransactionId).toBeNull();
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([]);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(transaction.results.length);
  });

  it("reverts an archived session even after ordinary history was cleared", () => {
    const first = executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(8));
    useAppStore.getState().commitTransaction(first);
    const second = executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(9));
    useAppStore.getState().commitTransaction(second);
    const snapshot = useAppStore.getState();
    useAppStore.setState({
      sessionArchive: [{
        id: "archived-session",
        name: "独立事务记录",
        startedAt: new Date(0).toISOString(),
        endedAt: new Date().toISOString(),
        configSnapshot: snapshot.settings,
        poolsSnapshot: snapshot.pools,
        poolFingerprint: first.poolFingerprint,
        transactionIds: [first.id, second.id],
        transactionRecords: snapshot.history
          .filter((entry) => entry.transactionId === first.id || entry.transactionId === second.id)
          .map((entry) => ({
            id: entry.transactionId!,
            createdAt: entry.createdAt || "",
            results: entry.results,
            operation: entry.operation || { kind: "draw" as const },
            statsDelta: entry.statsDelta!,
            poolFingerprint: entry.poolFingerprint || "",
            usedAdded: entry.usedAdded || [],
            receipt: entry.receipt,
          })),
        roundCount: 2,
      }],
    });
    useAppStore.getState().clearHistory();
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(first.results.length + second.results.length);
    expect(useAppStore.getState().revertSession("archived-session")).toBe(true);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(0);
  });
});
