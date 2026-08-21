import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Edit3, ListOrdered, Minus, Plus, RotateCcw, Sparkles, Timer, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "../../app/store";
import { generateDraw, generateShuffle, startCountdownCeremony } from "../../app/drawController";
import { getPoolStatus } from "../../domain/draw";
import { parseDiceExpression, describeDiceExpression } from "../../domain/dice";
import { parseExclusionInput } from "../../domain/random";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";
import { Tooltip } from "../../components/ui/Tooltip";
import PoolEditor from "../studio/PoolEditor";
import { formatDrawSummary } from "../../lib/drawSummary";
import { translateRuntimeMessage } from "../../i18n/messages";

const quickCounts = [1, 3, 5, 10];

// 跑团预设分类：基础骰面 / 检定 / 属性 / 伤害 (Item 2)
interface DicePresetGroup {
  nameKey: string;
  items: Array<{ expr: string; tipKey: string }>;
}

const DICE_PRESET_GROUPS: DicePresetGroup[] = [
  {
    nameKey: "roll.diceGroups.basic",
    items: [
      { expr: "d4", tipKey: "roll.diceTips.d4" }, { expr: "d6", tipKey: "roll.diceTips.d6" }, { expr: "d8", tipKey: "roll.diceTips.d8" }, { expr: "d10", tipKey: "roll.diceTips.d10" }, { expr: "d12", tipKey: "roll.diceTips.d12" }, { expr: "d20", tipKey: "roll.diceTips.d20" }, { expr: "1d100", tipKey: "roll.diceTips.d100" },
    ],
  },
  {
    nameKey: "roll.diceGroups.check",
    items: [
      { expr: "2d20kh1", tipKey: "roll.diceTips.2d20kh1" }, { expr: "2d20kl1", tipKey: "roll.diceTips.2d20kl1" },
    ],
  },
  {
    nameKey: "roll.diceGroups.ability",
    items: [
      { expr: "3d6", tipKey: "roll.diceTips.3d6" }, { expr: "4d6kh3", tipKey: "roll.diceTips.4d6kh3" },
    ],
  },
  {
    nameKey: "roll.diceGroups.damage",
    items: [
      { expr: "2d6", tipKey: "roll.diceTips.2d6" }, { expr: "2d8", tipKey: "roll.diceTips.2d8" }, { expr: "1d8+1", tipKey: "roll.diceTips.1d8+1" },
    ],
  },
];

function CountStepper({ count, onChange }: { count: number; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(count));
  const [error, setError] = useState("");

  const commit = () => {
    const value = Number(draft.trim());
    if (!draft.trim() || !Number.isInteger(value)) {
      setDraft(String(count));
      setError(t("roll.countError"));
      return;
    }
    const clamped = Math.max(1, Math.min(50, value));
    onChange(clamped);
    setDraft(String(clamped));
    setError(value < 1 || value > 50 ? t("roll.countClamped") : "");
  };

  const immediate = (value: number) => {
    const clamped = Math.max(1, Math.min(50, Math.trunc(value)));
    setDraft(String(clamped));
    setError("");
    onChange(clamped);
  };

  return (
    <div className="count-control">
      <div className="field-title">
        <span>{t("roll.count")}</span>
        <strong>{count}</strong>
      </div>
      <div className="stepper">
        <button type="button" aria-label={t("roll.decrease")} onClick={() => immediate(count - 1)}>
          <Minus size={16} />
        </button>
        <input
          aria-label={t("roll.generateCount")}
          type="text"
          inputMode="numeric"
          min="1"
          max="50"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(String(count));
              setError("");
              event.currentTarget.blur();
            }
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "count-field-error" : undefined}
        />
        <button type="button" aria-label={t("roll.increase")} onClick={() => immediate(count + 1)}>
          <Plus size={16} />
        </button>
      </div>
      <div className="quick-values">
        {quickCounts.map((quickCount) => (
          <Tooltip key={quickCount} content={t("roll.quickCount", { count: quickCount })}>
            <button type="button" className={count === quickCount ? "active" : ""} onClick={() => immediate(quickCount)}>
              {quickCount}
            </button>
          </Tooltip>
        ))}
      </div>
      {error && <small className="field-error" id="count-field-error" role="alert">{error}</small>}
    </div>
  );
}

