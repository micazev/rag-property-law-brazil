import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkByHeadings, chunkLaw, embedTextFor, isSectionHeading } from '../chunk-law';
import { decodeHtml, htmlToText } from '../extract';

const CC_EXCERPT = `LEI Nº 10.406, DE 10 DE JANEIRO DE 2002.
Institui o Código Civil.
O PRESIDENTE DA REPÚBLICA Faço saber que o Congresso Nacional decreta e eu sanciono a seguinte Lei:
PARTE ESPECIAL
LIVRO III
Do Direito das Coisas
TÍTULO III
Da Propriedade
CAPÍTULO II
Da Aquisição da Propriedade Imóvel
Seção I
Da Usucapião
Art. 1.238. Aquele que, por quinze anos, sem interrupção, nem oposição, possuir como seu um imóvel, adquire-lhe a propriedade, independentemente de título e boa-fé; podendo requerer ao juiz que assim o declare por sentença, a qual servirá de título para o registro no Cartório de Registro de Imóveis.
Parágrafo único. O prazo estabelecido neste artigo reduzir-se-á a dez anos se o possuidor houver estabelecido no imóvel a sua moradia habitual, ou nele realizado obras ou serviços de caráter produtivo.
Art. 1.240-A. Aquele que exercer, por 2 (dois) anos ininterruptamente e sem oposição, posse direta, com exclusividade, sobre imóvel urbano de até 250m² cuja propriedade divida com ex-cônjuge ou ex-companheiro que abandonou o lar, utilizando-o para sua moradia ou de sua família, adquirir-lhe-á o domínio integral, desde que não seja proprietário de outro imóvel urbano ou rural. (Incluído pela Lei nº 12.424, de 2011)
§ 1º O direito previsto no caput não será reconhecido ao mesmo possuidor mais de uma vez.
§ 2º (VETADO). (Incluído pela Lei nº 12.424, de 2011)
CAPÍTULO III
Da Aquisição da Propriedade Móvel
Art. 1.260. Aquele que possuir como sua uma coisa móvel, contínua e incontestadamente durante três anos, com justo título e boa-fé, adquirir-lhe-á a propriedade.
Art. 1.261. (Revogado pela Lei nº 99.999, de 2099)
Brasília, 10 de janeiro de 2002; 181º da Independência e 114º da República.
FERNANDO HENRIQUE CARDOSO`;

describe('chunkLaw', () => {
  const chunks = chunkLaw(CC_EXCERPT);
  const byLabel = (l: string) => chunks.find((c) => c.articleLabel === l)!;

  it('emits the ementa/preamble first', () => {
    expect(chunks[0].articleLabel).toBe('ementa');
    expect(chunks[0].content).toContain('Institui o Código Civil.');
  });

  it('keeps caput and paragraphs of one article in one chunk', () => {
    const art = byLabel('1238');
    expect(art.content).toContain('Art. 1.238.');
    expect(art.content).toContain('Parágrafo único.');
    expect(art.partLabel).toBeNull();
  });

  it('builds the heading breadcrumb, joining heading and name lines', () => {
    expect(byLabel('1238').path).toEqual([
      'PARTE ESPECIAL',
      'LIVRO III – Do Direito das Coisas',
      'TÍTULO III – Da Propriedade',
      'CAPÍTULO II – Da Aquisição da Propriedade Imóvel',
      'Seção I – Da Usucapião',
    ]);
    // A new CAPÍTULO replaces the old one and drops its Seção.
    expect(byLabel('1260').path).toEqual([
      'PARTE ESPECIAL',
      'LIVRO III – Do Direito das Coisas',
      'TÍTULO III – Da Propriedade',
      'CAPÍTULO III – Da Aquisição da Propriedade Móvel',
    ]);
  });

  it('parses suffixed articles and drops a vetoed paragraph inside a live article', () => {
    const art = byLabel('1240-A');
    expect(art.content).toContain('§ 1º');
    expect(art.content).not.toContain('§ 2º');
    expect(art.isRevoked).toBe(false);
  });

  it('marks a wholly revoked article without needing <strike>', () => {
    const art = byLabel('1261');
    expect(art.isRevoked).toBe(true);
  });

  it('stops at the signature block', () => {
    expect(chunks.some((c) => c.content.includes('FERNANDO HENRIQUE'))).toBe(false);
    expect(chunks.some((c) => c.content.includes('Brasília'))).toBe(false);
  });

  it('drops articles outside the filter but keeps the breadcrumb going', () => {
    const filtered = chunkLaw(CC_EXCERPT, { filter: { articles: ['1260'] } });
    expect(filtered.map((c) => c.articleLabel)).toEqual(['ementa', '1260']);
    expect(filtered[1].path[3]).toBe('CAPÍTULO III – Da Aquisição da Propriedade Móvel');
  });

  it('embeds with a hierarchical prefix', () => {
    const text = embedTextFor('Código Civil', byLabel('1240-A'));
    expect(text.split('\n')[0]).toBe(
      'Código Civil > PARTE ESPECIAL > LIVRO III – Do Direito das Coisas > TÍTULO III – Da Propriedade > CAPÍTULO II – Da Aquisição da Propriedade Imóvel > Seção I – Da Usucapião > Art. 1.240-A',
    );
  });
});

