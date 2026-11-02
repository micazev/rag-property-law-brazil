// Loads the fetched texts (data/text/<slug>.txt) and chunks them with the
// manifest's filters. The texts are the output of htmlToText, one provision
// per line, so chunking is deterministic for a given text version.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chunkLaw, embedTextFor, type KnowledgeChunk } from '@rag-property-law-brazil/lei-chunker';
import { NORMS, type NormEntry } from './manifest';

export interface CorpusChunk extends KnowledgeChunk {
  /** Stable within one text version: "<slug>#<ord>". */
  id: string;
  slug: string;
  documentTitle: string;
  /** Breadcrumb + content: what an embedder sees. */
  embedText: string;
}

export interface CorpusDocument {
  norm: NormEntry;
  text: string;
}

export const DEFAULT_DATA_DIR = path.resolve(import.meta.dirname, '../data');

export function textPath(slug: string, dataDir = DEFAULT_DATA_DIR): string {
  return path.join(dataDir, 'text', `${slug}.txt`);
}

/** Every norm whose text has been fetched. Missing ones are listed so the caller can say so. */
export function loadDocuments(dataDir = DEFAULT_DATA_DIR, norms: NormEntry[] = NORMS): {
  documents: CorpusDocument[];
  missing: string[];
} {
  const documents: CorpusDocument[] = [];
  const missing: string[] = [];
  for (const norm of norms) {
    const file = textPath(norm.slug, dataDir);
    if (!existsSync(file)) {
      missing.push(norm.slug);
      continue;
    }
    documents.push({ norm, text: readFileSync(file, 'utf8') });
  }
  return { documents, missing };
}

export function chunkDocument(doc: CorpusDocument, opts: { maxChars?: number } = {}): CorpusChunk[] {
  return chunkLaw(doc.text, { filter: doc.norm.filter, maxChars: opts.maxChars }).map((c) => ({
    ...c,
    id: `${doc.norm.slug}#${c.ord}`,
    slug: doc.norm.slug,
    documentTitle: doc.norm.title,
    embedText: embedTextFor(doc.norm.title, c),
  }));
}
