import type { CopyFormat, DrawMode, DrawResult, HistoryEntry } from "../domain/types";

export const MODE_LABELS: Record<DrawMode, string> = {
  range: "范围",
  custom: "自定义",
  weighted: "加权（历史）",
  expression: "骰子",
};

export function displayValue(result: DrawResult): number {
  return result.total ?? result.value;
}

export function formatResultList(results: Array<Pick<DrawResult, "total" | "value">>, format: CopyFormat = "comma"): string {
  const values = results.map((result) => String(result.total ?? result.value));
  return format === "newline" ? values.join("\n") : values.join(", ");
}

export function historySearchText(entry: HistoryEntry): string {
  return [
    MODE_LABELS[entry.mode],
    entry.results.map((result) => result.total).join(" "),
    entry.config.expression?.source || "",
    entry.config.excludeInput || "",
    entry.sessionId || "",
    entry.presetId || "",
    entry.createdAt || "",
  ].join(" ").toLowerCase();
}
