import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const localeFiles = {
  "zh-CN": resolve(root, "src/i18n/locales/zh-CN.json"),
  "en-US": resolve(root, "src/i18n/locales/en-US.json"),
};

// Maintenance boundary for the future UI hard-coded-text scan. It remains
// advisory until the existing UI is migrated by the integration agent.
const hardCodedUiScan = {
  status: "reserved",
  include: ["src/app", "src/components", "src/features"],
  exclude: ["src/i18n", "src/domain", "src/platform", "src/test", "*.test.*"],
  policy: "report-only-during-v0.6-migration",
};

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? flatten(child, path)
      : [[path, child]];
  });
}

async function loadLocale(locale, file) {
  const value = JSON.parse(await readFile(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${locale} resource must be an object`);
  return new Map(flatten(value));
}

const locales = new Map();
for (const [locale, file] of Object.entries(localeFiles)) locales.set(locale, await loadLocale(locale, file));

const base = locales.get("zh-CN");
const other = locales.get("en-US");
const errors = [];
for (const key of new Set([...base.keys(), ...other.keys()])) {
  if (!base.has(key)) errors.push(`zh-CN missing key: ${key}`);
  if (!other.has(key)) errors.push(`en-US missing key: ${key}`);
  for (const [locale, resource] of locales) {
    const value = resource.get(key);
    if (typeof value !== "string" || !value.trim()) errors.push(`${locale} empty value: ${key}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`i18n resources verified: ${base.size} keys, zh-CN/en-US aligned.`);
  console.log(`Hard-coded UI scan reserved (${hardCodedUiScan.policy}); include=${hardCodedUiScan.include.join(",")}.`);
}

