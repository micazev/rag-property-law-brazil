// The golden set: JSONL, one GoldItem per line. Loading normalizes article
// labels ("1.245" → "1245") and rejects malformed lines with their line number;
// validation then checks every gold article exists in the chunked corpus, so a
// typo or an article cut out by a manifest filter fails loudly instead of
// silently scoring as a retrieval miss.

import { normalizeArticleLabel } from '@rag-property-law-brazil/lei-chunker';
import type { EvalChunk, GoldItem, QuestionType } from './types';

const TYPES: QuestionType[] = ['reference', 'paraphrase', 'multi', 'unanswerable', 'out_of_scope'];

export function parseGold(jsonl: string): GoldItem[] {
  const items: GoldItem[] = [];
  const ids = new Set<string>();
  jsonl.split('\n').forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('//')) return;
    const where = `gold line ${i + 1}`;
    let v: Record<string, unknown>;
    try {
      v = JSON.parse(line);
    } catch {
      throw new Error(`${where}: invalid JSON`);
    }
    if (typeof v.id !== 'string' || !v.id) throw new Error(`${where}: missing id`);
    if (ids.has(v.id)) throw new Error(`${where}: duplicate id ${v.id}`);
    ids.add(v.id);
    if (typeof v.question !== 'string' || !v.question.trim()) throw new Error(`${where}: missing question`);
    if (!TYPES.includes(v.type as QuestionType)) throw new Error(`${where}: type must be one of ${TYPES.join(', ')}`);
    const type = v.type as QuestionType;
    if (!Array.isArray(v.gold)) throw new Error(`${where}: gold must be a list`);
    const gold = v.gold.map((g: unknown) => {
      const r = g as Record<string, unknown>;
      const label = typeof r?.article === 'string' ? normalizeArticleLabel(r.article) : null;
      if (typeof r?.norm !== 'string' || !label) throw new Error(`${where}: bad gold ref ${JSON.stringify(g)}`);
      return { norm: r.norm, article: label };
    });
    const answerable = type !== 'unanswerable' && type !== 'out_of_scope';
    if (answerable && gold.length === 0) throw new Error(`${where}: ${type} question needs at least one gold article`);
    if (!answerable && gold.length > 0) throw new Error(`${where}: ${type} question must have no gold articles`);
    if (type === 'multi' && gold.length < 2) throw new Error(`${where}: multi question needs two or more gold articles`);
    const status = v.status === 'reviewed' ? 'reviewed' : 'draft';
    items.push({ id: v.id, question: v.question, type, gold, status, note: typeof v.note === 'string' ? v.note : undefined });
  });
  return items;
}

/** Gold refs that no chunk covers, as "id: norm art. X". Empty means the set is consistent with the corpus. */
export function missingGold(items: GoldItem[], chunks: EvalChunk[]): string[] {
  const covered = new Set<string>();
  for (const c of chunks) for (const a of c.articles) covered.add(`${c.slug}|${a}`);
  const out: string[] = [];
  for (const item of items) {
    for (const g of item.gold) {
      if (!covered.has(`${g.norm}|${g.article}`)) out.push(`${item.id}: ${g.norm} art. ${g.article}`);
    }
  }
  return out;
}
