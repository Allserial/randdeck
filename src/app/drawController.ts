import { createReceipt } from "../domain/audit";
import { executeDraw, prepareDraw, prepareShuffle } from "../domain/draw";
import { WebCryptoRandomSource } from "../domain/random";
import { playCountdownTick, playDrawSound, startCountdownDrums, stopCountdownDrums } from "../platform/audio";
import { publishDisplayState } from "../platform/desktop";
import { modeLabel } from "../lib/labels";
import { snapshotState, useAppStore } from "./store";
import i18n from "i18next";

let activeGeneration: Promise<string | null> | null = null;
let ceremonyCountdownTimer: number | undefined;
let ceremonyRevealTimer: number | undefined;

interface PartialDrawContext {
  generatedIndices: number[];
  sourceTransactionId: string;
  resultTemplate: Array<ReturnType<typeof snapshotState>["history"][number]["results"][number] | null>;
  retainedPinnedIndices: number[];
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
    results,
    mode: modeLabel(state.settings.mode, state.ui.locale),
    modeKey: state.settings.mode,
    locale: state.ui.locale,
    summary,
    theme: state.settings.appearance.theme,
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

function runGeneration(countOverride?: number, partial?: PartialDrawContext, shuffle = false): Promise<string | null> {
  if (activeGeneration) return activeGeneration;
  activeGeneration = (async () => {
    const store = useAppStore.getState();
    if (store.isDrawing || store.ceremony.phase !== "idle") return null;
    store.setError("");
    try {
      const snapshot = snapshotState();
      if (countOverride) snapshot.settings = { ...snapshot.settings, count: countOverride };
      if (partial && snapshot.settings.mode === "expression") {
        snapshot.settings = { ...snapshot.settings, expression: { ...snapshot.settings.expression, evaluation: "batch" } };
      }
      const plan = shuffle ? prepareShuffle(snapshot) : prepareDraw(snapshot);
      if (partial && snapshot.settings.noDup) {
        const retainedValues = new Set(
          partial.resultTemplate.flatMap((result) => (result === null ? [] : [result.value]))
        );
        plan.candidateEntries = plan.candidateEntries.filter((entry) => !retainedValues.has(entry.value));
        if (plan.candidateEntries.length < plan.count) {
          throw new Error(`当前仅剩 ${plan.candidateEntries.length} 个可抽取数字，不能补抽 ${plan.count} 个`);
        }
      }
      const transaction = executeDraw(plan, new WebCryptoRandomSource(), null);
      if (partial) {
        const replacements = transaction.results;
        if (replacements.length !== partial.generatedIndices.length) throw new Error("重掷结果数量与所选项不一致");
        let replacementIndex = 0;
        transaction.results = partial.resultTemplate.map((result) => result ?? replacements[replacementIndex++]);
        transaction.configSnapshot = { ...transaction.configSnapshot, count: partial.resultTemplate.length };
        transaction.operation = {
          kind: "reroll",
          sourceTransactionId: partial.sourceTransactionId,
          rerolledIndices: partial.generatedIndices,
        };
      }
      transaction.receipt = await createReceipt(transaction);

      const motion = effectiveMotion();
      const duration = motion === "instant" ? 0 : motion === "standard" ? 620 : 1180;

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
        void playDrawSound(snapshot.settings.appearance.soundProfile, snapshot.settings.muted, "start");
        void publishCurrentDisplay({ hidden: true });
        await new Promise((resolve) => window.setTimeout(resolve, duration));
      }

      const current = useAppStore.getState();
      current.commitTransaction(transaction);
      if (partial) {
        current.setResultInteraction({
          transactionId: transaction.id,
          selectedIndices: [],
          pinnedIndices: partial.retainedPinnedIndices,
          rollingIndices: null,
        });
      } else {
        current.clearResultInteraction();
      }
      void playDrawSound(snapshot.settings.appearance.soundProfile, snapshot.settings.muted, "lock");
      await publishCurrentDisplay();
      return transaction.id;
    } catch (error) {
      const current = useAppStore.getState();
      current.setDrawing(false);
      current.setPreviewResults([]);
      current.setResultInteraction({ rollingIndices: null });
      current.setError((error as Error).message || "生成失败");
      return null;
    }
  })().finally(() => {
    activeGeneration = null;
  });
  return activeGeneration;
}

