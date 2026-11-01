// Scope filter applied at ingestion: which articles of a norm enter the
// knowledge base. General codes (CC, CPC, CTN, CF) are mostly unrelated to the
// property registry, so only the configured slices are chunked and embedded —
// the rest is dropped before it can surface as a false positive in retrieval.
// The source document itself is not modified.

import { compareLabels, normalizeArticleLabel, romanToInt } from './labels';

export type ArticleSpec = string | [string, string];

export type KnowledgeFilter =
  | { all: true }
  | {
      /** Single labels ("313") or inclusive ranges (["185", "185-A"]). */
      articles?: ArticleSpec[];
      /** Per article, the inclusive inciso range to keep (roman numerals). The caput and §§ are always kept. */
      incisos?: Record<string, [string, string]>;
      /** Keep every article whose breadcrumb has a heading containing one of these (accent/case-insensitive). */
      paths?: string[];
    };

export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normSpec(raw: string): string {
  return normalizeArticleLabel(raw) ?? raw;
}

function labelMatchesSpec(label: string, spec: ArticleSpec): boolean {
  if (typeof spec === 'string') return normSpec(spec) === label;
  const lo = compareLabels(label, normSpec(spec[0]));
  const hi = compareLabels(label, normSpec(spec[1]));
  return lo !== null && hi !== null && lo >= 0 && hi <= 0;
}

/** True when the article (normalized label + heading breadcrumb) is inside the filter. */
export function articleInFilter(
  label: string,
  path: string[],
  filter: KnowledgeFilter | null | undefined,
): boolean {
  if (!filter || 'all' in filter) return true;
  const { articles, paths } = filter;
  if (!articles?.length && !paths?.length) return true;
  if (articles?.some((spec) => labelMatchesSpec(label, spec))) return true;
  if (paths?.length) {
    const folded = path.map(foldText);
    return paths.some((p) => {
      const needle = foldText(p);
      return folded.some((h) => h.includes(needle));
    });
  }
  return false;
}

/** Inciso range configured for this article, as integers; null when every inciso is kept. */
export function incisoRangeFor(
  label: string,
  filter: KnowledgeFilter | null | undefined,
): [number, number] | null {
  if (!filter || 'all' in filter || !filter.incisos) return null;
  const entry = Object.entries(filter.incisos).find(([k]) => normSpec(k) === label);
  if (!entry) return null;
  const lo = romanToInt(entry[1][0]);
  const hi = romanToInt(entry[1][1]);
  return lo !== null && hi !== null ? [lo, hi] : null;
}

/** Validates a filter given as JSON (object or string). Throws with a readable message (pt-BR). */
export function parseFilter(input: unknown): KnowledgeFilter | null {
  if (input === null || input === undefined || input === '') return null;
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Filtro deve ser um objeto JSON');
  }
  const v = value as Record<string, unknown>;
  if (v.all === true) return { all: true };
  const out: { articles?: ArticleSpec[]; incisos?: Record<string, [string, string]>; paths?: string[] } = {};
  if (v.articles !== undefined) {
    if (!Array.isArray(v.articles)) throw new Error('"articles" deve ser uma lista');
    out.articles = v.articles.map((a) => {
      if (typeof a === 'string' && normalizeArticleLabel(a)) return a;
      if (
        Array.isArray(a) &&
        a.length === 2 &&
        a.every((x) => typeof x === 'string' && normalizeArticleLabel(x))
      ) {
        return [a[0], a[1]] as [string, string];
      }
      throw new Error(`Artigo inválido no filtro: ${JSON.stringify(a)}`);
    });
  }
  if (v.incisos !== undefined) {
    if (typeof v.incisos !== 'object' || v.incisos === null) throw new Error('"incisos" deve ser um objeto');
    out.incisos = {};
    for (const [k, r] of Object.entries(v.incisos as Record<string, unknown>)) {
      if (!Array.isArray(r) || r.length !== 2 || r.some((x) => typeof x !== 'string' || romanToInt(x) === null)) {
        throw new Error(`Intervalo de incisos inválido para o art. ${k}`);
      }
      out.incisos[k] = [r[0], r[1]];
    }
  }
  if (v.paths !== undefined) {
    if (!Array.isArray(v.paths) || v.paths.some((p) => typeof p !== 'string' || !p.trim())) {
      throw new Error('"paths" deve ser uma lista de títulos');
    }
    out.paths = v.paths as string[];
  }
  return out;
}
