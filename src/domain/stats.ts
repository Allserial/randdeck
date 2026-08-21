import type { DrawMode, DrawResult, StatsBucket, StatsDelta, StatsState } from "./types";

export const STAT_MODES: DrawMode[] = ["range", "custom", "weighted", "expression"];

function emptyBucket(): StatsBucket {
  return { draws: 0, values: {}, faces: {}, tags: {}, resetAt: null };
}

export function createEmptyStats(): StatsState {
  return { version: 2, byMode: Object.fromEntries(STAT_MODES.map((mode) => [mode, emptyBucket()])) as Record<DrawMode, StatsBucket> };
}

function increment(map: Record<string, number>, key: unknown, amount = 1): void {
  const label = String(key);
  map[label] = (map[label] || 0) + amount;
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

function applyMap(target: Record<string, number>, delta: Record<string, number>, direction: 1 | -1): void {
  Object.entries(delta).forEach(([key, amount]) => {
    const value = Math.max(0, (target[key] || 0) + amount * direction);
    if (value) target[key] = value; else delete target[key];
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
  next.byMode[mode] = { ...emptyBucket(), resetAt: new Date().toISOString() };
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
      values: bucket.values && typeof bucket.values === "object" ? { ...bucket.values } : {},
      faces: bucket.faces && typeof bucket.faces === "object" ? { ...bucket.faces } : {},
      tags: bucket.tags && typeof bucket.tags === "object" ? { ...bucket.tags } : {},
      resetAt: typeof bucket.resetAt === "string" ? bucket.resetAt : null,
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
