// Downloads each norm's compiled text from Planalto, converts it to one
// provision per line (htmlToText) and writes data/text/<slug>.txt plus
// data/sources.lock.json (URL, fetch date, sha256 of the raw page and of the
// text). The eval reads only data/text, so a run is reproducible against the
// committed texts; re-fetching is how the corpus is updated to a new version.
//
//   pnpm --filter @rag-property-law-brazil/corpus fetch            # every norm
//   pnpm --filter @rag-property-law-brazil/corpus fetch lei-8009-1990

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { decodeHtml, htmlToText } from '@rag-property-law-brazil/lei-chunker';
import { DEFAULT_DATA_DIR, NORMS, textPath } from '../src/index';

interface LockEntry {
  url: string;
  fetchedAt: string;
  rawSha256: string;
  textSha256: string;
  lines: number;
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

async function main() {
  const only = new Set(process.argv.slice(2));
  const norms = only.size ? NORMS.filter((n) => only.has(n.slug)) : NORMS;
  const unknown = [...only].filter((s) => !NORMS.some((n) => n.slug === s));
  if (unknown.length) throw new Error(`Unknown slug(s): ${unknown.join(', ')}`);

  mkdirSync(path.join(DEFAULT_DATA_DIR, 'text'), { recursive: true });
  const lockFile = path.join(DEFAULT_DATA_DIR, 'sources.lock.json');
  const lock: Record<string, LockEntry> = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : {};

  let failed = 0;
  for (const norm of norms) {
    try {
      const res = await fetch(norm.sourceUrl, { headers: { 'User-Agent': 'rag-property-law-brazil corpus fetcher' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      const text = htmlToText(decodeHtml(raw, res.headers.get('content-type')));
      writeFileSync(textPath(norm.slug), `${text}\n`);
      lock[norm.slug] = {
        url: norm.sourceUrl,
        fetchedAt: new Date().toISOString(),
        rawSha256: sha256(raw),
        textSha256: sha256(text),
        lines: text.split('\n').length,
      };
      console.log(`ok   ${norm.slug}  ${lock[norm.slug].lines} lines`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${norm.slug}  ${(err as Error).message}`);
    }
  }
  const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(lockFile, `${JSON.stringify(sorted, null, 2)}\n`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
