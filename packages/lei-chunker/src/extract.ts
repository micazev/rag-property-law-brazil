// Text extraction for knowledge-base documents (statutes and practice guides).
//
// Planalto HTML is the preferred source: it carries one provision per <p>, so
// line structure survives, and superseded wording is kept STRUCK THROUGH
// (<strike>/<s>/<del>) next to the current text — that markup must be removed
// before tags are stripped, or old and new wording get indexed as one law.
// PDFs (browser print-outs of the same page) are accepted as a fallback; their
// print headers/footers and hyphenation breaks are cleaned up here.

import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { dropRepeatedLines } from './repeated-lines';

export type KnowledgeMime = 'text/html' | 'application/pdf' | 'text/plain' | 'text/markdown';

export function detectMime(filename: string, declared?: string | null): KnowledgeMime | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm') || declared?.includes('html')) return 'text/html';
  if (lower.endsWith('.pdf') || declared === 'application/pdf') return 'application/pdf';
  if (lower.endsWith('.md') || declared === 'text/markdown') return 'text/markdown';
  if (lower.endsWith('.txt') || declared?.startsWith('text/plain')) return 'text/plain';
  return null;
}

/**
 * Decode an HTML page. Planalto serves windows-1252 (often without a header),
 * so: honor a declared charset, else accept the bytes as UTF-8 only if they
 * decode cleanly, else fall back to windows-1252.
 */
export function decodeHtml(buffer: Buffer, contentType?: string | null): string {
  const head = buffer.subarray(0, 4096).toString('latin1');
  const declared =
    contentType?.match(/charset=([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared.toLowerCase()).decode(buffer);
    } catch {
      // unknown label: fall through to detection
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ordm: 'º', ordf: 'ª', sect: '§', deg: '°', para: '¶', middot: '·',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bull: '•', shy: '',
};
for (const [base, mark] of [
  ['acute', '́'], ['grave', '̀'], ['circ', '̂'], ['tilde', '̃'], ['uml', '̈'],
] as const) {
  for (const v of 'aeiouAEIOUnN') {
    const composed = (v + mark).normalize('NFC');
    if (composed.length === 1) NAMED_ENTITIES[v + base] = composed;
  }
}
NAMED_ENTITIES.ccedil = 'ç';
NAMED_ENTITIES.Ccedil = 'Ç';

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** <table> → Markdown table, so numeric tables (CTN arts. 90–91) stay readable after tag stripping. */
function tableToMarkdown(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1]).replace(/\|/g, '/')),
  );
  const nonEmpty = rows.filter((r) => r.some((c) => c));
  if (nonEmpty.length === 0) return '\n';
  // Layout tables (a single cell per row) carry ordinary paragraphs: keep them as lines.
  if (nonEmpty.every((r) => r.length <= 1)) return `\n${nonEmpty.map((r) => r[0] ?? '').join('\n')}\n`;
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const [head, ...body] = nonEmpty.map(pad);
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return `\n${lines.join('\n')}\n`;
}

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|head|noscript)\b[\s\S]*?<\/\1>/gi, '');
  // Superseded wording: drop it with its content. Repeat for nested markup.
  for (let i = 0; i < 3; i++) {
    s = s.replace(/<(strike|s|del)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  }
  // Innermost tables first, so a layout table wrapping a data table still works.
  for (let i = 0; i < 5 && /<table\b/i.test(s); i++) {
    s = s.replace(/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi, (m) => tableToMarkdown(m));
  }
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(p|div|h[1-6]|li|ul|ol|blockquote|center|section|article|tr)\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return normalizeLines(s);
}

/** Trim each line, collapse inner whitespace, drop blank lines. Markdown table rows are kept as-is. */
export function normalizeLines(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const PRINT_ARTIFACT_LINES: RegExp[] = [
  /^page \d+ of \d+$/i,
  /^página \d+ de \d+$/i,
  /^\d+\s*\/\s*\d+$/,
  /^https?:\/\/\S+$/i,
  /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?\b.*$/i,
];

/** PDF print-outs: drop browser headers/footers and re-join words hyphenated across lines. */
export function cleanPdfPages(pageTexts: string[]): string {
  const pages = dropRepeatedLines(pageTexts).map((p) =>
    p
      .split('\n')
      .filter((l) => !PRINT_ARTIFACT_LINES.some((re) => re.test(l.trim())))
      .join('\n'),
  );
  // A line ending in "-" before a clitic ("adquirir-\nlhe-á") is a real hyphen, not a line-break split.
  return normalizeLines(
    pages
      .join('\n')
      .replace(/([a-zà-ú])-\n(?!(?:lhes?|se|me|te|nos|vos|l?[oa]s?|n[oa]s?)\b)([a-zà-ú])/g, '$1$2')
      .replace(/([a-zà-ú])-\n([a-zà-ú])/g, '$1-$2'),
  );
}

export async function extractKnowledgeText(
  buffer: Buffer,
  mime: KnowledgeMime,
  contentType?: string | null,
): Promise<string> {
  switch (mime) {
    case 'text/html':
      return htmlToText(decodeHtml(buffer, contentType));
    case 'application/pdf': {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdfText(pdf, { mergePages: false });
      return cleanPdfPages(Array.isArray(text) ? text : [text]);
    }
    case 'text/plain':
    case 'text/markdown':
      return normalizeLines(buffer.toString('utf8'));
  }
}
