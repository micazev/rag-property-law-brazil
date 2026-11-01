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
| `eval` | Golden question set with retrieval (recall@k, MRR) and refusal metrics | planned |
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
