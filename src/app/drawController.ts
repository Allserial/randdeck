import { createReceipt } from "../domain/audit";
import { executeDraw, prepareDraw, prepareShuffle } from "../domain/draw";
import { WebCryptoRandomSource } from "../domain/random";
import type { DrawTransaction, SoundProfile } from "../domain/types";
import { playCountdownTick, playDrawSound, startCountdownDrums, stopCountdownDrums } from "../platform/audio";
import { publishDisplayState } from "../platform/desktop";
import { modeLabel } from "../lib/labels";
import { snapshotState, useAppStore } from "./store";
import { getPinScopeKey, transactionPresentation } from "./resultPresentation";
import i18n from "i18next";
import { messageFromUnknown, runtimeError } from "../domain/runtimeMessage";

let activeGeneration: Promise<string | null> | null = null;
let activeCountdown: Promise<void> | null = null;
let ceremonyCountdownTimer: number | undefined;
let ceremonyRevealTimer: number | undefined;
let operationGeneration = 0;

interface PartialDrawContext {
  generatedIndices: number[];
  sourceTransactionId: string;
  resultTemplate: Array<ReturnType<typeof snapshotState>["history"][number]["results"][number] | null>;
  retainedPinnedIndices: number[];
  retainedSelectedIndices?: number[];
}

let ceremonyPartial: PartialDrawContext | undefined;

function commitGeneratedTransaction(transaction: DrawTransaction, partial?: PartialDrawContext): void {
  const current = useAppStore.getState();
  current.commitTransaction(transaction);
  if (partial) {
    current.setResultInteraction({
      transactionId: transaction.id,
      selectedIndices: partial.retainedSelectedIndices ?? [],
      pinnedIndices: partial.retainedPinnedIndices,
      rollingIndices: null,
    });
  } else {
    current.clearResultInteraction();
  }
}

// Both immediate generation and countdowns use the same plan and replacement accounting.
function prepareGeneration(countOverride?: number, partial?: PartialDrawContext, shuffle = false) {
  const snapshot = snapshotState();
  const originalSettings = structuredClone(snapshot.settings);
  if (countOverride) snapshot.settings = { ...snapshot.settings, count: countOverride };
  if (partial && snapshot.settings.mode === "expression") {
    snapshot.settings = { ...snapshot.settings, expression: { ...snapshot.settings.expression, evaluation: "batch" } };
  }
  const plan = shuffle ? prepareShuffle(snapshot) : prepareDraw(snapshot);
  if (partial && snapshot.settings.noDup && plan.mode !== "expression") {
    const retainedValues = new Set(partial.resultTemplate.flatMap((result) => result === null ? [] : [result.value]));
    plan.candidateEntries = plan.candidateEntries.filter((entry) => !retainedValues.has(entry.value));
    if (plan.candidateEntries.length < plan.count) {
      throw runtimeError("errors.notEnough", { available: plan.candidateEntries.length, count: plan.count });
    }
  }
  const transaction = executeDraw(plan, new WebCryptoRandomSource(), null);
  if (partial) {
    const replacements = transaction.results;
    if (replacements.length !== partial.generatedIndices.length) throw runtimeError("errors.rerollMismatch");
    let replacementIndex = 0;
    transaction.results = partial.resultTemplate.map((result) => result ?? replacements[replacementIndex++]);
    transaction.configSnapshot = {
      ...transaction.configSnapshot,
      count: partial.resultTemplate.length,
      ...(originalSettings.mode === "expression" ? {
        expression: { ...transaction.configSnapshot.expression, evaluation: originalSettings.expression.evaluation },
      } : {}),
    };
    transaction.operation = {
      kind: "reroll",
      sourceTransactionId: partial.sourceTransactionId,
      rerolledIndices: partial.generatedIndices,
    };
  }
  return { snapshot, transaction };
}

export function effectiveMotion(): "instant" | "standard" | "ceremony" {
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "instant";
  return useAppStore.getState().settings.appearance.motion;
}

