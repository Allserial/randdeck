import type { DiceAstNode, ProbabilityPoint, ProbabilityReport, ProbabilityRequest } from "./types";
import { compareDice, diceNodes, evaluateDiceExpression } from "./dice";
import { drawUnweighted, SeededRandomSource, type RandomSource } from "./random";
import { matchesTagFilter, tagsForValue } from "./tags";
import { drawWeightedEntries } from "./weighted";
import { createRuntimeMessage, runtimeError, type RuntimeMessageParams } from "./runtimeMessage";

export const PROBABILITY_STATE_BUDGET = 250_000;
export const SIMULATION_OPTIONS = [5_000, 20_000, 100_000] as const;

class ExactUnavailable extends Error {
  constructor(code: string, params: RuntimeMessageParams = {}) { super(createRuntimeMessage(code, params)); }
}
class StateBudgetExceeded extends Error {
  constructor(code: string, params: RuntimeMessageParams = {}) { super(createRuntimeMessage(code, params)); }
}

type Distribution = Map<number, number>;

function addProbability(map: Distribution, value: number, probability: number): void {
  map.set(value, (map.get(value) || 0) + probability);
}

function diceOutcome(node: Extract<DiceAstNode, { type: "dice" }>, faces: number[]): number {
  let kept = faces.map((value, index) => ({ value, index, kept: true }));
  if (node.modifiers.keep) {
    const { type, count } = node.modifiers.keep;
    const selected = [...kept].sort((left, right) => type.endsWith("h") ? right.value - left.value : left.value - right.value).slice(0, count).map((item) => item.index);
    kept = kept.map((item) => ({ ...item, kept: type.startsWith("k") ? selected.includes(item.index) : !selected.includes(item.index) }));
  }
  const active = kept.filter((item) => item.kept);
  return node.success ? active.filter((item) => compareDice(item.value, node.success!.operator, node.success!.threshold)).length : active.reduce((sum, item) => sum + item.value, 0);
}

function exactDiceNode(node: Extract<DiceAstNode, { type: "dice" }>, budget: { states: number }): Distribution {
  if (node.modifiers.explode || node.modifiers.reroll) throw new ExactUnavailable("insights.reasons.explodeOrReroll");
  const combinations = node.sides ** node.count;
  if (!Number.isFinite(combinations) || combinations > PROBABILITY_STATE_BUDGET) throw new StateBudgetExceeded("insights.reasons.diceCombinationsBudget");
  const counts = new Map<number, number>();
  const faces: number[] = [];
  const walk = (depth: number) => {
    if (depth === node.count) {
      budget.states += 1; if (budget.states > PROBABILITY_STATE_BUDGET) throw new StateBudgetExceeded("insights.reasons.diceStatesBudget");
      const value = diceOutcome(node, faces); counts.set(value, (counts.get(value) || 0) + 1); return;
    }
    for (let face = 1; face <= node.sides; face += 1) { faces.push(face); walk(depth + 1); faces.pop(); }
  };
  walk(0);
  return new Map([...counts].map(([value, count]) => [value, count / combinations]));
}

function exactAst(node: DiceAstNode, budget: { states: number }): Distribution {
  if (node.type === "number") return new Map([[node.value, 1]]);
  if (node.type === "dice") return exactDiceNode(node, budget);
  if (node.type === "unary") return new Map([...exactAst(node.value, budget)].map(([value, probability]) => [node.operator === "-" ? -value : value, probability]));
  const left = exactAst(node.left, budget); const right = exactAst(node.right, budget); const output: Distribution = new Map();
  for (const [leftValue, leftProbability] of left) for (const [rightValue, rightProbability] of right) {
    budget.states += 1; if (budget.states > PROBABILITY_STATE_BUDGET) throw new StateBudgetExceeded("insights.reasons.expressionStatesBudget");
    if (node.operator === "/" && rightValue === 0) throw runtimeError("errors.divideByZero");
    const value = { "+": leftValue + rightValue, "-": leftValue - rightValue, "*": leftValue * rightValue, "/": leftValue / rightValue }[node.operator];
    if (!Number.isFinite(value)) throw runtimeError("errors.nonFiniteResult");
    addProbability(output, value, leftProbability * rightProbability);
  }
  return output;
}

function weightedWithoutReplacement(request: ProbabilityRequest): ProbabilityPoint[] {
  const entries = request.candidates; const count = Math.min(request.count, entries.length);
  if (count >= entries.length) return entries.map((entry) => ({ value: entry.value, probability: 1 / entries.length, expectedCount: 1 }));
  if (entries.length > 20) throw new StateBudgetExceeded("insights.reasons.weightedCandidatesBudget");
  let states = new Map<number, number>([[0, 1]]);
  for (let draw = 0; draw < count; draw += 1) {
    const next = new Map<number, number>();
    for (const [mask, stateProbability] of states) {
      const total = entries.reduce((sum, entry, index) => sum + ((mask & (1 << index)) ? 0 : entry.weight), 0);
      entries.forEach((entry, index) => {
        if (mask & (1 << index)) return;
        const nextMask = mask | (1 << index);
        next.set(nextMask, (next.get(nextMask) || 0) + stateProbability * entry.weight / total);
      });
    }
    states = next;
    if (states.size > PROBABILITY_STATE_BUDGET) throw new StateBudgetExceeded("insights.reasons.weightedStatesBudget");
  }
  const inclusion = entries.map(() => 0);
  states.forEach((probability, mask) => entries.forEach((_entry, index) => { if (mask & (1 << index)) inclusion[index] += probability; }));
  return entries.map((entry, index) => ({ value: entry.value, probability: inclusion[index] / count, expectedCount: inclusion[index] }));
}

