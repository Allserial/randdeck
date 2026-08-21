import { describe, expect, it } from "vitest";
import { buildBackup, createDefaultState, migrateToV5, parseBackup } from "./state";
import { parseRuntimeMessage } from "../domain/runtimeMessage";
import { detectLocaleFromLanguages, normalizePersistedLocale } from "../i18n/locale";

describe("AppState v5 migration", () => {
  it("detects a fresh locale from browser language preferences", () => {
    expect(detectLocaleFromLanguages(["en-US", "zh-CN"])).toBe("zh-CN");
    expect(detectLocaleFromLanguages(["en-US"], "en-GB")).toBe("en-US");
    expect(normalizePersistedLocale(undefined)).toBe("zh-CN");
    expect(createDefaultState("en-US").ui.locale).toBe("en-US");
  });

  it("uses zh-CN for v5 states and backups that predate the locale field", () => {
    const source = createDefaultState("en-US");
    const { locale: _locale, ...legacyUi } = source.ui;
    const legacyState = { ...source, ui: legacyUi };

    expect(migrateToV5(legacyState, "旧 v5").ui.locale).toBe("zh-CN");
    expect(parseBackup({
      schema: "zhishutai.backup.v5",
      version: 5,
      exportedAt: new Date(0).toISOString(),
      state: legacyState,
    }).ui.locale).toBe("zh-CN");
  });

  it("preserves a persisted supported locale", () => {
    expect(migrateToV5(createDefaultState("en-US"), "当前 v5").ui.locale).toBe("en-US");
  });

  it("resets all mode counts to 5 when an old v5 state has no count memory", () => {
    const source = createDefaultState();
    const { countByMode: _countByMode, ...legacyUi } = source.ui;
    const state = migrateToV5({
      ...source,
      settings: { ...source.settings, mode: "expression", count: 17 },
      ui: { ...legacyUi, activeView: "insights" },
    }, "旧 v5");

    expect(state.settings.count).toBe(5);
    expect(state.ui.countByMode).toEqual({ range: 5, custom: 5, expression: 5 });
    expect(state.migrationNotes.filter((note) => note.includes("按模式独立并重置")).length).toBe(1);
  });

  it("keeps complete count memory and clamps values while syncing the current mode", () => {
    const source = createDefaultState();
    source.settings.mode = "custom";
    source.settings.count = 2;
    source.ui.countByMode = { range: 0, custom: 7.9, expression: 99 };

    const state = migrateToV5(source, "新 v5");

    expect(state.ui.countByMode).toEqual({ range: 1, custom: 7, expression: 50 });
    expect(state.settings.count).toBe(7);
    expect(state.migrationNotes.some((note) => note.includes("重置为 5"))).toBe(false);
  });

  it("applies the same reset rule to an old v5 backup without count memory", () => {
    const source = createDefaultState();
    const { countByMode: _countByMode, ...legacyUi } = source.ui;
    source.settings.count = 21;

    const state = parseBackup({
      schema: "zhishutai.backup.v5",
      version: 5,
      exportedAt: new Date(0).toISOString(),
      state: { ...source, ui: legacyUi },
    });

    expect(state.settings.count).toBe(5);
    expect(state.ui.countByMode).toEqual({ range: 5, custom: 5, expression: 5 });
    expect(state.migrationNotes.filter((note) => note.includes("按模式独立并重置")).length).toBe(1);
  });

  it("migrates v2 pools, presets and history without inventing used values", () => {
    const state = migrateToV5(
      {
        version: 2,
        settings: { mode: "range", min: 1, max: 10, count: 1, noDup: true },
        pools: { customEntries: [{ id: "x", value: 4, tags: [] }] },
        history: [{ id: "h", mode: "range", config: { mode: "range" }, results: [{ value: 4 }] }],
        stats: {},
        presets: [{ id: "p", name: "旧预设", config: { mode: "range" }, pools: {} }],
      },
      "测试 v2"
    );
    expect(state.version).toBe(5);
    expect(state.pools.customEntries[0].value).toBe(4);
    expect(state.history[0].legacy).toBe(true);
    expect(state.drawState.usedValues).toEqual([]);
    expect(state.migrationNotes.join(" ")).toContain("v2");
    expect(state.settings.appearance.particles).toBe(true);
    expect(state.settings.timer.durationSec).toBe(5);
  });

  it("migrates v1 custom input", () => {
    const state = migrateToV5(
      { version: 1, settings: { mode: "custom", customInput: "1,2,3" }, history: [], presets: [] },
      "测试 v1"
    );
    expect(state.pools.customEntries.map((entry) => entry.value)).toEqual([1, 2, 3]);
  });

  it("migrates weighted mode to custom and copies deduplicated weighted entries if custom is empty", () => {
    const state = migrateToV5(
      {
        version: 4,
        settings: { mode: "weighted" },
        pools: {
          customEntries: [],
          weightedEntries: [
            { id: "w1", value: 10, weight: 5, tags: ["tag1"] },
            { id: "w2", value: 20, weight: 1, tags: [] },
            { id: "w3", value: 10, weight: 3, tags: ["tag2"] },
          ],
        },
        history: [],
      },
      "加权迁移测试"
    );
    expect(state.version).toBe(5);
    expect(state.settings.mode).toBe("custom");
    expect(state.pools.customEntries.map((entry) => entry.value)).toEqual([10, 20]);
    expect(state.migrationNotes.join(" ")).toContain("自定义数字池");
  });

  it("drops threeDice and accepts light theme", () => {
    const state = migrateToV5(
      {
        version: 3,
        settings: { mode: "range", min: 1, max: 10, appearance: { theme: "light", motion: "standard", soundProfile: "minimal", threeDice: true } },
        pools: {},
        history: [],
        stats: {
          version: 2,
          byMode: {
            range: { draws: 0, values: {}, faces: {}, tags: {}, resetAt: null },
            custom: { draws: 0, values: {}, faces: {}, tags: {}, resetAt: null },
            weighted: { draws: 0, values: {}, faces: {}, tags: {}, resetAt: null },
            expression: { draws: 0, values: {}, faces: {}, tags: {}, resetAt: null },
          },
        },
        presets: [],
        pinnedPresetIds: [],
        drawState: { poolFingerprint: "", usedValues: [], lastTransactionId: null, activePresetId: null },
        activeSession: null,
        sessionArchive: [],
        ui: { activeView: "roll", inspectorOpen: true, miniMode: false },
        migrationNotes: [],
      },
      "测试 v3"
    );
    expect(state.version).toBe(5);
    expect(state.settings.appearance.theme).toBe("light");
    expect((state.settings.appearance as { threeDice?: boolean }).threeDice).toBeUndefined();
    expect(state.migrationNotes.join(" ")).toMatch(/v5/);
  });

  it("validates versioned backups", () => {
    const backup = buildBackup(createDefaultState());
    expect(parseBackup(backup).version).toBe(5);
    let error: unknown;
    try { parseBackup({ version: 99 }); } catch (caught) { error = caught; }
    expect(parseRuntimeMessage((error as Error).message)?.key).toBe("errors.incompatibleBackup");
  });
});