export async function publishCurrentDisplay(overrides: { hidden?: boolean } = {}): Promise<void> {
  const state = useAppStore.getState();
  const ceremony = state.ceremony;

  let results: typeof state.currentResults;
  let summary: string;

  if (ceremony.phase === "countdown") {
    results = [];
    summary = i18n.t("roll.countdown", { seconds: ceremony.remainingSeconds });
  } else if (ceremony.phase === "revealing") {
    results = (ceremony.targetTransaction?.results || []).slice(0, ceremony.revealedCount);
    summary = i18n.t("roll.revealingStatus", { current: ceremony.revealedCount, total: ceremony.targetTransaction?.results.length || 0 });
  } else if (ceremony.phase === "finished") {
    results = ceremony.targetTransaction?.results || state.currentResults;
    summary = results.map((result) => result.total).join(", ");
  } else if (state.isDrawing || overrides.hidden) {
    results = [];
    summary = i18n.t("roll.drawing");
  } else {
    results = state.currentResults;
    summary = results.map((result) => result.total).join(", ");
  }

  await publishDisplayState({
    context: ceremony.targetTransaction ? transactionPresentation(ceremony.targetTransaction) : state.resultPresentation,
    results,
    mode: modeLabel(ceremony.targetTransaction?.mode ?? state.resultPresentation?.mode ?? state.settings.mode, state.ui.locale),
    modeKey: ceremony.targetTransaction?.mode ?? state.resultPresentation?.mode ?? state.settings.mode,
    locale: state.ui.locale,
    summary,
    theme: state.settings.appearance.theme,
    appearance: { motion: state.settings.appearance.motion, particles: state.settings.appearance.particles },
    windowMode: state.settings.desktop.displayMode,
    animationToken:
      ceremony.phase !== "idle"
        ? `ceremony-${ceremony.targetTransaction?.id || "active"}`
        : state.drawState.lastTransactionId || "ready",
    ceremony:
      ceremony.phase !== "idle"
        ? {
            phase: ceremony.phase,
            remainingSeconds: ceremony.remainingSeconds,
            revealedCount: ceremony.revealedCount,
            totalCount: ceremony.targetTransaction?.results.length || state.settings.count,
          }
        : undefined,
  });
}

function startCeremonyReveal(
  transaction: DrawTransaction,
  soundProfile: SoundProfile,
  generation: number,
  partial?: PartialDrawContext
): void {
  ceremonyPartial = partial;
  const store = useAppStore.getState();
  const total = transaction.results.length;

  const finishReveal = () => {
    if (generation !== operationGeneration) return;
    ceremonyRevealTimer = undefined;
    commitGeneratedTransaction(transaction, partial);
    useAppStore.getState().setCeremony({
      phase: "finished",
      remainingSeconds: 0,
      revealedCount: total,
      targetTransaction: transaction,
    });
    void publishCurrentDisplay();
  };

  let revealed = 1;
  store.setCeremony({
    phase: "revealing",
    remainingSeconds: 0,
    revealedCount: 1,
    targetTransaction: transaction,
  });
  void playDrawSound(soundProfile, useAppStore.getState().settings.muted, "lock");
  void publishCurrentDisplay();

  if (total <= 1) {
    ceremonyRevealTimer = window.setTimeout(finishReveal, 450);
    return;
  }

  ceremonyRevealTimer = window.setInterval(() => {
    if (generation !== operationGeneration) return;
    revealed += 1;
    useAppStore.getState().setCeremony({ revealedCount: revealed });
    void playDrawSound(soundProfile, useAppStore.getState().settings.muted, "lock");
    void publishCurrentDisplay();

    if (revealed >= total) {
      window.clearInterval(ceremonyRevealTimer);
      finishReveal();
    }
  }, 450);
}

function runGeneration(countOverride?: number, partial?: PartialDrawContext, shuffle = false): Promise<string | null> {
  if (activeGeneration) return activeGeneration;
  const store = useAppStore.getState();
  if (store.isClosing || activeCountdown || store.isDrawing || store.ceremony.phase !== "idle") return Promise.resolve(null);
  const generation = ++operationGeneration;
  const pending = (async () => {
    store.setError("");
    try {
      const { snapshot, transaction } = prepareGeneration(countOverride, partial, shuffle);
      transaction.receipt = await createReceipt(transaction);
      if (generation !== operationGeneration) return null;

      const motion = effectiveMotion();
      const isCeremonyMode = motion === "ceremony" && !partial && !shuffle;
      const duration = motion === "instant" ? 0 : isCeremonyMode ? 480 : motion === "standard" ? 620 : 1180;

      if (duration > 0) {
        store.setResultInteraction(
          partial
            ? {
                transactionId: partial.sourceTransactionId,
                rollingIndices: partial.generatedIndices,
              }
            : {
                transactionId: store.drawState.lastTransactionId,
                selectedIndices: [],
                pinnedIndices: [],
                rollingIndices: null,
              }
        );
        store.setDrawing(true);
        void playDrawSound(snapshot.settings.appearance.soundProfile, useAppStore.getState().settings.muted, "start");
        void publishCurrentDisplay({ hidden: true });
        await new Promise((resolve) => window.setTimeout(resolve, duration));
        if (generation !== operationGeneration) return null;
      }

      if (isCeremonyMode) {
        const sequential = snapshot.settings.appearance.sequentialReveal !== false;
        const total = transaction.results.length;
        const current = useAppStore.getState();
        current.setDrawing(false);
        current.setPreviewResults([]);
        current.setResultInteraction({ rollingIndices: null });

        if (sequential && total > 1) {
          startCeremonyReveal(transaction, snapshot.settings.appearance.soundProfile, generation);
          return transaction.id;
        }

        commitGeneratedTransaction(transaction);
        current.setCeremony({
          phase: "finished",
          remainingSeconds: 0,
          revealedCount: total,
          targetTransaction: transaction,
        });
        void playDrawSound(snapshot.settings.appearance.soundProfile, useAppStore.getState().settings.muted, "lock");
        await publishCurrentDisplay();
        return transaction.id;
      }

      commitGeneratedTransaction(transaction, partial);
      void playDrawSound(snapshot.settings.appearance.soundProfile, useAppStore.getState().settings.muted, "lock");
      await publishCurrentDisplay();
      return transaction.id;
    } catch (error) {
      if (generation !== operationGeneration) return null;
      const current = useAppStore.getState();
      current.setDrawing(false);
      current.setPreviewResults([]);
      current.setResultInteraction({ rollingIndices: null });
      current.setError(messageFromUnknown(error, "errors.drawFailed"));
      return null;
    }
  })().finally(() => {
    if (activeGeneration === pending) activeGeneration = null;
  });
  activeGeneration = pending;
  return pending;
}

