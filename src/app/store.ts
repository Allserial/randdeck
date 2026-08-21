import { create } from "zustand";
import type { AppLocale, AppState, AppView, CeremonyState, CopyFormat, CountMemoryMode, DrawMode, DrawSession, DrawSettings, DrawTransaction, HistoryEntry, InsightsTab, PoolsState, SessionTransactionRecord } from "../domain/types";
import { applyStatsDelta, resetStats } from "../domain/stats";
import { createId } from "../domain/random";
import { createDefaultState, HISTORY_LIMIT, migrateToV5 } from "./state";
import { createPersistenceAdapter, loadPersistedState, savePersistedState, type PersistenceAdapter } from "../platform/persistence";
import { createRuntimeMessage, messageFromUnknown } from "../domain/runtimeMessage";

interface RuntimeState {
  hydrated: boolean;
  hydrationSource: string;
  warnings: string[];
  currentResults: DrawTransaction["results"];
  previewResults: DrawTransaction["results"];
  isDrawing: boolean;
  error: string;
  toast: string;
  revision: number;
  ceremony: CeremonyState;
  resultInteraction: ResultInteractionState;
}

interface ResultInteractionState {
  transactionId: string | null;
  selectedIndices: number[];
  pinnedIndices: number[];
  rollingIndices: number[] | null;
}

interface AppActions {
  updateSettings(updates: Partial<DrawSettings>): void;
  updatePools(updates: Partial<PoolsState>): void;
  setView(view: AppView): void;
  setLocale(locale: AppLocale): void;
  setInspectorOpen(open: boolean): void;
  setInsightsTab(tab: InsightsTab): void;
  toggleCompare(id: string): void;
  clearCompare(): void;
  setCopyFormat(format: CopyFormat): void;
  setCeremony(updates: Partial<CeremonyState>): void;
  resetCeremony(): void;
  setDrawing(drawing: boolean): void;
  setPreviewResults(results: DrawTransaction["results"]): void;
  setError(message: string): void;
  setToast(message: string): void;
  setResultInteraction(updates: Partial<ResultInteractionState>): void;
  clearResultInteraction(): void;
  commitTransaction(transaction: DrawTransaction): void;
  revertTransaction(transactionId: string): boolean;
  resetPool(): void;
  deleteHistory(id: string): void;
  clearHistory(): void;
  resetModeStats(mode: DrawMode): void;
  recallHistory(id: string): void;
  revertSession(id: string): boolean;
  deleteArchivedSession(id: string): boolean;
  replacePersistentState(state: AppState): void;
}

export type AppStore = AppState & RuntimeState & AppActions;

let adapter: PersistenceAdapter = createPersistenceAdapter();
let saveTimer: number | undefined;

function countMemoryMode(mode: DrawMode): CountMemoryMode {
  return mode === "weighted" ? "custom" : mode;
}

function clampCount(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(50, Math.trunc(value))) : fallback;
}

function persistentSnapshot(state: AppStore): AppState {
  return {
    version: 5,
    settings: state.settings,
    pools: state.pools,
    history: state.history,
    stats: state.stats,
    presets: state.presets,
    pinnedPresetIds: state.pinnedPresetIds,
    drawState: state.drawState,
    activeSession: null,
    sessionArchive: state.sessionArchive,
    ui: state.ui,
    migrationNotes: state.migrationNotes,
  };
}

function queuePersistence(immediate = false): void {
  window.clearTimeout(saveTimer);
  const run = () => {
    const state = useAppStore.getState();
    if (!state.hydrated) return;
    savePersistedState(persistentSnapshot(state), adapter).catch((error) =>
      useAppStore.setState({ error: createRuntimeMessage("errors.localSave", { message: messageFromUnknown(error) }) })
    );
  };
  if (immediate) void run();
  else saveTimer = window.setTimeout(run, 350);
}

function transactionEntry(transaction: DrawTransaction): HistoryEntry {
  return {
    id: createId("history"),
    transactionId: transaction.id,
    createdAt: transaction.createdAt,
    mode: transaction.mode,
    config: transaction.configSnapshot,
    results: transaction.results,
    operation: transaction.operation,
    statsDelta: transaction.statsDelta,
    poolFingerprint: transaction.poolFingerprint,
    usedAdded: transaction.usedAdded,
    receipt: transaction.receipt,
    sessionId: transaction.session?.id,
    presetId: transaction.presetId,
    legacy: false,
  };
}

