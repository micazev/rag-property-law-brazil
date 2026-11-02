import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseFilter } from '@rag-property-law-brazil/lei-chunker';
import { chunkDocument, loadDocuments, NORMS } from '../index';

describe('manifest', () => {
  it('has unique slugs and Planalto URLs', () => {
    expect(new Set(NORMS.map((n) => n.slug)).size).toBe(NORMS.length);
    for (const n of NORMS) expect(n.sourceUrl).toMatch(/^https:\/\/www\.planalto\.gov\.br\//);
  });

  it('has filters that parse', () => {
    for (const n of NORMS) expect(() => parseFilter(n.filter)).not.toThrow();
  });
});

describe('loadDocuments / chunkDocument', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'corpus-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('loads fetched texts, lists missing ones, and applies the norm filter', () => {
    mkdirSync(path.join(dir, 'text'));
    writeFileSync(
      path.join(dir, 'text', 'lei-8078-1990.txt'),
      'LEI Nº 8.078\nArt. 5º Fora do filtro.\nArt. 6º São direitos básicos do consumidor.\nArt. 51. São nulas as cláusulas abusivas.\n',
    );
    const { documents, missing } = loadDocuments(dir);
    expect(documents.map((d) => d.norm.slug)).toEqual(['lei-8078-1990']);
    expect(missing).toHaveLength(NORMS.length - 1);

    const chunks = chunkDocument(documents[0]);
    expect(chunks.map((c) => c.articleLabel)).toEqual(['ementa', '6', '51']);
    expect(chunks[1].id).toBe('lei-8078-1990#1');
    expect(chunks[1].embedText.split('\n')[0]).toBe('Código de Defesa do Consumidor (Lei 8.078/1990) > Art. 6º');
  });
});
