import type { AppState, CandidateSpec, DrawPlan, DrawResult, DrawSession, DrawTransaction, PoolEntry, WeightedEntry } from "./types";
import { ALGORITHM_VERSION, asWeighted, buildRangeEntries, clampCount, createId, drawUnweighted, parseExclusionInput, poolFingerprint, type RandomSource } from "./random";
import { parseDiceExpression, evaluateDiceExpression } from "./dice";
import { createStatsDelta } from "./stats";
import { tagsForValue, validateTagRules } from "./tags";
import { drawWeightedEntries, filterWeightedEntries, validateWeightedEntries } from "./weighted";
import { SHUFFLE_ALGORITHM, SHUFFLE_LIMIT, shuffleEntries } from "./shuffle";

export class DrawValidationError extends Error {
  constructor(message: string) { super(message); this.name = "DrawValidationError"; }
}

function candidateFingerprint(state: AppState): string {
  const { settings, pools } = state;
  const modePools = settings.mode === "range" ? pools.rangeTagRules : settings.mode === "custom" ? pools.customEntries : settings.mode === "weighted" ? pools.weightedEntries : pools.expressionTagRules;
  const tagFilter = settings.mode === "custom" ? settings.tagFilter : undefined;
  return poolFingerprint({ mode: settings.mode, min: settings.min, max: settings.max, source: settings.expression.source, excludeInput: settings.excludeInput, tagFilter, modePools });
}

function enrichTags(entries: PoolEntry[], state: AppState): PoolEntry[] {
  if (state.settings.mode !== "range") return entries;
  return entries.map((entry) => ({ ...entry, tags: tagsForValue(entry.value, state.pools.rangeTagRules) }));
}

function candidateSpec(state: AppState, entries: WeightedEntry[]): CandidateSpec {
  const selectedTags = state.settings.mode === "custom" ? state.settings.tagFilter.selectedTags : [];
  const base: CandidateSpec = { mode: state.settings.mode, exclusions: state.settings.excludeInput, selectedTags, tagCombine: state.settings.tagFilter.combine };
  if (state.settings.mode === "range") base.range = { min: Math.min(state.settings.min, state.settings.max), max: Math.max(state.settings.min, state.settings.max) };
  else if (state.settings.mode === "expression") base.expression = state.settings.expression.source;
  else base.entries = entries.map((entry) => ({ value: entry.value, weight: state.settings.mode === "weighted" ? entry.weight : undefined, tags: entry.tags }));
  return base;
}

export function prepareDraw(state: AppState): DrawPlan {
  const fingerprint = candidateFingerprint(state);
  const used = state.settings.noDup && state.drawState.poolFingerprint === fingerprint ? new Set(state.drawState.usedValues) : new Set<number>();
  const configSnapshot = structuredClone(state.settings);
  const poolsSnapshot = structuredClone(state.pools);
  if (state.settings.mode === "expression") {
    const ruleError = validateTagRules(state.pools.expressionTagRules);
    if (ruleError) throw new DrawValidationError(ruleError);
    const expressionAst = parseDiceExpression(state.settings.expression.source);
    const count = state.settings.expression.evaluation === "single" ? 1 : clampCount(state.settings.count, 50);
    return { mode: "expression", count, configSnapshot, poolsSnapshot, poolFingerprint: fingerprint, sourceCount: 0, candidateEntries: [], candidateSpec: candidateSpec(state, []), expressionAst, presetId: state.drawState.activePresetId, operationKind: "draw" };
  }

  const excluded = parseExclusionInput(state.settings.excludeInput);
  if (excluded.invalidTokens.length) throw new DrawValidationError(`排除项包含无效内容：${excluded.invalidTokens.join("、")}`);
  let sourceEntries: WeightedEntry[];
  if (state.settings.mode === "range") {
    const ruleError = validateTagRules(state.pools.rangeTagRules);
    if (ruleError) throw new DrawValidationError(ruleError);
    const range = buildRangeEntries(Number(state.settings.min), Number(state.settings.max));
    if (range.error) throw new DrawValidationError(range.error);
    sourceEntries = asWeighted(enrichTags(range.entries, state));
  } else if (state.settings.mode === "custom") {
    if (!state.pools.customEntries.length) throw new DrawValidationError("请至少添加一个自定义数字");
    sourceEntries = asWeighted(state.pools.customEntries);
  } else {
    const validation = validateWeightedEntries(state.pools.weightedEntries);
    if (validation.errors.length) throw new DrawValidationError(validation.errors[0]);
    sourceEntries = validation.entries;
  }
  const selectedTags = state.settings.mode === "custom" ? state.settings.tagFilter.selectedTags : [];
  const candidates = filterWeightedEntries(sourceEntries, { selectedTags, combine: state.settings.tagFilter.combine, exclusions: excluded.tokens, used });
  if (!candidates.length) throw new DrawValidationError(state.settings.noDup && used.size ? "抽后移除池已经耗尽，请重置池" : "当前没有可抽取数字");
  const count = clampCount(state.settings.count, state.settings.noDup ? candidates.length : 50);
  if (state.settings.noDup && state.settings.count > candidates.length) throw new DrawValidationError(`可用数字不足，当前最多只能抽取 ${candidates.length} 个`);
  return { mode: state.settings.mode, count, configSnapshot, poolsSnapshot, poolFingerprint: fingerprint, sourceCount: sourceEntries.length, candidateEntries: candidates, candidateSpec: candidateSpec(state, sourceEntries), presetId: state.drawState.activePresetId, operationKind: "draw" };
}

