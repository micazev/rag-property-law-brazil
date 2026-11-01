// Running headers/footers of multi-page PDF print-outs: a line that appears on
// most pages is page chrome, not normative text. Pages are counted, not
// occurrences — a line repeated ten times on one page is not a header.

/** A line on at least this share of pages is treated as a running header/footer. */
const REPEATED_LINE_PAGE_RATIO = 0.6;
/** Below this page count repetition proves nothing; short documents are left alone. */
const MIN_PAGES_FOR_REPEAT_DETECTION = 3;
/** Headers are short. A long paragraph repeating across pages is kept rather than risk deleting body text. */
const MAX_REPEATED_LINE_CHARS = 200;

/** Comparable key for a line: whitespace collapsed, digits masked (page numbers, timestamps). Empty = never dropped. */
function normalizeRepeatedLine(line: string): string {
  const collapsed = line.trim().replace(/\s+/g, ' ');
  if (collapsed.length > MAX_REPEATED_LINE_CHARS) return '';
  return collapsed
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
    .replace(/\d/g, '#')
    .toLowerCase();
}

/** Drops lines that repeat across most pages. Returns one cleaned string per page, in order. */
export function dropRepeatedLines(pageTexts: string[]): string[] {
  const pages = pageTexts.map((t) => t ?? '');
  if (pages.length < MIN_PAGES_FOR_REPEAT_DETECTION) return pages;

  const pagesWithLine = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.split(/\r?\n/)) {
      const key = normalizeRepeatedLine(line);
      if (key) seen.add(key);
    }
    for (const key of seen) pagesWithLine.set(key, (pagesWithLine.get(key) ?? 0) + 1);
  }

  const threshold = Math.ceil(pages.length * REPEATED_LINE_PAGE_RATIO);
  return pages.map((page) =>
    page
      .split(/\r?\n/)
      .filter((line) => {
        const key = normalizeRepeatedLine(line);
        if (!key) return true;
        return (pagesWithLine.get(key) ?? 0) < threshold;
      })
      .join('\n')
      .trim(),
  );
}