function pinnedGenerationContext(countOverride?: number): { count?: number; partial?: PartialDrawContext } | null {
  const state = useAppStore.getState();
  const interaction = state.resultInteraction;
  const pinsAreCurrent = interaction.transactionId === state.drawState.lastTransactionId && state.currentResults.length > 0
    && state.resultPresentation?.pinScopeKey != null && state.resultPresentation.pinScopeKey === getPinScopeKey(state.settings, state.pools);
  const pinnedSourceIndices = pinsAreCurrent
    ? [...new Set(interaction.pinnedIndices)].filter((index) => index >= 0 && index < state.currentResults.length).sort((a, b) => a - b)
    : [];

  if (!pinnedSourceIndices.length) return { count: countOverride };

  const targetCount =
    state.settings.mode === "expression" && state.settings.expression.evaluation === "single"
      ? 1
      : Math.max(1, Math.min(50, Math.trunc(countOverride ?? state.settings.count)));
  if (pinnedSourceIndices.length >= targetCount) {
    state.setError(
      pinnedSourceIndices.length === targetCount
        ? runtimeError("errors.fixedAll").message
        : runtimeError("errors.fixedTooMany", { fixed: pinnedSourceIndices.length, count: targetCount }).message
    );
    return null;
  }

  const resultTemplate = Array.from({ length: targetCount }, () => null) as PartialDrawContext["resultTemplate"];
  const overflow: number[] = [];
  pinnedSourceIndices.forEach((sourceIndex) => {
    if (sourceIndex < targetCount && resultTemplate[sourceIndex] === null) {
      resultTemplate[sourceIndex] = structuredClone(state.currentResults[sourceIndex]);
    } else {
      overflow.push(sourceIndex);
    }
  });
  overflow.forEach((sourceIndex) => {
    const targetIndex = resultTemplate.findIndex((result) => result === null);
    if (targetIndex >= 0) resultTemplate[targetIndex] = structuredClone(state.currentResults[sourceIndex]);
  });
  const retainedPinnedIndices = resultTemplate.flatMap((result, index) => (result === null ? [] : [index]));
  const generatedIndices = resultTemplate.flatMap((result, index) => (result === null ? [index] : []));

  return { count: generatedIndices.length, partial: {
    generatedIndices,
    sourceTransactionId: state.drawState.lastTransactionId!,
    resultTemplate,
    retainedPinnedIndices,
  } };
}

export function generateDraw(countOverride?: number): Promise<string | null> {
  const context = pinnedGenerationContext(countOverride);
  return context ? runGeneration(context.count, context.partial) : Promise.resolve(null);
}

export function generateShuffle(): Promise<string | null> {
  return runGeneration(undefined, undefined, true);
}

