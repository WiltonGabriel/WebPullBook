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
import { novelBinParser } from './novelbin.js';
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
  novelBinParser,
  genericHtmlParser
]);

export const PARSERS = parserRegistry.parsers;

export function getParserById(id) {
  return parserRegistry.getById(id);
}

export function selectParser(doc, parserId = 'auto', url = '') {
  return parserRegistry.detect(doc, url, parserId);
}

/**
 * Resolve the best parser for an individual chapter URL, enabling multi-domain
 * series (e.g. Merge Tabs or translator aggregator hubs) to match each host cleanly.
 */
export function resolveParserForChapterUrl(
  chapterUrl,
  fallbackParser = genericHtmlParser,
  parserId = 'auto',
  seriesUrl = ''
) {
  if (parserId && parserId !== 'auto') {
    return getParserById(parserId) || fallbackParser || genericHtmlParser;
  }
  if (!chapterUrl || !/^https?:\/\//i.test(chapterUrl)) {
    return fallbackParser || genericHtmlParser;
  }

  let chHost = '';
  let seriesHost = '';
  try {
    chHost = new URL(chapterUrl).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return fallbackParser || genericHtmlParser;
  }
  try {
    seriesHost = seriesUrl ? new URL(seriesUrl).hostname.replace(/^www\./i, '').toLowerCase() : '';
  } catch {
    seriesHost = '';
  }

  if (seriesHost && chHost === seriesHost && fallbackParser) {
    return fallbackParser;
  }

  // Probe URL-affinity scores with an empty lightweight document stub
  const emptyDoc = { querySelector: () => null, querySelectorAll: () => [] };
  let best = null;
  let bestScore = 0;
  for (const parser of parserRegistry.parsers) {
    if (parser.id === 'generic-html') continue;
    const score = Number(parser.matchScore(emptyDoc, chapterUrl)) || 0;
    if (score >= 25 && score > bestScore) {
      bestScore = score;
      best = parser;
    }
  }
  if (best) return best;
  if (seriesHost && chHost !== seriesHost) {
    return genericHtmlParser;
  }
  return fallbackParser || genericHtmlParser;
}

const KNOWN_SSR_CONTENT_SELECTOR =
  '.eplister, .epcontent, .ts-chl-collapsible, .wp-manga-chapter, .reading-content, table#chapters, .chapter-inner, ol.toc_ol, #chp_raw, .fic_title, [data-testid="novel-synopsis"], #reader-chapter-title, .chapter-list a.chapter-item';

function analyzeVisibleBodyDom(doc) {
  const body = doc?.body;
  if (!body) {
    return { visibleText: '', linkCount: 0, paragraphCount: 0, skeletonCount: 0 };
  }
  const clone = body.cloneNode(true);
  for (const hidden of clone.querySelectorAll('script, style, noscript, template')) {
    hidden.remove();
  }
  return {
    visibleText: normalizeSpaces(clone.textContent || ''),
    linkCount: clone.querySelectorAll('a[href]').length,
    paragraphCount: clone.querySelectorAll('p').length,
    skeletonCount: clone.querySelectorAll('.skeleton, [class*="skeleton-"]').length
  };
}

export function looksLikeSpaShell(doc) {
  if (!doc || !doc.body) return false;
  if (doc.querySelector(KNOWN_SSR_CONTENT_SELECTOR)) return false;

  const { visibleText, linkCount, paragraphCount, skeletonCount } = analyzeVisibleBodyDom(doc);

  // Normal SSR pages with real readable content or navigation are never SPA shells
  if (visibleText.length >= 300 || paragraphCount >= 3 || linkCount >= 12) {
    return false;
  }

  const hasEmptySpaMount = Boolean(doc.querySelector('#root:empty, #app:empty, #__next:empty, #__nuxt:empty'));
  const hasModuleOrBundleScript = doc.querySelectorAll('script[src], script[type="module"]').length > 0;
  const noscriptText = Array.from(doc.querySelectorAll('noscript'))
    .map((n) => normalizeSpaces(n.textContent || ''))
    .join(' ');
  const hasJsGateMessage = /enable\s+javascript|javascript\s+is\s+(?:required|disabled)|ative\s+o\s+javascript/i.test(
    `${visibleText} ${noscriptText}`
  );

  if (skeletonCount >= 2 && visibleText.length < 220 && linkCount < 6 && hasModuleOrBundleScript) {
    return true;
  }
  if (hasEmptySpaMount && visibleText.length < 180) return true;
  if (visibleText.length < 120 && linkCount < 3 && (hasModuleOrBundleScript || hasJsGateMessage)) {
    return true;
  }
  if (visibleText.length < 180 && hasJsGateMessage && linkCount < 5) {
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
        preferOpenTab: effectiveOptions.preferOpenTabDom !== false,
        signal
      });
      effectiveOptions = { ...effectiveOptions, renderWithTab: true, _usedTabFallback: true };
      usedAutoSpa = true;
    } else {
      throw err;
    }
  }

  const initialScores = parserRegistry.scoreAll(initialDoc, initialUrl);
  const topInitialScore = initialScores[0]?.score || 0;

  if (
    !effectiveOptions.renderWithTab &&
    effectiveOptions.autoFallbackTab !== false &&
    canUseTabScripting() &&
    topInitialScore < 30 &&
    looksLikeSpaShell(initialDoc)
  ) {
    effectiveOptions.onLog?.(`[SPA] Página parece SPA vazia -> tentando captura via aba em ${initialUrl}`, 'debug');
    try {
      initialDoc = await fetchRenderedTabDocument(initialUrl, {
        waitMs: effectiveOptions.renderWaitMs ?? 1100,
        preferOpenTab: effectiveOptions.preferOpenTabDom !== false,
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

  // Intelligent SPA fallback: if static parse yielded 0 chapters and BaseParser did NOT already try tab rendering, retry once
  if (
    (series.chapters || []).length === 0 &&
    !effectiveOptions.renderWithTab &&
    !effectiveOptions._usedTabFallback &&
    !series.requiresTabRender &&
    !series._attemptedTabFallback &&
    effectiveOptions.autoFallbackTab !== false &&
    canUseTabScripting()
  ) {
    effectiveOptions.onLog?.(`[SPA] 0 capítulos no HTML estático -> tentando aba renderizada em ${initialUrl}`, 'debug');
    try {
      const renderedDoc = await fetchRenderedTabDocument(initialUrl, {
        waitMs: Math.max(effectiveOptions.renderWaitMs ?? 1100, 1200),
        preferOpenTab: effectiveOptions.preferOpenTabDom !== false,
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
