import { z } from "zod";
import type { AppLocale, AppState, CountByMode, CountMemoryMode, DrawMode, DrawResult, DrawSession, DrawSettings, HistoryEntry, PoolEntry, PoolsState, Preset, UiState } from "../domain/types";
import { createId, parseIntegerList } from "../domain/random";
import { createEmptyStats, normalizeStats } from "../domain/stats";
import { normalizeTagRules } from "../domain/tags";
import { normalizeWeightedEntries } from "../domain/weighted";
import { detectLocaleFromLanguages, normalizePersistedLocale } from "../i18n/locale";

export const STATE_VERSION = 5 as const;
export const STORAGE_KEY_V5 = "zhishutai.state.v5";
export const STORAGE_KEY_V4 = "zhishutai.state.v4";
export const STORAGE_KEY_V3 = "zhishutai.state.v3";
export const STORAGE_KEY_V2 = "zhishutai.state.v2";
export const STORAGE_KEY_V1 = "zhishutai.state.v1";
export const BACKUP_SCHEMA_V5 = "zhishutai.backup.v5";
export const BACKUP_SCHEMA_V4 = "zhishutai.backup.v4";
export const BACKUP_SCHEMA_V3 = "zhishutai.backup.v3";
export const HISTORY_LIMIT = 200;
export const PRESET_LIMIT = 50;
export const SESSION_LIMIT = 50;

const DEFAULT_UI: UiState = {
  locale: "zh-CN",
  activeView: "roll",
  inspectorOpen: true,
  insightsTab: "overview",
  compareIds: [],
  copyFormat: "comma",
  countByMode: { range: 5, custom: 5, expression: 5 },
};

export const DEFAULT_SETTINGS: DrawSettings = {
  mode: "range",
  min: 1,
  max: 100,
  customInput: "",
  count: 5,
  noDup: false,
  excludeInput: "",
  muted: false,
  tagFilter: { selectedTags: [], combine: "any" },
  expression: { source: "2d6", evaluation: "batch", tagBehavior: "classify" },
  appearance: { theme: "dark", motion: "standard", soundProfile: "minimal", particles: true },
  desktop: {
    displayMode: "normal",
    displayClickThrough: false,
  },
  timer: { durationSec: 5, expireAction: "reveal" },
};

export const DEFAULT_POOLS: PoolsState = { customEntries: [], weightedEntries: [], rangeTagRules: [], expressionTagRules: [] };

function detectFreshStateLocale(): AppLocale {
  if (typeof navigator === "undefined") return "en-US";
  return detectLocaleFromLanguages(navigator.languages, navigator.language);
}

export function createDefaultState(locale: AppLocale = detectFreshStateLocale()): AppState {
  return {
    version: STATE_VERSION,
    settings: structuredClone(DEFAULT_SETTINGS),
    pools: structuredClone(DEFAULT_POOLS),
    history: [],
    stats: createEmptyStats(),
    presets: [],
    pinnedPresetIds: [],
    drawState: { poolFingerprint: "", usedValues: [], lastTransactionId: null, activePresetId: null },
    activeSession: null,
    sessionArchive: [],
    ui: { ...structuredClone(DEFAULT_UI), locale },
    migrationNotes: [],
  };
}

