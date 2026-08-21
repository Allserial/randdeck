import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { historySearchText, modeLabel } from "../../lib/labels";
import { formatLocaleDate, formatLocaleNumber, translateRuntimeMessage } from "../../i18n/messages";

const ChartsPanel = lazy(() => import("./ChartsPanel"));
type Tab = "overview" | "history" | "probability";

export default function InsightsView() {
  const { t } = useTranslation();
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
  const locale = useAppStore((state) => state.ui.locale);

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
        throw new Error(t("insights.errorTooManyCandidates"));
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
      setToast(t("insights.analysisComplete"));
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
          <span className="section-label">{t("insights.title")}</span>
          <h1>{t("insights.heading")}</h1>
        </div>
      </header>

      <nav className="view-tabs" aria-label={t("insights.viewLabel")}>
        {[
          { id: "overview", label: t("insights.overview"), icon: BarChart3 },
          { id: "history", label: t("insights.history"), icon: History },
          { id: "probability", label: t("insights.probability"), icon: Activity },
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
              aria-label={t("insights.searchHistory")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("insights.searchPlaceholder")}
            />
          </label>
          <label>
            {t("insights.mode")}
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value as DrawMode | "all")}>
              <option value="all">{t("common.actions.all")}</option>
              <option value="range">{t("modes.rangeShort")}</option>
              <option value="custom">{t("modes.customShort")}</option>
              <option value="expression">{t("modes.expressionShort")}</option>
            </select>
          </label>
          <label>
            {t("insights.time")}
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              <option value="all">{t("common.actions.all")}</option>
              <option value="7d">{t("insights.last7")}</option>
              <option value="30d">{t("insights.last30")}</option>
            </select>
          </label>
        </div>
      )}

      {tab === "overview" && (
        <>
          <div className="metric-grid">
            <article>
              <span>{t("insights.currentDraws")}</span>
              <strong>{formatLocaleNumber(currentStats.draws, locale)}</strong>
              <small>{modeLabel(currentMode, locale)}</small>
            </article>
            <article>
              <span>{t("insights.coverage")}</span>
              <strong>{coverage.pct.toFixed(1)}%</strong>
              <small>
                {coverage.seen}/{coverage.total}
              </small>
            </article>
            <article>
              <span>{t("insights.filteredBatches")}</span>
              <strong>{filteredHistory.length}</strong>
              <small>{values.length} {t("common.units.results")}</small>
            </article>
            <article>
              <span>{t("insights.missing")}</span>
              <strong>{coverage.missing.length}</strong>
              <small>{coverage.missing.slice(0, 4).join("、") || t("common.status.none")}</small>
            </article>
          </div>
          <Suspense fallback={<div className="chart-loading">{t("insights.loadChart")}</div>}>
            <ChartsPanel frequency={frequency} trend={trend} />
          </Suspense>
          <Button
            variant="danger"
            icon={<RotateCcw size={15} />}
            onClick={() => {
              resetModeStats(currentMode);
              setToast(t("insights.statsCleared", { mode: modeLabel(currentMode, locale) }));
            }}
          >
            {t("insights.resetStats")}
          </Button>
        </>
      )}

      {tab === "history" && (
        <section className="history-table">
          <div className="history-table-head">
            <span>{t("insights.records", { count: filteredHistory.length })}</span>
            <div className="heading-actions">
              {compareIds.length > 0 && (
                <Button variant="quiet" onClick={clearCompare}>
                  {t("insights.clearCompare")}
                </Button>
              )}
              <Button
                variant="danger"
                icon={<Trash2 size={15} />}
                disabled={!historyEntries.length}
                onClick={() => setClearOpen(true)}
              >
                {t("insights.clearHistory")}
              </Button>
            </div>
          </div>
          {compared.length === 2 && compareSets && (
            <div className="compare-panel" data-print="compare">
              <article>
                <h3>{t("insights.batchA")}</h3>
                <p>{compared[0]!.results.map((result) => result.total).join(" · ")}</p>
              </article>
              <article>
                <h3>{t("insights.batchB")}</h3>
                <p>{compared[1]!.results.map((result) => result.total).join(" · ")}</p>
              </article>
              <article>
                <h3>{t("insights.compare")}</h3>
                <p>{t("insights.intersection", { values: [...compareSets.left].filter((value) => compareSets.right.has(value)).join("、") || t("common.status.none") })}</p>
                <p>{t("insights.onlyA", { values: [...compareSets.left].filter((value) => !compareSets.right.has(value)).join("、") || t("common.status.none") })}</p>
                <p>{t("insights.onlyB", { values: [...compareSets.right].filter((value) => !compareSets.left.has(value)).join("、") || t("common.status.none") })}</p>
              </article>
            </div>
          )}
          {filteredHistory.length ? (
            filteredHistory.map((entry) => (
              <article key={entry.id} className={clsx(compareIds.includes(entry.id) && "is-compared")}>
                <span className="history-time">{formatLocaleDate(entry.createdAt || 0, locale, { dateStyle: "short", timeStyle: "short" })}</span>
                <span className="mode-badge">{modeLabel(entry.mode, locale)}</span>
                <button type="button" className="history-result" onClick={() => recallHistory(entry.id)}>
                  {entry.results.map((result) => result.total).join(" · ")}
                </button>
                {entry.legacy && <small>{t("insights.compatibleRecord")}</small>}
                <IconButton label={t("insights.recall")} onClick={() => recallHistory(entry.id)}>
                  <History size={14} />
                </IconButton>
                <IconButton label={t("insights.addCompare")} onClick={() => toggleCompare(entry.id)}>
                  <Search size={14} />
                </IconButton>
                <IconButton
                  label={t("insights.copyBatch")}
                  onClick={() => void copyText(entry.results.map((result) => result.total).join(", "))}
                >
                  <Copy size={14} />
                </IconButton>
                <IconButton label={t("insights.deleteBatch")} onClick={() => deleteHistory(entry.id)}>
                  <Trash2 size={14} />
                </IconButton>
              </article>
            ))
          ) : (
            <p className="empty-editor">{t("insights.noMatchingHistory")}</p>
          )}
        </section>
      )}

      {tab === "probability" && (
        <section className="probability-workspace">
          <div className="probability-controls">
            <div>
              <span className="section-label">{t("insights.engine")}</span>
              <h2>{t("insights.analysisHeading")}</h2>
              <p>{t("insights.analysisDescription")}</p>
            </div>
            <Segmented
              label={t("insights.sampleCount")}
              value={String(samples) as "5000" | "20000" | "100000"}
              options={[
                { value: "5000", label: "5k" },
                { value: "20000", label: "20k" },
                { value: "100000", label: "100k" },
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
                {analyzing ? t("insights.cancelAnalysis") : t("insights.startAnalysis")}
              </Button>
            </div>
          </div>
          {report && (
            <>
              <div className="report-summary">
                <span className={report.method}>{report.method === "exact" ? t("common.status.exact") : t("common.status.simulated")}</span>
                <strong>{translateRuntimeMessage(report.reason, t)}</strong>
                {report.seed !== undefined && <code>seed {report.seed}</code>}
                {report.uncertainty !== undefined && (
                  <small>{t("insights.maxError", { value: (report.uncertainty * 100).toFixed(2) })}</small>
                )}
              </div>
                <Suspense fallback={<div className="chart-loading">{t("insights.probabilityChart")}</div>}>
                <ChartsPanel frequency={[]} trend={[]} probability={report} />
              </Suspense>
              <div className="probability-table">
                {report.points.slice(0, 200).map((point) => (
                  <div key={point.value}>
                    <strong>{point.value}</strong>
                    <span>{(point.probability * 100).toFixed(3)}%</span>
                    <span>{t("insights.expectedPerBatch", { value: point.expectedCount.toFixed(3) })}</span>
                    <span>{t("insights.observed", { value: point.observed ?? 0 })}</span>
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
        title={t("insights.clearHistoryTitle")}
        description={t("insights.clearHistoryDescription")}
        footer={
          <>
            <Button variant="quiet" onClick={() => setClearOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearHistory();
                setClearOpen(false);
                setToast(t("insights.historyCleared"));
              }}
            >
              {t("insights.confirmClear")}
            </Button>
          </>
        }
      >
        <p>{t("insights.clearHistoryBody")}</p>
      </Dialog>
    </div>
  );
}
