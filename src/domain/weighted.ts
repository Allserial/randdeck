import Papa from "papaparse";
import type { WeightedEntry } from "./types";
import type { ExclusionToken, RandomSource } from "./random";
import { createId, isExcluded, randomIndex } from "./random";
import { matchesTagFilter } from "./tags";

export const MAX_WEIGHTED_ROWS = 500;
export const MAX_WEIGHT = 1_000_000;

export function normalizeWeightedEntries(entries: unknown): WeightedEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as Partial<WeightedEntry>;
    const value = Number(entry.value); const weight = Number(entry.weight);
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(weight)) return [];
    return [{ id: entry.id || createId("weighted"), value, weight: Math.trunc(weight), tags: [...new Set((entry.tags || []).map((tag) => String(tag).trim()).filter(Boolean))] }];
  }).slice(0, MAX_WEIGHTED_ROWS);
}

export function validateWeightedEntries(entries: unknown): { entries: WeightedEntry[]; errors: string[] } {
  const source = Array.isArray(entries) ? entries : [];
  const normalized = normalizeWeightedEntries(source);
  const errors: string[] = [];
  const seen = new Set<number>();
  if (source.length > MAX_WEIGHTED_ROWS) errors.push(`加权表最多支持 ${MAX_WEIGHTED_ROWS} 行`);
  normalized.forEach((entry, index) => {
    if (seen.has(entry.value)) errors.push(`第 ${index + 1} 行数字重复：${entry.value}`);
    seen.add(entry.value);
    if (entry.weight < 1 || entry.weight > MAX_WEIGHT) errors.push(`第 ${index + 1} 行权重必须在 1 至 ${MAX_WEIGHT.toLocaleString()} 之间`);
  });
  if (!normalized.length) errors.push("请至少添加一行有效的加权数字");
  return { entries: normalized, errors: [...new Set(errors)] };
}

export function filterWeightedEntries(
  entries: WeightedEntry[],
  options: { selectedTags?: string[]; combine?: "any" | "all"; exclusions?: ExclusionToken[]; used?: Set<number> } = {},
): WeightedEntry[] {
  const { selectedTags = [], combine = "any", exclusions = [], used = new Set<number>() } = options;
  return entries.filter((entry) => !isExcluded(entry.value, exclusions) && !used.has(entry.value) && matchesTagFilter(entry.tags, selectedTags, combine));
}

export function pickWeighted(entries: WeightedEntry[], source: RandomSource): WeightedEntry | undefined {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!entries.length || total <= 0 || !Number.isSafeInteger(total)) return undefined;
  let target = randomIndex(total, source);
  for (const entry of entries) {
    if (target < entry.weight) return entry;
    target -= entry.weight;
  }
  return entries.at(-1);
}

export function drawWeightedEntries(entries: WeightedEntry[], count: number, withReplacement: boolean, source: RandomSource): WeightedEntry[] {
  const output: WeightedEntry[] = [];
  const remaining = [...entries];
  const drawCount = withReplacement ? count : Math.min(count, remaining.length);
  for (let index = 0; index < drawCount; index += 1) {
    const selected = pickWeighted(withReplacement ? entries : remaining, source);
    if (!selected) break;
    output.push(selected);
    if (!withReplacement) remaining.splice(remaining.findIndex((entry) => entry.id === selected.id), 1);
  }
  return output;
}

export function weightedEntriesToCsv(entries: WeightedEntry[]): string {
  return `\uFEFF${Papa.unparse(entries.map((entry) => ({ 数字: entry.value, 权重: entry.weight, 标签: entry.tags.join("|") })))}`;
}

export function parseWeightedCsv(text: string): WeightedEntry[] {
  const parsed = Papa.parse<Record<string, string>>(String(text ?? "").replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() });
  if (parsed.errors.length) throw new Error(`CSV 第 ${Number(parsed.errors[0].row ?? 0) + 1} 行无法解析：${parsed.errors[0].message}`);
  return parsed.data.map((row) => ({
    id: createId("weighted-import"),
    value: Number(row["数字"] ?? row.value),
    weight: Number(row["权重"] ?? row.weight),
    tags: String(row["标签"] ?? row.tags ?? "").split("|").map((tag) => tag.trim()).filter(Boolean),
  }));
}
