// The production fusion rule: Reciprocal Rank Fusion (k = 60) over the
// lexical and vector candidate lists, then +1 for every exact-reference hit so
// those always rank first. Each component retrieves `candidates` items.

import type { EvalChunk, Retriever, ScoredChunk } from '../types';

export function fuseRrf(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return scores;
}

export interface HybridOptions {
  exact?: Retriever;
  /** Retrievers fused by RRF (lexical, vector, …). */
  ranked: Retriever[];
  candidates?: number;
  rrfK?: number;
  name?: string;
}

export function hybridRetriever(opts: HybridOptions): Retriever {
  const candidates = opts.candidates ?? 20;
  const name = opts.name ?? [...(opts.exact ? ['exact'] : []), ...opts.ranked.map((r) => r.name)].join('+');
  return {
    name,
    async retrieve(question, k) {
      const exact = opts.exact ? await opts.exact.retrieve(question, k) : [];
      const lists = await Promise.all(opts.ranked.map((r) => r.retrieve(question, candidates)));
      const byId = new Map<string, EvalChunk>();
      for (const s of [...exact, ...lists.flat()]) byId.set(s.chunk.id, s.chunk);
      const scores = fuseRrf(
        lists.map((l) => l.map((s) => s.chunk.id)),
        opts.rrfK,
      );
      for (const s of exact) scores.set(s.chunk.id, (scores.get(s.chunk.id) ?? 0) + 1);
      return [...scores.entries()]
        .sort((a, z) => z[1] - a[1])
        .slice(0, k)
        .map(([id, score]): ScoredChunk => ({ chunk: byId.get(id)!, score }));
    },
  };
}
