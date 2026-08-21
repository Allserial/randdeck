import type { AppLocale } from "../domain/types";

export const DEFAULT_LOCALE: AppLocale = "zh-CN";
export const SUPPORTED_LOCALES: readonly AppLocale[] = ["zh-CN", "en-US"];

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "en-US";
}

export function normalizePersistedLocale(value: unknown, fallback: AppLocale = DEFAULT_LOCALE): AppLocale {
  return isAppLocale(value) ? value : fallback;
}

/** Pure browser-language policy: any Chinese preference selects zh-CN. */
export function detectLocaleFromLanguages(
  languages: readonly string[] | null | undefined,
  language?: string | null,
): AppLocale {
  const candidates = [...(languages ?? []), language ?? ""];
  return candidates.some((candidate) => /^zh(?:-|$)/i.test(candidate.trim())) ? "zh-CN" : "en-US";
}

