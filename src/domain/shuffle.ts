import type { WeightedEntry } from "./types";
import { drawUnweighted, type RandomSource } from "./random";

export const SHUFFLE_LIMIT = 200;
export const SHUFFLE_ALGORITHM = "webcrypto-fisher-yates-v1" as const;

export function shuffleEntries(entries: WeightedEntry[], source: RandomSource): WeightedEntry[] {
  return drawUnweighted(entries, entries.length, false, source);
}
