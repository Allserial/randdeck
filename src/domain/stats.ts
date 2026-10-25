import type { DrawMode, DrawResult, StatsBucket, StatsDelta, StatsState } from "./types";
import { createId } from "./random";

export const STAT_MODES: DrawMode[] = ["range", "custom", "weighted", "expression"];

function emptyBucket(): StatsBucket {
  return { draws: 0, values: {}, faces: {}, tags: {}, resetAt: null };
}

export function createEmptyStats(): StatsState {
  return { version: 2, byMode: Object.fromEntries(STAT_MODES.map((mode) => [mode, emptyBucket()])) as Record<DrawMode, StatsBucket> };
}

function increment(map: Record<string, number>, key: unknown, amount = 1): void {
  const label = String(key);
  setCount(map, label, ownCount(map, label) + amount);
}

function ownCount(map: Record<string, number>, key: string): number {
  return Object.hasOwn(map, key) && Number.isFinite(map[key]) ? map[key] : 0;
}

function setCount(map: Record<string, number>, key: string, value: number): void {
  // Assignment to __proto__ invokes a setter on ordinary objects. Explicitly
  // define a data property so every user supplied label has identical semantics.
  Object.defineProperty(map, key, { value, enumerable: true, configurable: true, writable: true });
}

function normalizeCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return [[key, raw]];
    // Older versions concatenated 1 onto inherited native methods for labels
    // such as constructor and toString. Each trailing 1 represents one hit.
    const inheritedHits = typeof raw === "string" ? /^function [\s\S]*\{\s*\[native code\]\s*\}(1+)$/.exec(raw) : null;
    return inheritedHits ? [[key, inheritedHits[1].length]] : [];
  }));
}

export function createStatsDelta(mode: DrawMode, results: DrawResult[]): StatsDelta {
  const delta: StatsDelta = { mode, draws: results.length, values: {}, faces: {}, tags: {} };
  results.forEach((result) => {
    increment(delta.values, result.total ?? result.value);
    result.faces.forEach((face) => increment(delta.faces, face.value));
    result.tags.forEach((tag) => increment(delta.tags, tag));
  });
  return delta;
}

export function normalizeStatsDelta(value: unknown): StatsDelta | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<StatsDelta>;
  if (!STAT_MODES.includes(source.mode as DrawMode)) return undefined;
  return {
    mode: source.mode as DrawMode,
    draws: typeof source.draws === "number" && Number.isFinite(source.draws) ? Math.max(0, source.draws) : 0,
    values: normalizeCountMap(source.values),
    faces: normalizeCountMap(source.faces),
    tags: normalizeCountMap(source.tags),
  };
}

function applyMap(target: Record<string, number>, delta: Record<string, number>, direction: 1 | -1): void {
  Object.entries(delta).forEach(([key, amount]) => {
    const value = Math.max(0, ownCount(target, key) + amount * direction);
    if (value) setCount(target, key, value); else delete target[key];
  });
}

export function applyStatsDelta(stats: StatsState, delta: StatsDelta, direction: 1 | -1 = 1): StatsState {
  const next = structuredClone(stats);
  const bucket = next.byMode[delta.mode] || emptyBucket();
  bucket.draws = Math.max(0, bucket.draws + delta.draws * direction);
  applyMap(bucket.values, delta.values, direction);
  applyMap(bucket.faces, delta.faces, direction);
  applyMap(bucket.tags, delta.tags, direction);
  next.byMode[delta.mode] = bucket;
  return next;
}

export function resetStats(stats: StatsState, mode: DrawMode): StatsState {
  const next = structuredClone(stats);
  next.byMode[mode] = { ...emptyBucket(), resetAt: new Date().toISOString(), epoch: createId("stats") };
  return next;
}

export function normalizeStats(value: unknown): StatsState {
  const next = createEmptyStats();
  if (!value || typeof value !== "object") return next;
  const source = value as { byMode?: Partial<Record<DrawMode, Partial<StatsBucket>>> };
  STAT_MODES.forEach((mode) => {
    const bucket = source.byMode?.[mode];
    if (!bucket) return;
    next.byMode[mode] = {
      draws: Math.max(0, Number(bucket.draws) || 0),
      values: normalizeCountMap(bucket.values),
      faces: normalizeCountMap(bucket.faces),
      tags: normalizeCountMap(bucket.tags),
      resetAt: typeof bucket.resetAt === "string" ? bucket.resetAt : null,
      ...(typeof bucket.epoch === "string" ? { epoch: bucket.epoch } : {}),
    };
  });
  return next;
}

export function coverageForStats(stats: StatsState, mode: DrawMode, sourceValues: number[]): { seen: number; total: number; pct: number; missing: number[] } {
  const values = [...new Set(sourceValues)];
  const bucket = stats.byMode[mode];
  const missing = values.filter((value) => !(bucket.values[String(value)] > 0));
  const seen = values.length - missing.length;
  return { seen, total: values.length, pct: values.length ? seen / values.length * 100 : 0, missing };
}
