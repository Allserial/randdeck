import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { AppLocale } from "../domain/types";
import { detectLocaleFromLanguages, normalizePersistedLocale } from "./locale";
import { resources } from "./resources";

export * from "./locale";
export { resources } from "./resources";
export type { AppLocale };

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: typeof resources["zh-CN"];
    returnNull: false;
  }
}

function detectBrowserLocale(): AppLocale {
  if (typeof navigator === "undefined") return "en-US";
  return detectLocaleFromLanguages(navigator.languages, navigator.language);
}

export function updateDocumentLanguage(locale: AppLocale, documentLike?: Pick<Document, "documentElement">): void {
  const target = documentLike ?? (typeof document === "undefined" ? undefined : document);
  if (target?.documentElement) target.documentElement.lang = locale;
}

export async function initializeI18n(locale?: AppLocale): Promise<AppLocale> {
  const nextLocale = normalizePersistedLocale(locale, detectBrowserLocale());

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: nextLocale,
      fallbackLng: "en-US",
      supportedLngs: ["zh-CN", "en-US"],
      defaultNS: "translation",
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else if (i18n.language !== nextLocale) {
    await i18n.changeLanguage(nextLocale);
  }

  updateDocumentLanguage(nextLocale);
  return nextLocale;
}

export async function setAppLocale(locale: AppLocale): Promise<AppLocale> {
  return initializeI18n(locale);
}

