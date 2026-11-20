/**
 * Backwards-compatible barrel facade re-exporting core parser engine modules.
 * Each responsibility now lives in its own focused SRP module.
 */
export { DEFAULT_EPUB_CSS, buildEpubStylesheet } from './epub-css.js';
export {
  FOLDER_LAYOUT_TEMPLATES,
  buildOutputPath,
  ensureAscendingChapterOrder,
  extractCleanSynopsis,
  extractVolumeLabel,
  extractVolumeNumber,
  normalizeSpaces,
  normalizeUrl,
  resolveSafeHttpUrl,
  sanitizeFilename,
  sanitizePathSegment,
  toHighResCoverUrl
} from './text-utils.js';
export {
  PageDomCache,
  TabRenderPool,
  assertSafeHttpUrl,
  canUseTabScripting,
  clearSpaDomainCircuit,
  decodeHtmlBytes,
  fetchDocumentWithOptions,
  fetchHtmlDocument,
  fetchRenderedTabDocument,
  fetchWithRetry,
  isAntiBotChallengeDocument,
  isRateLimitDocument,
  isSpaDomainCircuitOpen,
  readOpenTabDocument,
  sleep,
  tripSpaDomainCircuit,
  waitForTabComplete
} from './net-fetcher.js';
export { AdaptiveRateLimiter } from './rate-limiter.js';
export { BaseParser, downloadAndParseChapter } from './base-parser.js';
export { generateCssSelector } from './selector-utils.js';