function historyTransactionRecord(entry: HistoryEntry): SessionTransactionRecord | null {
  if (!entry.transactionId || !entry.statsDelta || !entry.poolFingerprint) return null;
  return {
    id: entry.transactionId,
    createdAt: entry.createdAt || "",
    results: entry.results,
    operation: entry.operation || { kind: "draw" },
    statsDelta: entry.statsDelta,
    poolFingerprint: entry.poolFingerprint,
    usedAdded: entry.usedAdded || [],
    receipt: entry.receipt,
  };
}

function removeTransactions(state: AppStore, ids: Set<string>, fallbackRecords: SessionTransactionRecord[] = []): Partial<AppStore> {
  let stats = state.stats;
  const usedToRemove = new Set<number>();
  const records = new Map(fallbackRecords.filter((record) => ids.has(record.id)).map((record) => [record.id, record]));
  state.history.forEach((entry) => {
    if (!entry.transactionId || !ids.has(entry.transactionId)) return;
    const record = historyTransactionRecord(entry);
    if (record) records.set(record.id, record);
  });
  records.forEach((record) => {
    stats = applyStatsDelta(stats, record.statsDelta, -1);
    if (record.poolFingerprint === state.drawState.poolFingerprint) {
      record.usedAdded.forEach((value) => usedToRemove.add(value));
    }
  });
  const history = state.history.filter((entry) => !entry.transactionId || !ids.has(entry.transactionId));
  return {
    history,
    stats,
    currentResults: history[0]?.results || [],
    drawState: {
      ...state.drawState,
      usedValues: state.drawState.usedValues.filter((value) => !usedToRemove.has(value)),
      lastTransactionId: history.find((entry) => entry.transactionId)?.transactionId || null,
    },
  };
}

const initial = createDefaultState();

const defaultCeremony: CeremonyState = {
  phase: "idle",
  remainingSeconds: 0,
  revealedCount: 0,
  targetTransaction: null,
};

const defaultResultInteraction: ResultInteractionState = {
  transactionId: null,
  selectedIndices: [],
  pinnedIndices: [],
  rollingIndices: null,
};

