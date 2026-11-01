import { describe, expect, it } from 'vitest';
import { articleInFilter, incisoRangeFor, parseFilter } from '../filter';
import { compareLabels, formatArticleLabel, normalizeArticleLabel, romanToInt } from '../labels';

describe('normalizeArticleLabel', () => {
  it.each([
    ['1.240-A', '1240-A'],
    ['1240a', '1240-A'],
    ['5º', '5'],
    ['4o-A', '4-A'],
    ['1.499', '1499'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeArticleLabel(raw)).toBe(expected);
  });

  it('rejects text that is not an article number', () => {
    expect(normalizeArticleLabel('único')).toBeNull();
    expect(normalizeArticleLabel('')).toBeNull();
  });
});

describe('compareLabels / formatArticleLabel', () => {
  it('orders by number, then the bare label before its suffixes', () => {
    expect(compareLabels('185', '185-A')!).toBeLessThan(0);
    expect(compareLabels('185-A', '186')!).toBeLessThan(0);
    expect(compareLabels('185-B', '185-A')!).toBeGreaterThan(0);
    expect(compareLabels('ementa', '1')).toBeNull();
  });

  it('formats the citation form', () => {
    expect(formatArticleLabel('1240-A')).toBe('1.240-A');
    expect(formatArticleLabel('5')).toBe('5º');
    expect(formatArticleLabel('10')).toBe('10');
  });
});

describe('romanToInt', () => {
  it('reads well-formed numerals and rejects the rest', () => {
    expect(romanToInt('XXII')).toBe(22);
    expect(romanToInt('XLIX')).toBe(49);
    expect(romanToInt('xii')).toBeNull();
  });
});

describe('filters', () => {
  it('matches single labels, inclusive ranges and heading paths', () => {
    const f = parseFilter({ articles: ['313', ['185', '185-A']], paths: ['direito das coisas'] })!;
    expect(articleInFilter('313', [], f)).toBe(true);
    expect(articleInFilter('185-A', [], f)).toBe(true);
    expect(articleInFilter('186', [], f)).toBe(false);
    expect(articleInFilter('1238', ['LIVRO III – Do Direito das Coisas'], f)).toBe(true);
  });

  it('keeps everything when there is no filter', () => {
    expect(articleInFilter('1', [], null)).toBe(true);
    expect(articleInFilter('1', [], { all: true })).toBe(true);
  });

  it('resolves the inciso range of one article', () => {
    const f = parseFilter('{"articles":["5"],"incisos":{"5º":["XXII","XXX"]}}');
    expect(incisoRangeFor('5', f)).toEqual([22, 30]);
    expect(incisoRangeFor('6', f)).toBeNull();
  });

  it('rejects malformed filters with a readable message', () => {
    expect(() => parseFilter([])).toThrow('Filtro deve ser um objeto JSON');
    expect(() => parseFilter({ articles: ['abc'] })).toThrow('Artigo inválido');
    expect(() => parseFilter({ incisos: { '5': ['XXII', '30'] } })).toThrow('incisos inválido');
  });
});