const StringNumberMap = z.record(z.string(), z.number().nonnegative());
const ResultSchema = z.object({
  value: z.number(),
  total: z.number(),
  faces: z.array(z.object({
    value: z.number(),
    sides: z.number().optional(),
    kept: z.boolean().optional(),
    exploded: z.boolean().optional(),
    rerolled: z.boolean().optional(),
  })),
  tags: z.array(z.string()),
  trace: z.unknown().optional(),
});
const SettingsSchema = z.object({
  mode: z.enum(["range", "custom", "weighted", "expression"]),
  min: z.number().int(),
  max: z.number().int(),
  customInput: z.string(),
  count: z.number().int().min(1).max(50),
  noDup: z.boolean(),
  excludeInput: z.string(),
  muted: z.boolean(),
  tagFilter: z.object({ selectedTags: z.array(z.string()), combine: z.enum(["any", "all"]) }),
  expression: z.object({ source: z.string(), evaluation: z.enum(["single", "batch"]), tagBehavior: z.enum(["classify", "constrain"]) }),
  appearance: z.object({
    theme: z.enum(["dark", "light", "contrast"]),
    motion: z.enum(["instant", "standard", "ceremony"]),
    soundProfile: z.enum(["minimal", "mechanical", "dice"]),
    particles: z.boolean(),
  }),
  desktop: z.object({
    displayMode: z.enum(["normal", "fullscreen", "overlay"]),
    displayClickThrough: z.boolean(),
  }),
  timer: z.object({ durationSec: z.number().int().min(0).max(600), expireAction: z.enum(["reveal", "autodraw"]) }),
});
const CountByModeSchema = z.object({
  range: z.number().int().min(1).max(50),
  custom: z.number().int().min(1).max(50),
  expression: z.number().int().min(1).max(50),
});
const PoolEntrySchema = z.object({ id: z.string(), value: z.number().int(), tags: z.array(z.string()) });
const WeightedEntrySchema = PoolEntrySchema.extend({ weight: z.number().int().min(1).max(1_000_000) });
const TagRuleSchema = z.object({ id: z.string(), label: z.string(), expression: z.string() });
const PoolsSchema = z.object({
  customEntries: z.array(PoolEntrySchema).max(500),
  weightedEntries: z.array(WeightedEntrySchema).max(500),
  rangeTagRules: z.array(TagRuleSchema),
  expressionTagRules: z.array(TagRuleSchema),
});
const StatsSchema = z.object({
  version: z.literal(2),
  byMode: z.record(z.enum(["range", "custom", "weighted", "expression"]), z.object({
    draws: z.number().nonnegative(),
    values: StringNumberMap,
    faces: StringNumberMap,
    tags: StringNumberMap,
    resetAt: z.string().nullable(),
  })),
});
const StatsDeltaSchema = z.object({
  mode: z.enum(["range", "custom", "weighted", "expression"]),
  draws: z.number().nonnegative(),
  values: StringNumberMap,
  faces: StringNumberMap,
  tags: StringNumberMap,
});
const OperationSchema = z.union([
  z.object({ kind: z.literal("draw") }),
  z.object({ kind: z.literal("reroll"), sourceTransactionId: z.string(), rerolledIndices: z.array(z.number().int().nonnegative()) }),
  z.object({ kind: z.literal("shuffle") }),
]);
const HistorySchema = z.object({
  id: z.string(),
  transactionId: z.string().optional(),
  createdAt: z.string().nullable(),
  mode: z.enum(["range", "custom", "weighted", "expression"]),
  config: SettingsSchema,
  results: z.array(ResultSchema),
  operation: OperationSchema.optional(),
  statsDelta: StatsDeltaSchema.optional(),
  poolFingerprint: z.string().optional(),
  usedAdded: z.array(z.number()).optional(),
  receipt: z.unknown().optional(),
  sessionId: z.string().optional(),
  presetId: z.string().optional(),
  legacy: z.boolean(),
});
const SessionTransactionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  results: z.array(ResultSchema),
  operation: OperationSchema,
  statsDelta: StatsDeltaSchema,
  poolFingerprint: z.string(),
  usedAdded: z.array(z.number().int()),
  receipt: z.unknown().optional(),
});
const SessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  configSnapshot: SettingsSchema,
  poolsSnapshot: PoolsSchema,
  poolFingerprint: z.string(),
  transactionIds: z.array(z.string()),
  transactionRecords: z.array(SessionTransactionSchema).default([]),
  roundCount: z.number().int().nonnegative(),
});

export const AppStateV5Schema = z.object({
  version: z.literal(5),
  settings: SettingsSchema,
  pools: PoolsSchema,
  history: z.array(HistorySchema).max(HISTORY_LIMIT),
  stats: StatsSchema,
  presets: z.array(z.object({ id: z.string(), name: z.string(), config: SettingsSchema, pools: PoolsSchema })).max(PRESET_LIMIT),
  pinnedPresetIds: z.array(z.string()).max(6),
  drawState: z.object({
    poolFingerprint: z.string(),
    usedValues: z.array(z.number().int()),
    lastTransactionId: z.string().nullable(),
    activePresetId: z.string().nullable(),
  }),
  activeSession: SessionSchema.nullable(),
  sessionArchive: z.array(SessionSchema).max(SESSION_LIMIT),
  ui: z.object({
    locale: z.enum(["zh-CN", "en-US"]),
    activeView: z.enum(["roll", "insights", "settings"]),
    inspectorOpen: z.boolean(),
    insightsTab: z.enum(["overview", "history", "probability"]),
    compareIds: z.array(z.string()).max(2),
    copyFormat: z.enum(["comma", "newline"]),
    countByMode: CountByModeSchema,
  }),
  migrationNotes: z.array(z.string()),
});