const CF_ART5 = [
  'TÍTULO II',
  'DOS DIREITOS E GARANTIAS FUNDAMENTAIS',
  'Art. 5º Todos são iguais perante a lei, sem distinção de qualquer natureza, garantindo-se aos brasileiros e aos estrangeiros residentes no País a inviolabilidade do direito à vida, à liberdade, à igualdade, à segurança e à propriedade, nos termos seguintes:',
  ...Array.from({ length: 30 }, (_, i) => {
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX'][i];
    return `${roman} - texto do inciso ${roman} ${'lorem ipsum dolor sit amet '.repeat(8)};`;
  }),
  'a) alínea do inciso XXX;',
  '§ 1º As normas definidoras dos direitos e garantias fundamentais têm aplicação imediata.',
].join('\n');

describe('chunkLaw — long articles and inciso filters', () => {
  it('splits an oversized article at inciso boundaries, repeating the caput', () => {
    const chunks = chunkLaw(CF_ART5, { maxChars: 2000 }).filter((c) => c.articleLabel === '5');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.startsWith('Art. 5º Todos são iguais')).toBe(true);
      expect(c.partLabel).toBeTruthy();
    }
    expect(chunks[0].partLabel!.startsWith('inciso I')).toBe(true);
    expect(chunks[chunks.length - 1].content).toContain('§ 1º');
  });

  it('keeps only the configured incisos (and their alíneas), plus caput and §§', () => {
    const [art] = chunkLaw(CF_ART5, { filter: { articles: ['5'], incisos: { '5': ['XXII', 'XXX'] } } }).filter(
      (c) => c.articleLabel === '5',
    );
    expect(art.content).toContain('XXII - texto');
    expect(art.content).toContain('XXX - texto');
    expect(art.content).toContain('a) alínea do inciso XXX');
    expect(art.content).not.toContain('\nXXI - texto');
    expect(art.content).not.toContain('\nI - texto');
    expect(art.content).toContain('§ 1º');
  });
});

describe('chunkLaw — ADCT numbering', () => {
  it('prefixes ADCT articles so they do not collide with the permanent text', () => {
    const text = 'Art. 5º Texto permanente.\nATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS\nArt. 5º Texto transitório.';
    const labels = chunkLaw(text).map((c) => c.articleLabel);
    expect(labels).toEqual(['5', 'ADCT-5']);
    expect(chunkLaw(text, { filter: { articles: ['5'] } }).map((c) => c.articleLabel)).toEqual(['5']);
  });
});

describe('planalto HTML fixture', () => {
  const html = readFileSync(path.join(__dirname, 'fixtures/lei-8009-excerpt.html'));
  const text = htmlToText(decodeHtml(html));
  const chunks = chunkLaw(text);

  it('drops page chrome and keeps the ementa', () => {
    expect(chunks[0].content).not.toContain('Casa Civil');
    expect(chunks[0].content).toContain('Dispõe sobre a impenhorabilidade do bem de família.');
  });

  it('removes struck-through wording and revoked incisos', () => {
    const art3 = chunks.find((c) => c.articleLabel === '3')!;
    expect(art3.content).not.toContain('trabalhadores da própria residência');
    expect(art3.content).not.toContain('Revogado');
    expect(art3.content).toContain('II - pelo titular do crédito');
    expect(art3.content).toContain('(Incluído pela Lei nº 8.245, de 1991)');
  });

  it('marks a vetoed article', () => {
    expect(chunks.find((c) => c.articleLabel === '7')!.isRevoked).toBe(true);
  });
});

const GUIDE = [
  'PENHORA — DO REGISTRO AO LEILÃO (texto de exemplo):',
  'A penhora é averbada na matrícula por ordem judicial e torna a constrição pública perante terceiros.',
  'HIPOTECA — DO REGISTRO AO LEILÃO:',
  'A hipoteca é registrada na matrícula e acompanha o imóvel até ser cancelada por averbação.',
].join('\n');

describe('chunkByHeadings (guides with ALL-CAPS sections)', () => {
  it('recognizes all-caps section headings only', () => {
    expect(isSectionHeading('PENHORA — DO REGISTRO AO LEILÃO (use para enriquecer a descrição factual):')).toBe(true);
    expect(isSectionHeading('Enquadre explicitamente o escopo da análise.')).toBe(false);
    expect(isSectionHeading('- SP_HABITE_SE_ALVARA_RISK: UF=SP')).toBe(false);
  });

  it('chunks a guide into one chunk per section', () => {
    const chunks = chunkByHeadings(GUIDE);
    expect(chunks.map((c) => c.path[0])).toEqual([
      'PENHORA — DO REGISTRO AO LEILÃO',
      'HIPOTECA — DO REGISTRO AO LEILÃO',
    ]);
    for (const c of chunks) {
      expect(c.articleLabel).toBeNull();
      expect(c.content.length).toBeGreaterThan(50);
    }
  });

  it('skips a heading with no body', () => {
    expect(chunkByHeadings('SEÇÃO VAZIA:\nOUTRA SEÇÃO:\nCorpo da outra seção.').map((c) => c.path[0])).toEqual([
      'OUTRA SEÇÃO',
    ]);
  });
});
