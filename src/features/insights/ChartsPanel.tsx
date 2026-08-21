import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProbabilityReport } from "../../domain/types";

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
  const probabilityData = probability?.points.slice(0, 80).map((point) => ({
    value: String(point.value),
    probability: Number((point.probability * 100).toFixed(3)),
    expected: Number(point.expectedCount.toFixed(3)),
  })) ?? [];

  return (
    <div className="charts-grid">
      <section className="chart-panel">
        <div><span className="section-label">频次</span><h3>出现次数</h3></div>
        <div className="chart-area">
          {frequency.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={frequency.slice(0, 60)}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="value" {...axisStyle} tickLine={false} />
                <YAxis {...axisStyle} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="实际次数" fill="var(--accent)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="empty-chart">暂无统计</p>}
        </div>
      </section>
      <section className="chart-panel">
        <div><span className="section-label">趋势</span><h3>批次平均值</h3></div>
        <div className="chart-area">
          {trend.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="batch" {...axisStyle} tickLine={false} />
                <YAxis {...axisStyle} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="average" name="平均值" stroke="var(--gold)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="empty-chart">暂无趋势</p>}
        </div>
      </section>
      {probability && (
        <section className="chart-panel chart-panel--wide">
          <div><span className="section-label">理论分布</span><h3>{probability.method === "exact" ? "精确概率" : `模拟概率 · ${probability.samples?.toLocaleString()} 次`}</h3></div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={probabilityData}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="value" {...axisStyle} tickLine={false} />
                <YAxis {...axisStyle} tickLine={false} unit="%" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="probability" name="单次概率 %" fill="var(--info)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}