export const AppStateV4Schema = AppStateV5Schema;

function normalizeSettings(value: unknown): DrawSettings {
  const source = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const tagFilter = source.tagFilter && typeof source.tagFilter === "object" ? source.tagFilter : {};
  const expression = source.expression && typeof source.expression === "object" ? source.expression : {};
  const appearance = source.appearance && typeof source.appearance === "object" ? source.appearance : {};
  const desktop = source.desktop && typeof source.desktop === "object" ? source.desktop : {};
  const timer = source.timer && typeof source.timer === "object" ? source.timer : {};

  let mode: DrawMode = (["range", "custom", "weighted", "expression"].includes(source.mode)
    ? source.mode
    : DEFAULT_SETTINGS.mode) as DrawMode;

  // v5 升级：将加权模式自动迁至自定义模式
  if (mode === "weighted") {
    mode = "custom";
  }

  return {
    mode,
    min: Number.isSafeInteger(Number(source.min)) ? Number(source.min) : DEFAULT_SETTINGS.min,
    max: Number.isSafeInteger(Number(source.max)) ? Number(source.max) : DEFAULT_SETTINGS.max,
    customInput: typeof source.customInput === "string" ? source.customInput : "",
    count: Math.max(1, Math.min(50, Math.trunc(Number(source.count)) || DEFAULT_SETTINGS.count)),
    noDup: Boolean(source.noDup),
    excludeInput: typeof source.excludeInput === "string" ? source.excludeInput : "",
    muted: Boolean(source.muted),
    tagFilter: {
      selectedTags: [
        ...new Set<string>(
          (Array.isArray(tagFilter.selectedTags) ? tagFilter.selectedTags : []).map((tag: unknown) => String(tag)).filter(Boolean)
        ),
      ],
      combine: tagFilter.combine === "all" ? "all" : "any",
    },
    expression: {
      source: typeof expression.source === "string" ? expression.source.slice(0, 256) : "2d6",
      evaluation: expression.evaluation === "single" ? "single" : "batch",
      tagBehavior: expression.tagBehavior === "constrain" ? "constrain" : "classify",
    },
    appearance: {
      theme: appearance.theme === "contrast" ? "contrast" : appearance.theme === "light" ? "light" : "dark",
      motion: ["instant", "standard", "ceremony"].includes(appearance.motion) ? appearance.motion : "standard",
      soundProfile: ["minimal", "mechanical", "dice"].includes(appearance.soundProfile) ? appearance.soundProfile : "minimal",
      particles: appearance.particles !== false,
    },
    desktop: {
      displayMode: ["normal", "fullscreen", "overlay"].includes(desktop.displayMode) ? desktop.displayMode : "normal",
      displayClickThrough: Boolean(desktop.displayClickThrough),
    },
    timer: {
      durationSec: Math.max(0, Math.min(600, Math.trunc(Number(timer.durationSec)) || DEFAULT_SETTINGS.timer.durationSec)),
      expireAction: timer.expireAction === "autodraw" ? "autodraw" : "reveal",
    },
  };
}

function clampCount(value: unknown, fallback = 5): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(50, Math.trunc(value)));
}

function countMemoryMode(mode: DrawMode): CountMemoryMode {
  return mode === "weighted" ? "custom" : mode;
}

function resolveCountByMode(value: unknown): { value: CountByMode; reset: boolean } {
  if (value && typeof value === "object") {
    const source = value as Partial<Record<CountMemoryMode, unknown>>;
    const complete = ["range", "custom", "expression"].every((mode) => typeof source[mode as CountMemoryMode] === "number" && Number.isFinite(source[mode as CountMemoryMode]));
    if (complete) {
      return {
        value: {
          range: clampCount(source.range),
          custom: clampCount(source.custom),
          expression: clampCount(source.expression),
        },
        reset: false,
      };
    }
  }
  return { value: structuredClone(DEFAULT_UI.countByMode), reset: true };
}

