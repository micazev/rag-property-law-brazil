// CLI: chunk the fetched corpus, validate the golden set against it, run every
// (retriever × chunking) pair and print Markdown tables. Full per-question
// results go to results/<timestamp>.json.
//
//   pnpm --filter @rag-property-law-brazil/eval eval
//   pnpm --filter @rag-property-law-brazil/eval eval -- --chunking article,window:1500:300 --k 1,5,10
//   GEMINI_API_KEY=… pnpm --filter @rag-property-law-brazil/eval eval -- --retrievers exact,lexical,vector,hybrid
//
// Retrievers: exact | lexical | vector | exact+lexical | hybrid (exact + RRF(lexical, vector), the production rule).
// vector and hybrid need GEMINI_API_KEY; without it they are skipped with a notice.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chunkDocument, DEFAULT_DATA_DIR, loadDocuments, NORMS } from '@rag-property-law-brazil/corpus';
import { applyStrategy, parseStrategy, strategyName } from './chunking';
import { geminiEmbedder } from './embedders/gemini';
import { byTypeMarkdown, evaluate, toMarkdown, type RunResult } from './evaluate';
import { missingGold, parseGold } from './gold';
import { exactRetriever } from './retrievers/exact';
import { hybridRetriever } from './retrievers/hybrid';
import { lexicalRetriever } from './retrievers/lexical';
import { cachedEmbedder, vectorRetriever, type Embedder } from './retrievers/vector';
import type { EvalChunk, Retriever } from './types';

const PKG = path.resolve(import.meta.dirname, '..');

const { values } = parseArgs({
  options: {
    gold: { type: 'string', default: path.join(PKG, 'gold/questions.jsonl') },
    data: { type: 'string', default: DEFAULT_DATA_DIR },
    retrievers: { type: 'string', default: 'exact,lexical,exact+lexical,vector,hybrid' },
    chunking: { type: 'string', default: 'article,window:1000:200,window:2000:400' },
    k: { type: 'string', default: '1,5,10' },
    'reviewed-only': { type: 'boolean', default: false },
    out: { type: 'string', default: path.join(PKG, 'results') },
  },
  allowPositionals: true,
});

async function buildRetriever(name: string, chunks: EvalChunk[], embedder: Embedder | null): Promise<Retriever | null> {
  const aliases = NORMS.map((n) => ({ slug: n.slug, aliases: n.aliases }));
  switch (name) {
    case 'exact':
      return exactRetriever(chunks, aliases);
    case 'lexical':
      return lexicalRetriever(chunks);
    case 'exact+lexical':
      return hybridRetriever({ exact: exactRetriever(chunks, aliases), ranked: [lexicalRetriever(chunks)] });
    case 'vector':
      return embedder ? vectorRetriever(chunks, embedder) : null;
    case 'hybrid':
      return embedder
        ? hybridRetriever({
            name: 'hybrid',
            exact: exactRetriever(chunks, aliases),
            ranked: [lexicalRetriever(chunks), await vectorRetriever(chunks, embedder)],
          })
        : null;
    default:
      throw new Error(`Unknown retriever ${name}`);
  }
}

async function main() {
  const { documents, missing } = loadDocuments(values.data);
  if (documents.length === 0) {
    throw new Error(`No corpus texts in ${values.data}/text. Run: pnpm --filter @rag-property-law-brazil/corpus fetch`);
  }
  if (missing.length) console.warn(`Not fetched (left out): ${missing.join(', ')}`);
  const byDoc = documents.map((d) => chunkDocument(d));

  let items = parseGold(readFileSync(values.gold, 'utf8'));
  if (values['reviewed-only']) items = items.filter((i) => i.status === 'reviewed');
  const fetched = new Set(documents.map((d) => d.norm.slug));
  const skipped = items.filter((i) => i.gold.some((g) => !fetched.has(g.norm)));
  if (skipped.length) console.warn(`${skipped.length} question(s) cite norms not fetched; skipped.`);
  items = items.filter((i) => !skipped.includes(i));

  const articleChunks = applyStrategy(byDoc, { kind: 'article' });
  const bad = missingGold(items, articleChunks);
  if (bad.length) {
    throw new Error(`Gold articles not found in the chunked corpus:\n  ${bad.join('\n  ')}`);
  }

  const key = process.env.GEMINI_API_KEY;
  const embedder = key ? cachedEmbedder(geminiEmbedder({ apiKey: key }), path.join(PKG, '.cache/embeddings')) : null;
  const ks = values.k.split(',').map(Number).filter((n) => n > 0);
  const runs: RunResult[] = [];
  const notices = new Set<string>();

  for (const spec of values.chunking.split(',')) {
    const strategy = parseStrategy(spec.trim());
    const chunks = applyStrategy(byDoc, strategy);
    for (const name of values.retrievers.split(',').map((s) => s.trim())) {
      if (name === 'exact' && strategy.kind === 'window') continue; // label lookup is meaningless over windows
      const retriever = await buildRetriever(name, chunks, embedder);
      if (!retriever) {
        notices.add(`${name}: skipped (GEMINI_API_KEY not set)`);
        continue;
      }
      runs.push(await evaluate({ retriever, chunking: strategyName(strategy), chunks, items, ks }));
    }
  }

  const answerable = items.filter((i) => i.type !== 'unanswerable' && i.type !== 'out_of_scope').length;
  console.log(`\n${answerable} answerable questions (${items.filter((i) => i.status === 'reviewed').length} reviewed), ${documents.length} norms\n`);
  console.log(toMarkdown(runs));
  console.log(`\n${byTypeMarkdown(runs, ks.includes(5) ? 5 : ks[ks.length - 1])}\n`);
  for (const n of notices) console.log(n);

  mkdirSync(values.out, { recursive: true });
  const file = path.join(values.out, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ gold: values.gold, ks, runs }, null, 2));
  console.log(`\nPer-question results: ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
