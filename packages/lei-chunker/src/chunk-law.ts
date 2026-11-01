// Structure-based chunking of Brazilian statutes, following the hierarchy of
// LC 95/1998 (art. 10): Ementa/Preâmbulo → Parte/Livro/Título/Capítulo/Seção/
// Subseção (breadcrumb) → Artigo (the chunk unit) → caput, §§ / Parágrafo
// único, incisos (I, II…), alíneas (a, b…), itens (1, 2…).
//
// One article — caput plus every subdivision — is one chunk: an inciso read
// without its caput loses the subject of the rule. Only an article longer than
// `maxChars` is split, at § / inciso boundaries, and every part repeats the
// caput. The input is one provision per line (see extract.ts).

import { articleInFilter, incisoRangeFor, type KnowledgeFilter } from './filter';
import { formatArticleLabel, normalizeArticleLabel, romanToInt } from './labels';

export interface KnowledgeChunk {
  ord: number;
  /** Heading breadcrumb, e.g. ["LIVRO III – DO DIREITO DAS COISAS", "TÍTULO III – DA PROPRIEDADE"]. */
  path: string[];
  /** Normalized article label ("1240-A"), "ementa" for the preamble, null for guide sections. */
  articleLabel: string | null;
  /** Set when an article was split: "§ 1º–§ 3º", "inciso XXII–inciso XXX". */
  partLabel: string | null;
  content: string;
  /** Whole article revoked or vetoed. Stored without embedding and kept out of FTS/vector search. */
  isRevoked: boolean;
}

export interface ChunkLawOptions {
  filter?: KnowledgeFilter | null;
  /** Split threshold in characters (~4 chars per token). */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 4800;

const HEADING_LEVELS: [RegExp, number][] = [
  [/^PARTE\s+(GERAL|ESPECIAL)\b/i, 0],
  [/^LIVRO\b/i, 1],
  [/^T[ÍI]TULO\b/i, 2],
  [/^CAP[ÍI]TULO\b/i, 3],
  [/^SUBSE[ÇC][ÃA]O\b/i, 5],
  [/^SE[ÇC][ÃA]O\b/i, 4],
];
// A heading keyword must be followed by its numeral (or ÚNICO/COMPLEMENTAR), a dash, or end of line —
// "Seção de registro…" in running text is not a heading.
const HEADING_TAIL = /^(PARTE\s+(GERAL|ESPECIAL)|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SUBSE[ÇC][ÃA]O|SE[ÇC][ÃA]O)(\s+([IVXLCDM]+(-[A-Z])?|[ÚU]NIC[OA]|COMPLEMENTAR)\b|\s*$|\s*[-–—])/i;
const HEADING_PREFIX =
  /^(PARTE\s+(GERAL|ESPECIAL)|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SUBSE[ÇC][ÃA]O|SE[ÇC][ÃA]O)(\s+([IVXLCDM]+(-[A-Z])?|[ÚU]NIC[OA]|COMPLEMENTAR)\b)?/i;
const ADCT_RE = /^ATO DAS DISPOSI[ÇC][ÕO]ES CONSTITUCIONAIS TRANSIT[ÓO]RIAS/i;

const ART_RE =
  /^Art\.?\s*(\d{1,2}(?:\.\d{3})+|\d{1,5})\s*(?:º|°|ª|o(?![a-zà-ú]))?\s*(-\s*[A-Z]{1,2}\b)?\s*[.\-–—]?\s*(.*)$/;
const PARA_RE = /^(§\s*\d+\s*(?:º|°|o(?![a-zà-ú]))?(?:\s*-\s*[A-Z]\b)?|Par[áa]grafo\s+[úu]nico)\s*[.\-–—]?\s*(.*)$/i;
const INCISO_RE = /^([IVXLCDM]+)(?:\s*-\s*[A-Z]\b)?\s*[-–—]\s*(.*)$/;
const ALINEA_RE = /^[a-z]\)\s*(.*)$/;
const ITEM_RE = /^\d{1,2}[.)]\s+(.*)$/;
const REVOKED_RE = /^\(?\s*(revogad[oa]s?|vetad[oa]s?)\b/i;

// Lines that end the normative text (signature block, DOU disclaimer).
const END_RE = /^(Bras[íi]lia,\s*\d|Este texto n[ãa]o substitui)/i;
// Planalto page chrome above the ementa.
const PREAMBLE_NOISE_RE =
  /^(Presid[êe]ncia da Rep[úu]blica|Casa Civil|Secretaria-Geral|Secretaria Especial para Assuntos Jur[íi]dicos|Subchefia para Assuntos Jur[íi]dicos|Texto compilado|Texto impresso|Mensagem de veto|Vig[êe]ncia|Regulamento|Convers[ãa]o da Medida Provis[óo]ria.*|\(Vide .*\)|\(Vig[êe]ncia\)|Vide .*)$/i;

interface Unit {
  marker: string | null;
  lines: string[];
  dropped: boolean;
}

interface OpenArticle {
  label: string;
  path: string[];
  caput: string[];
  units: Unit[];
  revoked: boolean;
  incisoRange: [number, number] | null;
}

function headingLevel(line: string): number | null {
  if (line.length > 200 || !HEADING_TAIL.test(line)) return null;
  for (const [re, level] of HEADING_LEVELS) if (re.test(line)) return level;
  return null;
}

function isStructural(line: string): boolean {
  return (
    ART_RE.test(line) ||
    headingLevel(line) !== null ||
    PARA_RE.test(line) ||
    INCISO_RE.test(line) ||
    ADCT_RE.test(line) ||
    END_RE.test(line)
  );
}

/** A heading's name on the following line: "DA POSSE", "Das Disposições Gerais". */
function looksLikeHeadingName(line: string): boolean {
  if (line.length > 160 || isStructural(line)) return false;
  const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (!letters) return false;
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, '').length;
  return upper / letters.length > 0.8 || /^(D[oa]s?|Disposi[çc][õo]es)\b/.test(line);
}

