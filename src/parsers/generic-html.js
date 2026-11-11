import {
  BaseParser,
  extractVolumeLabel,
  normalizeSpaces,
  normalizeUrl
} from '../core/parser-engine.js';

const EXCLUDED_CONTAINER_SELECTOR = 'nav, header, footer, aside, .menu, .navbar, .sidebar, #sidebar, #comments, .comments, .pagination, .breadcrumb';
const CHAPTER_HINT_RX = /(?:cap[íi]tulo|chapter|cap\.?|ch\.?|ep\.?|epis[óo]dio|episode|part|parte|volume|vol\.?|book|livro)/i;
const URL_HINT_RX = /(?:cap|chapter|ch|ep|vol|parte|read|lesson|section)[-_/\d]/i;

/**
 * Intelligent fallback adapter using DOM cluster scoring for chapter indexes
 * and Readability-inspired prose scoring for chapter bodies.
 */
export class GenericHtmlParser extends BaseParser {
  constructor() {
    super({
      id: 'generic-html',
      name: 'Generic Web Page Extractor'
    });
  }

  matchScore(doc) {
    if (doc.querySelector('.chapter-list, .chapters, #chapter-list, .toc')) {
      return 35;
    }
    return 10;
  }

  _isNoiseRegion(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(el.closest(EXCLUDED_CONTAINER_SELECTOR));
  }

  _extractSameOriginLinks(container, targetUrl, baseOrigin) {
    const links = [];
    const seen = new Set();
    for (const a of container.querySelectorAll('a[href]')) {
      if (this._isNoiseRegion(a)) continue;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;

      let absUrl;
      try {
        const u = new URL(href, targetUrl);
        if (u.origin !== baseOrigin) continue;
        u.hash = '';
        absUrl = u.toString();
      } catch {
        continue;
      }
      if (absUrl === targetUrl || seen.has(absUrl)) continue;
      const text = normalizeSpaces(a.textContent);
      if (!text || text.length > 180) continue;
      seen.add(absUrl);
      links.push({ url: absUrl, text });
    }
    return links;
  }

  _scoreListCandidate(container, targetUrl, baseOrigin, context = {}) {
    if (this._isNoiseRegion(container)) return { score: -999, links: [] };
    const links = this._extractSameOriginLinks(container, targetUrl, baseOrigin);
    if (links.length === 0) return { score: -1, links };

    const knownPrefixes = context?.knownPrefixes || new Set();
    let matchesKnownPrefix = false;
    let chapterHints = 0;
    let urlHints = 0;
    let numericHints = 0;
    const prefixCounts = new Map();

    for (const l of links) {
      if (CHAPTER_HINT_RX.test(l.text)) chapterHints++;
      if (URL_HINT_RX.test(l.url)) urlHints++;
      if (/\d+/.test(l.text)) numericHints++;
      try {
        const parts = new URL(l.url).pathname.split('/').filter(Boolean);
        const prefix = parts.length > 1 ? `/${parts[0]}/` : '/';
        if (knownPrefixes.has(prefix)) matchesKnownPrefix = true;
        prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
      } catch {
        // ignore
      }
    }

    if (links.length < 2 && !matchesKnownPrefix && chapterHints === 0 && urlHints === 0) {
      return { score: -1, links };
    }

    const maxPrefixShare = Math.max(0, ...prefixCounts.values()) / links.length;
    const textChars = normalizeSpaces(container.textContent).length || 1;
    const linkChars = links.reduce((sum, l) => sum + l.text.length, 0);
    const linkCoverage = linkChars / textChars;

    let score = links.length * 1.5;
    score += chapterHints * 3;
    score += urlHints * 2;
    score += numericHints * 1.2;
    if (matchesKnownPrefix) score += 20;
    if (maxPrefixShare > 0.7 && links.length >= 2) score += 15;
    if (linkCoverage > 0.45) score += 10;
    if (container.matches('.chapter-list, .chapters, #chapter-list, .toc, [class*="chapter"], [id*="chapter"]')) {
      score += 30;
    }

    return { score, links };
  }

  collectChapterNodes(doc, targetUrl, _options = {}, context = {}) {
    const baseOrigin = new URL(targetUrl).origin;

    // 1. Direct explicit TOC containers first
    const explicit = doc.querySelector('.chapter-list, .chapters, #chapter-list, .toc');
    if (explicit) {
      const directLinks = this._extractSameOriginLinks(explicit, targetUrl, baseOrigin);
      if (directLinks.length > 0) {
        return directLinks.map((l) => ({
          url: l.url,
          numText: '',
          titleText: l.text,
          dateText: '',
          displayTitle: l.text,
          volume: extractVolumeLabel('', l.text, l.url),
          included: true
        }));
      }
    }

    // 2. Score candidate list/block containers across main/body
    const root = doc.querySelector('main, article') || doc.body;
    const candidates = Array.from(root.querySelectorAll('ul, ol, table, div, section'));
    let best = { score: 0, links: [] };

    for (const el of candidates) {
      const evaluated = this._scoreListCandidate(el, targetUrl, baseOrigin, context);
      if (evaluated.score > best.score) {
        best = evaluated;
      }
    }

    const filtered = best.score >= 12
      ? best.links
      : this._extractSameOriginLinks(root, targetUrl, baseOrigin).filter(
          (l) => CHAPTER_HINT_RX.test(l.text) || URL_HINT_RX.test(l.url)
        );

    return filtered.map((l) => ({
      url: l.url,
      numText: '',
      titleText: l.text,
      dateText: '',
      displayTitle: l.text,
      volume: extractVolumeLabel('', l.text, l.url),
      included: true
    }));
  }

  /**
   * Readability-inspired prose container scorer when explicit chapter selectors are absent.
   */
  findChapterContentRoot(doc) {
    const explicit = doc.querySelector(
      '.epcontent, .chapter-content, #chapter-content, .reading-content, .entry-content'
    );
    if (explicit) return explicit;

    const candidates = Array.from(doc.querySelectorAll('article, main, div, section'));
    let bestEl = null;
    let bestScore = 0;

    for (const el of candidates) {
      if (this._isNoiseRegion(el)) continue;
      const blocks = Array.from(el.querySelectorAll('p, blockquote, li')).filter((b) => !this._isNoiseRegion(b));
      if (blocks.length === 0) continue;

      let pTextLen = 0;
      let commaCount = 0;
      for (const blk of blocks) {
        const txt = normalizeSpaces(blk.textContent);
        pTextLen += txt.length;
        commaCount += (txt.match(/[,.;!?—]/g) || []).length;
      }
      if (pTextLen < 40) continue;

      const totalLen = normalizeSpaces(el.textContent).length || 1;
      const linkLen = Array.from(el.querySelectorAll('a')).reduce(
        (sum, a) => sum + normalizeSpaces(a.textContent).length,
        0
      );
      const linkDensity = linkLen / totalLen;
      if (linkDensity > 0.35) continue;

      const nonProseOverhead = Math.max(0, totalLen - pTextLen);
      let score = pTextLen * 0.1 + commaCount * 2 - linkDensity * 200 - nonProseOverhead * 0.05;
      if (el.tagName.toLowerCase() === 'article') score += 40;
      if (el.tagName.toLowerCase() === 'main') score += 25;

      // Prefer tighter inner containers when score is equal or higher
      if (score >= bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    return bestEl || doc.querySelector('article, main');
  }
}

export const genericHtmlParser = new GenericHtmlParser();