function normalizePoolEntries(value: unknown): PoolEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value
    .flatMap((raw) => {
      const entry = raw && typeof raw === "object" ? (raw as Partial<PoolEntry>) : {};
      const numeric = Number(entry.value);
      if (!Number.isSafeInteger(numeric) || seen.has(numeric)) return [];
      seen.add(numeric);
      return [
        {
          id: entry.id || createId("custom"),
          value: numeric,
          tags: [...new Set((entry.tags || []).map((tag) => String(tag).trim()).filter(Boolean))],
        },
      ];
    })
    .slice(0, 500);
}

function normalizePools(value: unknown): PoolsState {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const customEntries = normalizePoolEntries(source.customEntries);
  const weightedEntries = normalizeWeightedEntries(source.weightedEntries);

  // v5 升级要求：若 customEntries 为空且 weightedEntries 存在，则拷贝 weightedEntries 中的数字（去重）填充 customEntries
  if (customEntries.length === 0 && weightedEntries.length > 0) {
    const seen = new Set<number>();
    weightedEntries.forEach((w) => {
      if (!seen.has(w.value)) {
        seen.add(w.value);
        customEntries.push({ id: createId("custom"), value: w.value, tags: w.tags || [] });
      }
    });
  }

  return {
    customEntries,
    weightedEntries,
    rangeTagRules: normalizeTagRules(source.rangeTagRules),
    expressionTagRules: normalizeTagRules(source.expressionTagRules),
  };
}

function normalizeResult(value: unknown): DrawResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, any>;
  const total = Number(result.total ?? result.value);
  if (!Number.isFinite(total)) return null;
  return {
    value: total,
    total,
    faces: Array.isArray(result.faces)
      ? result.faces.flatMap((face: any) =>
          Number.isFinite(Number(face?.value ?? face))
            ? [
                {
                  value: Number(face?.value ?? face),
                  sides: Number.isFinite(Number(face?.sides)) ? Number(face.sides) : undefined,
                  kept: face?.kept,
                  exploded: face?.exploded,
                  rerolled: face?.rerolled,
                },
              ]
            : []
        )
      : [],
    tags: [...new Set((Array.isArray(result.tags) ? result.tags : []).map(String))],
    trace: result.trace ?? undefined,
  };
}

function normalizeHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((raw, index) => {
      if (!raw || typeof raw !== "object") return [];
      const entry = raw as Record<string, any>;
      const rawResults = Array.isArray(entry.results)
        ? entry.results
        : Array.isArray(entry.nums)
          ? entry.nums.map((number: number) => ({ value: number }))
          : [];
      const results = rawResults.map(normalizeResult).filter((result): result is DrawResult => Boolean(result));
      if (!results.length) return [];
      return [
        {
          id: String(entry.id || `legacy-history-${index}`),
          transactionId: typeof entry.transactionId === "string" ? entry.transactionId : undefined,
          createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
          mode: (["range", "custom", "weighted", "expression"].includes(entry.mode)
            ? entry.mode
            : entry.config?.mode || "range") as DrawMode,
          config: normalizeSettings(entry.config),
          results,
          operation: entry.operation,
          statsDelta: entry.statsDelta,
          poolFingerprint: entry.poolFingerprint,
          usedAdded: Array.isArray(entry.usedAdded) ? entry.usedAdded.filter(Number.isSafeInteger) : undefined,
          receipt: entry.receipt,
          sessionId: entry.sessionId,
          presetId: entry.presetId,
          legacy: entry.transactionId ? Boolean(entry.legacy) : true,
        },
      ];
    })
    .slice(0, HISTORY_LIMIT);
}

function normalizePresets(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const preset = raw as Record<string, unknown>;
      const name = String(preset.name ?? "").trim().slice(0, 40);
      if (!name) return [];
      return [{ id: String(preset.id || createId("preset")), name, config: normalizeSettings(preset.config), pools: normalizePools(preset.pools) }];
    })
    .slice(0, PRESET_LIMIT);
}

