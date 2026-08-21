import { useMemo, useRef, useState } from "react";
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

const quickCounts = [1, 3, 5, 10];

// 跑团预设分类：基础骰面 / 检定 / 属性 / 伤害 (Item 2)
interface DicePresetGroup {
  name: string;
  items: Array<{ expr: string; tip: string }>;
}

const DICE_PRESET_GROUPS: DicePresetGroup[] = [
  {
    name: "基础骰面",
    items: [
      { expr: "d4", tip: "d4：四面骰（匕首/法术伤害）" },
      { expr: "d6", tip: "d6：单颗标准六面骰" },
      { expr: "d8", tip: "d8：八面骰（长剑/轻弩伤害）" },
      { expr: "d10", tip: "d10：十面骰（长戟/重弩伤害）" },
      { expr: "d12", tip: "d12：十二面骰（巨斧伤害）" },
      { expr: "d20", tip: "d20：标准二十面检定骰" },
      { expr: "1d100", tip: "1d100：百分骰（1-100 百分比判定）" },
    ],
  },
  {
    name: "检定",
    items: [
      { expr: "2d20kh1", tip: "2d20kh1：双二十面取高（优势检定）" },
      { expr: "2d20kl1", tip: "2d20kl1：双二十面取低（劣势检定）" },
    ],
  },
  {
    name: "属性",
    items: [
      { expr: "3d6", tip: "3d6：三颗六面骰（经典属性直掷）" },
      { expr: "4d6kh3", tip: "4d6kh3：四颗留最大三颗（经典建卡属性）" },
    ],
  },
  {
    name: "伤害",
    items: [
      { expr: "2d6", tip: "2d6：两颗六面骰（如巨剑伤害）" },
      { expr: "2d8", tip: "2d8：两颗八面骰（强力法术/至圣斩）" },
      { expr: "1d8+1", tip: "1d8+1：单手武器修正加成" },
    ],
  },
];