export function analyzeExact(request: ProbabilityRequest): ProbabilityReport {
  if (request.mode === "expression") {
    if (!request.expression) throw runtimeError("errors.probabilityMissingExpression");
    if (request.expression.constrained) throw new ExactUnavailable("insights.reasons.tagConstraint");
    const distribution = exactAst(request.expression.ast, { states: 0 });
    return { method: "exact", reason: createRuntimeMessage("insights.reasons.diceExact"), generatedAt: new Date().toISOString(), points: [...distribution].sort(([left], [right]) => left - right).map(([value, probability]) => ({ value, probability, expectedCount: probability * request.count })) };
  }
  if (!request.candidates.length) throw runtimeError("errors.probabilityNoCandidates");
  if (request.noDup) {
    const allEqual = request.candidates.every((entry) => entry.weight === request.candidates[0].weight);
    if (allEqual) {
      const inclusion = Math.min(request.count, request.candidates.length) / request.candidates.length;
      return { method: "exact", reason: createRuntimeMessage("insights.reasons.uniformWithoutReplacement"), generatedAt: new Date().toISOString(), points: request.candidates.map((entry) => ({ value: entry.value, probability: 1 / request.candidates.length, expectedCount: inclusion })) };
    }
    return { method: "exact", reason: createRuntimeMessage("insights.reasons.weightedWithoutReplacement"), generatedAt: new Date().toISOString(), points: weightedWithoutReplacement(request) };
  }
  const total = request.candidates.reduce((sum, entry) => sum + entry.weight, 0);
  return { method: "exact", reason: createRuntimeMessage(request.mode === "weighted" ? "insights.reasons.normalizedWeight" : "insights.reasons.uniformPool"), generatedAt: new Date().toISOString(), points: request.candidates.map((entry) => ({ value: entry.value, probability: entry.weight / total, expectedCount: entry.weight / total * request.count })) };
}

function expressionBatch(request: ProbabilityRequest, source: RandomSource): number[] {
  const expression = request.expression!; const values: number[] = [];
  for (let index = 0; index < request.count; index += 1) {
    let accepted = false;
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const result = evaluateDiceExpression(expression.ast, source);
      const tags = tagsForValue(result.total, expression.tagRules || []);
      accepted = !expression.constrained || matchesTagFilter(tags, expression.selectedTags || [], expression.combine || "any");
      if (accepted) { values.push(result.total); break; }
    }
    if (!accepted) throw runtimeError("errors.probabilityNoAcceptedResult");
  }
  return values;
}

export async function simulateProbability(
  request: ProbabilityRequest,
  options: { samples: number; seed: number; signal?: AbortSignal; onProgress?: (progress: number) => void },
): Promise<ProbabilityReport> {
  const source = new SeededRandomSource(options.seed); const counts = new Map<number, number>();
  const samples = Math.max(1, Math.trunc(options.samples));
  for (let sample = 0; sample < samples; sample += 1) {
    if (options.signal?.aborted) throw new DOMException("Probability analysis cancelled", "AbortError");
    const values = request.mode === "expression"
      ? expressionBatch(request, source)
      : (request.mode === "weighted" ? drawWeightedEntries(request.candidates, request.count, !request.noDup, source) : drawUnweighted(request.candidates, request.count, !request.noDup, source)).map((entry) => entry.value);
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    if (sample % Math.max(1, Math.floor(samples / 20)) === 0) { options.onProgress?.(sample / samples); await Promise.resolve(); }
  }
  options.onProgress?.(1);
  const totalRolls = samples * request.count;
  const points = [...counts].sort(([left], [right]) => left - right).map(([value, count]) => ({ value, probability: count / totalRolls, expectedCount: count / samples }));
  const uncertainty = points.reduce((max, point) => Math.max(max, 1.96 * Math.sqrt(point.probability * (1 - point.probability) / Math.max(1, totalRolls))), 0);
  return { method: "simulation", reason: createRuntimeMessage("insights.reasons.simulationFallback"), generatedAt: new Date().toISOString(), seed: options.seed >>> 0, samples, uncertainty, points };
}

export async function analyzeProbabilityLocal(
  request: ProbabilityRequest,
  options: { samples?: number; seed?: number; signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<ProbabilityReport> {
  try { return analyzeExact(request); }
  catch (error) {
    if (!(error instanceof ExactUnavailable) && !(error instanceof StateBudgetExceeded)) throw error;
    const seed = options.seed ?? crypto.getRandomValues(new Uint32Array(1))[0];
    const report = await simulateProbability(request, { samples: options.samples ?? 20_000, seed, signal: options.signal, onProgress: options.onProgress });
    report.reason = (error as Error).message;
    return report;
  }
}

export function requiresSimulation(ast: DiceAstNode): boolean {
  return diceNodes(ast).some((node) => Boolean(node.modifiers.explode || node.modifiers.reroll));
}