function normalizeUi(value: unknown, countByMode = DEFAULT_UI.countByMode, localeFallback: AppLocale = "zh-CN"): UiState {
  const source = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const compareIds = Array.isArray(source.compareIds) ? source.compareIds.map(String).filter(Boolean).slice(0, 2) : [];
  const activeView = (["roll", "insights", "settings"].includes(source.activeView) ? source.activeView : "roll") as UiState["activeView"];
  const insightsTab = (["overview", "history", "probability"].includes(source.insightsTab) ? source.insightsTab : "overview") as UiState["insightsTab"];
  return {
    locale: normalizePersistedLocale(source.locale, localeFallback),
    activeView,
    inspectorOpen: source.inspectorOpen !== false,
    insightsTab,
    compareIds,
    copyFormat: source.copyFormat === "newline" ? "newline" : "comma",
    countByMode: structuredClone(countByMode),
  };
}

function normalizeSession(value: unknown): DrawSession | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, any>;
  const name = String(source.name || "").trim().slice(0, 40);
  if (!name) return null;
  return {
    id: String(source.id || createId("session")),
    name,
    startedAt: typeof source.startedAt === "string" ? source.startedAt : new Date().toISOString(),
    endedAt: typeof source.endedAt === "string" ? source.endedAt : undefined,
    configSnapshot: normalizeSettings(source.configSnapshot),
    poolsSnapshot: normalizePools(source.poolsSnapshot),
    poolFingerprint: String(source.poolFingerprint || ""),
    transactionIds: Array.isArray(source.transactionIds) ? source.transactionIds.map(String) : [],
    transactionRecords: Array.isArray(source.transactionRecords)
      ? source.transactionRecords.map((r: any) => ({
          id: String(r.id),
          createdAt: String(r.createdAt || ""),
          results: (Array.isArray(r.results) ? r.results : []).map(normalizeResult).filter((res: DrawResult | null): res is DrawResult => Boolean(res)),
          operation: r.operation || { kind: "draw" },
          statsDelta: r.statsDelta || { mode: "range", draws: 0, values: {}, faces: {}, tags: {} },
          poolFingerprint: String(r.poolFingerprint || ""),
          usedAdded: Array.isArray(r.usedAdded) ? r.usedAdded.filter(Number.isSafeInteger) : [],
          receipt: r.receipt,
        }))
      : [],
    roundCount: Math.max(0, Number(source.roundCount) || 0),
  };
}

function liftNotes(source: Record<string, any>, sourceLabel: string, fromVersion: number, countMemoryReset = false): string[] {
  const notes = Array.isArray(source.migrationNotes) ? source.migrationNotes.map(String) : [];
  if (fromVersion < 5) notes.push(`已从 ${sourceLabel} v${fromVersion} 迁移到 v5`);
  if (countMemoryReset) notes.push("抽取数量已按模式独立并重置为 5");
  if (fromVersion <= 2) notes.push("旧版本未保存抽后移除状态，已使用集合从空集合开始");
  if (source.activeSession) notes.push("进行中的会话已自动归档");
  if (source.ui?.activeView === "studio") notes.push("规则工坊已整合至抽取台，视图已切换为抽取台");
  if (source.settings?.mode === "weighted") notes.push("加权模式已停用，已自动切换为自定义数字池");
  return [...new Set(notes)];
}

