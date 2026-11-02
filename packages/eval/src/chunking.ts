// Chunking strategies under comparison. `article` is lei-chunker's output as is.
// `window` is the usual baseline: fixed-size character windows with overlap,
// cut across the same filtered text (the article chunks of one norm joined in
// order), so both strategies see exactly the same words. Each window records
// every article it overlaps, which is what the metrics score against.

import type { CorpusChunk } from '@rag-property-law-brazil/corpus';
import { fromCorpusChunk, type EvalChunk } from './types';

export type ChunkingStrategy = { kind: 'article' } | { kind: 'window'; size: number; overlap: number };

export function parseStrategy(spec: string): ChunkingStrategy {
  if (spec === 'article') return { kind: 'article' };
  const m = spec.match(/^window:(\d+)(?::(\d+))?$/);
  if (m) {
    const size = Number(m[1]);
    const overlap = Number(m[2] ?? 0);
    if (size < 100 || overlap >= size) throw new Error(`Bad window spec ${spec}: size ≥ 100 and overlap < size`);
    return { kind: 'window', size, overlap };
  }
  throw new Error(`Unknown chunking strategy ${spec} (use "article" or "window:<size>[:<overlap>]")`);
}

export function strategyName(s: ChunkingStrategy): string {
  return s.kind === 'article' ? 'article' : `window:${s.size}:${s.overlap}`;
}

/** Windows over one norm's live (non-revoked) chunks, in document order. */
export function windowChunks(docChunks: CorpusChunk[], size: number, overlap: number): EvalChunk[] {
  const live = docChunks.filter((c) => !c.isRevoked);
  if (live.length === 0) return [];
  const spans: { start: number; end: number; article: string | null }[] = [];
  let text = '';
  for (const c of live) {
    if (text) text += '\n';
    spans.push({ start: text.length, end: text.length + c.content.length, article: c.articleLabel });
    text += c.content;
  }
  const { slug, documentTitle } = live[0];
  const out: EvalChunk[] = [];
  const step = size - overlap;
  for (let start = 0, n = 0; start < text.length; start += step, n++) {
    const end = Math.min(start + size, text.length);
    const articles = [
      ...new Set(
        spans
          .filter((s) => s.article && s.article !== 'ementa' && s.start < end && s.end > start)
          .map((s) => s.article as string),
      ),
    ];
    const content = text.slice(start, end);
    out.push({ id: `${slug}~w${n}`, slug, documentTitle, articles, content, embedText: content, isRevoked: false });
    if (end === text.length) break;
  }
  return out;
}

export function applyStrategy(chunksByDoc: CorpusChunk[][], s: ChunkingStrategy): EvalChunk[] {
  if (s.kind === 'article') return chunksByDoc.flat().map(fromCorpusChunk);
  return chunksByDoc.flatMap((doc) => windowChunks(doc, s.size, s.overlap));
}
