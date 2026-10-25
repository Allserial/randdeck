import { beforeEach, describe, expect, it } from "vitest";
import type { AppState } from "../domain/types";
import { createDefaultState } from "./state";
import { flushStore, initializeStore, useAppStore } from "./store";
import { executeDraw, prepareDraw } from "../domain/draw";
import { SeededRandomSource } from "../domain/random";
import type { PersistenceAdapter } from "../platform/persistence";
import { parseRuntimeMessage } from "../domain/runtimeMessage";

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

  it("does not reverse new statistics or used values when undoing across reset boundaries after reload", async () => {
    const adapter = new MemoryAdapter();
    await initializeStore(adapter);
    useAppStore.getState().updateSettings({ min: 1, max: 1, count: 1, noDup: true });
    const old = executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(1));
    useAppStore.getState().commitTransaction(old);
    useAppStore.getState().resetModeStats("range");
    useAppStore.getState().resetPool();
    const current = executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(2));
    useAppStore.getState().commitTransaction(current);
    await flushStore();
    await initializeStore(adapter);

    expect(useAppStore.getState().revertTransaction(old.id)).toBe(true);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(1);
    expect(useAppStore.getState().stats.byMode.range.values).toEqual({ 1: 1 });
    expect(useAppStore.getState().drawState.usedValues).toEqual([1]);
    expect(useAppStore.getState().history.map((entry) => entry.transactionId)).toEqual([current.id]);
    expect(() => prepareDraw(useAppStore.getState())).toThrow();
    expect(useAppStore.getState().revertTransaction(current.id)).toBe(true);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(0);
    expect(useAppStore.getState().drawState.usedValues).toEqual([]);
    await flushStore();
  });

  it("preserves another retained legacy transaction's ownership of a used value", () => {
    useAppStore.getState().updateSettings({ min: 1, max: 1, count: 1, noDup: true });
    const old = executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(1));
    old.createdAt = "2026-01-01T00:00:00.000Z";
    useAppStore.getState().commitTransaction(old);
    useAppStore.getState().resetPool();
    useAppStore.getState().resetModeStats("range");
    const current = executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(2));
    current.createdAt = "2026-01-03T00:00:00.000Z";
    useAppStore.getState().commitTransaction(current);
    const state = useAppStore.getState();
    const { poolEpoch: _poolEpoch, ...legacyDrawState } = state.drawState;
    const { epoch: _epoch, ...legacyBucket } = state.stats.byMode.range;
    useAppStore.setState({
      history: state.history.map(({ statsEpoch: _statsEpoch, poolEpoch: _entryPoolEpoch, ...entry }) => entry),
      drawState: legacyDrawState,
      stats: { ...state.stats, byMode: { ...state.stats.byMode, range: { ...legacyBucket, resetAt: "2026-01-02T00:00:00.000Z" } } },
    });

    useAppStore.getState().revertTransaction(old.id);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(1);
    expect(useAppStore.getState().drawState.usedValues).toEqual([1]);
    useAppStore.getState().revertTransaction(current.id);
    expect(useAppStore.getState().stats.byMode.range.draws).toBe(0);
    expect(useAppStore.getState().drawState.usedValues).toEqual([]);
  });

  it("saves and reloads arbitrary prototype-named labels without losing counts or history", async () => {
    const adapter = new MemoryAdapter();
    await initializeStore(adapter);
    const labels = ["constructor", "toString", "__proto__", "valueOf"];
    useAppStore.getState().updateSettings({ mode: "custom", count: 1 });
    useAppStore.getState().updatePools({ customEntries: [{ id: "special", value: 1, tags: labels }] });
    for (let index = 0; index < 2; index += 1) {
      useAppStore.getState().commitTransaction(executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(index)));
    }
    await flushStore();
    const saved = JSON.parse(JSON.stringify(adapter.envelope));
    labels.forEach((label) => expect(saved.current.stats.byMode.custom.tags[label]).toBe(2));
    adapter.envelope = saved;
    await initializeStore(adapter);
    labels.forEach((label) => {
      expect(Object.hasOwn(useAppStore.getState().stats.byMode.custom.tags, label)).toBe(true);
      expect(useAppStore.getState().stats.byMode.custom.tags[label]).toBe(2);
      expect(useAppStore.getState().history[0].statsDelta?.tags[label]).toBe(1);
    });
    expect(useAppStore.getState().history).toHaveLength(2);
    expect(useAppStore.getState().error).toBe("");
  });

  it("serializes an in-flight save before flushing the latest snapshot", async () => {
    class DelayedAdapter extends MemoryAdapter {
      release: (() => void) | null = null;
      started: (() => void) | null = null;
      blockNext = false;
      async save(value: { current?: unknown; lastKnownGood?: unknown }) {
        if (this.blockNext) {
          this.blockNext = false;
          await new Promise<void>((resolve) => { this.release = resolve; this.started?.(); });
        }
        await super.save(value);
      }
    }
    const adapter = new DelayedAdapter();
    await initializeStore(adapter);
    adapter.blockNext = true;
    const started = new Promise<void>((resolve) => { adapter.started = resolve; });
    useAppStore.getState().updateSettings({ max: 12 });
    const oldSave = flushStore();
    await started;
    useAppStore.getState().updateSettings({ max: 99 });
    const latestSave = flushStore();
    adapter.release!();
    await Promise.all([oldSave, latestSave]);
    expect((adapter.envelope?.current as AppState).settings.max).toBe(99);
  });

  it("exposes save failures and allows the next queued save to recover", async () => {
    class FailingAdapter extends MemoryAdapter {
      failNext = false;
      async save(value: { current?: unknown; lastKnownGood?: unknown }) {
        if (this.failNext) { this.failNext = false; throw new Error("disk unavailable"); }
        await super.save(value);
      }
    }
    const adapter = new FailingAdapter();
    await initializeStore(adapter);
    adapter.failNext = true;
    useAppStore.getState().updateSettings({ max: 12 });
    await expect(flushStore()).rejects.toThrow("disk unavailable");
    expect(parseRuntimeMessage(useAppStore.getState().error)).toMatchObject({ key: "errors.localSave", params: { message: "disk unavailable" } });
    useAppStore.getState().updateSettings({ max: 99 });
    await flushStore();
    expect((adapter.envelope?.current as AppState).settings.max).toBe(99);
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
