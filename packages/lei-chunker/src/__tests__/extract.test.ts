import { describe, expect, it } from 'vitest';
import { cleanPdfPages, decodeEntities, decodeHtml, detectMime, htmlToText } from '../extract';

describe('decodeHtml', () => {
  it('falls back to windows-1252 for planalto pages without a charset', () => {
    const bytes = Buffer.from([0x41, 0x72, 0x74, 0x2e, 0x20, 0x31, 0xba, 0x20, 0x49, 0x6d, 0xf3, 0x76, 0x65, 0x6c]);
    expect(decodeHtml(bytes)).toBe('Art. 1º Imóvel');
  });

  it('keeps valid UTF-8 as UTF-8', () => {
    expect(decodeHtml(Buffer.from('<p>Imóvel</p>', 'utf8'))).toBe('<p>Imóvel</p>');
  });
});

describe('htmlToText', () => {
  it('removes struck-through (superseded) wording with its content', () => {
    const text = htmlToText('<p>Art. 1º <strike>Texto antigo.</strike> Texto novo.</p><p><s>velho</s><del>x</del>Art. 2º Vigente.</p>');
    expect(text).toBe('Art. 1º Texto novo.\nArt. 2º Vigente.');
  });

  it('turns data tables into Markdown and layout tables into lines', () => {
    const text = htmlToText(
      '<table><tr><th>Categoria</th><th>Coeficiente</th></tr><tr><td>até 10.188</td><td>0,6</td></tr></table>' +
        '<table><tr><td><p>Art. 3º Parágrafo em tabela de layout.</p></td></tr></table>',
    );
    expect(text).toContain('| Categoria | Coeficiente |');
    expect(text).toContain('| até 10.188 | 0,6 |');
    expect(text).toContain('Art. 3º Parágrafo em tabela de layout.');
  });

  it('decodes the entities planalto uses', () => {
    expect(decodeEntities('Art. 1&ordm; &sect; 2&ordm; im&oacute;vel &ccedil; &#225; &#xE9;')).toBe('Art. 1º § 2º imóvel ç á é');
  });
});

describe('cleanPdfPages', () => {
  it('drops browser print headers/footers and re-joins hyphenated words', () => {
    const bodies = [
      'Art. 1º O locatário tem prefe-\nrência na aquisição.',
      'Art. 2º A locação poderá ser ajustada por qualquer prazo.',
      'Art. 3º O contrato pode ser averbado na matrícula.',
    ];
    const pages = bodies.map(
      (body, i) => `27/10/2026, 10:15 L8245\n${body}\nhttps://www.planalto.gov.br/ccivil_03/leis/l8245.htm\nPage ${i + 1} of 21`,
    );
    const text = cleanPdfPages(pages);
    expect(text).not.toMatch(/Page \d of 21/);
    expect(text).not.toContain('https://');
    expect(text).not.toContain('10:15');
    expect(text).toContain('Art. 1º O locatário tem preferência na aquisição.');
  });

  it('keeps the hyphen of an enclitic split across lines', () => {
    expect(cleanPdfPages(['Art. 1º Aquele que possuir adquirir-\nlhe-á a propriedade.'])).toBe(
      'Art. 1º Aquele que possuir adquirir-lhe-á a propriedade.',
    );
  });
});

describe('detectMime', () => {
  it('maps extensions and declared types', () => {
    expect(detectMime('l8009.htm')).toBe('text/html');
    expect(detectMime('x', 'text/html; charset=windows-1252')).toBe('text/html');
    expect(detectMime('lei.PDF')).toBe('application/pdf');
    expect(detectMime('guia.md')).toBe('text/markdown');
    expect(detectMime('a.docx')).toBeNull();
  });
});
