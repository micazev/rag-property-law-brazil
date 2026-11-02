// Gemini embeddings over REST, as in production: gemini-embedding-001
// truncated to 768 dimensions and re-normalized, RETRIEVAL_DOCUMENT /
// RETRIEVAL_QUERY task types. Needs GEMINI_API_KEY.

import type { Embedder } from '../retrievers/vector';

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? v.map((x) => x / norm) : v;
}

export function geminiEmbedder(opts: { apiKey: string; model?: string; dimensions?: number }): Embedder {
  const model = opts.model ?? 'gemini-embedding-001';
  const dims = opts.dimensions ?? 768;

  async function batch(texts: string[], taskType: string): Promise<number[][]> {
    const body = JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: dims,
      })),
    });
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body,
      });
      if (res.ok) {
        const data = (await res.json()) as { embeddings?: { values: number[] }[] };
        const out = data.embeddings?.map((e) => e.values) ?? [];
        if (out.length !== texts.length || out.some((v) => v.length !== dims)) {
          throw new Error(`Embedding response shape mismatch (${out.length}/${texts.length})`);
        }
        return out.map(normalize);
      }
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt >= MAX_RETRIES) {
        throw new Error(`Gemini embeddings failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      }
      await sleep(1000 * 2 ** attempt);
    }
  }

  return {
    id: `${model}@${dims}`,
    async embed(texts, task) {
      const taskType = task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) out.push(...(await batch(texts.slice(i, i + BATCH_SIZE), taskType)));
      return out;
    },
  };
}
