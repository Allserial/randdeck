import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export const resources = {
  "zh-CN": { translation: zhCN },
  "en-US": { translation: enUS },
} as const;

export type TranslationResources = typeof resources["zh-CN"];

