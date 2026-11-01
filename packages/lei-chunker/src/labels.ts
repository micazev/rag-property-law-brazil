// Article labels as they appear in Brazilian statutes ("Art. 1.240-A.",
// "Art. 5º", "Art. 4o-A") normalized to one comparable form: digits without the
// thousands dot, the ordinal mark dropped, and an optional upper-case letter
// suffix — "1240-A", "5", "4-A". Labels are compared as (number, suffix) so a
// range ["185", "185-A"] contains "185-A" but not "186".

export interface ParsedLabel {
  num: number;
  suffix: string;
}

/** "1.240-A" / "1240a" / "5º" / "4o-A" → "1240-A" / "1240-A" / "5" / "4-A". Null when not an article number. */
export function normalizeArticleLabel(raw: string): string | null {
  const m = raw
    .trim()
    .match(/^(\d{1,2}(?:\.\d{3})+|\d{1,5})\s*(?:º|°|ª|o(?![a-z]))?\s*(?:-?\s*([A-Za-z]{1,2})(?![a-z]))?\.?$/);
  if (!m) return null;
  const num = String(parseInt(m[1].replace(/\./g, ''), 10));
  const suffix = m[2] ? m[2].toUpperCase() : '';
  return suffix ? `${num}-${suffix}` : num;
}

export function parseLabel(label: string): ParsedLabel | null {
  const m = label.match(/^(\d+)(?:-([A-Z]{1,2}))?$/);
  if (!m) return null;
  return { num: parseInt(m[1], 10), suffix: m[2] ?? '' };
}

/** Negative / zero / positive like a sort comparator; null when either side is not a plain article label. */
export function compareLabels(a: string, b: string): number | null {
  const pa = parseLabel(a);
  const pb = parseLabel(b);
  if (!pa || !pb) return null;
  if (pa.num !== pb.num) return pa.num - pb.num;
  if (pa.suffix === pb.suffix) return 0;
  if (!pa.suffix) return -1;
  if (!pb.suffix) return 1;
  return pa.suffix < pb.suffix ? -1 : 1;
}

/** "1240-A" → "1.240-A", "5" → "5º" — the citation form shown to users. */
export function formatArticleLabel(label: string): string {
  const p = parseLabel(label);
  if (!p) return label;
  const n = p.num >= 1000 ? p.num.toLocaleString('pt-BR') : String(p.num);
  const ordinal = p.num < 10 && !p.suffix ? 'º' : '';
  return `${n}${ordinal}${p.suffix ? `-${p.suffix}` : ''}`;
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** "XXII" → 22. Null for anything that is not a well-formed upper-case roman numeral. */
export function romanToInt(roman: string): number | null {
  if (!/^[IVXLCDM]+$/.test(roman)) return null;
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const cur = ROMAN[roman[i]];
    const next = ROMAN[roman[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}
