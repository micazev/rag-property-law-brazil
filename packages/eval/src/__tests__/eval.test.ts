import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chunkDocument, type NormEntry } from '@rag-property-law-brazil/corpus';
import { applyStrategy, parseStrategy, windowChunks } from '../chunking';
import { evaluate, toMarkdown } from '../evaluate';
import { missingGold, parseGold } from '../gold';
import { firstRanks, ndcgAt, recallAt, reciprocalRank } from '../metrics';
import { exactRetriever, parseQuery } from '../retrievers/exact';
import { fuseRrf, hybridRetriever } from '../retrievers/hybrid';
import { lexicalRetriever, tokenize } from '../retrievers/lexical';
import { cachedEmbedder, vectorRetriever, type Embedder } from '../retrievers/vector';
import type { EvalChunk, Retriever } from '../types';

// Synthetic norms in the shape of a Planalto text, so the tests do not depend on fetched data.
const LEI_A: NormEntry = {
  slug: 'lei-a',
  title: 'Lei A',
  sourceUrl: 'https://example.invalid/a',
  aliases: ['Lei A', 'LA'],
  filter: { all: true },
};
const LEI_B: NormEntry = { ...LEI_A, slug: 'lei-b', title: 'Lei B', aliases: ['Lei B'] };

const TEXT_A = [
  'LEI A, DE 1 DE JANEIRO DE 2000.',
  'Dispõe sobre o registro de imóveis.',
  'CAPÍTULO I',
  'DO REGISTRO',
  'Art. 1º A propriedade imóvel se transfere pelo registro do título translativo no cartório de registro de imóveis.',
  'Parágrafo único. Enquanto não se registrar o título, o alienante continua a ser havido como dono do imóvel.',
  'Art. 2º A penhora de imóvel será averbada na matrícula para presunção absoluta de conhecimento por terceiros.',
  'Art. 3º (Revogado).',
  'Art. 4º O condomínio edilício será instituído por ato registrado no cartório competente.',
].join('\n');
const TEXT_B = [
  'LEI B, DE 2 DE FEVEREIRO DE 2001.',
  'Dispõe sobre a locação.',
  'Art. 1º O locatário tem preferência para adquirir o imóvel locado em caso de venda, em igualdade de condições com terceiros.',
  'Art. 2º O aluguel será livremente convencionado entre as partes.',
].join('\n');

const byDoc = [chunkDocument({ norm: LEI_A, text: TEXT_A }), chunkDocument({ norm: LEI_B, text: TEXT_B })];
const articleChunks = applyStrategy(byDoc, { kind: 'article' });
const aliases = [LEI_A, LEI_B].map((n) => ({ slug: n.slug, aliases: n.aliases }));
const ids = (hits: { chunk: EvalChunk }[]) => hits.map((h) => h.chunk.id);
const chunkFor = (slug: string, article: string) =>
  articleChunks.find((c) => c.slug === slug && c.articles.includes(article))!;

describe('parseGold', () => {
  it('normalizes article labels and defaults status to draft', () => {
    const [item] = parseGold('{"id":"q1","question":"?","type":"reference","gold":[{"norm":"lei-a","article":"1.245"}]}');
    expect(item.gold).toEqual([{ norm: 'lei-a', article: '1245' }]);
    expect(item.status).toBe('draft');
  });

  it('skips blank and // comment lines', () => {
    expect(parseGold('// header\n\n{"id":"q1","question":"?","type":"out_of_scope","gold":[]}')).toHaveLength(1);
  });

  it.each([
    ['{"id":"q1","question":"?","type":"reference","gold":[]}', 'needs at least one gold article'],
    ['{"id":"q1","question":"?","type":"unanswerable","gold":[{"norm":"lei-a","article":"1"}]}', 'must have no gold'],
    ['{"id":"q1","question":"?","type":"multi","gold":[{"norm":"lei-a","article":"1"}]}', 'two or more'],
    ['{"id":"q1","question":"?","type":"guess","gold":[]}', 'type must be one of'],
    ['{"id":"q1","question":"?","type":"reference","gold":[{"norm":"lei-a","article":"x"}]}', 'bad gold ref'],
    ['{"id":"q1","question":"?","type":"out_of_scope","gold":[]}\n{"id":"q1","question":"?","type":"out_of_scope","gold":[]}', 'line 2: duplicate id'],
    ['{nope', 'line 1: invalid JSON'],
  ])('rejects %s', (line, message) => {
    expect(() => parseGold(line)).toThrow(message);
  });

  it('reports gold articles absent from the corpus', () => {
    const items = parseGold(
      '{"id":"q1","question":"?","type":"multi","gold":[{"norm":"lei-a","article":"2"},{"norm":"lei-a","article":"99"}]}',
    );
    expect(missingGold(items, articleChunks)).toEqual(['q1: lei-a art. 99']);
  });
});

