import type { DrawSettings, PoolsState } from "../domain/types";
import { translateRuntimeMessage, type TranslateMessage } from "../i18n/messages";

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
  translate?: TranslateMessage,
): DrawSummary {
  if (poolStatus.error) {
    const error = translate ? translateRuntimeMessage(poolStatus.error, translate) : poolStatus.error;
    return {
      visible: translate ? translate("roll.summary.invalid", { message: error }) : poolStatus.error,
      accessible: translate ? translate("roll.summary.invalid", { message: error }) : `配置无效：${poolStatus.error}`,
      invalid: true,
      error: poolStatus.error,
    };
  }

  if (settings.mode === "expression") {
    const evaluation = settings.expression.evaluation === "single" ? (translate ? translate("roll.single") : "单次") : (translate ? translate("roll.batch") : `批量 ${settings.count} 次`);
    const visible = translate
      ? translate("roll.summary.expression", { expression: settings.expression.source || "未填写", evaluation, count: settings.count })
      : `骰子 ${settings.expression.source || "未填写"} · ${evaluation}`;
    return { visible, accessible: translate ? visible : `抽取配置：${visible}`, invalid: false, error: "" };
  }

  const noDup = settings.noDup ? (translate ? ` · ${translate("roll.summary.removed")}` : " · 抽后移除") : "";
  const exclusion = poolStatus.exclusionHits > 0 ? (translate ? ` · ${translate("roll.summary.exclude", { count: poolStatus.exclusionHits })}` : ` · 排除 ${poolStatus.exclusionHits}`) : "";
  const tagCount = settings.mode === "custom" ? settings.tagFilter.selectedTags.length : 0;
  const tag = tagCount > 0 ? (translate ? ` · ${translate("roll.summary.tags", { count: tagCount })}` : ` · 标签 ${tagCount} 项`) : "";
  const isWeighted = settings.mode === "weighted";

  if (settings.mode === "range") {
    const visible = translate
      ? translate("roll.summary.range", { min: settings.min, max: settings.max, available: poolStatus.candidateCount, count: settings.count }) + exclusion + noDup
      : `范围 ${settings.min}–${settings.max} · 可抽 ${poolStatus.candidateCount} · ${countLabel(settings.count)}${exclusion}${noDup}`;
    return { visible, accessible: `抽取配置：${visible}`, invalid: false, error: "" };
  }

  const total = isWeighted ? pools.weightedEntries.length : pools.customEntries.length;
  const visible = translate
    ? translate("roll.summary.custom", { total, available: poolStatus.candidateCount, count: settings.count }) + tag + exclusion + noDup
    : `${isWeighted ? "加权池" : "自定义池"} ${total} 项 · 可抽 ${poolStatus.candidateCount} · ${countLabel(settings.count)}${tag}${exclusion}${noDup}`;
  return { visible, accessible: `抽取配置：${visible}`, invalid: false, error: "" };
}