export function prepareShuffle(state: AppState): DrawPlan {
  if (state.settings.mode === "expression") throw new DrawValidationError("骰子表达式不能列出全部顺序，请改用范围、自定义或加权池");
  const plan = prepareDraw(state);
  if (plan.candidateEntries.length > SHUFFLE_LIMIT) throw new DrawValidationError(`候选超过 ${SHUFFLE_LIMIT} 个，请缩小范围后再列出全部顺序`);
  return { ...plan, count: plan.candidateEntries.length, operationKind: "shuffle" };
}

export function executeDraw(plan: DrawPlan, source: RandomSource, session?: DrawSession | null): DrawTransaction {
  const results: DrawResult[] = [];
  const isShuffle = plan.operationKind === "shuffle";
  if (plan.mode === "expression") {
    if (!plan.expressionAst) throw new Error("骰子表达式尚未解析");
    for (let index = 0; index < plan.count; index += 1) {
      const evaluated = evaluateDiceExpression(plan.expressionAst, source);
      const tags = tagsForValue(evaluated.total, plan.poolsSnapshot.expressionTagRules);
      results.push({ value: evaluated.total, total: evaluated.total, faces: evaluated.faces, trace: evaluated.trace, tags });
    }
  } else {
    const selected = isShuffle
      ? shuffleEntries(plan.candidateEntries, source)
      : plan.mode === "weighted"
        ? drawWeightedEntries(plan.candidateEntries, plan.count, !plan.configSnapshot.noDup, source)
        : drawUnweighted(plan.candidateEntries, plan.count, !plan.configSnapshot.noDup, source);
    selected.forEach((entry) => results.push({ value: entry.value, total: entry.value, faces: [], tags: entry.tags }));
  }
  if (!results.length) throw new DrawValidationError("当前没有可抽取数字");
  const id = createId("draw");
  return {
    id, createdAt: new Date().toISOString(), mode: plan.mode, configSnapshot: plan.configSnapshot, poolsSnapshot: plan.poolsSnapshot,
    poolFingerprint: plan.poolFingerprint, candidateCount: plan.candidateEntries.length || plan.sourceCount, candidateSpec: plan.candidateSpec,
    results, operation: { kind: isShuffle ? "shuffle" : "draw" }, statsDelta: createStatsDelta(plan.mode, results),
    usedAdded: plan.configSnapshot.noDup && plan.mode !== "expression" ? [...new Set(results.map((result) => result.value))] : [],
    algorithmVersion: isShuffle ? SHUFFLE_ALGORITHM : ALGORITHM_VERSION,
    session: session ? { id: session.id, name: session.name, round: session.roundCount + 1 } : undefined, presetId: plan.presetId || undefined,
  };
}

export function getPoolStatus(state: AppState): { sourceCount: number; candidateCount: number; usedCount: number; exclusionHits: number; error: string } {
  try {
    const plan = prepareDraw({ ...state, settings: { ...state.settings, count: 1 } });
    const usedCount = state.drawState.poolFingerprint === plan.poolFingerprint ? state.drawState.usedValues.length : 0;
    const exclusions = parseExclusionInput(state.settings.excludeInput).tokens;
    const values = plan.candidateSpec.entries?.map((entry) => entry.value) ?? (plan.candidateSpec.range ? Array.from({ length: Math.min(plan.sourceCount, 1_000_000) }, (_, index) => plan.candidateSpec.range!.min + index) : []);
    const hitCount = values.filter((value) => exclusions.some((token) => token.kind === "integer" ? value === token.value : token.kind === "range" ? value >= token.min && value <= token.max : token.kind === "odd" ? Math.abs(value % 2) === 1 : value % 2 === 0)).length;
    return { sourceCount: plan.sourceCount, candidateCount: plan.candidateEntries.length, usedCount, exclusionHits: hitCount, error: "" };
  } catch (error) { return { sourceCount: 0, candidateCount: 0, usedCount: 0, exclusionHits: 0, error: (error as Error).message }; }
}
