import type { DrawMode, DrawSettings, DrawTransaction, HistoryEntry, PoolsState } from "../domain/types";
import { MAX_RANGE_SIZE, parseExclusionInput } from "../domain/random";
import { parseDiceExpression } from "../domain/dice";
import { validateTagRules } from "../domain/tags";

export interface ResultPresentationContext {
  transactionId: string | null;
  mode: DrawMode;
  config: DrawSettings;
  pinScopeKey: string | null;
  historical: boolean;
}

// This key is presentation-only; never use it for randomness or the used-value pool.
export function getPinScopeKey(settings: DrawSettings, pools: PoolsState): string | null {
  const filter = { ...settings.tagFilter, selectedTags: [...settings.tagFilter.selectedTags].sort() };
  const excluded = parseExclusionInput(settings.excludeInput);
  if (settings.mode !== "expression" && excluded.invalidTokens.length) return null;
  if (settings.mode === "range" && (!Number.isSafeInteger(settings.min) || !Number.isSafeInteger(settings.max)
    || Math.abs(settings.max - settings.min) + 1 > MAX_RANGE_SIZE || validateTagRules(pools.rangeTagRules))) return null;
  if (settings.mode === "expression") {
    try { parseDiceExpression(settings.expression.source); } catch { return null; }
    if (validateTagRules(pools.expressionTagRules)) return null;
  }
  const tokens = excluded.tokens.map(token => token.kind === "integer" ? `i:${token.value}` : token.kind === "range" ? `r:${token.min}:${token.max}` : token.kind).sort();
  const source = settings.mode === "range"
    ? [settings.min, settings.max, pools.rangeTagRules]
    : settings.mode === "custom" ? [pools.customEntries.map(({ value, tags }) => ({ value, tags })), filter]
      : settings.mode === "weighted" ? [pools.weightedEntries.map(({ value, weight, tags }) => ({ value, weight, tags })), filter]
        : [settings.expression, pools.expressionTagRules];
  return JSON.stringify([settings.mode, source, settings.noDup, tokens, [...excluded.invalidTokens].sort()]);
}

export function pinConfigurationChanged(context: ResultPresentationContext | null, previousSettings: DrawSettings, settings: DrawSettings, pools: PoolsState): boolean {
  if (previousSettings.mode !== settings.mode) return true;
  const nextKey = getPinScopeKey(settings, pools);
  return nextKey !== null && context?.pinScopeKey != null && nextKey !== context.pinScopeKey;
}

export function transactionPresentation(transaction: DrawTransaction): ResultPresentationContext {
  return { transactionId: transaction.id, mode: transaction.mode, config: structuredClone(transaction.configSnapshot),
    pinScopeKey: getPinScopeKey(transaction.configSnapshot, transaction.poolsSnapshot), historical: false };
}

export function historyPresentation(entry?: HistoryEntry): ResultPresentationContext | null {
  // History does not carry a full pools snapshot. Do not invent compatibility.
  return entry ? { transactionId: entry.transactionId ?? null, mode: entry.mode,
    config: structuredClone(entry.config), pinScopeKey: null, historical: true } : null;
}