describe('metrics', () => {
  const c = (slug: string, articles: string[]): EvalChunk => ({
    id: `${slug}:${articles.join(',')}`,
    slug,
    documentTitle: slug,
    articles,
    content: 'x',
    embedText: 'x',
    isRevoked: false,
  });

  it('scores each gold article at its first covering rank', () => {
    const ranked = [c('lei-b', ['1']), c('lei-a', ['2', '3']), c('lei-a', ['2'])];
    const ranks = firstRanks(ranked, [
      { norm: 'lei-a', article: '2' },
      { norm: 'lei-a', article: '9' },
    ]);
    expect(ranks).toEqual([2, null]);
    expect(recallAt(ranks, 1)).toBe(0);
    expect(recallAt(ranks, 2)).toBe(0.5);
    expect(reciprocalRank(ranks)).toBe(0.5);
  });

  it('computes binary nDCG against the ideal ordering', () => {
    expect(ndcgAt([1, 2], 5)).toBeCloseTo(1);
    expect(ndcgAt([2], 5)).toBeCloseTo(1 / Math.log2(3));
    expect(ndcgAt([null], 5)).toBe(0);
  });
});

describe('window chunking', () => {
  it('covers the same text and records every article a window overlaps', () => {
    const windows = windowChunks(byDoc[0], 150, 30);
    expect(windows.length).toBeGreaterThan(2);
    expect(new Set(windows.flatMap((w) => w.articles))).toEqual(new Set(['1', '2', '4']));
    for (const w of windows) expect(w.content.length).toBeLessThanOrEqual(150);
    // Overlap: the end of one window opens the next.
    expect(windows[1].content.startsWith(windows[0].content.slice(-30))).toBe(true);
  });

  it('leaves revoked articles and the ementa out of article coverage', () => {
    const all = windowChunks(byDoc[0], 5000, 0);
    expect(all).toHaveLength(1);
    expect(all[0].articles).toEqual(['1', '2', '4']);
    expect(all[0].content).not.toContain('Revogado');
  });

  it('parses strategy specs', () => {
    expect(parseStrategy('window:1000:200')).toEqual({ kind: 'window', size: 1000, overlap: 200 });
    expect(parseStrategy('window:800')).toEqual({ kind: 'window', size: 800, overlap: 0 });
    expect(() => parseStrategy('window:500:500')).toThrow('overlap < size');
    expect(() => parseStrategy('sentence')).toThrow('Unknown chunking');
  });
});

describe('exact retriever', () => {
  it('parses lists of references and the norms a question names', () => {
    expect(parseQuery('arts. 1º e 2º da Lei A', aliases)).toEqual({ articleLabels: ['1', '2'], slugs: ['lei-a'] });
    expect(parseQuery('art. 1.240-A do CC', aliases).articleLabels).toEqual(['1240-A']);
    expect(parseQuery('o que é penhora?', aliases)).toEqual({ articleLabels: [], slugs: [] });
  });

  it('restricts to the named norm, and searches every norm when none is named', async () => {
    const r = exactRetriever(articleChunks, aliases);
    expect(ids(await r.retrieve('o que diz o art. 1º da Lei B?', 5))).toEqual([chunkFor('lei-b', '1').id]);
    expect(ids(await r.retrieve('o que diz o art. 1º?', 5))).toHaveLength(2);
  });

  it('reaches revoked articles', async () => {
    const [hit] = await exactRetriever(articleChunks, aliases).retrieve('art. 3º da Lei A', 5);
    expect(hit.chunk.isRevoked).toBe(true);
  });
});

