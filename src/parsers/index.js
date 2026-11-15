import {
  canUseTabScripting,
  fetchDocumentWithOptions,
  fetchRenderedTabDocument,
  normalizeSpaces,
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

  scoreAll(doc, url) {
    return this.parsers
      .map((parser) => ({ id: parser.id, name: parser.name, score: Number(parser.matchScore(doc, url)) || 0 }))
      .sort((a, b) => b.score - a.score);
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

function looksLikeSpaShell(doc) {
  if (!doc) return false;
  if (doc.querySelectorAll('a[href]').length < 2) return true;
  if (doc.querySelector('#root:empty, #app:empty, #__next:empty, #__nuxt:empty')) return true;
  const bodyText = normalizeSpaces(doc.body?.textContent || '');
  if (bodyText.length < 180 && doc.querySelectorAll('script[src], script[type="module"]').length > 0) {
    return true;
  }
  if (/enable\s+javascript|javascript\s+is\s+(?:required|disabled)|ative\s+o\s+javascript/i.test(bodyText)) {
    return true;
  }
  return false;
}

export async function loadSeriesWithParser(inputUrl, options = {}, signal) {
  const initialUrl = normalizeUrl(inputUrl);
  let effectiveOptions = { ...options };
  let initialDoc;
  let usedAutoSpa = Boolean(effectiveOptions.renderWithTab);

  try {
    initialDoc = await fetchDocumentWithOptions(initialUrl, effectiveOptions, signal);
    if (initialDoc?._wpbRenderedByTab) {
      effectiveOptions = { ...effectiveOptions, renderWithTab: true, _usedTabFallback: true };
      usedAutoSpa = true;
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
      usedAutoSpa = true;
    } else {
      throw err;
    }
  }

  if (
    !effectiveOptions.renderWithTab &&
    effectiveOptions.autoFallbackTab !== false &&
    canUseTabScripting() &&
    looksLikeSpaShell(initialDoc)
  ) {
    try {
      initialDoc = await fetchRenderedTabDocument(initialUrl, {
        waitMs: effectiveOptions.renderWaitMs ?? 1100,
        signal
      });
      effectiveOptions = { ...effectiveOptions, renderWithTab: true, _usedTabFallback: true };
      usedAutoSpa = true;
    } catch {
      // Continue with static document if tab render fails
    }
  }

  let parser = parserRegistry.detect(initialDoc, initialUrl, effectiveOptions.parserId || 'auto');
  const scoreSummary = parserRegistry
    .scoreAll(initialDoc, initialUrl)
    .slice(0, 3)
    .map((s) => `${s.id}=${s.score}`)
    .join(', ');
  effectiveOptions.onLog?.(`[PARSER] Selecionado "${parser.name}" (${scoreSummary})`, 'debug');
  let series = await parser.loadSeries(initialUrl, effectiveOptions, signal, initialDoc);

  // Intelligent SPA fallback: if static parse yielded 0 chapters even with nav links, retry via rendered tab once
  if (
    (series.chapters || []).length === 0 &&
    !effectiveOptions.renderWithTab &&
    effectiveOptions.autoFallbackTab !== false &&
    canUseTabScripting()
  ) {
    effectiveOptions.onLog?.(`[SPA] 0 capítulos no HTML estático -> tentando aba renderizada em ${initialUrl}`, 'debug');
    try {
      const renderedDoc = await fetchRenderedTabDocument(initialUrl, {
        waitMs: Math.max(effectiveOptions.renderWaitMs ?? 1100, 1200),
        signal
      });
      const renderedOpts = { ...effectiveOptions, renderWithTab: true, _usedTabFallback: true };
      const renderedParser = parserRegistry.detect(renderedDoc, initialUrl, renderedOpts.parserId || 'auto');
      const renderedSeries = await renderedParser.loadSeries(initialUrl, renderedOpts, signal, renderedDoc);
      if ((renderedSeries.chapters || []).length > 0) {
        initialDoc = renderedDoc;
        parser = renderedParser;
        series = { ...renderedSeries, requiresTabRender: true };
        usedAutoSpa = true;
      }
    } catch {
      // Keep initial static result if rendered fallback fails
    }
  }

  return {
    parser,
    series,
    initialDoc,
    usedAutoSpa
  };
}
