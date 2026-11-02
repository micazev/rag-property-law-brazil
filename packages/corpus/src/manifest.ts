// The norms in the corpus and the slice of each that is kept. Property-law
// statutes go in whole; general codes keep only the articles that bear on the
// property registry, so the rest cannot surface as false positives.
//
// Copied from the production manifest. The slices are a product decision that
// has not been reviewed by a lawyer.
//
// Left out of the eval corpus for now:
//   - Provimento CNJ 149/2023 (Código Nacional de Normas): no stable compiled
//     URL on Planalto; the consolidated text has to be downloaded by hand.
//   - LGPD (Lei 13.709/2018): in the production base, but not property law.

import type { KnowledgeFilter } from '@rag-property-law-brazil/lei-chunker';

export interface NormEntry {
  slug: string;
  title: string;
  /** Planalto compiled-text page. */
  sourceUrl: string;
  /** How people refer to the norm in a question ("CC", "Código Civil", "10.406"). Matched accent/case-insensitive. */
  aliases: string[];
  filter: KnowledgeFilter;
}

export const NORMS: NormEntry[] = [
  {
    slug: 'lei-6015-1973',
    title: 'Lei de Registros Públicos (Lei 6.015/1973)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm',
    aliases: ['LRP', 'Lei de Registros Públicos', '6.015', '6015'],
    filter: { all: true },
  },
  {
    slug: 'lei-9514-1997',
    title: 'Alienação Fiduciária de Imóveis (Lei 9.514/1997)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l9514.htm',
    aliases: ['9.514', '9514', 'alienação fiduciária', 'SFI'],
    filter: { all: true },
  },
  {
    slug: 'lei-8245-1991',
    title: 'Lei do Inquilinato (Lei 8.245/1991)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l8245.htm',
    aliases: ['Lei do Inquilinato', 'Inquilinato', '8.245', '8245'],
    filter: { all: true },
  },
  {
    slug: 'lei-8009-1990',
    title: 'Bem de Família (Lei 8.009/1990)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l8009.htm',
    aliases: ['bem de família', '8.009', '8009'],
    filter: { all: true },
  },
  {
    slug: 'lei-14711-2023',
    title: 'Marco Legal das Garantias (Lei 14.711/2023)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14711.htm',
    aliases: ['Marco Legal das Garantias', '14.711', '14711'],
    filter: { all: true },
  },
  {
    slug: 'lei-10406-2002',
    title: 'Código Civil (Lei 10.406/2002)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm',
    aliases: ['CC', 'Código Civil', '10.406', '10406'],
    filter: {
      articles: [
        ['104', '188'], // negócio jurídico (inclui fraude contra credores, 158–165)
        '313',
        '356',
        ['478', '480'],
        ['481', '564'], // compra e venda, troca, doação
        '884',
        ['1196', '1510'], // Livro III — Direito das Coisas
        ['1639', '1688'], // regimes de bens
        '1784',
        '1911',
      ],
    },
  },
  {
    slug: 'lei-13105-2015',
    title: 'Código de Processo Civil (Lei 13.105/2015)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm',
    aliases: ['CPC', 'Código de Processo Civil', '13.105', '13105'],
    filter: {
      articles: [
        '300',
        ['554', '587'], // possessórias, divisão e demarcação
        ['610', '673'], // inventário e partilha
        ['674', '681'], // embargos de terceiro
        '792', // fraude à execução
        '804',
        '828', // averbação premonitória
        '835',
        ['843', '845'],
        '876',
        ['879', '903'], // alienação / leilão
        '908',
      ],
    },
  },
  {
    slug: 'lei-5172-1966',
    title: 'Código Tributário Nacional (Lei 5.172/1966)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm',
    aliases: ['CTN', 'Código Tributário Nacional', '5.172', '5172'],
    filter: {
      articles: [
        ['29', '42'], // ITR, IPTU, ITBI
        ['130', '131'], // responsabilidade dos sucessores
        ['185', '185-A'], // fraude e indisponibilidade
        ['205', '208'], // certidões negativas
      ],
    },
  },
  {
    slug: 'constituicao-1988',
    title: 'Constituição Federal de 1988',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
    aliases: ['CF', 'Constituição', 'Constituição Federal', 'CF/88'],
    filter: {
      articles: ['5', '170', ['182', '191'], '236'],
      incisos: { '5': ['XXII', 'XXX'] },
    },
  },
  {
    slug: 'lei-8078-1990',
    title: 'Código de Defesa do Consumidor (Lei 8.078/1990)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm',
    aliases: ['CDC', 'Código de Defesa do Consumidor', '8.078', '8078'],
    filter: { articles: ['6', ['51', '54']] },
  },
];

export function normBySlug(slug: string): NormEntry | undefined {
  return NORMS.find((n) => n.slug === slug);
}