function paraMarker(raw: string): string {
  if (/^par/i.test(raw)) return 'Parágrafo único';
  const m = raw.match(/§\s*(\d+)/);
  return m ? `§ ${m[1]}${parseInt(m[1], 10) < 10 ? 'º' : ''}` : raw;
}

function contentOf(art: OpenArticle, units: Unit[]): string {
  return [...art.caput, ...units.flatMap((u) => u.lines)].join('\n');
}

function partLabelOf(units: Unit[]): string | null {
  const markers = units.map((u) => u.marker).filter((m): m is string => !!m);
  if (markers.length === 0) return null;
  return markers.length === 1 ? markers[0] : `${markers[0]}–${markers[markers.length - 1]}`;
}

function articleChunks(art: OpenArticle, maxChars: number): Omit<KnowledgeChunk, 'ord'>[] {
  const base = { path: art.path, articleLabel: art.label };
  if (art.revoked) {
    return [{ ...base, partLabel: null, content: art.caput.join('\n'), isRevoked: true }];
  }
  const kept = art.units.filter((u) => !u.dropped);
  const whole = contentOf(art, kept);
  if (whole.length <= maxChars || kept.length <= 1) {
    return [{ ...base, partLabel: null, content: whole, isRevoked: false }];
  }
  const caputLen = art.caput.join('\n').length;
  const parts: Unit[][] = [];
  let cur: Unit[] = [];
  let curLen = caputLen;
  for (const u of kept) {
    const len = u.lines.join('\n').length + 1;
    if (cur.length && curLen + len > maxChars) {
      parts.push(cur);
      cur = [];
      curLen = caputLen;
    }
    cur.push(u);
    curLen += len;
  }
  if (cur.length) parts.push(cur);
  if (parts.length === 1) return [{ ...base, partLabel: null, content: whole, isRevoked: false }];
  return parts.map((units) => ({
    ...base,
    partLabel: partLabelOf(units),
    content: contentOf(art, units),
    isRevoked: false,
  }));
}

