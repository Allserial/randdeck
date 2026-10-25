import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultState } from "./state";
import { beginStoreClose, endStoreClose, flushStore, flushStoreUntilStable, initializeStore, snapshotState, useAppStore } from "./store";
import { prepareMainWindowClose } from "./close";
import { cancelCeremony, generateDraw, startCountdownCeremony } from "./drawController";
import { listenMainWindowClose } from "../platform/desktop";
import type { PersistenceAdapter } from "../platform/persistence";
import type { AppState } from "../domain/types";
import { executeDraw, prepareDraw } from "../domain/draw";
import { SeededRandomSource } from "../domain/random";

const mocks = vi.hoisted(() => ({ main: { onCloseRequested: vi.fn(), destroy: vi.fn() } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks.main }));
vi.mock("../platform/persistence", async (original) => ({ ...await original(), isTauriRuntime: () => true }));
vi.mock("../platform/desktop", async (original) => ({ ...await original(), publishDisplayState: vi.fn(async () => undefined) }));
vi.mock("../platform/audio", () => ({ playDrawSound: vi.fn(), playCountdownTick: vi.fn(), startCountdownDrums: vi.fn(), stopCountdownDrums: vi.fn() }));

class DelayedMemoryAdapter implements PersistenceAdapter {
  envelope = { current: createDefaultState(), lastKnownGood: createDefaultState() };
  delayNext = false;
  failNext = false;
  release!: () => void;
  private notify!: () => void;
  started = new Promise<void>((resolve) => { this.notify = resolve; });
  async load() { return structuredClone(this.envelope); }
  async save(value: { current?: unknown; lastKnownGood?: unknown }) {
    if (this.delayNext) {
      this.delayNext = false;
      await new Promise<void>((resolve) => { this.release = resolve; this.notify(); });
    }
    if (this.failNext) { this.failNext = false; throw new Error("disk unavailable"); }
    this.envelope = structuredClone(value) as typeof this.envelope;
  }
}

let adapter: DelayedMemoryAdapter;
beforeEach(async () => {
  vi.resetAllMocks();
  endStoreClose();
  cancelCeremony();
  adapter = new DelayedMemoryAdapter();
  await initializeStore(adapter);
});
afterEach(async () => {
  endStoreClose();
  cancelCeremony();
  await flushStore();
  vi.useRealTimers();
});

async function closeHandler(onError = vi.fn()) {
  await listenMainWindowClose(prepareMainWindowClose, (error) => { endStoreClose(); onError(error); });
  return mocks.main.onCloseRequested.mock.calls[0][0] as (event: { preventDefault(): void }) => Promise<void>;
}

