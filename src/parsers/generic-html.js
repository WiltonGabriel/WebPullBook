import {
  BaseParser,
  buildReadableSelector,
  ensureAscendingChapterOrder,
  extractVolumeLabel,
  fetchDocumentWithOptions,
  isDescendantOf,
  normalizeSpaces,
  normalizeUrl,
  resolveSafeHttpUrl
} from '../core/parser-engine.js';

const EXCLUDED_CONTAINER_SELECTOR =
  'nav, header, footer, aside, .menu, .navbar, .sidebar, #sidebar, #comments, .comments, [id*="comments" i], [id*="comentarios" i], [class*="related" i], [id*="parecidas" i], [class*="recommend" i], .pagination, .breadcrumb';
const CHAPTER_HINT_RX = /(?:cap[íi]tulo|chapter|cap\.?|ch\.?|ep\.?|epis[óo]dio|episode|part|parte|volume|vol\.?|book|livro|pr[óo]logo|prologue|ep[íi]logo|epilogue)/i;
const URL_HINT_RX = /(?:cap|chapter|ch|ep|vol|parte|read|lesson|section)[-_/\d]/i;
const TAXONOMY_PATH_RX = /(?:^|\/)(?:genero|generos|genre|genres|tag|tags|category|categories|categoria|categorias|author|authors|autor|autores|perfil|profile|user|users|login|register|signup|search|busca|sobre|about|contato|contact|privacy|terms)(?:\/|$)/i;
const CTA_TEXT_RX = /^(?:come[çc]ar\s+a\s+ler|continuar\s+lendo|start\s+reading|read\s+first|continue\s+reading)$/i;
const NEXT_CHAPTER_RX =
  /^(?:next(?:\s+(?:chapter|part|page|ep(?:isode)?))?|pr[óo]xim[oa](?:\s+(?:cap[íi]tulo|parte|p[áa]gina|epis[óo]dio))?|cap[íi]tulo\s+seguinte|seguinte|avan[çc]ar|siguiente(?:\s+cap[íi]tulo)?|»+|›+|→)$/i;
const TOC_LINK_RX =
  /^(?:[íi]ndice|sum[áa]rio|table\s+of\s+contents|toc|lista\s+de\s+cap[íi]tulos|todos\s+os\s+cap[íi]tulos|all\s+chapters|chapters?\s+list|chapter\s+index|back\s+to\s+(?:index|toc|series|novel|book))$/i;
const POSITIVE_PROSE_HINT_RX =
  /(?:^|[\s_-])(?:content|chapter|prose|reading|story|novel|texto|capitulo|article|entry|post-body|text-body|chapter-text|正文|章节|本文)(?:$|[\s_-])/i;
const NEGATIVE_PROSE_HINT_RX =
  /(?:^|[\s_-])(?:comment|sidebar|footer|widget|recommend|related|share|meta|author-bio|nav|menu)(?:$|[\s_-])/i;
