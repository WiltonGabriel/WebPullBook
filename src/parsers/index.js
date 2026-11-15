import {
  canUseTabScripting,
  fetchDocumentWithOptions,
  fetchRenderedTabDocument,
  normalizeUrl
} from '../core/parser-engine.js';
import { wpLightNovelParser } from './wp-lightnovel.js';
import { madaraThemeParser } from './madara-theme.js';
import { royalRoadParser } from './royalroad.js';
import { scribbleHubParser } from './scribblehub.js';
import { novelManiaParser } from './novelmania.js';
import { genericHtmlParser } from './generic-html.js';

/**
 * Polymorphic registry ranking parsers by DOM match confidence.
 */
export class ParserRegistry {
  constructor(parsers = []) {
    this.parsers = [...parsers];
  }

  register(parser) {
    this.parsers.push(parser);
  }

  getById(id) {
    return this.parsers.find((p) => p.id === id) || null;
  }

  list() {
    return this.parsers.map((p) => ({ id: p.id, name: p.name }));
  }

  detect(doc, url, forcedId = 'auto') {
    if (forcedId && forcedId !== 'auto') {
      const explicit = this.getById(forcedId);
      if (explicit) return explicit;
    }

    let bestParser = genericHtmlParser;
    let bestScore = -1;
    for (const parser of this.parsers) {
      const score = Number(parser.matchScore(doc, url)) || 0;
      if (score > bestScore) {
        bestScore = score;
        bestParser = parser;
      }
    }
    return bestParser;
  }
}

export const parserRegistry = new ParserRegistry([
  wpLightNovelParser,
  madaraThemeParser,
  royalRoadParser,
  scribbleHubParser,
  novelManiaParser,
  genericHtmlParser
]);

export const PARSERS = parserRegistry.parsers;

export function getParserById(id) {
  return parserRegistry.getById(id);
}

export function selectParser(doc, parserId = 'auto', url = '') {
  return parserRegistry.detect(doc, url, parserId);
}

export async function loadSeriesWithParser(inputUrl, options = {}, signal) {
  const initialUrl = normalizeUrl(inputUrl);
  let effectiveOptions = { ...options };
  let initialDoc;

  try {
    initialDoc = await fetchDocumentWithOptions(initialUrl, effectiveOptions, signal);
    if (initialDoc?._wpbRenderedByTab) {
      effectiveOptions = { ...effectiveOptions, renderWithTab: true, _usedTabFallback: true };
    }
  } catch (err) {
    if (
      !effectiveOptions.renderWithTab &&
      effectiveOptions.autoFallbackTab !== false &&
      canUseTabScripting() &&
      !err.isRateLimit &&
      (err.status === 403 || err.status === 503)
    ) {
      initialDoc = await fetchRenderedTabDocument(initialUrl, {
        waitMs: effectiveOptions.renderWaitMs ?? 1100,
        signal
      });
      effectiveOptions = { ...effectiveOptions, renderWithTab: true, _usedTabFallback: true };
    } else {
      throw err;
    }
  }

  if (
    !effectiveOptions.renderWithTab &&
    effectiveOptions.autoFallbackTab !== false &&
    canUseTabScripting() &&
    initialDoc.querySelectorAll('a[href]').length < 2
  ) {
    try {
      initialDoc = await fetchRenderedTabDocument(initialUrl, {
        waitMs: effectiveOptions.renderWaitMs ?? 1100,
        signal
      });
      effectiveOptions = { ...effectiveOptions, renderWithTab: true, _usedTabFallback: true };
    } catch {
      // Continue with static document if tab render fails
    }
  }

  const parser = parserRegistry.detect(initialDoc, initialUrl, effectiveOptions.parserId || 'auto');
  const series = await parser.loadSeries(initialUrl, effectiveOptions, signal, initialDoc);

  return {
    parser,
    series
  };
}
