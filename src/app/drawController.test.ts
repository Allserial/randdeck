import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawTransaction } from "../domain/types";
import { executeDraw, prepareDraw } from "../domain/draw";
import { SeededRandomSource, WebCryptoRandomSource } from "../domain/random";
import { playDrawSound } from "../platform/audio";
import { createDefaultState } from "./state";
import { snapshotState, useAppStore } from "./store";
import { cancelCeremony, generateDraw, startCountdownCeremony, skipCeremonyReveal } from "./drawController";

const mocks = vi.hoisted(() => ({ receipt: vi.fn<(transaction: DrawTransaction) => Promise<undefined>>() }));
vi.mock("../domain/audit", () => ({ createReceipt: mocks.receipt }));
vi.mock("../platform/audio", () => ({
  playDrawSound: vi.fn(), playCountdownTick: vi.fn(), startCountdownDrums: vi.fn(), stopCountdownDrums: vi.fn(),
}));
vi.mock("../platform/desktop", () => ({ publishDisplayState: vi.fn(async () => undefined) }));

beforeEach(() => {
  vi.useFakeTimers();
  cancelCeremony();
  vi.clearAllMocks();
  mocks.receipt.mockResolvedValue(undefined);
  useAppStore.setState({ ...createDefaultState("zh-CN"), hydrated: false, currentResults: [], previewResults: [], resultPresentation: null,
    resultInteraction: { transactionId: null, selectedIndices: [], pinnedIndices: [], rollingIndices: null },
    ceremony: { phase: "idle", remainingSeconds: 0, revealedCount: 0, targetTransaction: null }, isDrawing: false, error: "", toast: "", revision: 0 });
  vi.spyOn(WebCryptoRandomSource.prototype, "nextUint32").mockReturnValue(0);
});

afterEach(() => {
  cancelCeremony();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setMotion(motion: "instant" | "standard" | "ceremony") {
  const settings = useAppStore.getState().settings;
  useAppStore.getState().updateSettings({ appearance: { ...settings.appearance, motion } });
}

function seedPinnedResults() {
  useAppStore.getState().updateSettings({ count: 3, noDup: true, min: 1, max: 20 });
  const first = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(21));
  useAppStore.getState().commitTransaction(first);
  useAppStore.getState().setResultInteraction({ transactionId: first.id, pinnedIndices: [1] });
  return first;
}

describe("generation cancellation", () => {
  it("invalidates a generation cancelled during receipt creation", async () => {
    let resolveReceipt!: () => void;
    mocks.receipt.mockImplementationOnce(() => new Promise((resolve) => { resolveReceipt = () => resolve(undefined); }));
    const pending = generateDraw();
    cancelCeremony();
    resolveReceipt();
    expect(await pending).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(useAppStore.getState().history).toHaveLength(0);
    expect(useAppStore.getState().ceremony.phase).toBe("idle");
    expect(useAppStore.getState().isDrawing).toBe(false);
  });

  it("cancels ceremony intro and keeps a newer generation independent", async () => {
    setMotion("ceremony");
    const cancelled = generateDraw();
    await vi.advanceTimersByTimeAsync(0);
    expect(useAppStore.getState().isDrawing).toBe(true);
    cancelCeremony();
    setMotion("instant");
    const acceptedId = await generateDraw();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await cancelled).toBeNull();
    expect(useAppStore.getState().history.map((entry) => entry.transactionId)).toEqual([acceptedId]);
    expect(useAppStore.getState().ceremony.phase).toBe("idle");
  });

  it("does not restart a countdown after cancellation during receipt creation", async () => {
    let resolveReceipt!: () => void;
    mocks.receipt.mockImplementationOnce(() => new Promise((resolve) => { resolveReceipt = () => resolve(undefined); }));
    const cancelled = startCountdownCeremony(3);
    cancelCeremony();
    resolveReceipt();
    await cancelled;
    await vi.advanceTimersByTimeAsync(5000);
    expect(useAppStore.getState().history).toHaveLength(0);
    expect(useAppStore.getState().ceremony.phase).toBe("idle");
  });

  it("stops a reveal before its final commit", async () => {
    setMotion("ceremony");
    const pending = generateDraw();
    await vi.advanceTimersByTimeAsync(480);
    await pending;
    expect(useAppStore.getState().ceremony.phase).toBe("revealing");
    cancelCeremony();
    await vi.advanceTimersByTimeAsync(5000);
    expect(useAppStore.getState().history).toHaveLength(0);
  });
});

