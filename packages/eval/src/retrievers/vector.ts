// Dense retrieval: cosine similarity between the question embedding and each
// chunk's embedText. Embeddings come from an injected Embedder and are cached
// on disk by (model, task, sha256(text)), so re-running the eval after a
// golden-set change costs only the new questions.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EvalChunk, Retriever } from '../types';

export type EmbedTask = 'document' | 'query';

export interface Embedder {
  /** Identifies the model and dimensions in the cache key ("gemini-embedding-001@768"). */
  id: string;
  embed(texts: string[], task: EmbedTask): Promise<number[][]>;
}

export function cachedEmbedder(inner: Embedder, cacheDir: string): Embedder {
  return {
    id: inner.id,
    async embed(texts, task) {
      const dir = path.join(cacheDir, inner.id.replace(/[^\w.@-]/g, '_'), task);
      mkdirSync(dir, { recursive: true });
      const files = texts.map((t) => path.join(dir, `${createHash('sha256').update(t).digest('hex')}.json`));
      const out: (number[] | null)[] = files.map((f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null));
      const todo = out.flatMap((v, i) => (v ? [] : [i]));
      if (todo.length) {
        const fresh = await inner.embed(
          todo.map((i) => texts[i]),
          task,
        );
        todo.forEach((i, j) => {
          out[i] = fresh[j];
          writeFileSync(files[i], JSON.stringify(fresh[j]));
        });
      }
      return out as number[][];
    },
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : 0;
}

export async function vectorRetriever(chunks: EvalChunk[], embedder: Embedder): Promise<Retriever> {
  const docs = chunks.filter((c) => !c.isRevoked);
  const vectors = await embedder.embed(
    docs.map((c) => c.embedText),
    'document',
  );
  return {
    name: 'vector',
    async retrieve(question, k) {
      const [q] = await embedder.embed([question], 'query');
      return docs
        .map((chunk, i) => ({ chunk, score: cosine(q, vectors[i]) }))
        .sort((a, z) => z.score - a.score)
        .slice(0, k);
    },
  };
}
