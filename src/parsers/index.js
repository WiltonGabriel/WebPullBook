import {
  canUseTabScripting,
  fetchDocumentWithOptions,
  fetchRenderedTabDocument,
  normalizeUrl
} from '../core/parser-engine.js';
import { wpLightNovelParser } from './wp-lightnovel.js';
import { madaraThemeParser } from './madara-theme.js';
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
  let initialDoc = await fetchDocumentWithOptions(initialUrl, options, signal);

  if (
    !options.renderWithTab &&
    options.autoFallbackTab !== false &&
    canUseTabScripting() &&
    initialDoc.querySelectorAll('a[href]').length < 2
  ) {
    try {
      initialDoc = await fetchRenderedTabDocument(initialUrl, {
        waitMs: options.renderWaitMs ?? 1100,
        signal
      });
    } catch {
      // Continue with static document if tab render fails
    }
  }

  const parser = parserRegistry.detect(initialDoc, initialUrl, options.parserId || 'auto');
  const series = await parser.loadSeries(initialUrl, options, signal, initialDoc);

  return {
    parser,
    series
  };
}