export function generateDraw(countOverride?: number): Promise<string | null> {
  const state = useAppStore.getState();
  const interaction = state.resultInteraction;
  const pinsAreCurrent = interaction.transactionId === state.drawState.lastTransactionId && state.currentResults.length > 0;
  const pinnedSourceIndices = pinsAreCurrent
    ? [...new Set(interaction.pinnedIndices)].filter((index) => index >= 0 && index < state.currentResults.length).sort((a, b) => a - b)
    : [];

  if (!pinnedSourceIndices.length) return runGeneration(countOverride);

  const targetCount =
    state.settings.mode === "expression" && state.settings.expression.evaluation === "single"
      ? 1
      : Math.max(1, Math.min(50, Math.trunc(countOverride ?? state.settings.count)));
  if (pinnedSourceIndices.length >= targetCount) {
    state.setError(
      pinnedSourceIndices.length === targetCount
        ? "本次结果已全部固定，请先取消固定再生成"
        : `固定结果有 ${pinnedSourceIndices.length} 项，超过本次抽取数量 ${targetCount}`
    );
    return Promise.resolve(null);
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

  return runGeneration(generatedIndices.length, {
    generatedIndices,
    sourceTransactionId: state.drawState.lastTransactionId!,
    resultTemplate,
    retainedPinnedIndices,
  });
}

export function generateShuffle(): Promise<string | null> {
  return runGeneration(undefined, undefined, true);
}

export function rerollDraw(indices: number[]): Promise<string | null> {
  const state = useAppStore.getState();
  const unique = [...new Set(indices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < state.currentResults.length)
    .sort((left, right) => left - right);
  if (!unique.length || !state.drawState.lastTransactionId) {
    state.setError("请先选择需要重掷的结果");
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
  });
}

// 倒计时后生成仪式系统（Item 3, 7）
export async function startCountdownCeremony(seconds: number): Promise<void> {
  const store = useAppStore.getState();
  if (store.isDrawing || store.ceremony.phase !== "idle") return;
  cancelCeremony();

  const snapshot = snapshotState();
  let transaction;
  try {
    const plan = prepareDraw(snapshot);
    transaction = executeDraw(plan, new WebCryptoRandomSource(), null);
    transaction.receipt = await createReceipt(transaction);
  } catch (error) {
    store.setError((error as Error).message || "生成失败");
    return;
  }

  // 1. 设置倒计时阶段，启动低音节奏床鼓点与整秒 tick
  store.setCeremony({
    phase: "countdown",
    remainingSeconds: seconds,
    revealedCount: 0,
    targetTransaction: transaction,
  });
  void startCountdownDrums(snapshot.settings.muted);
  void playCountdownTick(snapshot.settings.muted);
  void publishCurrentDisplay();

  const motion = effectiveMotion();
  const instant = motion === "instant";

  // 倒计时每秒触发
  let currentSec = seconds;
  ceremonyCountdownTimer = window.setInterval(() => {
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

    if (instant) {
      // 即时/减少动态模式：倒计时结束后一次性揭晓
      useAppStore.getState().commitTransaction(transaction);
      useAppStore.getState().setCeremony({
        phase: "finished",
        remainingSeconds: 0,
        revealedCount: transaction.results.length,
        targetTransaction: transaction,
      });
      void playDrawSound(snapshot.settings.appearance.soundProfile, snapshot.settings.muted, "lock");
      void publishCurrentDisplay();
      return;
    }

    // 2. 转入揭晓阶段：立刻揭晓第 1 张（单张也走此路径，礼花从该卡中心炸）
    const total = transaction.results.length;
    const finishReveal = () => {
      ceremonyRevealTimer = undefined;
      useAppStore.getState().commitTransaction(transaction);
      useAppStore.getState().setCeremony({
        phase: "finished",
        remainingSeconds: 0,
        revealedCount: total,
        targetTransaction: transaction,
      });
      void publishCurrentDisplay();
    };

    let revealed = 1;
    useAppStore.getState().setCeremony({
      phase: "revealing",
      remainingSeconds: 0,
      revealedCount: 1,
      targetTransaction: transaction,
    });
    void playDrawSound(snapshot.settings.appearance.soundProfile, snapshot.settings.muted, "lock");
    void publishCurrentDisplay();

    if (total <= 1) {
      ceremonyRevealTimer = window.setTimeout(finishReveal, 800);
      return;
    }

    ceremonyRevealTimer = window.setInterval(() => {
      revealed += 1;
      useAppStore.getState().setCeremony({ revealedCount: revealed });
      void playDrawSound(snapshot.settings.appearance.soundProfile, snapshot.settings.muted, "lock");
      void publishCurrentDisplay();

      if (revealed >= total) {
        window.clearInterval(ceremonyRevealTimer);
        finishReveal();
      }
    }, 1000);
  }, 1000);
}

// Esc 中断或离开：终止仪式，停止音效，不留答案、不写历史
export function cancelCeremony(): void {
  window.clearInterval(ceremonyCountdownTimer);
  window.clearInterval(ceremonyRevealTimer);
  window.clearTimeout(ceremonyRevealTimer);
  ceremonyCountdownTimer = undefined;
  ceremonyRevealTimer = undefined;
  stopCountdownDrums();
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
  store.commitTransaction(tx);
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
