// Exact article references. "art. 1.499 do CC" embeds poorly and is a weak
// lexical query (the number is the whole point), so a parsed reference is
// looked up by label, restricted to the norms the question names when it names
// any. Revoked articles are reachable here and only here.
//
// Ported from the production retriever (parseQuery), unchanged except that the
// alias index is passed in instead of read from the app's manifest.

import { foldText, normalizeArticleLabel } from '@rag-property-law-brazil/lei-chunker';
import type { EvalChunk, Retriever, ScoredChunk } from '../types';

export interface ParsedQuery {
  articleLabels: string[];
  slugs: string[];
}

export interface AliasEntry {
  slug: string;
  aliases: string[];
}

const ARTICLE_REF_RE =
  /\bart(?:igo)?s?\.?\s*((?:\d{1,2}(?:\.\d{3})+|\d{1,5})\s*(?:º|°|o(?![a-zà-ú]))?(?:\s*-\s*[a-z]\b)?(?:\s*(?:,|e)\s*(?:\d{1,2}(?:\.\d{3})+|\d{1,5})\s*(?:º|°|o(?![a-zà-ú]))?(?:\s*-\s*[a-z]\b)?)*)/gi;
const LABEL_IN_LIST_RE = /(\d{1,2}(?:\.\d{3})+|\d{1,5})\s*(?:º|°|o(?![a-zà-ú]))?(?:\s*-\s*([a-z])\b)?/gi;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Article labels and norms referenced in a question ("arts. 26 e 27 da Lei 9.514" → 26, 27 / lei-9514-1997). */
export function parseQuery(question: string, aliasIndex: AliasEntry[]): ParsedQuery {
  const labels = new Set<string>();
  for (const m of question.matchAll(ARTICLE_REF_RE)) {
    for (const n of m[1].matchAll(LABEL_IN_LIST_RE)) {
      const label = normalizeArticleLabel(`${n[1]}${n[2] ? `-${n[2]}` : ''}`);
      if (label) labels.add(label);
    }
  }
  const folded = foldText(question);
  const slugs = aliasIndex
    .filter(({ aliases }) =>
      aliases.some((a) => new RegExp(`(^|[^a-z0-9])${escapeRe(foldText(a))}([^a-z0-9]|$)`).test(folded)),
    )
    .map((e) => e.slug);
  return { articleLabels: [...labels], slugs };
}

export function exactRetriever(chunks: EvalChunk[], aliasIndex: AliasEntry[]): Retriever {
  return {
    name: 'exact',
    async retrieve(question, k) {
      const { articleLabels, slugs } = parseQuery(question, aliasIndex);
      if (articleLabels.length === 0) return [];
      const hits: ScoredChunk[] = chunks
        .filter(
          (c) =>
            c.articles.some((a) => articleLabels.includes(a)) && (slugs.length === 0 || slugs.includes(c.slug)),
        )
        .map((chunk) => ({ chunk, score: 1 }));
      return hits.slice(0, k);
    },
  };
}
