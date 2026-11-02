// Lexical retrieval: Okapi BM25 over Portuguese Snowball stems, stopwords
// removed, accents folded after stemming. The query is an OR of its terms.
//
// This is an in-memory stand-in for the production retriever, which uses
// Postgres full-text search (to_tsvector('portuguese') — the same Snowball
// stemmer — with an OR'd plainto_tsquery ranked by ts_rank_cd). The
// tokenization matches; the ranking function does not: ts_rank_cd scores term
// proximity and has no IDF, BM25 has IDF and no proximity. Numbers from this
// retriever describe BM25, not the deployed FTS.

import snowball from 'snowball-stemmers';
import type { EvalChunk, Retriever } from '../types';

const stemmer = snowball.newStemmer('portuguese');

// Postgres' portuguese.stop list (the Snowball list), folded.
const STOPWORDS = new Set(
  `de a o que e do da em um para com nao uma os no se na por mais as dos como mas ao ele das a seu sua ou quando muito
  nos ja eu tambem so pelo pela ate isso ela entre depois sem mesmo aos seus quem nas me esse eles voce essa num nem
  suas meu minha numa pelos elas qual nos lhe deles essas esses pelas este dele tu te voces vos lhes meus minhas teu
  tua teus tuas nosso nossa nossos nossas dela delas esta estes estas aquele aquela aqueles aquelas isto aquilo estou
  esta estamos estao estive esteve estivemos estiveram estava estavamos estavam estivera estiveramos esteja estejamos
  estejam estivesse estivessemos estivessem estiver estivermos estiverem hei ha havemos hao houve houvemos houveram
  houvera houveramos haja hajamos hajam houvesse houvessemos houvessem houver houvermos houverem houverei houvera
  houveremos houverao houveria houveriamos houveriam sou somos sao era eramos eram fui foi fomos foram fora foramos
  seja sejamos sejam fosse fossemos fossem for formos forem serei sera seremos serao seria seriamos seriam tenho tem
  temos tem tinha tinhamos tinham tive teve tivemos tiveram tivera tiveramos tenha tenhamos tenham tivesse
  tivessemos tivessem tiver tivermos tiverem terei tera teremos terao teria teriamos teriam`.split(/\s+/),
);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOPWORDS.has(fold(raw))) continue;
    out.push(fold(stemmer.stem(raw)));
  }
  return out;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
}

export function lexicalRetriever(chunks: EvalChunk[], opts: Bm25Options = {}): Retriever {
  const k1 = opts.k1 ?? 1.2;
  const b = opts.b ?? 0.75;
  const docs = chunks.filter((c) => !c.isRevoked);
  const tfs = docs.map((c) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(c.content)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const lengths = tfs.map((tf) => [...tf.values()].reduce((a, n) => a + n, 0));
  const avgLen = lengths.reduce((a, n) => a + n, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const tf of tfs) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => {
    const n = df.get(t) ?? 0;
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
  };

  return {
    name: 'lexical',
    async retrieve(question, k) {
      const terms = [...new Set(tokenize(question))];
      if (terms.length === 0) return [];
      const scored = docs.map((chunk, i) => {
        let score = 0;
        for (const t of terms) {
          const f = tfs[i].get(t);
          if (!f) continue;
          score += (idf(t) * f * (k1 + 1)) / (f + k1 * (1 - b + (b * lengths[i]) / avgLen));
        }
        return { chunk, score };
      });
      return scored
        .filter((s) => s.score > 0)
        .sort((a, z) => z.score - a.score)
        .slice(0, k);
    },
  };
}