export const useAppStore = create<AppStore>((set, get) => ({
  ...initial,
  hydrated: false,
  hydrationSource: "pending",
  warnings: [],
  currentResults: [],
  previewResults: [],
  isDrawing: false,
  error: "",
  toast: "",
  revision: 0,
  ceremony: structuredClone(defaultCeremony),
  resultInteraction: structuredClone(defaultResultInteraction),
  updateSettings(updates) {
    const changesDrawConfig = Object.keys(updates).some((key) => !["appearance", "desktop", "muted", "timer"].includes(key));
    set((state) => {
      const currentMode = countMemoryMode(state.settings.mode);
      const requestedMode = updates.mode ?? state.settings.mode;
      const nextMode = countMemoryMode(requestedMode);
      const modeChanged = nextMode !== currentMode;
      const countWasProvided = Object.prototype.hasOwnProperty.call(updates, "count") && typeof updates.count === "number";
      const countByMode = { ...state.ui.countByMode, [currentMode]: clampCount(state.settings.count, state.ui.countByMode[currentMode]) };

      if (countWasProvided) {
        countByMode[nextMode] = clampCount(updates.count as number, countByMode[nextMode]);
      }

      const nextCount = countWasProvided
        ? countByMode[nextMode]
        : modeChanged
          ? countByMode[nextMode]
          : clampCount(state.settings.count, countByMode[currentMode]);

      return {
        settings: { ...state.settings, ...updates, mode: nextMode, count: nextCount },
        ui: { ...state.ui, countByMode },
        drawState: changesDrawConfig ? { ...state.drawState, activePresetId: null } : state.drawState,
        error: "",
        revision: state.revision + 1,
      };
    });
    queuePersistence();
  },
  updatePools(updates) {
    set((state) => ({
      pools: { ...state.pools, ...updates },
      drawState: { ...state.drawState, activePresetId: null },
      error: "",
      revision: state.revision + 1,
    }));
    queuePersistence();
  },
  setView(activeView) {
    set((state) => ({ ui: { ...state.ui, activeView }, revision: state.revision + 1 }));
    queuePersistence();
  },
  setLocale(locale) {
    set((state) => ({ ui: { ...state.ui, locale }, revision: state.revision + 1 }));
    queuePersistence(true);
  },
  setInspectorOpen(inspectorOpen) {
    set((state) => ({ ui: { ...state.ui, inspectorOpen }, revision: state.revision + 1 }));
    queuePersistence();
  },
  setInsightsTab(insightsTab) {
    set((state) => ({ ui: { ...state.ui, insightsTab, activeView: "insights" }, revision: state.revision + 1 }));
    queuePersistence();
  },
  toggleCompare(id) {
    set((state) => {
      const exists = state.ui.compareIds.includes(id);
      const compareIds = exists ? state.ui.compareIds.filter((item) => item !== id) : [...state.ui.compareIds, id].slice(-2);
      return { ui: { ...state.ui, compareIds, insightsTab: "history", activeView: "insights" }, revision: state.revision + 1 };
    });
    queuePersistence();
  },
  clearCompare() {
    set((state) => ({ ui: { ...state.ui, compareIds: [] }, revision: state.revision + 1 }));
    queuePersistence();
  },
  setCopyFormat(copyFormat) {
    set((state) => ({ ui: { ...state.ui, copyFormat }, revision: state.revision + 1 }));
    queuePersistence();
  },
  setCeremony(updates) {
    set((state) => ({
      ceremony: { ...state.ceremony, ...updates },
      revision: state.revision + 1,
    }));
  },
  resetCeremony() {
    set((state) => ({
      ceremony: structuredClone(defaultCeremony),
      revision: state.revision + 1,
    }));
  },
  setDrawing(isDrawing) {
    set({ isDrawing });
  },
  setPreviewResults(previewResults) {
    set({ previewResults });
  },
  setError(error) {
    set({ error });
  },
  setToast(toast) {
    set({ toast });
  },
  setResultInteraction(updates) {
    set((state) => ({ resultInteraction: { ...state.resultInteraction, ...updates } }));
  },
  clearResultInteraction() {
    set({ resultInteraction: structuredClone(defaultResultInteraction) });
  },
  commitTransaction(transaction) {
    set((state) => {
      const samePool = state.drawState.poolFingerprint === transaction.poolFingerprint;
      const used = transaction.usedAdded.length
        ? [...new Set([...(samePool ? state.drawState.usedValues : []), ...transaction.usedAdded])]
        : (samePool ? state.drawState.usedValues : []);
      return {
        history: [transactionEntry(transaction), ...state.history].slice(0, HISTORY_LIMIT),
        stats: applyStatsDelta(state.stats, transaction.statsDelta),
        currentResults: transaction.results,
        drawState: {
          poolFingerprint: transaction.poolFingerprint,
          usedValues: used,
          lastTransactionId: transaction.id,
          activePresetId: state.drawState.activePresetId,
        },
        previewResults: [],
        isDrawing: false,
        error: "",
        revision: state.revision + 1,
      };
    });
    queuePersistence(true);
  },
  revertTransaction(transactionId) {
    const entry = get().history.find((item) => item.transactionId === transactionId);
    const storedRecord = get().sessionArchive.flatMap((session) => session.transactionRecords).find((record) => record.id === transactionId);
    const record = entry ? historyTransactionRecord(entry) : storedRecord;
    if (!record) return false;
    const prune = (session: DrawSession): DrawSession => {
      const contains = session.transactionIds.includes(transactionId);
      return contains
        ? {
            ...session,
            transactionIds: session.transactionIds.filter((id) => id !== transactionId),
            transactionRecords: session.transactionRecords.filter((item) => item.id !== transactionId),
            roundCount: Math.max(0, session.roundCount - 1),
          }
        : session;
    };
    set((state) => ({
      ...removeTransactions(state, new Set([transactionId]), [record]),
      sessionArchive: state.sessionArchive.map(prune),
      revision: state.revision + 1,
    }));
    queuePersistence(true);
    return true;
  },
  resetPool() {
    set((state) => ({ drawState: { ...state.drawState, poolFingerprint: "", usedValues: [] }, revision: state.revision + 1 }));
    queuePersistence(true);
  },
  deleteHistory(id) {
    set((state) => ({
      history: state.history.filter((entry) => entry.id !== id),
      ui: { ...state.ui, compareIds: state.ui.compareIds.filter((item) => item !== id) },
      revision: state.revision + 1,
    }));
    queuePersistence();
  },
  clearHistory() {
    set((state) => ({
      history: [],
      currentResults: [],
      previewResults: [],
      resultInteraction: structuredClone(defaultResultInteraction),
      drawState: { ...state.drawState, lastTransactionId: null },
      ui: { ...state.ui, compareIds: [] },
      revision: state.revision + 1,
    }));
    queuePersistence(true);
  },
  resetModeStats(mode) {
    set((state) => ({ stats: resetStats(state.stats, mode), revision: state.revision + 1 }));
    queuePersistence(true);
  },
  recallHistory(id) {
    const entry = get().history.find((item) => item.id === id);
    if (!entry) {
      get().setError(createRuntimeMessage("errors.recallMissing"));
      return;
    }
    set((state) => ({
      currentResults: entry.results,
      previewResults: [],
      ui: { ...state.ui, activeView: "roll" },
      drawState: { ...state.drawState, lastTransactionId: entry.transactionId || state.drawState.lastTransactionId },
      resultInteraction: structuredClone(defaultResultInteraction),
      toast: createRuntimeMessage("roll.recall"),
      revision: state.revision + 1,
    }));
  },
  revertSession(id) {
    const state = get();
    const session = state.sessionArchive.find((item) => item.id === id);
    if (!session) return false;
    set((current) => ({
      ...removeTransactions(current, new Set(session.transactionIds), session.transactionRecords),
      sessionArchive: current.sessionArchive.filter((item) => item.id !== id),
      revision: current.revision + 1,
    }));
    queuePersistence(true);
    return true;
  },
  deleteArchivedSession(id) {
    set((state) => ({
      sessionArchive: state.sessionArchive.filter((item) => item.id !== id),
      revision: state.revision + 1,
    }));
    queuePersistence(true);
    return true;
  },
  replacePersistentState(replacement) {
    const valid = migrateToV5(replacement, "备份恢复");
    set((state) => ({
      ...valid,
      currentResults: [],
      previewResults: [],
      resultInteraction: structuredClone(defaultResultInteraction),
      drawState: { ...valid.drawState, lastTransactionId: null },
      error: "",
      revision: state.revision + 1,
    }));
    queuePersistence(true);
  },
}));

