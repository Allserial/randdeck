import type { DrawSettings, PoolsState } from "../domain/types";

export interface DrawSummaryPoolStatus {
  sourceCount: number;
  candidateCount: number;
  usedCount: number;
  exclusionHits: number;
  error: string;
}

export interface DrawSummary {
  visible: string;
  accessible: string;
  invalid: boolean;
  error: string;
}

function countLabel(count: number): string {
  return `本次 ${Math.max(1, Math.trunc(count || 1))}`;
}

export function formatDrawSummary(
  settings: DrawSettings,
  pools: PoolsState,
  poolStatus: DrawSummaryPoolStatus,
): DrawSummary {
  if (poolStatus.error) {
    return {
      visible: poolStatus.error,
      accessible: `配置无效：${poolStatus.error}`,
      invalid: true,
      error: poolStatus.error,
    };
  }

  if (settings.mode === "expression") {
    const modeLabel = settings.expression.evaluation === "single" ? "单次" : `批量 ${settings.count} 次`;
    const visible = `骰子 ${settings.expression.source || "未填写"} · ${modeLabel}`;
    return { visible, accessible: `抽取配置：${visible}`, invalid: false, error: "" };
  }

  const noDup = settings.noDup ? " · 抽后移除" : "";
  const exclusion = poolStatus.exclusionHits > 0 ? ` · 排除 ${poolStatus.exclusionHits}` : "";
  const tagCount = settings.mode === "custom" ? settings.tagFilter.selectedTags.length : 0;
  const tag = tagCount > 0 ? ` · 标签 ${tagCount} 项` : "";
  const isWeighted = settings.mode === "weighted";

  if (settings.mode === "range") {
    const range = `范围 ${settings.min}–${settings.max}`;
    const visible = `${range} · 可抽 ${poolStatus.candidateCount} · ${countLabel(settings.count)}${exclusion}${noDup}`;
    return { visible, accessible: `抽取配置：${visible}`, invalid: false, error: "" };
  }

  const total = isWeighted ? pools.weightedEntries.length : pools.customEntries.length;
  const poolName = isWeighted ? "加权池" : "自定义池";
  const visible = `${poolName} ${total} 项 · 可抽 ${poolStatus.candidateCount} · ${countLabel(settings.count)}${tag}${exclusion}${noDup}`;
  return { visible, accessible: `抽取配置：${visible}`, invalid: false, error: "" };
}
