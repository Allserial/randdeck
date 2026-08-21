import type { AppLocale } from "../domain/types";
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
    "备份版本不兼容": "errors.incompatibleBackup"
  };
  if (exact[message]) return translate(exact[message]);
  if (message === "找不到要召回的批次") return translate("errors.recallMissing");
  if (message === "已召回该批结果") return translate("roll.recall");
  if (message === "抽取数量已按模式独立并重置为 5") return translate("settings.migration.countReset");
  if (message === "旧版本未保存抽后移除状态，已使用集合从空集合开始") return translate("settings.migration.usedReset");
  if (message === "进行中的会话已自动归档") return translate("settings.migration.sessionArchived");
  if (message === "规则工坊已整合至抽取台，视图已切换为抽取台") return translate("settings.migration.studioMerged");
  if (message === "加权模式已停用，已自动切换为自定义数字池") return translate("settings.migration.weightedDisabled");
  match = message.match(/^已从 (.*) v(\d+) 迁移到 v5$/);
  if (match) return translate("settings.migration.version", { source: match[1], version: match[2] });
  match = message.match(/^本地保存失败：(.*)$/);
  if (match) return translate("errors.localSave", { message: match[1] });
  match = message.match(/^备份无法恢复：(.*)$/);
  if (match) return translate("errors.restoreFailed", { message: match[1] });
  match = message.match(/^导入失败：(.*)$/);
  if (match) return translate("errors.importFailed", { message: match[1] });
  match = message.match(/^第 (\d+) 行未通过校验$/);
  if (match) return translate("errors.rowInvalid", { row: match[1] });
  match = message.match(/^范围过大，请控制在 ([\d,]+) 个数字以内$/);
  if (match) return translate("errors.rangeTooLarge", { count: match[1] });
  match = message.match(/^排除项包含无效内容：(.*)$/);
  if (match) return translate("errors.invalidExclusion", { tokens: match[1] });
  match = message.match(/^当前仅剩 (\d+) 个可抽取数字，不能补抽 (\d+) 个$/);
  if (match) return translate("errors.notEnough", { available: match[1], count: match[2] });
  match = message.match(/^固定结果有 (\d+) 项，超过本次抽取数量 (\d+)$/);
  if (match) return translate("errors.fixedTooMany", { fixed: match[1], count: match[2] });
  if (message === "重掷结果数量与所选项不一致") return translate("errors.rerollMismatch");
  match = message.match(/^v5 数据校验失败：(.*)$/);
  if (match) return translate("errors.validationFailed", { message: match[1] });
  return message;
}
