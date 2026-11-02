# rag-property-law-brazil

Retrieval-augmented generation over Brazilian property and registry law
(*direito imobiliário e registral*): structure-aware chunking of statutes,
hybrid retrieval, cited answers that refuse when the sources do not support
them, and an evaluation harness.

The code is extracted from a production document-analysis product for
*matrículas de imóveis* (property registry certificates) and is being
published package by package.

## Status

| Package | What it does | Status |
|---|---|---|
| [`lei-chunker`](packages/lei-chunker) | Parses a Brazilian statute into one chunk per article, following the hierarchy of LC 95/1998 | ✅ published here |
| `lex-retrieval` | Hybrid retrieval: exact article reference + Portuguese full-text search + pgvector, fused with Reciprocal Rank Fusion | planned |
| `answer` | Grounded answers with `[n]` citations and two refusal gates (similarity before the model, citation validation after) | planned |
| `matricula-parser` | Segments a registry certificate into one chunk per act (R-n / AV-n) | planned |
| [`corpus`](packages/corpus) | The norms, the slice of each that is kept, and a fetcher for the Planalto compiled texts | ✅ code; texts not fetched yet |
| [`eval`](packages/eval) | Golden questions, retrievers (exact, BM25, vector, hybrid), chunking baselines, recall@k / MRR / nDCG | ✅ harness; golden set empty |
| `mcp-server` | MCP tools over the corpus (`buscar_lei`, `obter_artigo`) | planned |

## `lei-chunker`

Brazilian federal statutes share one drafting structure, set by
[LC 95/1998, art. 10](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp95.htm):
Parte → Livro → Título → Capítulo → Seção → Subseção → **Artigo** → caput,
§§ / Parágrafo único, incisos (I, II…), alíneas (a, b…), itens (1, 2…).

The chunker uses that structure instead of fixed-size token windows:

- **One article = one chunk.** An inciso read without its caput loses the
  subject of the rule ("o prazo é de trinta dias" — prazo de quê?). Only an
  article longer than `maxChars` is split, at § / inciso boundaries, and every
  part repeats the caput.
- **Heading breadcrumb per chunk** (`["LIVRO III – Do Direito das Coisas",
  "TÍTULO III – Da Propriedade", …]`), prepended to the embedded text by
  `embedTextFor`.
- **Revoked and vetoed provisions**: a wholly revoked article is kept but
  flagged `isRevoked` (so it can be stored without an embedding); a revoked §,
  inciso or alínea inside a live article is dropped.
- **Article labels normalized** for lookup: `Art. 1.240-A`, `Art. 5º`,
  `Art. 4o-A` → `1240-A`, `5`, `4-A`. ADCT articles are prefixed (`ADCT-5`) so
  they do not collide with the permanent text of the Constitution.
- **Scope filters** for large codes: keep only selected articles, ranges
  (`["185", "185-A"]`), inciso ranges per article, or every article under a
  heading (`paths: ["Do Direito das Coisas"]`).
- **Planalto extraction**: HTML from planalto.gov.br (windows-1252 detection,
  struck-through superseded wording removed before tags are stripped, data
  tables kept as Markdown) and PDF print-outs (running headers/footers and
  line-break hyphenation removed, enclitics such as `adquirir-lhe-á` kept).

```ts
import { readFileSync } from 'node:fs';
import { chunkLaw, decodeHtml, embedTextFor, htmlToText } from '@rag-property-law-brazil/lei-chunker';

const text = htmlToText(decodeHtml(readFileSync('L10406compilada.htm')));
const chunks = chunkLaw(text, { filter: { paths: ['Do Direito das Coisas'] } });

for (const c of chunks) {
  console.log(c.articleLabel, c.path.at(-1), c.isRevoked);
  const toEmbed = embedTextFor('Código Civil', c);
}
```

## Evaluation

The harness compares retrievers and chunking strategies on the same golden
set, with the **article** as the unit of relevance: a gold article counts as
found at the rank of the first retrieved chunk that covers it. Fixed-size
windows are cut over the same filtered text as the article chunks and record
every article they overlap, so both strategies are scored on which articles
reach the top k. `Chars@k` reports how much text that costs.

| Retriever | What it is |
|---|---|
| `exact` | Article references parsed from the question, looked up by label (restricted to the norms the question names) |
| `lexical` | BM25 over Portuguese Snowball stems. An in-memory stand-in: production ranks with Postgres `ts_rank_cd`, which uses the same stemmer but scores proximity instead of IDF |
| `vector` | Cosine over `gemini-embedding-001` (768 dims), embeddings cached on disk |
| `exact+lexical` | RRF over lexical, exact hits ranked first |
| `hybrid` | The production rule: exact first, then RRF (k = 60) over lexical and vector |

```bash
pnpm --filter @rag-property-law-brazil/corpus fetch      # download the texts from planalto.gov.br
pnpm --filter @rag-property-law-brazil/eval eval         # exact, lexical, exact+lexical
GEMINI_API_KEY=… pnpm --filter @rag-property-law-brazil/eval eval   # + vector, hybrid
```

Results: _pending — the corpus texts and the golden set are the next commit._

## Development

Node 22, pnpm 10.

```bash
pnpm install
pnpm verify   # tsc --noEmit + vitest, every package
```

## Legal texts

Brazilian statutes and official acts are not protected by copyright
(Lei 9.610/1998, art. 8º, IV). Test fixtures contain excerpts of official
texts and synthetic examples only. Nothing in this repository is legal advice.

## License

MIT
