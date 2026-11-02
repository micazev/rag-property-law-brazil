// Retrieval metrics with articles as the unit of relevance. A gold article is
// found at the rank of the FIRST retrieved chunk that covers it; later chunks
// covering the same article (the other parts of a split article, overlapping
// windows) add nothing. That keeps article chunks and fixed windows comparable:
// both are judged on which articles reach the top k, not on how many chunks
// mention them.

import type { EvalChunk, GoldRef } from './types';

/** 1-based rank at which each gold ref is first covered; null when it never is. */
export function firstRanks(ranked: EvalChunk[], gold: GoldRef[]): (number | null)[] {
  return gold.map((g) => {
    const i = ranked.findIndex((c) => c.slug === g.norm && c.articles.includes(g.article));
    return i === -1 ? null : i + 1;
  });
}

export function recallAt(ranks: (number | null)[], k: number): number {
  if (ranks.length === 0) return 0;
  return ranks.filter((r) => r !== null && r <= k).length / ranks.length;
}

/** Reciprocal rank of the first chunk covering any gold ref. */
export function reciprocalRank(ranks: (number | null)[]): number {
  const found = ranks.filter((r): r is number => r !== null);
  return found.length ? 1 / Math.min(...found) : 0;
}

/** Binary-relevance nDCG@k, one gain per gold ref at its first covering rank. */
export function ndcgAt(ranks: (number | null)[], k: number): number {
  if (ranks.length === 0) return 0;
  const dcg = ranks.reduce<number>((s, r) => (r !== null && r <= k ? s + 1 / Math.log2(r + 1) : s), 0);
  let ideal = 0;
  for (let i = 1; i <= Math.min(ranks.length, k); i++) ideal += 1 / Math.log2(i + 1);
  return ideal > 0 ? dcg / ideal : 0;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