const VOLUME_HEADING_RX = /\b(?:vol(?:ume)?\.?\s*\d+|book\s*\d+|livro\s*\d+|tome\s*\d+|ano\s*\d+|part(?:e)?\s*(?:\d+|[ivx]+))/i;

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
      const absUrl = resolveSafeHttpUrl(a.getAttribute('href'), targetUrl);
      if (!absUrl) continue;

      let pathname = '';
      try {
        const u = new URL(absUrl);
        if (u.origin !== baseOrigin) continue;
        pathname = u.pathname || '';
        if (TAXONOMY_PATH_RX.test(pathname)) continue;
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
    const scored = [];

    for (const el of candidates) {
      const evaluated = this._scoreListCandidate(el, targetUrl, baseOrigin, context);
      if (evaluated.score >= 12 && evaluated.links.length > 0) {
        scored.push({ ...evaluated, container: el });
      }
    }

    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score);
      let best = scored[0];
      // Innermost Node Wins: prefer a tighter descendant list that preserves >= 85% of chapter links
      for (let i = 1; i < scored.length; i++) {
        const challenger = scored[i];
        if (!isDescendantOf(challenger.container, best.container)) continue;
        if (
          challenger.links.length >= Math.max(2, Math.ceil(best.links.length * 0.85)) &&
          challenger.score >= best.score * 0.8
        ) {
          best = challenger;
        }
      }
      return best;
    }

    return {
      container: root,
      score: 0,
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

  _findTocIndexUrl(doc, currentUrl, baseOrigin) {
    const normCurrent = normalizeUrl(currentUrl);
    const validate = (href) => {
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return null;
      try {
        const u = new URL(href, currentUrl);
        if (u.origin !== baseOrigin || TAXONOMY_PATH_RX.test(u.pathname || '')) return null;
        u.hash = '';
        const abs = normalizeUrl(u.toString());
        if (!abs || abs === normCurrent || u.pathname === '/' || u.pathname === '') return null;
        return abs;
      } catch {
        return null;
      }
    };

    const explicitRel = doc.querySelector('a[rel="contents"], a[rel="index"], a[rel="up"]');
    const relUrl = validate(explicitRel?.getAttribute('href'));
    if (relUrl) return relUrl;

    for (const a of doc.querySelectorAll('a[href]')) {
      if (a.closest('#comments, .comments, footer, .sidebar, #sidebar')) continue;
      const label = normalizeSpaces(a.textContent);
      const aria = normalizeSpaces(a.getAttribute('aria-label') || a.getAttribute('title') || '');
      if (TOC_LINK_RX.test(label) || (aria && TOC_LINK_RX.test(aria))) {
        const abs = validate(a.getAttribute('href'));
        if (abs) return abs;
      }
    }

    const curPath = new URL(currentUrl).pathname;
    const breadcrumbLinks = Array.from(
      doc.querySelectorAll('.breadcrumb a[href], .breadcrumbs a[href], [aria-label*="breadcrumb" i] a[href]')
    ).reverse();
    for (const a of breadcrumbLinks) {
      const abs = validate(a.getAttribute('href'));
      if (!abs) continue;
      const candPath = new URL(abs).pathname;
      if (
        candPath.length < curPath.length &&
        /(?:^|\/)(?:series|novel|novels|fiction|obra|obras|book|books|story|stories|manga|webnovel)\//i.test(candPath)
      ) {
        return abs;
      }
    }
    return null;
  }

  /**
   * Distinguish a true Table-of-Contents page from a chapter page that happens to include
   * a small sidebar/footer list of recent chapters.
   */
  isTableOfContents(doc, targetUrl, selectedList = null) {
    const selected = selectedList || this._selectListCandidate(doc, targetUrl, {});
    if (selected.score >= 999 && selected.links.length >= 2) return true;
    if (selected.links.length <= 1) return false;

    const proseRoot = this.findChapterContentRoot(doc);
    const proseChars = proseRoot ? normalizeSpaces(proseRoot.textContent).length : 0;
    if (proseChars >= 1200) {
      const baseOrigin = new URL(targetUrl).origin;
      const hasChapterNav = Boolean(
        this._findNextChapterUrl(doc, targetUrl, baseOrigin) ||
          this._findTocIndexUrl(doc, targetUrl, baseOrigin)
      );
      if (hasChapterNav && selected.links.length <= 15 && selected.score < 80) {
        return false;
      }
    }
    return selected.links.length >= 2;
  }

  async resolveIndexDocument(inputUrl, doc, signal, options = {}) {
    const targetUrl = normalizeUrl(inputUrl);
    if ((options.customListSelector || '').trim()) {
      return { targetUrl, doc };
    }
    const initialList = this._selectListCandidate(doc, targetUrl, {});
    if (this.isTableOfContents(doc, targetUrl, initialList)) {
      return { targetUrl, doc };
    }

    const baseOrigin = new URL(targetUrl).origin;
    const tocUrl = this._findTocIndexUrl(doc, targetUrl, baseOrigin);
    if (!tocUrl) {
      return { targetUrl, doc };
    }

    try {
      const tocDoc = await fetchDocumentWithOptions(tocUrl, options, signal);
      const tocList = this._selectListCandidate(tocDoc, tocUrl, {});
      if (tocList.links.length >= 2) {
        options.onLog?.(`[PARSE] Índice resolvido automaticamente a partir do capítulo: ${tocUrl}`, 'debug');
        return { targetUrl: tocUrl, doc: tocDoc };
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }

    return { targetUrl, doc };
  }

  collectChapterNodes(doc, targetUrl, _options = {}, context = {}) {
    const selected = this._selectListCandidate(doc, targetUrl, context);

    const chapters = selected.links.map((l) => ({
      url: l.url,
      numText: '',
      titleText: l.text,
      dateText: l.dateText || '',
      displayTitle: l.text,
      volume: this._inferVolumeFromAncestors(l.el, selected.container, l.text, l.url),
      included: true
    }));
    return ensureAscendingChapterOrder(chapters, false);
  }

  _findNextChapterUrl(doc, currentUrl, baseOrigin) {
    const normCurrent = normalizeUrl(currentUrl);
    const validateHref = (href) => {
      const abs = resolveSafeHttpUrl(href, currentUrl);
      if (!abs) return null;
      try {
        const u = new URL(abs);
        if (u.origin !== baseOrigin || TAXONOMY_PATH_RX.test(u.pathname || '')) return null;
        return abs !== normCurrent ? abs : null;
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
      const selected = this._selectListCandidate(indexDoc, targetUrl, {
        pageIndex: 0,
        knownPrefixes: new Set()
      });
      const isToc = this.isTableOfContents(indexDoc, targetUrl, selected);
      if (!isToc || selected.links.length <= 1) {
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
          if (!isToc || selected.links.length === 0) {
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

    const collected = await super.collectAllChapters(indexDoc, targetUrl, options, signal);
    return customListSelector ? collected : ensureAscendingChapterOrder(collected, false);
  }

  /**
   * Readability-inspired prose container scorer with <br>/loose-text support,
   * semantic class/id signals, and Innermost Node Wins refinement.
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
      const brCount = el.querySelectorAll('br').length;
      let directTextLen = 0;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          directTextLen += normalizeSpaces(child.nodeValue).length;
        }
      }

      if (blocks.length === 0 && brCount < 3 && directTextLen < 160) continue;

      let pTextLen = 0;
      let commaCount = 0;
      if (blocks.length > 0) {
        for (const blk of blocks) {
          const txt = normalizeSpaces(blk.textContent);
          pTextLen += txt.length;
          commaCount += (txt.match(/[,.;!?—。，！？]/g) || []).length;
        }
      } else {
        const txt = normalizeSpaces(el.textContent);
        pTextLen = txt.length;
        commaCount = (txt.match(/[,.;!?—。，！？]/g) || []).length;
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
      const brBonus = blocks.length === 0 ? Math.min(40, brCount * 4) : 0;
      const proseScore =
        pTextLen * 0.1 + commaCount * 2 + brBonus - linkDensity * 200 - nonProseOverhead * 0.05;
      let score = proseScore;
      const tag = el.tagName.toLowerCase();
      if (tag === 'article') score += 40;
      if (tag === 'main') score += 25;

      const idAndClass = `${el.getAttribute('id') || ''} ${typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''}`;
      if (POSITIVE_PROSE_HINT_RX.test(idAndClass)) score += 35;
      if (NEGATIVE_PROSE_HINT_RX.test(idAndClass)) score -= 50;

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