describe("pinned countdowns and reveal settings", () => {
  it.each(["generate", "countdown"] as const)("preserves expression pins with a noDup setting carried from range mode during %s", async (kind) => {
    useAppStore.getState().updateSettings({ noDup: true, mode: "expression", count: 3 });
    const first = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(21));
    useAppStore.getState().commitTransaction(first);
    useAppStore.getState().setResultInteraction({ transactionId: first.id, pinnedIndices: [1] });
    setMotion("instant");

    if (kind === "generate") await generateDraw();
    else {
      await startCountdownCeremony(1);
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(mocks.receipt).toHaveBeenCalledTimes(1);
    const transaction = mocks.receipt.mock.calls[0][0];
    expect(transaction.results).toHaveLength(3);
    expect(transaction.results[1]).toEqual(first.results[1]);
    expect(transaction.configSnapshot.count).toBe(3);
    expect(transaction.operation).toEqual({ kind: "reroll", sourceTransactionId: first.id, rerolledIndices: [0, 2] });
    expect(transaction.statsDelta.draws).toBe(2);
    expect(transaction.usedAdded).toEqual([]);
    expect(useAppStore.getState().history).toHaveLength(2);
    expect(useAppStore.getState().stats.byMode.expression.draws).toBe(5);
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([1]);
    expect(useAppStore.getState().error).toBe("");
  });

  it.each(["instant", "ceremony"] as const)("preserves pins, replacement accounting and receipt results in %s mode", async (motion) => {
    const first = seedPinnedResults();
    setMotion(motion);
    await startCountdownCeremony(1);
    const transaction = mocks.receipt.mock.calls[0][0];
    expect(transaction.results[1]).toEqual(first.results[1]);
    expect(transaction.results).toHaveLength(3);
    expect(transaction.configSnapshot.count).toBe(3);
    expect(transaction.operation).toEqual({ kind: "reroll", sourceTransactionId: first.id, rerolledIndices: [0, 2] });
    expect(transaction.statsDelta.draws).toBe(2);
    expect(transaction.usedAdded).toHaveLength(2);
    expect(transaction.usedAdded).not.toContain(first.results[1].value);
    await vi.advanceTimersByTimeAsync(3000);
    expect(useAppStore.getState().currentResults[1]).toEqual(first.results[1]);
    expect(useAppStore.getState().history).toHaveLength(2);
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([1]);
    expect(useAppStore.getState().resultInteraction.transactionId).toBe(transaction.id);
  });

  it("preserves pins when skipping a countdown reveal", async () => {
    const first = seedPinnedResults();
    setMotion("ceremony");
    await startCountdownCeremony(1);
    await vi.advanceTimersByTimeAsync(1000);
    skipCeremonyReveal();
    await vi.advanceTimersByTimeAsync(2000);
    expect(useAppStore.getState().history).toHaveLength(2);
    expect(useAppStore.getState().currentResults[1]).toEqual(first.results[1]);
    expect(useAppStore.getState().resultInteraction.pinnedIndices).toEqual([1]);
  });

  it("rejects countdown generation when all target cards are pinned", async () => {
    const first = seedPinnedResults();
    useAppStore.getState().setResultInteraction({ transactionId: first.id, pinnedIndices: [0, 1, 2] });
    await startCountdownCeremony(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(useAppStore.getState().error).toContain("fixedAll");
  });

  it("uses the current mute state for every sequential reveal", async () => {
    setMotion("ceremony");
    useAppStore.getState().updateSettings({ count: 3 });
    const pending = generateDraw();
    await vi.advanceTimersByTimeAsync(480);
    await pending;
    expect(playDrawSound).toHaveBeenLastCalledWith("minimal", false, "lock");
    useAppStore.getState().updateSettings({ muted: true });
    await vi.advanceTimersByTimeAsync(450);
    expect(playDrawSound).toHaveBeenLastCalledWith("minimal", true, "lock");
    useAppStore.getState().updateSettings({ muted: false });
    await vi.advanceTimersByTimeAsync(450);
    expect(playDrawSound).toHaveBeenLastCalledWith("minimal", false, "lock");
    expect(useAppStore.getState().history).toHaveLength(1);
  });

  it("respects a mute change while the receipt is still being created", async () => {
    let resolveReceipt!: () => void;
    mocks.receipt.mockImplementationOnce(() => new Promise((resolve) => { resolveReceipt = () => resolve(undefined); }));
    const pending = generateDraw();
    useAppStore.getState().updateSettings({ muted: true });
    resolveReceipt();
    await vi.advanceTimersByTimeAsync(620);
    await pending;
    expect(playDrawSound).toHaveBeenNthCalledWith(1, "minimal", true, "start");
    expect(playDrawSound).toHaveBeenLastCalledWith("minimal", true, "lock");
  });
});
