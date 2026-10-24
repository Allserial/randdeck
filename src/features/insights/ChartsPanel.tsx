import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import type { ProbabilityReport } from "../../domain/types";
import { useAppStore } from "../../app/store";
import { Pager } from "../../components/ui/Pager";
import { formatProbability } from "./formatProbability";

type FrequencyPoint = { value: string; count: number };
type TrendPoint = { batch: number; average: number };
type Props = { view: "overview"; frequency: FrequencyPoint[]; trend: TrendPoint[] } | { view: "probability"; probability: ProbabilityReport };
const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 6, color: "var(--text)" };

export default function ChartsPanel(props: Props) {
  const { t } = useTranslation();
  const locale = useAppStore(s => s.ui.locale);
  const [pageIndex, setPage] = useState(0);
  const [size, setSize] = useState(() => matchMedia("(max-width: 759px)").matches ? 10 : 20);
  useEffect(() => {
    const media = matchMedia("(max-width: 759px)");
    const change = () => { setSize(media.matches ? 10 : 20); setPage(0); };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const points = props.view === "overview"
    ? props.frequency.map(p => ({ value: Number(p.value), amount: p.count }))
    : props.probability.points.map(p => ({ value: p.value, amount: p.probability * 100 }));
  points.sort((a,b) => a.value - b.value);
  const page = Math.min(pageIndex, Math.max(0, Math.ceil(points.length / size) - 1));
  const maximum = Math.max(1, ...points.map(p => p.amount));
  const probability = props.view === "probability";
  return <div className="charts-grid">
    <section className={probability ? "chart-panel chart-panel--wide" : "chart-panel"}>
      <h3>{probability ? (props.probability.method === "exact" ? t("insights.exactProbability") : t("insights.simulatedProbability", { count: props.probability.samples })) : t("charts.occurrences")}</h3>
      <div className="chart-area">
        {points.length ? <BarChart responsive style={{ width: "100%", height: "100%" }} data={points.slice(page * size, (page + 1) * size)}>
          <defs>
            <linearGradient id="chartBarAccent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.95} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.62} />
            </linearGradient>
            <linearGradient id="chartBarInfo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--info)" stopOpacity={0.95} />
              <stop offset="100%" stopColor="var(--info)" stopOpacity={0.48} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="value" stroke="var(--muted)" tickLine={false} minTickGap={12} />
          <YAxis stroke="var(--muted)" tickLine={false} allowDecimals={probability} domain={[0, maximum]} unit={probability ? "%" : undefined} />
          <Tooltip contentStyle={tooltipStyle} formatter={value => probability ? formatProbability(Number(value) / 100, locale) : Number(value).toLocaleString(locale)} />
          <Bar dataKey="amount" name={probability ? t("charts.singleProbability") : t("charts.actualCount")} fill={probability ? "url(#chartBarInfo)" : "url(#chartBarAccent)"} radius={[4, 4, 0, 0]} />
        </BarChart> : <p className="empty-chart">{t("charts.noStats")}</p>}
      </div>
      {(probability || points.length > size) && <Pager page={page} size={size} total={points.length} onChange={setPage} />}
    </section>
    {props.view === "overview" && <section className="chart-panel">
      <h3>{t("charts.batchAverage")}</h3>
      <div className="chart-area">{props.trend.length ? <LineChart responsive style={{ width: "100%", height: "100%" }} data={props.trend}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="batch" stroke="var(--muted)" tickLine={false} allowDecimals={false} />
        <YAxis stroke="var(--muted)" tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="average" name={t("charts.average")} stroke="var(--gold)" strokeWidth={2.5} dot={props.trend.length <= 12 ? { r: 3.5, fill: "var(--gold)", stroke: "var(--surface)", strokeWidth: 1.5 } : false} activeDot={{ r: 5, fill: "var(--gold)" }} />
      </LineChart> : <p className="empty-chart">{t("charts.noTrend")}</p>}</div>
    </section>}
  </div>;
}
