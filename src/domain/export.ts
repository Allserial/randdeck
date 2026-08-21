import Papa from "papaparse";
import type { AppStateV3, DrawSession } from "./types";

interface ExportRow {
  recordType: string;
  timestamp: string;
  mode: string;
  batchId: string;
  transactionId: string;
  sessionId: string;
  presetId: string;
  expression: string;
  resultIndex: string | number;
  value: string | number;
  weight: string | number;
  tags: string;
  faces: string;
  statistic: string;
  count: string | number;
}

function row(updates: Partial<ExportRow>): ExportRow {
  return { recordType: "", timestamp: "", mode: "", batchId: "", transactionId: "", sessionId: "", presetId: "", expression: "", resultIndex: "", value: "", weight: "", tags: "", faces: "", statistic: "", count: "", ...updates };
}

export function buildCompleteCsv(state: AppStateV3): string {
  const rows: ExportRow[] = [row({ recordType: "settings", mode: state.settings.mode, expression: state.settings.expression.source, count: state.settings.count, value: `${state.settings.min}..${state.settings.max}`, tags: state.settings.tagFilter.selectedTags.join("|") })];
  state.pools.customEntries.forEach((entry) => rows.push(row({ recordType: "pool-custom", mode: "custom", value: entry.value, tags: entry.tags.join("|") })));
  state.pools.weightedEntries.forEach((entry) => rows.push(row({ recordType: "pool-weighted", mode: "weighted", value: entry.value, weight: entry.weight, tags: entry.tags.join("|") })));
  state.pools.rangeTagRules.forEach((rule) => rows.push(row({ recordType: "tag-rule", mode: "range", value: rule.expression, tags: rule.label })));
  state.pools.expressionTagRules.forEach((rule) => rows.push(row({ recordType: "tag-rule", mode: "expression", value: rule.expression, tags: rule.label })));
  state.history.forEach((entry) => entry.results.forEach((result, index) => rows.push(row({
    recordType: "history", timestamp: entry.createdAt || "", mode: entry.mode, batchId: entry.id, transactionId: entry.transactionId || "", sessionId: entry.sessionId || "", presetId: entry.presetId || "",
    expression: entry.mode === "expression" ? entry.config.expression.source : "", resultIndex: index + 1, value: result.total, tags: result.tags.join("|"), faces: result.faces.map((face) => `${face.value}${face.sides ? `d${face.sides}` : ""}`).join("|"),
  }))));
  Object.entries(state.stats.byMode).forEach(([mode, bucket]) => {
    rows.push(row({ recordType: "stats-summary", mode, statistic: "draws", count: bucket.draws, timestamp: bucket.resetAt || "" }));
    Object.entries(bucket.values).forEach(([value, count]) => rows.push(row({ recordType: "stats-value", mode, statistic: "value", value, count })));
    Object.entries(bucket.faces).forEach(([value, count]) => rows.push(row({ recordType: "stats-face", mode, statistic: "face", value, count })));
    Object.entries(bucket.tags).forEach(([value, count]) => rows.push(row({ recordType: "stats-tag", mode, statistic: "tag", tags: value, count })));
  });
  return `\uFEFF${Papa.unparse(rows)}`;
}

export function buildSessionCsv(session: DrawSession): string {
  const rows = session.transactionRecords.flatMap((transaction, round) => transaction.results.map((result, index) => ({
    会话: session.name,
    轮次: round + 1,
    时间: transaction.createdAt,
    事务: transaction.id,
    操作: transaction.operation.kind,
    序号: index + 1,
    结果: result.total,
    标签: result.tags.join("|"),
    骰面: result.faces.map((face) => face.value).join("|"),
  })));
  return `\uFEFF${Papa.unparse(rows)}`;
}
