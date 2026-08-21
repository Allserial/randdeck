import type { AppLocale } from "../domain/types";
import { parseRuntimeMessage } from "../domain/runtimeMessage";
import type { TFunction } from "i18next";

export type TranslateMessage = TFunction;

export function formatLocaleDate(value: string | number | Date, locale: AppLocale, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

export function formatLocaleTime(value: string | number | Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatLocaleNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Translate known domain/platform messages at the UI boundary without changing stable domain errors. */
export function translateRuntimeMessage(message: string, t: TranslateMessage): string {
  if (!message) return "";
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const descriptor = parseRuntimeMessage(message);
  if (descriptor) {
    const params = Object.fromEntries(Object.entries(descriptor.params).map(([key, value]) => [
      key,
      typeof value === "string" && parseRuntimeMessage(value) ? translateRuntimeMessage(value, t) : value,
    ]));
    return translate(descriptor.key, params);
  }
  let match: RegExpMatchArray | null;
  const exact: Record<string, string> = {
    "复制失败，请检查剪贴板权限": "errors.copy",
    "生成失败": "errors.drawFailed",
    "当前结果不能事务撤销": "errors.cannotUndo",
    "请先选择需要重掷的结果": "errors.selectReroll",
    "本次结果已全部固定，请先取消固定再生成": "errors.fixedAll",
    "当前环境不支持 Web Crypto 随机源": "errors.webCrypto",
    "范围必须是整数": "errors.rangeInteger",
    "没有识别到有效数字": "errors.noNumbers",
    "请输入标签名称": "errors.labelRequired",
    "不支持的数据版本": "errors.unsupportedVersion",
    "备份内容不是有效对象": "errors.invalidBackupObject",
    "备份版本不兼容": "errors.incompatibleBackup",
    "请至少添加一个自定义数字": "errors.customPoolEmpty",
    "抽后移除池已经耗尽，请重置池": "errors.poolExhausted",
    "当前没有可抽取数字": "errors.noCandidates",
    "骰子表达式不能列出全部顺序，请改用范围、自定义或加权池": "errors.expressionShuffleUnsupported",
    "骰子表达式尚未解析": "errors.expressionUnparsed",
    "请输入骰子表达式": "errors.expressionRequired",
    "保留或丢弃数量必须是非负整数": "errors.keepDropCount",
    "重掷规则需要使用 r<数字 或 r>数字": "errors.rerollSyntax",
    "表达式不能除以零": "errors.divideByZero",
    "表达式结果不是有限数字": "errors.nonFiniteResult",
    "重掷次数超过安全上限": "errors.rerollLimit",
    "爆骰次数超过安全上限": "errors.explosionLimit",
    "标签表达式不能为空": "errors.tagExpressionEmpty",
    "标签表达式不能对零取余": "errors.tagModuloZero",
    "请至少添加一行有效的加权数字": "errors.weightedEmpty",
    "缺少骰子表达式": "errors.probabilityMissingExpression",
    "当前没有候选项": "errors.probabilityNoCandidates",
    "模拟在 10,000 次尝试内没有得到符合标签的骰子结果": "errors.probabilityNoAcceptedResult",
    "概率分析失败": "errors.probabilityFailed",
    "概率分析 Worker 启动失败": "errors.probabilityWorkerFailed",
    "当前环境不能生成 PNG 回执": "errors.receiptPngUnavailable",
    "当前环境不能生成会话图片": "errors.sessionPngUnavailable",
    "PNG 编码失败": "errors.pngEncodingFailed",
    "IndexedDB 打开失败": "errors.indexedDbOpen",
    "IndexedDB 读取失败": "errors.indexedDbRead",
    "IndexedDB 保存失败": "errors.indexedDbSave",
    "当前数据损坏": "errors.currentDataCorrupt",
    "恢复副本不可用": "errors.recoveryCopyUnavailable",
    "未知错误": "errors.unknown",
    "爆骰或重掷使用模拟分析": "insights.reasons.explodeOrReroll",
    "骰子组合超过精确计算预算": "insights.reasons.diceCombinationsBudget",
    "骰子状态超过精确计算预算": "insights.reasons.diceStatesBudget",
    "表达式状态超过精确计算预算": "insights.reasons.expressionStatesBudget",
    "加权无放回候选过多": "insights.reasons.weightedCandidatesBudget",
    "加权无放回状态超过精确计算预算": "insights.reasons.weightedStatesBudget",
    "标签约束结果使用模拟分析": "insights.reasons.tagConstraint",
    "骰子状态在精确计算预算内": "insights.reasons.diceExact",
    "等概率无放回包含概率": "insights.reasons.uniformWithoutReplacement",
    "加权动态无放回精确枚举": "insights.reasons.weightedWithoutReplacement",
    "归一化权重": "insights.reasons.normalizedWeight",
    "等概率候选池": "insights.reasons.uniformPool",
    "精确状态不可用或超过预算": "insights.reasons.simulationFallback"
  };
  if (exact[message]) return translate(exact[message]);
  if (message === "找不到要召回的批次") return translate("errors.recallMissing");
  if (message === "已召回该批结果") return translate("roll.recall");
  if (message === "抽取数量已按模式独立并重置为 5") return translate("settings.migration.countReset");
  if (message === "旧版本未保存抽后移除状态，已使用集合从空集合开始") return translate("settings.migration.usedReset");
  if (message === "进行中的会话已自动归档") return translate("settings.migration.sessionArchived");
  if (message === "规则工坊已整合至抽取台，视图已切换为抽取台") return translate("settings.migration.studioMerged");
  if (message === "加权模式已停用，已自动切换为自定义数字池") return translate("settings.migration.weightedDisabled");
  match = message.match(/^已从 v(\d+) 存储升级到 v5$/);
  if (match) return translate("settings.migration.storageUpgrade", { version: match[1] });
  match = message.match(/^已从 (.*) v(\d+) 迁移到 v5$/);
  if (match) {
    const sourceKeys: Record<string, string> = {
      "未知来源": "settings.migration.sourceUnknown",
      "备份恢复": "settings.migration.sourceRestore",
      "兼容数据": "settings.migration.sourceCompatibleData",
      "兼容备份": "settings.migration.sourceCompatibleBackup",
    };
    return translate("settings.migration.version", {
      source: sourceKeys[match[1]] ? translate(sourceKeys[match[1]]) : match[1],
      version: match[2],
    });
  }
  match = message.match(/^本地保存失败：(.*)$/);
  if (match) return translate("errors.localSave", { message: translateRuntimeMessage(match[1], t) });
  match = message.match(/^备份无法恢复：(.*)$/);
  if (match) return translate("errors.restoreFailed", { message: translateRuntimeMessage(match[1], t) });
  match = message.match(/^导入失败：(.*)$/);
  if (match) return translate("errors.importFailed", { message: translateRuntimeMessage(match[1], t) });
  match = message.match(/^第 (\d+) 行未通过校验$/);
  if (match) return translate("errors.rowInvalid", { row: match[1] });
  match = message.match(/^范围过大，请控制在 ([\d,]+) 个数字以内$/);
  if (match) return translate("errors.rangeTooLarge", { count: match[1] });
  match = message.match(/^排除项包含无效内容：(.*)$/);
  if (match) return translate("errors.invalidExclusion", { tokens: match[1] });
  match = message.match(/^当前仅剩 (\d+) 个可抽取数字，不能补抽 (\d+) 个$/);
  if (match) return translate("errors.notEnough", { available: match[1], count: match[2] });
  match = message.match(/^可用数字不足，当前最多只能抽取 (\d+) 个$/);
  if (match) return translate("errors.notEnoughAvailable", { count: match[1] });
  match = message.match(/^候选超过 ([\d,]+) 个，请缩小范围后再列出全部顺序$/);
  if (match) return translate("errors.shuffleLimit", { count: match[1] });
  match = message.match(/^固定结果有 (\d+) 项，超过本次抽取数量 (\d+)$/);
  if (match) return translate("errors.fixedTooMany", { fixed: match[1], count: match[2] });
  if (message === "重掷结果数量与所选项不一致") return translate("errors.rerollMismatch");
  match = message.match(/^v5 数据校验失败：(.*)$/);
  if (match) return translate("errors.validationFailed", { message: translateRuntimeMessage(match[1], t) });
  match = message.match(/^表达式不能超过 ([\d,]+) 个字符$/);
  if (match) return translate("errors.expressionTooLong", { count: match[1] });
  match = message.match(/^第 (\d+) 个字符：不支持的骰子标识符 (.*)$/);
  if (match) return translate("errors.unsupportedDiceIdentifier", { position: match[1], identifier: match[2] });
  match = message.match(/^第 (\d+) 个字符：不支持的标签标识符 (.*)$/);
  if (match) return translate("errors.unsupportedTagIdentifier", { position: match[1], identifier: match[2] });
  match = message.match(/^第 (\d+) 个字符：不支持 (.*)$/);
  if (match) return translate("errors.unsupportedCharacter", { position: match[1], character: match[2] });
  match = message.match(/^第 (\d+) 个字符：期待 (.*)，实际为 (.*)$/);
  if (match) return translate("errors.expectedToken", { position: match[1], expected: match[2], actual: match[3] });
  match = message.match(/^第 (\d+) 个字符：期待数字、骰子或括号$/);
  if (match) return translate("errors.expectedDiceValue", { position: match[1] });
  match = message.match(/^第 (\d+) 个字符：期待 value 或整数$/);
  if (match) return translate("errors.expectedTagValue", { position: match[1] });
  match = message.match(/^第 (\d+) 个字符：标签规则必须包含比较条件$/);
  if (match) return translate("errors.tagComparisonRequired", { position: match[1] });
  match = message.match(/^第 (\d+) 个字符：存在多余内容 (.*)$/);
  if (match) return translate("errors.trailingContent", { position: match[1], content: match[2] });
  match = message.match(/^表达式嵌套不能超过 ([\d,]+) 层$/);
  if (match) return translate("errors.expressionDepth", { count: match[1] });
  match = message.match(/^每项骰子数量必须在 1 至 ([\d,]+) 之间$/);
  if (match) return translate("errors.diceCountRange", { count: match[1] });
  match = message.match(/^骰面数必须在 1 至 ([\d,]+) 之间$/);
  if (match) return translate("errors.diceSidesRange", { count: match[1] });
  match = message.match(/^标签表达式不能超过 ([\d,]+) 个字符$/);
  if (match) return translate("errors.tagExpressionTooLong", { count: match[1] });
  match = message.match(/^标签规则“(.*)”无效：(.*)$/);
  if (match) return translate("errors.tagRuleInvalid", { label: match[1], message: translateRuntimeMessage(match[2], t) });
  match = message.match(/^加权表最多支持 ([\d,]+) 行$/);
  if (match) return translate("errors.weightedRowsLimit", { count: match[1] });
  match = message.match(/^第 (\d+) 行数字重复：(.*)$/);
  if (match) return translate("errors.weightedDuplicate", { row: match[1], value: match[2] });
  match = message.match(/^第 (\d+) 行权重必须在 1 至 ([\d,]+) 之间$/);
  if (match) return translate("errors.weightedWeightRange", { row: match[1], count: match[2] });
  match = message.match(/^CSV 第 (\d+) 行无法解析：(.*)$/);
  if (match) return translate("errors.csvParse", { row: match[1], message: match[2] });
  match = message.match(/^当前数据损坏：(.*)$/);
  if (match) return translate("errors.currentDataWarning", { message: translateRuntimeMessage(match[1], t) });
  match = message.match(/^恢复副本也不可用：(.*)$/);
  if (match) return translate("errors.recoveryCopyWarning", { message: translateRuntimeMessage(match[1], t) });
  match = message.match(/^持久化存储暂时不可用：(.*)$/);
  if (match) return translate("errors.persistenceUnavailable", { message: translateRuntimeMessage(match[1], t) });
  match = message.match(/^读取 v(\d+) 存储失败：(.*)$/);
  if (match) return translate("errors.storageReadFailed", { version: match[1], message: translateRuntimeMessage(match[2], t) });
  match = message.match(/^旧数据迁移失败：(.*)$/);
  if (match) return translate("errors.legacyMigrationFailed", { message: translateRuntimeMessage(match[1], t) });
  return message;
}
