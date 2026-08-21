import type { PoolEntry, WeightedEntry } from "./types";

export const MAX_COUNT = 50;
export const MAX_RANGE_SIZE = 1_000_000;
export const ALGORITHM_VERSION = "webcrypto-rejection-v1" as const;

export interface RandomSource {
  nextUint32(): number;
}

export class WebCryptoRandomSource implements RandomSource {
  nextUint32(): number {
    if (!globalThis.crypto?.getRandomValues) throw new Error("当前环境不支持 Web Crypto 随机源");
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
}

export class SeededRandomSource implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }
}

export function createId(prefix = "item"): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function randomIndex(length: number, source: RandomSource = new WebCryptoRandomSource()): number {
  if (!Number.isInteger(length) || length <= 0) return -1;
  const maxUint32 = 0x1_0000_0000;
  const limit = Math.floor(maxUint32 / length) * length;
  let value: number;
  do value = source.nextUint32(); while (value >= limit);
  return value % length;
}

export function parseIntegerList(input: unknown): { values: number[]; invalidTokens: string[] } {
  const tokens = String(input ?? "").trim().split(/[,，\s]+/).filter(Boolean);
  const values: number[] = [];
  const invalidTokens: string[] = [];
  for (const token of tokens) {
    if (/^[+-]?\d+$/.test(token) && Number.isSafeInteger(Number(token))) values.push(Number(token));
    else invalidTokens.push(token);
  }
  return { values: [...new Set(values)], invalidTokens };
}

export type ExclusionToken =
  | { raw: string; kind: "integer"; value: number }
  | { raw: string; kind: "range"; min: number; max: number }
  | { raw: string; kind: "odd" | "even" };

export function parseExclusionInput(input: unknown): { tokens: ExclusionToken[]; invalidTokens: string[] } {
  const rawTokens = String(input ?? "").trim().split(/[,，\s]+/).filter(Boolean);
  const tokens: ExclusionToken[] = [];
  const invalidTokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawTokens) {
    let parsed: ExclusionToken | undefined;
    if (/^[+-]?\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) {
      parsed = { raw, kind: "integer", value: Number(raw) };
    } else {
      const range = raw.match(/^([+-]?\d+)\.\.([+-]?\d+)$/);
      if (range && Number.isSafeInteger(Number(range[1])) && Number.isSafeInteger(Number(range[2]))) {
        parsed = { raw, kind: "range", min: Math.min(Number(range[1]), Number(range[2])), max: Math.max(Number(range[1]), Number(range[2])) };
      } else if (raw === "奇数") parsed = { raw, kind: "odd" };
      else if (raw === "偶数") parsed = { raw, kind: "even" };
    }
    if (!parsed) invalidTokens.push(raw);
    else {
      const key = parsed.kind === "integer" ? `i:${parsed.value}` : parsed.kind === "range" ? `r:${parsed.min}:${parsed.max}` : parsed.kind;
      if (!seen.has(key)) { seen.add(key); tokens.push(parsed); }
    }
  }
  return { tokens, invalidTokens };
}

export function isExcluded(value: number, tokens: ExclusionToken[]): boolean {
  return tokens.some((token) => {
    if (token.kind === "integer") return value === token.value;
    if (token.kind === "range") return value >= token.min && value <= token.max;
    if (token.kind === "odd") return Math.abs(value % 2) === 1;
    return value % 2 === 0;
  });
}

export function exclusionHitCount(values: number[], tokens: ExclusionToken[]): number {
  return values.reduce((count, value) => count + (isExcluded(value, tokens) ? 1 : 0), 0);
}

export function buildRangeEntries(min: number, max: number): { entries: PoolEntry[]; error: string } {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return { entries: [], error: "范围必须是整数" };
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const size = hi - lo + 1;
  if (size > MAX_RANGE_SIZE) return { entries: [], error: `范围过大，请控制在 ${MAX_RANGE_SIZE.toLocaleString()} 个数字以内` };
  return { entries: Array.from({ length: size }, (_, index) => ({ id: `range-${lo + index}`, value: lo + index, tags: [] })), error: "" };
}

export function clampCount(value: unknown, availableCount = MAX_COUNT): number {
  const requested = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 1;
  return Math.max(1, Math.min(MAX_COUNT, Math.max(1, availableCount), requested));
}

export function drawUnweighted<T>(pool: T[], count: number, withReplacement: boolean, source: RandomSource): T[] {
  if (!pool.length || count <= 0) return [];
  if (withReplacement) return Array.from({ length: count }, () => pool[randomIndex(pool.length, source)]);
  const shuffled = [...pool];
  const output: T[] = [];
  for (let index = 0; index < Math.min(count, shuffled.length); index += 1) {
    const selected = index + randomIndex(shuffled.length - index, source);
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
    output.push(shuffled[index]);
  }
  return output;
}

export function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, Object.keys(value as object).sort());
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function poolFingerprint(input: unknown): string {
  return stableHash(JSON.stringify(input));
}

export function asWeighted(entries: PoolEntry[]): WeightedEntry[] {
  return entries.map((entry) => ({ ...entry, weight: 1 }));
}