describe('lexical retriever', () => {
  it('stems Portuguese and drops stopwords', () => {
    expect(tokenize('registrado')).toEqual(tokenize('registro'));
    expect(tokenize('de que a o')).toEqual([]);
    expect(tokenize('MATRÍCULA')).toEqual(tokenize('matricula'));
  });

  it('finds an article from a paraphrase and never returns revoked chunks', async () => {
    const r = lexicalRetriever(articleChunks);
    const [top] = await r.retrieve('inquilino tem preferência na venda do imóvel locado?', 3);
    expect(top.chunk.id).toBe(chunkFor('lei-b', '1').id);
    const all = await r.retrieve('revogado', 10);
    expect(all.every((h) => !h.chunk.isRevoked)).toBe(true);
  });
});

describe('hybrid retriever', () => {
  it('fuses with RRF', () => {
    const s = fuseRrf([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(s.get('b')).toBeCloseTo(1 / 62 + 1 / 61);
    expect([...s.entries()].sort((x, y) => y[1] - x[1])[0][0]).toBe('b');
  });

  it('puts exact hits first, ahead of anything the ranked lists agree on', async () => {
    const fixed = (name: string, list: EvalChunk[]): Retriever => ({
      name,
      retrieve: async () => list.map((chunk) => ({ chunk, score: 1 })),
    });
    const a2 = chunkFor('lei-a', '2');
    const r = hybridRetriever({
      exact: exactRetriever(articleChunks, aliases),
      ranked: [fixed('x', [a2]), fixed('y', [a2])],
    });
    expect(r.name).toBe('exact+x+y');
    expect(ids(await r.retrieve('art. 4º da Lei A', 2))).toEqual([chunkFor('lei-a', '4').id, a2.id]);
  });
});

describe('vector retriever', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'emb-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Bag-of-stems embedder: enough to rank by shared vocabulary.
  let calls = 0;
  const vocab = new Map<string, number>();
  const fake: Embedder = {
    id: 'fake@64',
    async embed(texts) {
      calls += texts.length;
      return texts.map((t) => {
        const v = new Array(64).fill(0);
        for (const tok of tokenize(t)) {
          if (!vocab.has(tok)) vocab.set(tok, vocab.size % 64);
          v[vocab.get(tok)!] += 1;
        }
        return v;
      });
    },
  };

  it('ranks by cosine and caches embeddings on disk', async () => {
    const embedder = cachedEmbedder(fake, dir);
    const r = await vectorRetriever(articleChunks, embedder);
    const [top] = await r.retrieve('penhora averbada na matrícula', 1);
    expect(top.chunk.id).toBe(chunkFor('lei-a', '2').id);
    const before = calls;
    await vectorRetriever(articleChunks, embedder);
    await r.retrieve('penhora averbada na matrícula', 1);
    expect(calls).toBe(before);
  });
});

describe('evaluate', () => {
  it('scores answerable questions only and renders a table', async () => {
    const items = parseGold(
      [
        '{"id":"q1","question":"art. 2º da Lei A","type":"reference","gold":[{"norm":"lei-a","article":"2"}]}',
        '{"id":"q2","question":"inquilino tem preferência na venda?","type":"paraphrase","gold":[{"norm":"lei-b","article":"1"}]}',
        '{"id":"q3","question":"qual a alíquota do imposto de renda?","type":"out_of_scope","gold":[]}',
      ].join('\n'),
    );
    const retriever = hybridRetriever({ exact: exactRetriever(articleChunks, aliases), ranked: [lexicalRetriever(articleChunks)] });
    const run = await evaluate({ retriever, chunking: 'article', chunks: articleChunks, items, ks: [1, 5] });
    expect(run.overall.n).toBe(2);
    expect(run.overall.recallAt[1]).toBe(1);
    expect(run.overall.mrr).toBe(1);
    expect(run.byType.reference?.n).toBe(1);
    expect(toMarkdown([run]).split('\n')[2]).toBe('| exact+lexical | article | 2 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | ' + Math.round(run.overall.charsAt[5]).toLocaleString('en-US') + ' |');
  });
});
