import type { CorpusChunk } from '@rag-property-law-brazil/corpus';

/** A unit the retrievers rank. `articles` lists every article the unit covers. */
export interface EvalChunk {
  id: string;
  slug: string;
  documentTitle: string;
  /** Normalized article labels this chunk covers: one for an article chunk, several for a fixed window. */
  articles: string[];
  content: string;
  /** What an embedder sees (breadcrumb + content for article chunks; the raw window otherwise). */
  embedText: string;
  isRevoked: boolean;
}

export function fromCorpusChunk(c: CorpusChunk): EvalChunk {
  return {
    id: c.id,
    slug: c.slug,
    documentTitle: c.documentTitle,
    articles: c.articleLabel ? [c.articleLabel] : [],
    content: c.content,
    embedText: c.embedText,
    isRevoked: c.isRevoked,
  };
}

export interface ScoredChunk {
  chunk: EvalChunk;
  score: number;
}

export interface Retriever {
  name: string;
  /** Best first. May return fewer than k. */
  retrieve(question: string, k: number): Promise<ScoredChunk[]>;
}

export type QuestionType =
  /** Names the article ("o que diz o art. 1.245 do CC?"). */
  | 'reference'
  /** Asks about the rule in lay words, no article number. */
  | 'paraphrase'
  /** Needs more than one article, possibly across norms. */
  | 'multi'
  /** In scope but the corpus does not answer it: retrieval should find nothing relevant. */
  | 'unanswerable'
  /** Outside property/registry law. */
  | 'out_of_scope';

export interface GoldRef {
  /** Norm slug from the corpus manifest. */
  norm: string;
  /** Article label as written in the norm ("1.245", "5º", "185-A"); normalized on load. */
  article: string;
}

export interface GoldItem {
  id: string;
  question: string;
  type: QuestionType;
  /** Empty for unanswerable / out_of_scope. */
  gold: GoldRef[];
  /** 'draft' until a person checked the question and its articles against the text. */
  status: 'draft' | 'reviewed';
  note?: string;
}