export function migrateToV5(value: unknown, sourceLabel = "未知来源"): AppState {
  const source = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const version = Number(source.version);

  if (version === 5) {
    const parsed = AppStateV5Schema.safeParse(value);
    if (parsed.success) {
      const state = parsed.data as AppState;
      const mode = countMemoryMode(state.settings.mode);
      const weightedMode = state.settings.mode === "weighted";
      const migrationNotes = weightedMode
        ? [...new Set([...state.migrationNotes, "加权模式已停用，已自动切换为自定义数字池"])]
        : state.migrationNotes;
      return {
        ...state,
        settings: { ...state.settings, mode: weightedMode ? "custom" : state.settings.mode, count: state.ui.countByMode[mode] },
        pools: weightedMode ? normalizePools(state.pools) : state.pools,
        migrationNotes,
      };
    }
  }
  if (![1, 2, 3, 4, 5].includes(version)) throw new Error("不支持的数据版本");

  // A persisted state without a locale is legacy data, so it must not inherit
  // the current browser language during migration.
  const next = createDefaultState("zh-CN");
  next.settings = normalizeSettings(source.settings);
  const countMemory = resolveCountByMode(source.ui?.countByMode);
  next.settings = { ...next.settings, count: countMemory.value[countMemoryMode(next.settings.mode)] };
  next.pools = normalizePools(source.pools);
  if (version === 1 && !next.pools.customEntries.length) {
    next.pools.customEntries = parseIntegerList(next.settings.customInput).values.map((item, index) => ({
      id: `custom-migrated-${index}`,
      value: item,
      tags: [],
    }));
  }
  next.history = normalizeHistory(source.history);
  next.stats = normalizeStats(source.stats);
  next.presets = normalizePresets(source.presets);
  next.pinnedPresetIds = Array.isArray(source.pinnedPresetIds) ? source.pinnedPresetIds.map(String).slice(0, 6) : [];
  next.drawState = {
    poolFingerprint: typeof source.drawState?.poolFingerprint === "string" ? source.drawState.poolFingerprint : "",
    usedValues: version >= 3 && Array.isArray(source.drawState?.usedValues) ? source.drawState.usedValues.filter(Number.isSafeInteger) : [],
    lastTransactionId: typeof source.drawState?.lastTransactionId === "string" ? source.drawState.lastTransactionId : null,
    activePresetId: typeof source.drawState?.activePresetId === "string" ? source.drawState.activePresetId : null,
  };

  const rawActive = normalizeSession(source.activeSession);
  const rawArchive = Array.isArray(source.sessionArchive)
    ? source.sessionArchive.map(normalizeSession).filter((s): s is DrawSession => Boolean(s))
    : [];
  if (rawActive) {
    const archivedActive: DrawSession = { ...rawActive, endedAt: rawActive.endedAt || new Date().toISOString() };
    next.activeSession = null;
    next.sessionArchive = [archivedActive, ...rawArchive].slice(0, SESSION_LIMIT);
  } else {
    next.activeSession = null;
    next.sessionArchive = rawArchive.slice(0, SESSION_LIMIT);
  }

  next.ui = normalizeUi(source.ui, countMemory.value, "zh-CN");
  next.migrationNotes = liftNotes(source, sourceLabel, version, countMemory.reset);

  const parsed = AppStateV5Schema.safeParse(next);
  if (!parsed.success) throw new Error(`v5 数据校验失败：${parsed.error.issues[0]?.message || "未知错误"}`);
  return parsed.data as AppState;
}

export function migrateToV4(value: unknown, sourceLabel = "未知来源"): AppState {
  return migrateToV5(value, sourceLabel);
}

export function migrateToV3(value: unknown, sourceLabel = "未知来源"): AppState {
  return migrateToV5(value, sourceLabel);
}

export function normalizeV5(value: unknown): AppState {
  return migrateToV5(value, "v5");
}

export function normalizeV4(value: unknown): AppState {
  return migrateToV5(value, "v4");
}

export function normalizeV3(value: unknown): AppState {
  return migrateToV5(value, "兼容数据");
}

export function buildBackup(state: AppState): { schema: typeof BACKUP_SCHEMA_V5; version: 5; exportedAt: string; state: AppState } {
  return { schema: BACKUP_SCHEMA_V5, version: 5, exportedAt: new Date().toISOString(), state: structuredClone(state) };
}

export function parseBackup(value: unknown): AppState {
  if (!value || typeof value !== "object") throw new Error("备份内容不是有效对象");
  const payload = value as Record<string, any>;
  if (payload.schema === BACKUP_SCHEMA_V5 || payload.schema === BACKUP_SCHEMA_V4 || payload.schema === BACKUP_SCHEMA_V3) {
    return migrateToV5(payload.state, payload.schema);
  }
  if ([1, 2, 3, 4, 5].includes(Number(payload.version))) return migrateToV5(payload, "兼容备份");
  if (payload.state && [1, 2, 3, 4, 5].includes(Number(payload.state.version))) return migrateToV5(payload.state, "兼容备份");
  throw new Error("备份版本不兼容");
}

export function summarizeState(state: AppState): string {
  return `历史 ${state.history.length} 批，自定义 ${state.pools.customEntries.length} 行，会话归档 ${state.sessionArchive.length} 个`;
}

export { normalizeSettings, normalizePools, normalizeHistory, normalizePresets, normalizeUi };