function CountStepper({ count, onChange }: { count: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(count));
  const [error, setError] = useState("");

  const commit = () => {
    const value = Number(draft.trim());
    if (!draft.trim() || !Number.isInteger(value)) {
      setDraft(String(count));
      setError("请输入 1–50 的整数");
      return;
    }
    const clamped = Math.max(1, Math.min(50, value));
    onChange(clamped);
    setDraft(String(clamped));
    setError(value < 1 || value > 50 ? "已调整为 1–50 范围内的数量" : "");
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
        <span>抽取个数</span>
        <strong>{count}</strong>
      </div>
      <div className="stepper">
        <button type="button" aria-label="减少数量" onClick={() => immediate(count - 1)}>
          <Minus size={16} />
        </button>
        <input
          aria-label="生成数量"
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
        <button type="button" aria-label="增加数量" onClick={() => immediate(count + 1)}>
          <Plus size={16} />
        </button>
      </div>
      <div className="quick-values">
        {quickCounts.map((quickCount) => (
          <Tooltip key={quickCount} content={`快速设置为单次抽取 ${quickCount} 个`}>
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
  const settings = useAppStore((state) => state.settings);
  const pools = useAppStore((state) => state.pools);
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
      return describeDiceExpression(ast);
    } catch (err) {
      return err instanceof Error ? err.message : "无效的表达式";
    }
  }, [settings.expression.source, settings.mode]);

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

  const summary = formatDrawSummary(settings, pools, poolStatus);

  return (
    <aside className="draw-inspector" aria-label="抽取设置">
      <div className="inspector-header">
        <strong data-inspector-heading tabIndex={-1}>抽取设置</strong>
        <button type="button" className="inspector-close" aria-label="关闭设置" onClick={() => setInspectorOpen(false)}>
          <X size={16} />
          <span>关闭设置</span>
        </button>
      </div>
      <div className="inspector-scroll">
        {/* 1. 源数据 / 范围配置 */}
        <section className="inspector-section" aria-labelledby="section-source">
          <span className="section-label" id="section-source">
            {settings.mode === "range" ? "范围设置" : settings.mode === "custom" ? "自定义数字池" : "骰子式子"}
          </span>
          <fieldset disabled={disabled} className="inspector-fields">
            {settings.mode === "range" && (
              <div className="range-fields">
                <label>
                  <span>最小值</span>
                  <input
                    aria-label="最小值"
                    type="number"
                    value={settings.min}
                    onChange={(event) => update({ min: Number(event.target.value) })}
                  />
                </label>
                <span>至</span>
                <label>
                  <span>最大值</span>
                  <input
                    aria-label="最大值"
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
                  <span>共 <strong>{pools.customEntries.length}</strong> 个数字</span>
                  <small>支持列表/CSV导入</small>
                </div>
                <Tooltip content="打开表格编辑器，增删改候选数字或从剪贴板导入">
                  <Button
                    className="edit-pool-btn"
                    icon={<Edit3 size={15} />}
                    onClick={() => setPoolEditorOpen(true)}
                  >
                    编辑数字池
                  </Button>
                </Tooltip>
              </div>
            )}

            {settings.mode === "expression" && (
              <div className="expression-quick">
                <label className="expression-input-label">
                  <span>骰子表达式</span>
                  <textarea
                    aria-label="表达式"
                    rows={2}
                    value={settings.expression.source}
                    onChange={(event) => updateExpression(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <div className="dice-presets-wrap">
                  <span className="dice-presets-title">常用跑团预设</span>
                  <div className="dice-preset-groups">
                    {DICE_PRESET_GROUPS.map((group) => (
                      <div className="dice-preset-group" key={group.name}>
                        <span className="dice-preset-group-title">{group.name}</span>
                        <div className="dice-presets">
                          {group.items.map(({ expr, tip }) => (
                            <Tooltip key={expr} content={tip}>
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
                <p className={clsx("expression-desc", expressionSummary.includes("字符") && "invalid")}>
                  {expressionSummary}
                </p>
                <Segmented
                  label="求值方式"
                  value={settings.expression.evaluation}
                  options={[
                    { value: "single", label: "单次求值" },
                    { value: "batch", label: "批量求值" },
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
            <span className="section-label" id="section-count">生成数量</span>
            <fieldset disabled={disabled} className="inspector-fields">
              <CountStepper key={settings.mode} count={settings.count} onChange={updateCount} />
            </fieldset>
          </section>
        )}

        {/* 3. 排除与池状态区块 */}
        {settings.mode !== "expression" && (
          <section className="inspector-section" aria-labelledby="section-exclude">
            <span className="section-label" id="section-exclude">排除与抽后移除</span>
            <fieldset disabled={disabled} className="inspector-fields">
              <label className="stacked-field">
                <span className="field-label-row">
                  <Tooltip content="支持单数字 (如 3, 5)、闭区间 (如 1..10) 或关键字 (如 奇数、偶数)">
                    <span>排除规则</span>
                  </Tooltip>
                  {settings.excludeInput && (
                    <Tooltip content="清空全部排除规则">
                      <button
                        type="button"
                        className="clear-exclusions"
                        aria-label="清空排除规则"
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
                  aria-label="排除数字"
                  value={settings.excludeInput}
                  onChange={(event) => update({ excludeInput: event.target.value })}
                  placeholder="如：3, 5 或 1..10、奇数"
                />
                <small>支持单数字、区间 1..10、奇数或偶数</small>
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
                  <strong>{poolStatus.candidateCount}</strong> 可抽取
                </span>
                <span>{poolStatus.exclusionHits} 已排除</span>
                {settings.noDup && <span>{poolStatus.usedCount} 已移除</span>}
              </div>
              <Tooltip content="开启后已抽出的数字不会再次出现，直到重置或耗尽">
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
                    <strong>抽后移除（不重复）</strong>
                    <small>抽出的数字不再进入下一次候选池</small>
                  </span>
                </button>
              </Tooltip>
              {settings.noDup && poolStatus.usedCount > 0 && (
                <button type="button" className="reset-pool" onClick={resetPool}>
                  <RotateCcw size={13} />
                  重置已抽记录 ({poolStatus.usedCount})
                </button>
              )}
            </fieldset>
          </section>
        )}

        {/* 4. 倒计时仪式区块 */}
        <section className="inspector-section" aria-labelledby="section-timer">
          <span className="section-label" id="section-timer">仪式感倒计时</span>
          <div className="timer-box">
            <div className="quick-values">
              {[3, 5, 10].map((value) => (
                <Tooltip key={value} content={`设置倒计时仪式时长为 ${value} 秒`}>
                  <button
                    type="button"
                    className={settings.timer.durationSec === value ? "active" : ""}
                    disabled={disabled}
                    onClick={() => update({ timer: { ...settings.timer, durationSec: value } })}
                  >
                    {value} 秒
                  </button>
                </Tooltip>
              ))}
            </div>
            <Tooltip content="启动超大倒计时仪式，伴随低音节奏鼓点与整秒揭晓">
              <Button
                className="countdown-start-btn"
                variant="quiet"
                icon={<Timer size={16} />}
                aria-keyshortcuts="Shift+Space"
                disabled={disabled || Boolean(poolStatus.error && settings.mode !== "expression")}
                onClick={() => void startCountdownCeremony(settings.timer.durationSec)}
              >
                倒计时后生成 ({settings.timer.durationSec}s)
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
              高级标签筛选
            </button>
            {advanced && (
              <div className="advanced-fields">
                {allTags.length ? (
                  <>
                    <span className="field-title">标签筛选</span>
                    <div className="tag-select">
                      {allTags.map((tag) => {
                        const selected = settings.tagFilter.selectedTags.includes(tag);
                        return (
                          <Tooltip key={tag} content={`筛选仅包含「${tag}」标签的候选数字`}>
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
                      label="标签组合"
                      value={settings.tagFilter.combine}
                      options={[
                        { value: "any", label: "任一标签" },
                        { value: "all", label: "全部标签" },
                      ]}
                      onChange={(combine) => update({ tagFilter: { ...settings.tagFilter, combine } })}
                    />
                  </>
                ) : (
                  <p className="setting-hint">当前自定义池数字尚无标签，可在「编辑数字池」中为数字添加标签。</p>
                )}
              </div>
            )}
          </section>
        )}

        {poolStatus.error && settings.mode !== "expression" && (
          <p className="inline-error" role="alert">
            {poolStatus.error}
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
          <span>{isDrawing ? "正在生成…" : ceremony.phase !== "idle" ? "仪式进行中" : "生成结果"}</span>
          {!isDrawing && ceremony.phase === "idle" && <small className="btn-key-hint">空格</small>}
        </Button>
        {settings.mode !== "expression" && (
          <Tooltip content="将当前候选池中的全部数字随机打乱排列">
            <button
              type="button"
              className="shuffle-sub-btn"
              disabled={disabled || Boolean(poolStatus.error)}
              onClick={() => void generateShuffle()}
            >
              <ListOrdered size={14} />
              <span>打乱全池顺序</span>
            </button>
          </Tooltip>
        )}
      </footer>

      <Dialog
        open={poolEditorOpen}
        onOpenChange={setPoolEditorOpen}
        title="自定义数字池"
        description="编辑、批量粘贴并校验候选数字列表"
      >
        <PoolEditor mode="custom" />
      </Dialog>
    </aside>
  );
}