export default function DrawInspector() {
  const { t } = useTranslation();
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const settings = useAppStore((state) => state.settings);
  const pools = useAppStore((state) => state.pools);
  const locale = useAppStore((state) => state.ui.locale);
  const isDrawing = useAppStore((state) => state.isDrawing);
  const ceremony = useAppStore((state) => state.ceremony);
  const update = useAppStore((state) => state.updateSettings);
  const resetPool = useAppStore((state) => state.resetPool);
  const setInspectorOpen = useAppStore((state) => state.setInspectorOpen);

  const [advanced, setAdvanced] = useState(false);
  const [poolEditorOpen, setPoolEditorOpen] = useState(false);
  const excludeInputRef = useRef<HTMLInputElement>(null);

  const poolStatus = getPoolStatus(useAppStore.getState());
  const disabled = isDrawing || ceremony.phase !== "idle";

  const allTags = useMemo(() => {
    const set = new Set<string>();
    pools.customEntries.forEach((entry) => entry.tags.forEach((tag) => set.add(tag)));
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [pools.customEntries]);

  const exclusions = useMemo(() => {
    return parseExclusionInput(settings.excludeInput);
  }, [settings.excludeInput]);

  const expressionSummary = useMemo(() => {
    if (settings.mode !== "expression") return "";
    try {
      const ast = parseDiceExpression(settings.expression.source);
      return describeDiceExpression(ast, locale);
    } catch (err) {
      return err instanceof Error ? translateRuntimeMessage(err.message, t) : t("roll.invalidExpression");
    }
  }, [locale, settings.expression.source, settings.mode, t]);

  const updateCount = (next: number) => {
    const value = Math.max(1, Math.min(50, Math.trunc(next)));
    update({ count: value });
  };

  const updateExpression = (source: string) => {
    update({ expression: { ...settings.expression, source } });
  };

  const removeExclusion = (raw: string) => {
    const next = exclusions.tokens
      .filter((token) => token.raw !== raw)
      .map((token) => token.raw)
      .join(",");
    update({ excludeInput: next });
  };

  const clearExclusions = () => {
    if (disabled || !settings.excludeInput) return;
    update({ excludeInput: "" });
    excludeInputRef.current?.focus();
  };

  const summary = formatDrawSummary(settings, pools, poolStatus, t);

  return (
    <aside className="draw-inspector" aria-label={t("roll.inspector")}>
      <div className="inspector-header">
        <strong data-inspector-heading tabIndex={-1}>{t("roll.inspector")}</strong>
        <button type="button" className="inspector-close" aria-label={t("roll.closeInspector")} onClick={() => setInspectorOpen(false)}>
          <X size={16} />
          <span>{t("roll.closeInspector")}</span>
        </button>
      </div>
      <div className="inspector-scroll">
        {/* 1. 源数据 / 范围配置 */}
        <section className="inspector-section" aria-labelledby="section-source">
          <span className="section-label" id="section-source">
            {settings.mode === "range" ? t("roll.rangeSettings") : settings.mode === "custom" ? t("roll.customPool") : t("roll.diceExpression")}
          </span>
          <fieldset disabled={disabled} className="inspector-fields">
            {settings.mode === "range" && (
              <div className="range-fields">
                <label>
                  <span>{t("roll.min")}</span>
                  <input
                    aria-label={t("roll.min")}
                    type="number"
                    value={settings.min}
                    onChange={(event) => update({ min: Number(event.target.value) })}
                  />
                </label>
                <span>{t("roll.to")}</span>
                <label>
                  <span>{t("roll.max")}</span>
                  <input
                    aria-label={t("roll.max")}
                    type="number"
                    value={settings.max}
                    onChange={(event) => update({ max: Number(event.target.value) })}
                  />
                </label>
              </div>
            )}

            {settings.mode === "custom" && (
              <div className="source-edit-card">
                <div className="source-edit-info">
                  <span>{t("roll.poolCount", { count: pools.customEntries.length })}</span>
                  <small>{t("roll.listCsv")}</small>
                </div>
                <Tooltip content={t("roll.editPoolHelp")}>
                  <Button
                    className="edit-pool-btn"
                    icon={<Edit3 size={15} />}
                    onClick={() => setPoolEditorOpen(true)}
                  >
                    {t("roll.editPool")}
                  </Button>
                </Tooltip>
              </div>
            )}

            {settings.mode === "expression" && (
              <div className="expression-quick">
                <label className="expression-input-label">
                  <span>{t("roll.diceExpression")}</span>
                  <textarea
                    aria-label={t("studio.expression")}
                    rows={2}
                    value={settings.expression.source}
                    onChange={(event) => updateExpression(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <div className="dice-presets-wrap">
                  <span className="dice-presets-title">{t("roll.dicePresets")}</span>
                  <div className="dice-preset-groups">
                    {DICE_PRESET_GROUPS.map((group) => (
                      <div className="dice-preset-group" key={group.nameKey}>
                        <span className="dice-preset-group-title">{translate(group.nameKey)}</span>
                        <div className="dice-presets">
                          {group.items.map(({ expr, tipKey }) => (
                            <Tooltip key={expr} content={translate(tipKey)}>
                              <button
                                type="button"
                                className={settings.expression.source === expr ? "active" : ""}
                                onClick={() => updateExpression(expr)}
                              >
                                {expr}
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className={clsx("expression-desc", expressionSummary === t("roll.invalidExpression") && "invalid")}>
                  {expressionSummary}
                </p>
                <Segmented
                  label={t("roll.evaluation")}
                  value={settings.expression.evaluation}
                  options={[
                    { value: "single", label: t("roll.single") },
                    { value: "batch", label: t("roll.batch") },
                  ]}
                  onChange={(evaluation) => update({ expression: { ...settings.expression, evaluation } })}
                />
              </div>
            )}
          </fieldset>
        </section>

        {/* 2. 数量区块 */}
        {(settings.mode !== "expression" || settings.expression.evaluation === "batch") && (
          <section className="inspector-section" aria-labelledby="section-count">
            <span className="section-label" id="section-count">{t("roll.countSection")}</span>
            <fieldset disabled={disabled} className="inspector-fields">
              <CountStepper key={settings.mode} count={settings.count} onChange={updateCount} />
            </fieldset>
          </section>
        )}

        {/* 3. 排除与池状态区块 */}
        {settings.mode !== "expression" && (
          <section className="inspector-section" aria-labelledby="section-exclude">
            <span className="section-label" id="section-exclude">{t("roll.excludeSection")}</span>
            <fieldset disabled={disabled} className="inspector-fields">
              <label className="stacked-field">
                <span className="field-label-row">
                  <Tooltip content={t("roll.excludeHelp")}>
                    <span>{t("roll.excludeRule")}</span>
                  </Tooltip>
                  {settings.excludeInput && (
                    <Tooltip content={t("roll.clearExclusions")}>
                      <button
                        type="button"
                        className="clear-exclusions"
                        aria-label={t("roll.clearExclusions")}
                        disabled={disabled}
                        onClick={clearExclusions}
                      >
                        <Trash2 size={14} />
                      </button>
                    </Tooltip>
                  )}
                </span>
                <input
                  ref={excludeInputRef}
                  aria-label={t("roll.excludeNumber")}
                  value={settings.excludeInput}
                  onChange={(event) => update({ excludeInput: event.target.value })}
                  placeholder={t("roll.excludePlaceholder")}
                />
                <small>{t("roll.excludeHint")}</small>
              </label>
              {(exclusions.tokens.length > 0 || exclusions.invalidTokens.length > 0) && (
                <div className="token-list">
                  {exclusions.tokens.map((token) => (
                    <button type="button" key={`${token.kind}-${token.raw}`} onClick={() => removeExclusion(token.raw)}>
                      {token.raw}
                      <span>×</span>
                    </button>
                  ))}
                  {exclusions.invalidTokens.map((token) => (
                    <span className="invalid-token" key={token}>
                      {token}
                    </span>
                  ))}
                </div>
              )}
              <div className="pool-meter">
                <span>
                  <strong>{poolStatus.candidateCount}</strong> {t("roll.available")}
                </span>
                <span>{poolStatus.exclusionHits} {t("roll.excluded")}</span>
                {settings.noDup && <span>{poolStatus.usedCount} {t("roll.removed")}</span>}
              </div>
              <Tooltip content={t("roll.removeAfterDrawTip")}>
                <button
                  type="button"
                  className={clsx("semantic-switch", settings.noDup && "on")}
                  role="switch"
                  aria-checked={settings.noDup}
                  onClick={() => update({ noDup: !settings.noDup })}
                >
                  <span className="switch-track" aria-hidden="true">
                    <i />
                  </span>
                  <span>
                    <strong>{t("roll.removeAfterDraw")}</strong>
                    <small>{t("roll.removeAfterDrawHelp")}</small>
                  </span>
                </button>
              </Tooltip>
              {settings.noDup && poolStatus.usedCount > 0 && (
                <button type="button" className="reset-pool" onClick={resetPool}>
                  <RotateCcw size={13} />
                  {t("roll.resetDrawn", { count: poolStatus.usedCount })}
                </button>
              )}
            </fieldset>
          </section>
        )}

        {/* 4. 倒计时仪式区块 */}
        <section className="inspector-section" aria-labelledby="section-timer">
          <span className="section-label" id="section-timer">{t("roll.timerSection")}</span>
          <div className="timer-box">
            <div className="quick-values">
              {[3, 5, 10].map((value) => (
                <Tooltip key={value} content={t("roll.timerSet", { seconds: value })}>
                  <button
                    type="button"
                    className={settings.timer.durationSec === value ? "active" : ""}
                    disabled={disabled}
                    onClick={() => update({ timer: { ...settings.timer, durationSec: value } })}
                  >
                    {value} {t("common.units.seconds")}
                  </button>
                </Tooltip>
              ))}
            </div>
            <Tooltip content={t("roll.timerTip")}>
              <Button
                className="countdown-start-btn"
                variant="quiet"
                icon={<Timer size={16} />}
                aria-keyshortcuts="Shift+Space"
                disabled={disabled || Boolean(poolStatus.error && settings.mode !== "expression")}
                onClick={() => void startCountdownCeremony(settings.timer.durationSec)}
              >
                {t("roll.countdownGenerate", { seconds: settings.timer.durationSec })}
              </Button>
            </Tooltip>
          </div>
        </section>

        {/* 5. 高级标签筛选区块 (只在自定义池模式显示，范围与骰子完全不出现) */}
        {settings.mode === "custom" && (
          <section className="inspector-section" aria-labelledby="section-advanced">
            <button
              type="button"
              className="advanced-toggle"
              id="section-advanced"
              onClick={() => setAdvanced((value) => !value)}
            >
              {advanced ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {t("roll.advancedTags")}
            </button>
            {advanced && (
              <div className="advanced-fields">
                {allTags.length ? (
                  <>
                    <span className="field-title">{t("roll.tagFilter")}</span>
                    <div className="tag-select">
                      {allTags.map((tag) => {
                        const selected = settings.tagFilter.selectedTags.includes(tag);
                        return (
                          <Tooltip key={tag} content={t("roll.tagFilterTip", { tag })}>
                            <button
                              type="button"
                              className={selected ? "selected" : ""}
                              disabled={disabled}
                              onClick={() =>
                                update({
                                  tagFilter: {
                                    ...settings.tagFilter,
                                    selectedTags: selected
                                      ? settings.tagFilter.selectedTags.filter((item) => item !== tag)
                                      : [...settings.tagFilter.selectedTags, tag],
                                  },
                                })
                              }
                            >
                              {tag}
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                    <Segmented
                      label={t("roll.tagCombine")}
                      value={settings.tagFilter.combine}
                      options={[
                        { value: "any", label: t("roll.anyTag") },
                        { value: "all", label: t("roll.allTags") },
                      ]}
                      onChange={(combine) => update({ tagFilter: { ...settings.tagFilter, combine } })}
                    />
                  </>
                ) : (
                  <p className="setting-hint">{t("roll.noTags")}</p>
                )}
              </div>
            )}
          </section>
        )}

        {poolStatus.error && settings.mode !== "expression" && (
          <p className="inline-error" role="alert">
            {translateRuntimeMessage(poolStatus.error, t)}
          </p>
        )}
      </div>

      {/* 底部独立底栏 (Item 1: 生成结果全宽主操作，打乱全池为下方安静次要) */}
      <footer className="inspector-footer">
        <div id="draw-config-summary" className={clsx("draw-config-summary", summary.invalid && "is-invalid")}>
          {summary.visible}
        </div>
        <Button
          variant="primary"
          className="generate-main-btn"
          icon={<Sparkles size={18} />}
          disabled={disabled || Boolean(poolStatus.error && settings.mode !== "expression")}
          aria-describedby="draw-config-summary"
          aria-keyshortcuts="Space Enter"
          onClick={() => void generateDraw()}
        >
          <span>{isDrawing ? t("roll.generating") : ceremony.phase !== "idle" ? t("roll.ceremonyActive") : t("roll.generate")}</span>
          {!isDrawing && ceremony.phase === "idle" && <small className="btn-key-hint">{t("roll.keyboardSpace")}</small>}
        </Button>
        {settings.mode !== "expression" && (
          <Tooltip content={t("roll.shuffleTip")}>
            <button
              type="button"
              className="shuffle-sub-btn"
              disabled={disabled || Boolean(poolStatus.error)}
              onClick={() => void generateShuffle()}
            >
              <ListOrdered size={14} />
              <span>{t("roll.shuffle")}</span>
            </button>
          </Tooltip>
        )}
      </footer>

      <Dialog
        open={poolEditorOpen}
        onOpenChange={setPoolEditorOpen}
        title={t("roll.customPool")}
        description={t("studio.bulkDescription")}
      >
        <PoolEditor mode="custom" />
      </Dialog>
    </aside>
  );
}
