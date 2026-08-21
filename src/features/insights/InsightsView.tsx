import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Copy, History, RotateCcw, Search, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { DrawMode, ProbabilityReport, ProbabilityRequest } from "../../domain/types";
import { prepareDraw } from "../../domain/draw";
import { parseDiceExpression } from "../../domain/dice";
import { coverageForStats } from "../../domain/stats";
import { analyzeProbability } from "../../platform/probabilityClient";
import { copyText } from "../../platform/files";
import { snapshotState, useAppStore } from "../../app/store";
import { Button, IconButton } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";
import { historySearchText, MODE_LABELS } from "../../lib/labels";

const ChartsPanel = lazy(() => import("./ChartsPanel"));
type Tab = "overview" | "history" | "probability";

export default function InsightsView() {
  const historyEntries = useAppStore((state) => state.history);
  const stats = useAppStore((state) => state.stats);
  const currentMode = useAppStore((state) => state.settings.mode);
  const tab = useAppStore((state) => state.ui.insightsTab) as Tab;
  const compareIds = useAppStore((state) => state.ui.compareIds);
  const setInsightsTab = useAppStore((state) => state.setInsightsTab);
  const toggleCompare = useAppStore((state) => state.toggleCompare);
  const clearCompare = useAppStore((state) => state.clearCompare);
  const recallHistory = useAppStore((state) => state.recallHistory);
  const deleteHistory = useAppStore((state) => state.deleteHistory);
  const clearHistory = useAppStore((state) => state.clearHistory);
  const resetModeStats = useAppStore((state) => state.resetModeStats);
  const setToast = useAppStore((state) => state.setToast);
  const setError = useAppStore((state) => state.setError);

  const [modeFilter, setModeFilter] = useState<DrawMode | "all">("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [analysisNow] = useState(() => Date.now());
  const [samples, setSamples] = useState<5_000 | 20_000 | 100_000>(20_000);
  const [report, setReport] = useState<ProbabilityReport | null>(null);
  const [progress, setProgress] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const filteredHistory = useMemo(() => {
    const cutoff =
      dateFilter === "7d"
        ? analysisNow - 7 * 86400000
        : dateFilter === "30d"
          ? analysisNow - 30 * 86400000
          : 0;
    const needle = search.trim().toLowerCase();
    return historyEntries.filter(
      (entry) =>
        (modeFilter === "all" || entry.mode === modeFilter) &&
        (!cutoff || new Date(entry.createdAt || 0).getTime() >= cutoff) &&
        (!needle || historySearchText(entry).includes(needle))
    );
  }, [analysisNow, dateFilter, historyEntries, modeFilter, search]);

  const values = filteredHistory.flatMap((entry) => entry.results.map((result) => result.total));
  const frequency = useMemo(() => {
    const counts = new Map<number, number>();
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    return [...counts]
      .sort(([left], [right]) => left - right)
      .map(([value, count]) => ({ value: String(value), count }));
  }, [values]);

  const trend = useMemo(
    () =>
      [...filteredHistory].reverse().map((entry, index) => ({
        batch: index + 1,
        average: entry.results.reduce((sum, result) => sum + result.total, 0) / entry.results.length,
      })),
    [filteredHistory]
  );

  const currentStats = stats.byMode[currentMode] || { draws: 0, values: {}, faces: {}, tags: {}, resetAt: null };
  const coverage = useMemo(() => {
    try {
      const plan = prepareDraw(snapshotState());
      return coverageForStats(
        stats,
        currentMode,
        plan.candidateEntries.map((entry) => entry.value)
      );
    } catch {
      return { seen: 0, total: 0, pct: 0, missing: [] };
    }
  }, [currentMode, stats]);

  const compared = compareIds.map((id) => historyEntries.find((entry) => entry.id === id)).filter(Boolean);

  const runAnalysis = async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setAnalyzing(true);
    setProgress(0);
    setReport(null);
    try {
      const state = snapshotState();
      const plan = prepareDraw(state);
      if (plan.candidateEntries.length > 50_000)
        throw new Error("候选结果超过 50,000 个，请缩小范围后分析，以免生成不可读的图表");
      const request: ProbabilityRequest = {
        mode: plan.mode,
        count: plan.count,
        noDup: plan.configSnapshot.noDup,
        candidates: plan.candidateEntries,
        expression:
          plan.mode === "expression"
            ? {
                source: state.settings.expression.source,
                ast: parseDiceExpression(state.settings.expression.source),
                constrained: state.settings.expression.tagBehavior === "constrain",
                tagRules: state.pools.expressionTagRules,
                selectedTags: state.settings.tagFilter.selectedTags,
                combine: state.settings.tagFilter.combine,
              }
            : undefined,
      };
      const next = await analyzeProbability(request, { samples, signal: abort.signal, onProgress: setProgress });
      const observed = stats.byMode[state.settings.mode]?.values || {};
      next.points = next.points.map((point) => ({ ...point, observed: observed[String(point.value)] || 0 }));
      setReport(next);
      setToast("概率分析完成");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setError((error as Error).message);
    } finally {
      setAnalyzing(false);
      controller.current = null;
    }
  };

  const compareSets =
    compared.length === 2
      ? {
          left: new Set(compared[0]!.results.map((result) => result.total)),
          right: new Set(compared[1]!.results.map((result) => result.total)),
        }
      : null;

  return (
    <div className="insights-view">
      <header className="view-heading">
        <div>
          <span className="section-label">数据洞察</span>
          <h1>验证分布，不预测结果</h1>
        </div>
      </header>

      <nav className="view-tabs" aria-label="数据洞察视图">
        {[
          { id: "overview", label: "概览", icon: BarChart3 },
          { id: "history", label: "历史", icon: History },
          { id: "probability", label: "概率", icon: Activity },
        ].map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={clsx(tab === id && "active")}
            onClick={() => setInsightsTab(id as Tab)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      {(tab === "overview" || tab === "history") && (
        <div className="insight-filters">
          <label className="history-search">
            <Search size={14} />
            <input
              aria-label="搜索历史"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索数字、模式或日期"
            />
          </label>
          <label>
            模式
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value as DrawMode | "all")}>
              <option value="all">全部</option>
              <option value="range">范围</option>
              <option value="custom">自定义</option>
              <option value="expression">骰子</option>
            </select>
          </label>
          <label>
            时间
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="7d">最近 7 天</option>
              <option value="30d">最近 30 天</option>
            </select>
          </label>
        </div>
      )}

      {tab === "overview" && (
        <>
          <div className="metric-grid">
            <article>
              <span>当前模式累计结果</span>
              <strong>{currentStats.draws.toLocaleString()}</strong>
              <small>{MODE_LABELS[currentMode]}</small>
            </article>
            <article>
              <span>候选覆盖率</span>
              <strong>{coverage.pct.toFixed(1)}%</strong>
              <small>
                {coverage.seen}/{coverage.total}
              </small>
            </article>
            <article>
              <span>筛选后批次</span>
              <strong>{filteredHistory.length}</strong>
              <small>{values.length} 个结果</small>
            </article>
            <article>
              <span>未出现数字</span>
              <strong>{coverage.missing.length}</strong>
              <small>{coverage.missing.slice(0, 4).join("、") || "无"}</small>
            </article>
          </div>
          <Suspense fallback={<div className="chart-loading">正在加载图表</div>}>
            <ChartsPanel frequency={frequency} trend={trend} />
          </Suspense>
          <Button
            variant="danger"
            icon={<RotateCcw size={15} />}
            onClick={() => {
              resetModeStats(currentMode);
              setToast(`${MODE_LABELS[currentMode]}统计已清零`);
            }}
          >
            清零当前模式统计
          </Button>
        </>
      )}

      {tab === "history" && (
        <section className="history-table">
          <div className="history-table-head">
            <span>{filteredHistory.length} 批记录</span>
            <div className="heading-actions">
              {compareIds.length > 0 && (
                <Button variant="quiet" onClick={clearCompare}>
                  清除对比
                </Button>
              )}
              <Button
                variant="danger"
                icon={<Trash2 size={15} />}
                disabled={!historyEntries.length}
                onClick={() => setClearOpen(true)}
              >
                清空历史
              </Button>
            </div>
          </div>
          {compared.length === 2 && compareSets && (
            <div className="compare-panel" data-print="compare">
              <article>
                <h3>批次 A</h3>
                <p>{compared[0]!.results.map((result) => result.total).join(" · ")}</p>
              </article>
              <article>
                <h3>批次 B</h3>
                <p>{compared[1]!.results.map((result) => result.total).join(" · ")}</p>
              </article>
              <article>
                <h3>对比</h3>
                <p>交集 {[...compareSets.left].filter((value) => compareSets.right.has(value)).join("、") || "无"}</p>
                <p>仅 A {[...compareSets.left].filter((value) => !compareSets.right.has(value)).join("、") || "无"}</p>
                <p>仅 B {[...compareSets.right].filter((value) => !compareSets.left.has(value)).join("、") || "无"}</p>
              </article>
            </div>
          )}
          {filteredHistory.length ? (
            filteredHistory.map((entry) => (
              <article key={entry.id} className={clsx(compareIds.includes(entry.id) && "is-compared")}>
                <span className="history-time">{new Date(entry.createdAt || 0).toLocaleString("zh-CN")}</span>
                <span className="mode-badge">{MODE_LABELS[entry.mode]}</span>
                <button type="button" className="history-result" onClick={() => recallHistory(entry.id)}>
                  {entry.results.map((result) => result.total).join(" · ")}
                </button>
                {entry.legacy && <small>兼容记录</small>}
                <IconButton label="召回该批" onClick={() => recallHistory(entry.id)}>
                  <History size={14} />
                </IconButton>
                <IconButton label="加入对比" onClick={() => toggleCompare(entry.id)}>
                  <Search size={14} />
                </IconButton>
                <IconButton
                  label="复制该批"
                  onClick={() => void copyText(entry.results.map((result) => result.total).join(", "))}
                >
                  <Copy size={14} />
                </IconButton>
                <IconButton label="删除该批" onClick={() => deleteHistory(entry.id)}>
                  <Trash2 size={14} />
                </IconButton>
              </article>
            ))
          ) : (
            <p className="empty-editor">没有符合筛选条件的历史</p>
          )}
        </section>
      )}

      {tab === "probability" && (
        <section className="probability-workspace">
          <div className="probability-controls">
            <div>
              <span className="section-label">混合引擎</span>
              <h2>当前配置概率分析</h2>
              <p>优先精确计算；状态过大、爆骰、重掷或标签约束自动改用可复算模拟。</p>
            </div>
            <Segmented
              label="模拟样本数"
              value={String(samples) as "5000" | "20000" | "100000"}
              options={[
                { value: "5000", label: "5 千" },
                { value: "20000", label: "2 万" },
                { value: "100000", label: "10 万" },
              ]}
              onChange={(value) => setSamples(Number(value) as 5_000 | 20_000 | 100_000)}
            />
            <div className="analysis-actions">
              {analyzing && (
                <div className="progress-line">
                  <i style={{ width: `${progress * 100}%` }} />
                  <span>{Math.round(progress * 100)}%</span>
                </div>
              )}
              <Button
                variant={analyzing ? "danger" : "primary"}
                icon={analyzing ? <Trash2 size={16} /> : <Activity size={16} />}
                onClick={() => (analyzing ? controller.current?.abort() : void runAnalysis())}
              >
                {analyzing ? "取消分析" : "开始分析"}
              </Button>
            </div>
          </div>
          {report && (
            <>
              <div className="report-summary">
                <span className={report.method}>{report.method === "exact" ? "精确" : "模拟"}</span>
                <strong>{report.reason}</strong>
                {report.seed !== undefined && <code>seed {report.seed}</code>}
                {report.uncertainty !== undefined && (
                  <small>最大 95% 误差约 ±{(report.uncertainty * 100).toFixed(2)}%</small>
                )}
              </div>
              <Suspense fallback={<div className="chart-loading">正在加载概率图表</div>}>
                <ChartsPanel frequency={[]} trend={[]} probability={report} />
              </Suspense>
              <div className="probability-table">
                {report.points.slice(0, 200).map((point) => (
                  <div key={point.value}>
                    <strong>{point.value}</strong>
                    <span>{(point.probability * 100).toFixed(3)}%</span>
                    <span>每批期望 {point.expectedCount.toFixed(3)}</span>
                    <span>实际 {point.observed ?? 0}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <Dialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="清空全部历史"
        description="统计账本不会随普通历史删除而改变。"
        footer={
          <>
            <Button variant="quiet" onClick={() => setClearOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearHistory();
                setClearOpen(false);
                setToast("历史与结果舞台已清空，统计保持不变");
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        <p>此操作会删除历史批次并清空结果舞台，无法撤销。</p>
      </Dialog>
    </div>
  );
}