export function rerollDraw(indices: number[]): Promise<string | null> {
  const state = useAppStore.getState();
  if (state.resultPresentation?.pinScopeKey == null || state.resultPresentation.pinScopeKey !== getPinScopeKey(state.settings, state.pools)) return Promise.resolve(null);
  const unique = [...new Set(indices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < state.currentResults.length)
    .sort((left, right) => left - right);
  if (!unique.length || !state.drawState.lastTransactionId) {
    state.setError(runtimeError("errors.selectReroll").message);
    return Promise.resolve(null);
  }
  const selected = new Set(unique);
  const pinned = new Set(
    state.resultInteraction.transactionId === state.drawState.lastTransactionId ? state.resultInteraction.pinnedIndices : []
  );
  return runGeneration(unique.length, {
    generatedIndices: unique,
    sourceTransactionId: state.drawState.lastTransactionId,
    resultTemplate: state.currentResults.map((result, index) => (selected.has(index) ? null : structuredClone(result))),
    retainedPinnedIndices: [...pinned].filter((index) => !selected.has(index)),
    retainedSelectedIndices: unique,
  });
}

// 倒计时后生成仪式系统（Item 3, 7）
export async function startCountdownCeremony(seconds: number): Promise<void> {
  const store = useAppStore.getState();
  if (store.isClosing || activeCountdown || activeGeneration || store.isDrawing || store.ceremony.phase !== "idle") return;
  const context = pinnedGenerationContext();
  if (!context) return;
  const generation = ++operationGeneration;
  store.setError("");

  const pending = (async () => {
    let snapshot;
    let transaction;
    try {
      ({ snapshot, transaction } = prepareGeneration(context.count, context.partial));
      transaction.receipt = await createReceipt(transaction);
    } catch (error) {
      if (generation === operationGeneration) store.setError(messageFromUnknown(error, "errors.drawFailed"));
      return;
    }

    if (generation !== operationGeneration) return;
    ceremonyPartial = context.partial;

    // 1. 设置倒计时阶段，启动低音节奏床鼓点与整秒 tick
    store.setCeremony({
      phase: "countdown",
      remainingSeconds: seconds,
      revealedCount: 0,
      targetTransaction: transaction,
    });
    void startCountdownDrums(useAppStore.getState().settings.muted);
    void playCountdownTick(useAppStore.getState().settings.muted);
    void publishCurrentDisplay();

    const motion = effectiveMotion();
    const instant = motion === "instant";

    // 倒计时每秒触发
    let currentSec = seconds;
    ceremonyCountdownTimer = window.setInterval(() => {
      if (generation !== operationGeneration) return;
      currentSec -= 1;
      if (currentSec > 0) {
        useAppStore.getState().setCeremony({ remainingSeconds: currentSec });
        void playCountdownTick(useAppStore.getState().settings.muted);
        void publishCurrentDisplay();
        return;
      }

      // 倒计时结束，停止鼓点
      window.clearInterval(ceremonyCountdownTimer);
      ceremonyCountdownTimer = undefined;
      stopCountdownDrums();

      const sequential = snapshot.settings.appearance.sequentialReveal !== false;

      if (instant || !sequential) {
        // 即时/减少动态模式或关闭逐个揭示：倒计时结束后一次性揭晓
        commitGeneratedTransaction(transaction, context.partial);
        useAppStore.getState().setCeremony({
          phase: "finished",
          remainingSeconds: 0,
          revealedCount: transaction.results.length,
          targetTransaction: transaction,
        });
        void playDrawSound(snapshot.settings.appearance.soundProfile, useAppStore.getState().settings.muted, "lock");
        void publishCurrentDisplay();
        return;
      }

      startCeremonyReveal(transaction, snapshot.settings.appearance.soundProfile, generation, context.partial);
    }, 1000);
  })().finally(() => {
    if (activeCountdown === pending) activeCountdown = null;
  });

  activeCountdown = pending;
  return pending;
}

// Esc 中断或离开：终止仪式，停止音效，不留答案、不写历史
export function cancelCeremony(): void {
  operationGeneration += 1;
  activeGeneration = null;
  activeCountdown = null;
  ceremonyPartial = undefined;
  window.clearInterval(ceremonyCountdownTimer);
  window.clearInterval(ceremonyRevealTimer);
  window.clearTimeout(ceremonyRevealTimer);
  ceremonyCountdownTimer = undefined;
  ceremonyRevealTimer = undefined;
  stopCountdownDrums();
  useAppStore.getState().setDrawing(false);
  useAppStore.getState().setPreviewResults([]);
  useAppStore.getState().setResultInteraction({ rollingIndices: null });
  useAppStore.getState().resetCeremony();
  void publishCurrentDisplay();
}

// 揭晓中按空格/Enter：立刻全部揭晓并播最终礼花
export function skipCeremonyReveal(): void {
  const store = useAppStore.getState();
  if (store.ceremony.phase !== "revealing" || !store.ceremony.targetTransaction) return;
  window.clearInterval(ceremonyRevealTimer);
  window.clearTimeout(ceremonyRevealTimer);
  ceremonyRevealTimer = undefined;
  stopCountdownDrums();

  const tx = store.ceremony.targetTransaction;
  commitGeneratedTransaction(tx, ceremonyPartial);
  store.setCeremony({
    phase: "finished",
    revealedCount: tx.results.length,
  });
  void playDrawSound(store.settings.appearance.soundProfile, store.settings.muted, "lock");
  void publishCurrentDisplay();
}

// 全部揭晓后按空格/Enter：淡出仪式，回到普通卡
export function finishCeremonyToNormal(): void {
  const store = useAppStore.getState();
  if (store.ceremony.phase !== "finished") return;
  stopCountdownDrums();
  store.resetCeremony();
  void publishCurrentDisplay();
}
