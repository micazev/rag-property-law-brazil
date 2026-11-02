// Runs every answerable golden question through one retriever over one
// chunking, and aggregates per question type. Unanswerable and out-of-scope
// questions are not scored here: whether the system declines them is decided
// by the answer step's gates, which this package does not run yet.

import { firstRanks, mean, ndcgAt, reciprocalRank, recallAt } from './metrics';
import type { EvalChunk, GoldItem, QuestionType, Retriever } from './types';

export interface QuestionResult {
  id: string;
  type: QuestionType;
  /** First covering rank per gold ref, in gold order; null = not in the top `depth`. */
  ranks: (number | null)[];
  /** Characters of retrieved text in the top k, per k: the context an answer step would read. */
  charsAt: Record<number, number>;
  top: { id: string; articles: string[]; score: number }[];
}

export interface Aggregate {
  n: number;
  recallAt: Record<number, number>;
  mrr: number;
  ndcgAt: Record<number, number>;
  charsAt: Record<number, number>;
}

export interface RunResult {
  retriever: string;
  chunking: string;
  chunks: number;
  ks: number[];
  overall: Aggregate;
  byType: Partial<Record<QuestionType, Aggregate>>;
  questions: QuestionResult[];
}

export function isAnswerable(item: GoldItem): boolean {
  return item.type !== 'unanswerable' && item.type !== 'out_of_scope';
}

function aggregate(results: QuestionResult[], ks: number[]): Aggregate {
  const per = (f: (r: QuestionResult) => number) => mean(results.map(f));
  return {
    n: results.length,
    recallAt: Object.fromEntries(ks.map((k) => [k, per((r) => recallAt(r.ranks, k))])),
    mrr: per((r) => reciprocalRank(r.ranks)),
    ndcgAt: Object.fromEntries(ks.map((k) => [k, per((r) => ndcgAt(r.ranks, k))])),
    charsAt: Object.fromEntries(ks.map((k) => [k, per((r) => r.charsAt[k])])),
  };
}

export async function evaluate(opts: {
  retriever: Retriever;
  chunking: string;
  chunks: EvalChunk[];
  items: GoldItem[];
  ks: number[];
}): Promise<RunResult> {
  const ks = [...opts.ks].sort((a, b) => a - b);
  const depth = ks[ks.length - 1];
  const questions: QuestionResult[] = [];
  for (const item of opts.items.filter(isAnswerable)) {
    const hits = await opts.retriever.retrieve(item.question, depth);
    const ranked = hits.map((h) => h.chunk);
    questions.push({
      id: item.id,
      type: item.type,
      ranks: firstRanks(ranked, item.gold),
      charsAt: Object.fromEntries(ks.map((k) => [k, ranked.slice(0, k).reduce((s, c) => s + c.content.length, 0)])),
      top: hits.map((h) => ({ id: h.chunk.id, articles: h.chunk.articles, score: h.score })),
    });
  }
  const types = [...new Set(questions.map((q) => q.type))];
  return {
    retriever: opts.retriever.name,
    chunking: opts.chunking,
    chunks: opts.chunks.length,
    ks,
    overall: aggregate(questions, ks),
    byType: Object.fromEntries(types.map((t) => [t, aggregate(questions.filter((q) => q.type === t), ks)])),
    questions,
  };
}

const pct = (x: number) => (x * 100).toFixed(1);

/** One Markdown row per run: the table a README can paste. */
export function toMarkdown(runs: RunResult[]): string {
  if (runs.length === 0) return '';
  const ks = runs[0].ks;
  const head = [
    'Retriever',
    'Chunking',
    'n',
    ...ks.map((k) => `Recall@${k}`),
    'MRR',
    ...ks.map((k) => `nDCG@${k}`),
    `Chars@${ks[ks.length - 1]}`,
  ];
  const rows = runs.map((r) => [
    r.retriever,
    r.chunking,
    String(r.overall.n),
    ...ks.map((k) => pct(r.overall.recallAt[k])),
    pct(r.overall.mrr),
    ...ks.map((k) => pct(r.overall.ndcgAt[k])),
    Math.round(r.overall.charsAt[ks[ks.length - 1]]).toLocaleString('en-US'),
  ]);
  return [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

/** Recall@k per question type, one row per run. */
export function byTypeMarkdown(runs: RunResult[], k: number): string {
  const types: QuestionType[] = ['reference', 'paraphrase', 'multi'];
  const head = ['Retriever', 'Chunking', ...types.map((t) => `${t} R@${k}`)];
  const rows = runs.map((r) => [
    r.retriever,
    r.chunking,
    ...types.map((t) => {
      const a = r.byType[t];
      return a ? `${pct(a.recallAt[k])} (n=${a.n})` : '—';
    }),
  ]);
  return [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}
