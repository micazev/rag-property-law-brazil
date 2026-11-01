export {
  chunkLaw,
  chunkByHeadings,
  embedTextFor,
  isSectionHeading,
  type KnowledgeChunk,
  type ChunkLawOptions,
} from './chunk-law';
export {
  articleInFilter,
  incisoRangeFor,
  parseFilter,
  foldText,
  type KnowledgeFilter,
  type ArticleSpec,
} from './filter';
export {
  normalizeArticleLabel,
  parseLabel,
  compareLabels,
  formatArticleLabel,
  romanToInt,
  type ParsedLabel,
} from './labels';
export {
  extractKnowledgeText,
  htmlToText,
  decodeHtml,
  decodeEntities,
  cleanPdfPages,
  normalizeLines,
  detectMime,
  type KnowledgeMime,
} from './extract';
export { dropRepeatedLines } from './repeated-lines';
