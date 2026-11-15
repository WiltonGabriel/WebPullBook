import {
  BaseParser,
  extractVolumeLabel,
  fetchDocumentWithOptions,
  normalizeSpaces,
  normalizeUrl
} from '../core/parser-engine.js';

const EXCLUDED_CONTAINER_SELECTOR =
  'nav, header, footer, aside, .menu, .navbar, .sidebar, #sidebar, #comments, .comments, [id*="comments" i], [id*="comentarios" i], [class*="related" i], [id*="parecidas" i], [class*="recommend" i], .pagination, .breadcrumb';
const CHAPTER_HINT_RX = /(?:cap[íi]tulo|chapter|cap\.?|ch\.?|ep\.?|epis[óo]dio|episode|part|parte|volume|vol\.?|book|livro|pr[óo]logo|prologue|ep[íi]logo|epilogue)/i;
const URL_HINT_RX = /(?:cap|chapter|ch|ep|vol|parte|read|lesson|section)[-_/\d]/i;
const TAXONOMY_PATH_RX = /(?:^|\/)(?:genero|generos|genre|genres|tag|tags|category|categories|categoria|categorias|author|authors|autor|autores|perfil|profile|user|users|login|register|signup|search|busca|sobre|about|contato|contact|privacy|terms)(?:\/|$)/i;
const CTA_TEXT_RX = /^(?:come[çc]ar\s+a\s+ler|continuar\s+lendo|start\s+reading|read\s+first|continue\s+reading)$/i;
const NEXT_CHAPTER_RX =
  /^(?:next(?:\s+(?:chapter|part|page|ep(?:isode)?))?|pr[óo]xim[oa](?:\s+(?:cap[íi]tulo|parte|p[áa]gina|epis[óo]dio))?|cap[íi]tulo\s+seguinte|seguinte|avan[çc]ar|siguiente(?:\s+cap[íi]tulo)?|»+|›+|→)$/i;
const UTILITY_CLASS_RX = /^(?:flex|inline-flex|grid|block|inline-block|hidden|relative|absolute|fixed|sticky|prose|container|mx-auto|(?:m|p|px|py|pt|pb|pl|pr|mt|mb|ml|mr|gap|space-[xy]|w|h|min-w|min-h|max-w|max-h|text|bg|border|rounded|shadow|overflow|items|justify|self|col|row|z)-.+|_[a-zA-Z0-9_-]{4,}|[a-zA-Z0-9-]+_[a-zA-Z0-9]{5,})$/;
const VOLUME_HEADING_RX = /\b(?:vol(?:ume)?\.?\s*\d+|book\s*\d+|livro\s*\d+|tome\s*\d+|ano\s*\d+|part(?:e)?\s*(?:\d+|[ivx]+))/i;

function isDescendantOf(child, ancestor) {
  let cur = child?.parentElement;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parentElement;
  }
  return false;
}

function escapeCssIdent(ident) {
  return String(ident).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function isStableId(id) {
  return Boolean(id) && !/^\d/.test(id) && !/^:?r\d+:?$/i.test(id) && !/_[a-zA-Z0-9]{6,}$/.test(id);
}

function getElementSimpleSelector(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'body' || tag === 'main' || tag === 'article') {
    const id = el.getAttribute('id') || '';
    if (isStableId(id)) return `#${escapeCssIdent(id)}`;
  }
  const id = el.getAttribute('id') || '';
  if (isStableId(id)) {
    return `#${escapeCssIdent(id)}`;
  }
  const rawClass = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
  const stableClasses = rawClass
    .trim()
    .split(/\s+/)
    .filter((c) => c && !UTILITY_CLASS_RX.test(c));
  if (stableClasses.length > 0) {
    return `${tag}.${stableClasses.slice(0, 2).map(escapeCssIdent).join('.')}`;
  }
  return tag;
}

function buildReadableSelector(el, doc, suffix = '') {
  if (!el || !doc) return '';
  const candidates = [];
  const base = getElementSimpleSelector(el);
  if (base) candidates.push(base);

  let ancestor = el.parentElement;
  let chain = base;
  for (let depth = 0; depth < 3 && ancestor && ancestor.tagName.toLowerCase() !== 'html'; depth++) {
    const part = getElementSimpleSelector(ancestor);
    chain = `${part} > ${chain}`;
    candidates.push(chain);
    if (part.startsWith('#') || part.includes('.')) {
      candidates.push(`${part} ${base}`);
    }
    if (ancestor.tagName.toLowerCase() === 'body') break;
    ancestor = ancestor.parentElement;
  }

  for (const sel of candidates) {
    const full = suffix ? `${sel} ${suffix}` : sel;
    try {
      const matched = doc.querySelectorAll(full);
      if (suffix) {
        if (matched.length > 0 && Array.from(matched).every((node) => node === el || isDescendantOf(node, el))) {
          return full;
        }
      } else if (matched.length === 1 && matched[0] === el) {
        return full;
      } else if (matched.length > 0 && matched[0] === el && (sel.startsWith('#') || sel.includes('.'))) {
        return full;
      }
    } catch {
      // Skip invalid candidate selector
    }
  }

  const fallback = candidates[candidates.length - 1] || base;
  return suffix && fallback ? `${fallback} ${suffix}` : fallback;
}

