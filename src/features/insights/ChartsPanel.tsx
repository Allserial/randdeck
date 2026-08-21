import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import type { ProbabilityReport } from "../../domain/types";
import { formatLocaleNumber } from "../../i18n/messages";
import { useAppStore } from "../../app/store";

type FrequencyPoint = { value: string; count: number; expected?: number };
type TrendPoint = { batch: number; average: number };

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
};

const axisStyle = { stroke: "var(--muted)" };

export default function ChartsPanel({ frequency, trend, probability }: { frequency: FrequencyPoint[]; trend: TrendPoint[]; probability?: ProbabilityReport | null }) {
  const { t } = useTranslation();
  const locale = useAppStore((state) => state.ui.locale);
  const probabilityData = probability?.points.slice(0, 80).map((point) => ({
    value: String(point.value),
    probability: Number((point.probability * 100).toFixed(3)),
    expected: Number(point.expectedCount.toFixed(3)),
  })) ?? [];

  return (
    <div className="charts-grid">
      <section className="chart-panel">
        <div><span className="section-label">{t("charts.frequency")}</span><h3>{t("charts.occurrences")}</h3></div>
        <div className="chart-area">
          {frequency.length ? (
              <BarChart responsive style={{ width: "100%", height: "100%" }} data={frequency.slice(0, 60)}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="value" {...axisStyle} tickLine={false} />
                <YAxis {...axisStyle} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name={t("charts.actualCount")} fill="var(--accent)" radius={[3, 3, 0, 0]} />
              </BarChart>
          ) : <p className="empty-chart">{t("charts.noStats")}</p>}
        </div>
      </section>
      <section className="chart-panel">
        <div><span className="section-label">{t("charts.trend")}</span><h3>{t("charts.batchAverage")}</h3></div>
        <div className="chart-area">
          {trend.length ? (
              <LineChart responsive style={{ width: "100%", height: "100%" }} data={trend}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="batch" {...axisStyle} tickLine={false} />
                <YAxis {...axisStyle} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="average" name={t("charts.average")} stroke="var(--gold)" strokeWidth={2} dot={false} />
              </LineChart>
          ) : <p className="empty-chart">{t("charts.noTrend")}</p>}
        </div>
      </section>
      {probability && (
        <section className="chart-panel chart-panel--wide">
          <div><span className="section-label">{t("charts.distribution")}</span><h3>{probability.method === "exact" ? t("insights.exactProbability") : t("insights.simulatedProbability", { count: formatLocaleNumber(probability.samples ?? 0, locale) })}</h3></div>
          <div className="chart-area">
              <BarChart responsive style={{ width: "100%", height: "100%" }} data={probabilityData}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="value" {...axisStyle} tickLine={false} />
                <YAxis {...axisStyle} tickLine={false} unit="%" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="probability" name={t("charts.singleProbability")} fill="var(--info)" radius={[3, 3, 0, 0]} />
              </BarChart>
          </div>
        </section>
      )}
    </div>
  );
}