export async function initializeStore(customAdapter?: PersistenceAdapter): Promise<void> {
  if (customAdapter) adapter = customAdapter;
  const loaded = await loadPersistedState(adapter);
  const narrow = globalThis.matchMedia?.("(max-width: 1039px)").matches;
  const state = {
    ...loaded.state,
    settings: {
      ...loaded.state.settings,
      mode: "range" as const,
      count: loaded.state.ui.countByMode.range,
    },
    drawState: {
      ...loaded.state.drawState,
      lastTransactionId: null,
    },
    ui: {
      ...loaded.state.ui,
      activeView: "roll" as const,
      insightsTab: "overview" as const,
      ...(narrow ? { inspectorOpen: false } : {}),
    },
  };
  useAppStore.setState({
    ...state,
    hydrated: true,
    hydrationSource: loaded.source,
    warnings: loaded.warnings,
    currentResults: [],
    previewResults: [],
    ceremony: structuredClone(defaultCeremony),
    resultInteraction: structuredClone(defaultResultInteraction),
  });
  await flushStore();
}

export async function flushStore(): Promise<void> {
  window.clearTimeout(saveTimer);
  const state = useAppStore.getState();
  if (state.hydrated) await savePersistedState(persistentSnapshot(state), adapter);
}

export function snapshotState(): AppState {
  return persistentSnapshot(useAppStore.getState());
}
