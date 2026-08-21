import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const localeFiles = {
  "zh-CN": resolve(root, "src/i18n/locales/zh-CN.json"),
  "en-US": resolve(root, "src/i18n/locales/en-US.json"),
};

const hardCodedAllowlist = new Map([
  ["src/app/state.ts", "migration notes and compatibility errors are translated at the UI boundary"],
  ["src/app/store.ts", "store fallback messages are translated at the UI boundary"],
  ["src/app/drawController.ts", "domain error contracts are translated at the UI boundary"],
  ["src/features/display/DisplayView.tsx", "legacy display payload labels remain protocol-compatible"],
  ["src/features/studio/PoolEditor.tsx", "Chinese CSV field names remain stable export fields"],
  ["src/features/settings/SettingsView.tsx", "localized backup and CSV filenames use the selected product name"],
  ["src/components/BrandMark.tsx", "the paired product brand is intentionally bilingual"],
]);

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

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if ([".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.includes(".test.")) result.push(path);
  }
  return result;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function findChineseStrings(source) {
  const clean = stripComments(source);
  const strings = [...clean.matchAll(/(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`)/g)];
  const quoted = strings
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((value) => /[\u4e00-\u9fff]/u.test(value));
  const jsxText = [...clean.matchAll(/>([^<>{}\r\n]*[\u4e00-\u9fff][^<>{}\r\n]*)</gu)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  return [...new Set([...quoted, ...jsxText])];
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

const findings = [];
for (const directory of ["src/app", "src/components", "src/features"]) {
  for (const file of await sourceFiles(directory)) {
    const strings = findChineseStrings(await readFile(resolve(root, file), "utf8"));
    if (!strings.length) continue;
    if (hardCodedAllowlist.has(file)) {
      console.log(`Allowlisted ${file}: ${hardCodedAllowlist.get(file)} (${strings.length} string(s))`);
    } else {
      findings.push(`${file}: ${strings.join(" | ")}`);
    }
  }
}

if (findings.length) errors.push("Unmanaged user-facing Chinese hard-coded strings:", ...findings);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`i18n resources verified: ${base.size} keys, zh-CN/en-US aligned.`);
  console.log("Hard-coded UI scan passed; only documented compatibility/export strings are allowlisted.");
}