describe("closing with the final durable state", () => {
  it("freezes every persistent action while the close snapshot is saving", async () => {
    useAppStore.getState().updateSettings({ max: 12 });
    const transaction = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(72));
    const close = await closeHandler();
    adapter.delayNext = true;
    const pending = close({ preventDefault: vi.fn() });
    await adapter.started;
    const before = structuredClone(snapshotState());
    const revision = useAppStore.getState().revision;
    const state = useAppStore.getState();
    expect(state.isClosing).toBe(true);
    state.updateSettings({ max: 99 });
    state.updatePools({ customEntries: [{ id: "late", value: 99, tags: [] }] });
    state.setView("settings"); state.setLocale("en-US"); state.setInspectorOpen(false);
    state.setInsightsTab("history"); state.toggleCompare("x"); state.clearCompare(); state.setCopyFormat("newline");
    state.commitTransaction(transaction); state.resetPool(); state.deleteHistory("x"); state.clearHistory();
    state.updateHistoryNote("x", "late"); state.resetModeStats("range"); state.recallHistory("x");
    state.replacePersistentState(createDefaultState("en-US"));
    expect(state.revertTransaction("x")).toBe(false);
    expect(state.revertSession("x")).toBe(false);
    expect(state.deleteArchivedSession("x")).toBe(false);
    expect(snapshotState()).toEqual(before);
    expect(useAppStore.getState().revision).toBe(revision);
    expect(mocks.main.destroy).not.toHaveBeenCalled();
    mocks.main.destroy.mockImplementation(async () => { expect(adapter.envelope.current).toEqual(before); });
    adapter.release();
    await pending;
    expect(mocks.main.destroy).toHaveBeenCalledOnce();
  });

  it("drains transactions already queued before close and rejects late transactions", async () => {
    const first = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(1));
    const second = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(2));
    adapter.delayNext = true;
    useAppStore.getState().commitTransaction(first);
    await adapter.started;
    useAppStore.getState().commitTransaction(second);
    const close = await closeHandler();
    const pending = close({ preventDefault: vi.fn() });
    const expected = structuredClone(snapshotState());
    useAppStore.getState().commitTransaction(executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(3)));
    mocks.main.destroy.mockImplementation(async () => {
      expect(adapter.envelope.current).toEqual(expected);
      expect(adapter.envelope.current.history.map((entry) => entry.transactionId)).toEqual([second.id, first.id]);
    });
    adapter.release();
    await pending;
    expect(mocks.main.destroy).toHaveBeenCalledOnce();
  });

  it("cancels an unfinished ceremony and does not accept new generation during close", async () => {
    vi.useFakeTimers();
    await startCountdownCeremony(3);
    expect(useAppStore.getState().ceremony.phase).toBe("countdown");
    adapter.delayNext = true;
    const close = await closeHandler();
    const pending = close({ preventDefault: vi.fn() });
    await adapter.started;
    expect(useAppStore.getState().ceremony.phase).toBe("idle");
    expect(await generateDraw()).toBeNull();
    await startCountdownCeremony(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(useAppStore.getState().history).toHaveLength(0);
    adapter.release();
    await pending;
    expect(adapter.envelope.current.history).toHaveLength(0);
  });

  it("restores editing after a failed save, then persists the edit on close retry", async () => {
    const error = vi.fn();
    const close = await closeHandler(error);
    adapter.failNext = true;
    await close({ preventDefault: vi.fn() });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "disk unavailable" }));
    expect(useAppStore.getState().isClosing).toBe(false);
    expect(mocks.main.destroy).not.toHaveBeenCalled();
    useAppStore.getState().updateSettings({ max: 99 });
    await close({ preventDefault: vi.fn() });
    expect(adapter.envelope.current.settings.max).toBe(99);
    expect(mocks.main.destroy).toHaveBeenCalledOnce();
  });

  it("restores editing if native destruction fails and handles repeated close requests once", async () => {
    const error = vi.fn();
    const close = await closeHandler(error);
    adapter.delayNext = true;
    const pending = close({ preventDefault: vi.fn() });
    await adapter.started;
    await close({ preventDefault: vi.fn() });
    mocks.main.destroy.mockRejectedValueOnce(new Error("native failure"));
    adapter.release();
    await pending;
    expect(mocks.main.destroy).toHaveBeenCalledOnce();
    expect(useAppStore.getState().isClosing).toBe(false);
    useAppStore.getState().updateSettings({ max: 72 });
    await close({ preventDefault: vi.fn() });
    expect(adapter.envelope.current.settings.max).toBe(72);
    expect(mocks.main.destroy).toHaveBeenCalledTimes(2);
  });

  it("flushes again if a revision changes while the earlier snapshot is in flight", async () => {
    adapter.delayNext = true;
    beginStoreClose();
    const pending = flushStoreUntilStable();
    await adapter.started;
    // Deliberately bypass actions to exercise the stabilization guard itself.
    useAppStore.setState((state) => ({ settings: { ...state.settings, max: 88 }, revision: state.revision + 1 }));
    adapter.release();
    await pending;
    expect((adapter.envelope.current as AppState).settings.max).toBe(88);
  });
});