export function chunkLaw(text: string, opts: ChunkLawOptions = {}): KnowledgeChunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const filter = opts.filter ?? null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const out: Omit<KnowledgeChunk, 'ord'>[] = [];
  const preamble: string[] = [];
  let path: { level: number; label: string }[] = [];
  let labelPrefix = '';
  let seenStructure = false;
  let art: OpenArticle | null = null;
  // True while consuming the body of an article that the filter excluded.
  let skipping = false;

  const flush = () => {
    if (art) out.push(...articleChunks(art, maxChars));
    art = null;
    skipping = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (END_RE.test(line) && seenStructure) {
      flush();
      break;
    }

    if (ADCT_RE.test(line)) {
      flush();
      seenStructure = true;
      path = [{ level: 0, label: 'ADCT' }];
      labelPrefix = 'ADCT-';
      continue;
    }

    const level = headingLevel(line);
    if (level !== null) {
      flush();
      seenStructure = true;
      let label = line;
      const next = lines[i + 1];
      const hasName = /[A-Za-zÀ-ÿ]/.test(line.replace(HEADING_PREFIX, ''));
      if (!hasName && next && looksLikeHeadingName(next)) {
        label = `${line} – ${next}`;
        i++;
      }
      path = [...path.filter((p) => p.level < level), { level, label }];
      continue;
    }

    const artMatch = line.match(ART_RE);
    if (artMatch) {
      flush();
      seenStructure = true;
      const normalized = normalizeArticleLabel(`${artMatch[1]}${artMatch[2] ? artMatch[2].replace(/\s+/g, '') : ''}`);
      if (!normalized) continue;
      const label = `${labelPrefix}${normalized}`;
      const pathLabels = path.map((p) => p.label);
      if (!articleInFilter(label, pathLabels, filter)) {
        skipping = true;
        continue;
      }
      const rest = artMatch[3] ?? '';
      art = {
        label,
        path: pathLabels,
        caput: [line],
        units: [],
        revoked: REVOKED_RE.test(rest),
        incisoRange: incisoRangeFor(label, filter),
      };
      continue;
    }

    if (!seenStructure) {
      if (!PREAMBLE_NOISE_RE.test(line)) preamble.push(line);
      continue;
    }
    if (skipping || !art) continue;
    const open: OpenArticle = art;

    const para = line.match(PARA_RE);
    if (para) {
      open.units.push({ marker: paraMarker(para[1]), lines: [line], dropped: REVOKED_RE.test(para[2] ?? '') });
      continue;
    }
    const inciso = line.match(INCISO_RE);
    if (inciso && romanToInt(inciso[1]) !== null) {
      const n = romanToInt(inciso[1])!;
      const outOfRange = open.incisoRange !== null && (n < open.incisoRange[0] || n > open.incisoRange[1]);
      open.units.push({
        marker: `inciso ${inciso[1]}`,
        lines: [line],
        dropped: outOfRange || REVOKED_RE.test(inciso[2] ?? ''),
      });
      continue;
    }
    const last = open.units[open.units.length - 1];
    const sub = line.match(ALINEA_RE) ?? line.match(ITEM_RE);
    if (sub && REVOKED_RE.test(sub[1] ?? '')) continue; // revoked alínea/item: drop the line only
    if (last) last.lines.push(line);
    else open.caput.push(line);
  }
  flush();

  const chunks: Omit<KnowledgeChunk, 'ord'>[] = [];
  if (preamble.length) {
    let content = preamble.join('\n');
    if (content.length > maxChars) content = content.slice(0, maxChars);
    chunks.push({ path: [], articleLabel: 'ementa', partLabel: null, content, isRevoked: false });
  }
  chunks.push(...out);
  return chunks.map((c, ord) => ({ ...c, ord }));
}

// ─── Guide / non-statute documents ───────────────────────────────────────────

/** An all-caps line ("PENHORA — DO REGISTRO AO LEILÃO (use para …):") opens a section. */
export function isSectionHeading(line: string): boolean {
  if (/^[-•*\d]/.test(line)) return false;
  const head = line.split(/[(:]/)[0];
  const letters = head.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 5) return false;
  return letters === letters.toUpperCase();
}

function sectionTitle(line: string): string {
  return line.split(/\s*\(|:\s*$/)[0].replace(/:\s*$/, '').trim();
}

/** Chunks a document with ALL-CAPS section headings (practice guides, notes), one section per chunk. */
export function chunkByHeadings(text: string, opts: { maxChars?: number } = {}): KnowledgeChunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const sections: { title: string; lines: string[] }[] = [];
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (isSectionHeading(line)) sections.push({ title: sectionTitle(line), lines: [line] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
    else sections.push({ title: 'Introdução', lines: [line] });
  }
  const out: Omit<KnowledgeChunk, 'ord'>[] = [];
  for (const s of sections) {
    if (s.lines.length < 2) continue; // heading without body
    const parts: string[][] = [];
    let cur: string[] = [];
    let len = 0;
    for (const l of s.lines) {
      if (cur.length && len + l.length + 1 > maxChars) {
        parts.push(cur);
        cur = [s.lines[0]];
        len = s.lines[0].length;
      }
      cur.push(l);
      len += l.length + 1;
    }
    if (cur.length) parts.push(cur);
    parts.forEach((p, idx) =>
      out.push({
        path: [s.title],
        articleLabel: null,
        partLabel: parts.length > 1 ? `parte ${idx + 1}` : null,
        content: p.join('\n'),
        isRevoked: false,
      }),
    );
  }
  return out.map((c, ord) => ({ ...c, ord }));
}

/** Text sent to the embedding model: hierarchical prefix + content, so "o prazo é de trinta dias" keeps its subject. */
export function embedTextFor(documentTitle: string, chunk: Pick<KnowledgeChunk, 'path' | 'articleLabel' | 'partLabel' | 'content'>): string {
  const crumbs = [documentTitle, ...chunk.path];
  if (chunk.articleLabel && chunk.articleLabel !== 'ementa') {
    crumbs.push(`Art. ${formatArticleLabel(chunk.articleLabel)}${chunk.partLabel ? ` (${chunk.partLabel})` : ''}`);
  } else if (chunk.articleLabel === 'ementa') {
    crumbs.push('Ementa');
  }
  return `${crumbs.join(' > ')}\n${chunk.content}`;
}