/**
 * Intelligent fallback adapter using DOM cluster scoring for chapter indexes
 * and Readability-inspired prose scoring for chapter bodies.
 */
export class GenericHtmlParser extends BaseParser {
  constructor() {
    super({
      id: 'generic-html',
      name: 'Universal Smart Extractor'
    });
  }

  matchScore(doc) {
    if (doc.querySelector('.chapter-list, .chapters, #chapter-list, .toc')) {
      return 35;
    }
    return 20;
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
      let pathname = '';
      try {
        const u = new URL(href, targetUrl);
        if (u.origin !== baseOrigin) continue;
        pathname = u.pathname || '';
        if (TAXONOMY_PATH_RX.test(pathname)) continue;
        u.hash = '';
        absUrl = u.toString();
      } catch {
        continue;
      }
      if (absUrl === targetUrl || seen.has(absUrl)) continue;

      const timeEl = a.querySelector('time');
      let text;
      if (timeEl) {
        const clone = a.cloneNode(true);
        for (const t of clone.querySelectorAll('time')) t.remove();
        text = normalizeSpaces(clone.textContent);
      } else {
        text = normalizeSpaces(a.textContent);
      }
      if (!text || text.length > 180 || CTA_TEXT_RX.test(text)) continue;

      const dateText = timeEl
        ? (timeEl.getAttribute('datetime') || '').slice(0, 10) || normalizeSpaces(timeEl.textContent)
        : '';

      seen.add(absUrl);
      links.push({ url: absUrl, text, dateText, el: a });
    }
    return links;
  }

  _inferVolumeFromAncestors(linkEl, stopEl, text, url) {
    const explicit = extractVolumeLabel('', text, url);
    if (/\b(?:vol(?:ume)?|book|livro|tome|parte?)[-_\s]*\d+/i.test(`${text} ${url}`)) {
      return explicit;
    }
    let cur = linkEl?.parentElement;
    for (let depth = 0; depth < 4 && cur && cur !== stopEl && cur !== stopEl?.parentElement; depth++) {
      // Check previous sibling heading/header element of the link's list block
      let prev = cur.previousElementSibling;
      while (prev) {
        if (/^(?:h[2-5]|div|header|summary|p)$/i.test(prev.tagName) && prev.querySelectorAll('a').length === 0) {
          const headingTxt = normalizeSpaces(prev.textContent);
          if (headingTxt && headingTxt.length <= 120 && VOLUME_HEADING_RX.test(headingTxt)) {
            return extractVolumeLabel(headingTxt, '', '');
          }
        }
        prev = prev.previousElementSibling;
      }
      if (cur.tagName?.toLowerCase() === 'details') {
        const sumTxt = normalizeSpaces(cur.querySelector('summary')?.textContent);
        if (sumTxt && VOLUME_HEADING_RX.test(sumTxt)) {
          return extractVolumeLabel(sumTxt, '', '');
        }
      }
      cur = cur.parentElement;
    }
    return explicit;
  }

  _selectListCandidate(doc, targetUrl, context = {}) {
    const baseOrigin = new URL(targetUrl).origin;
    const explicit = doc.querySelector('.chapter-list, .chapters, #chapter-list, .toc');
    if (explicit) {
      const directLinks = this._extractSameOriginLinks(explicit, targetUrl, baseOrigin);
      if (directLinks.length > 0) {
        return { container: explicit, links: directLinks, score: 999 };
      }
    }

    const root = doc.querySelector('main, article') || doc.body;
    const candidates = Array.from(root.querySelectorAll('ul, ol, table, div, section'));
    let best = { container: root, score: 0, links: [] };

    for (const el of candidates) {
      const evaluated = this._scoreListCandidate(el, targetUrl, baseOrigin, context);
      if (evaluated.score >= best.score) {
        best = { ...evaluated, container: el };
      }
    }

    if (best.score >= 12) {
      return best;
    }

    return {
      container: root,
      score: best.score,
      links: this._extractSameOriginLinks(root, targetUrl, baseOrigin).filter(
        (l) => CHAPTER_HINT_RX.test(l.text) || URL_HINT_RX.test(l.url)
      )
    };
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
    const rawTextLen = normalizeSpaces(container.textContent).length;
    let timeChars = 0;
    for (const t of container.querySelectorAll('time')) {
      timeChars += normalizeSpaces(t.textContent).length;
    }
    const textChars = Math.max(1, rawTextLen - timeChars);
    const linkChars = links.reduce((sum, l) => sum + l.text.length, 0);
    const linkCoverage = linkChars / textChars;

    let score = links.length * 2.5;
    score += chapterHints * 3;
    score += urlHints * 2;
    score += numericHints * 1.2;
    if (matchesKnownPrefix) score += 20;
    if (maxPrefixShare > 0.7 && links.length >= 2) score += 15;
    if (linkCoverage > 0.45) score += 10;
    if (linkCoverage < 0.2) score -= 15;
    if (container.querySelector('h1, form, .synopsis, .description, [data-testid*="synopsis"]')) {
      score -= 40;
    }
    if (container.matches('.chapter-list, .chapters, #chapter-list, .toc, [class*="chapter"], [id*="chapter"]')) {
      score += 30;
    }

    return { score, links };
  }

  collectChapterNodes(doc, targetUrl, _options = {}, context = {}) {
    const selected = this._selectListCandidate(doc, targetUrl, context);

    return selected.links.map((l) => ({
      url: l.url,
      numText: '',
      titleText: l.text,
      dateText: l.dateText || '',
      displayTitle: l.text,
      volume: this._inferVolumeFromAncestors(l.el, selected.container, l.text, l.url),
      included: true
    }));
  }

  _findNextChapterUrl(doc, currentUrl, baseOrigin) {
    const normCurrent = normalizeUrl(currentUrl);
    const validateHref = (href) => {
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null;
      try {
        const u = new URL(href, currentUrl);
        if (u.origin !== baseOrigin || TAXONOMY_PATH_RX.test(u.pathname || '')) return null;
        u.hash = '';
        const abs = normalizeUrl(u.toString());
        return abs && abs !== normCurrent ? abs : null;
      } catch {
        return null;
      }
    };

    const explicit = doc.querySelector(
      'a[rel="next"], .chapter-nav a.next, .nav-links a.next, .post-navigation .nav-next a, a[data-next-chapter]'
    );
    const explicitUrl = validateHref(explicit?.getAttribute('href'));
    if (explicitUrl) return explicitUrl;

    for (const a of doc.querySelectorAll('a[href]')) {
      if (a.closest('#comments, .comments, footer, .sidebar, #sidebar')) continue;
      const label = normalizeSpaces(a.textContent);
      const aria = normalizeSpaces(a.getAttribute('aria-label') || a.getAttribute('title') || '');
      if (NEXT_CHAPTER_RX.test(label) || (aria && NEXT_CHAPTER_RX.test(aria))) {
        const abs = validateHref(a.getAttribute('href'));
        if (abs) return abs;
      }
    }
    return null;
  }

  async _crawlChaptersFromNextLinks(startDoc, startUrl, options = {}, signal) {
    const maxCrawl = Math.max(1, Math.min(300, Number(options.maxCrawlChapters) || 100));
    const baseOrigin = new URL(startUrl).origin;
    const chapters = [];
    const visited = new Set();

    let curDoc = startDoc;
    let curUrl = normalizeUrl(startUrl);

    for (let step = 0; step < maxCrawl; step++) {
      if (!curUrl || visited.has(curUrl)) break;
      visited.add(curUrl);

      const { chapterTitle } = this.extractChapterHeading(curDoc, {
        url: curUrl,
        displayTitle: `Capítulo ${chapters.length + 1}`
      });
      chapters.push({
        url: curUrl,
        numText: '',
        titleText: chapterTitle,
        dateText: '',
        displayTitle: chapterTitle,
        volume: extractVolumeLabel('', chapterTitle, curUrl),
        included: true
      });

      const nextUrl = this._findNextChapterUrl(curDoc, curUrl, baseOrigin);
      if (!nextUrl || visited.has(nextUrl)) break;
      try {
        curDoc = await fetchDocumentWithOptions(nextUrl, options, signal);
        curUrl = nextUrl;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        break;
      }
    }

    return chapters;
  }

  async collectAllChapters(indexDoc, targetUrl, options = {}, signal) {
    const customListSelector = (options.customListSelector || '').trim();
    if (!customListSelector) {
      const initialNodes = this.collectChapterNodes(indexDoc, targetUrl, options, {
        pageIndex: 0,
        knownPrefixes: new Set()
      });
      if (initialNodes.length <= 1) {
        const proseRoot = this.findChapterContentRoot(indexDoc);
        const proseChars = proseRoot ? normalizeSpaces(proseRoot.textContent).length : 0;
        if (proseChars >= 120) {
          if (options.crawlNextLinks !== false) {
            const baseOrigin = new URL(targetUrl).origin;
            const nextChapterUrl = this._findNextChapterUrl(indexDoc, targetUrl, baseOrigin);
            if (nextChapterUrl) {
              return this._crawlChaptersFromNextLinks(indexDoc, targetUrl, options, signal);
            }
          }
          if (initialNodes.length === 0) {
            const singleTitle =
              this.extractChapterHeading(indexDoc, { url: targetUrl, displayTitle: 'Capítulo 1' }).chapterTitle ||
              'Capítulo 1';
            return [
              {
                url: targetUrl,
                numText: '1',
                titleText: singleTitle,
                dateText: '',
                displayTitle: singleTitle,
                volume: extractVolumeLabel('', singleTitle, targetUrl),
                included: true
              }
            ];
          }
        }
      }
    }

    return super.collectAllChapters(indexDoc, targetUrl, options, signal);
  }

  /**
   * Readability-inspired prose container scorer with Innermost Node Wins refinement.
   */
  findChapterContentRoot(doc) {
    const explicit = doc.querySelector(
      '.epcontent, .chapter-content, #chapter-content, .reading-content, .entry-content'
    );
    if (explicit) return explicit;

    const candidates = Array.from(doc.querySelectorAll('article, main, div, section'));
    const scored = [];

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
      const proseScore = pTextLen * 0.1 + commaCount * 2 - linkDensity * 200 - nonProseOverhead * 0.05;
      let score = proseScore;
      if (el.tagName.toLowerCase() === 'article') score += 40;
      if (el.tagName.toLowerCase() === 'main') score += 25;

      scored.push({ el, score, proseScore, pTextLen, linkDensity });
    }

    if (scored.length === 0) {
      return doc.querySelector('article, main');
    }

    scored.sort((a, b) => b.score - a.score);
    let best = scored[0];
    // Innermost Node Wins: descend into inner prose nodes when they retain >= 85% of outer prose text
    for (let i = 1; i < scored.length; i++) {
      const challenger = scored[i];
      if (!isDescendantOf(challenger.el, best.el)) continue;
      if (
        challenger.pTextLen >= best.pTextLen * 0.85 &&
        challenger.linkDensity <= best.linkDensity + 0.05 &&
        challenger.proseScore >= best.proseScore * 0.85
      ) {
        best = challenger;
      }
    }

    return best.el;
  }

  /**
   * Heuristic CSS selector scanner (inspired by WebToEpub's HeuristicScanner) to prefill
   * Advanced Options without requiring site-specific code.
   */
  suggestSelectors({ indexDoc, chapterDoc = null, targetUrl = '' }) {
    const out = {
      listSelector: '',
      contentSelector: '',
      excludeSelector: '',
      listCount: 0,
      contentChars: 0,
      sampleChapterUrl: ''
    };

    if (indexDoc && targetUrl) {
      const selected = this._selectListCandidate(indexDoc, targetUrl, {});
      if (selected.links.length > 0) {
        out.sampleChapterUrl = selected.links[0].url;
        out.listSelector = buildReadableSelector(selected.container, indexDoc, 'a[href]');
        try {
          out.listCount = indexDoc.querySelectorAll(out.listSelector).length;
        } catch {
          out.listCount = selected.links.length;
        }
      }
    }

    if (chapterDoc) {
      const contentRoot = this.findChapterContentRoot(chapterDoc);
      if (contentRoot) {
        out.contentSelector = buildReadableSelector(contentRoot, chapterDoc);
        out.contentChars = normalizeSpaces(contentRoot.textContent).length;
        const noiseChecks = ['.nav-links', '.chapter-nav', '.post-navigation', '.sharedaddy', '.ads', '.advertisement', '.author-note', '.translator-note'];
        const foundNoise = noiseChecks.filter((sel) => {
          try {
            return Boolean(contentRoot.querySelector(sel));
          } catch {
            return false;
          }
        });
        out.excludeSelector = foundNoise.join(', ');
      }
    }

    return out;
  }
}

export const genericHtmlParser = new GenericHtmlParser();
