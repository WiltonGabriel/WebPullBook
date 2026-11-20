/**
 * Abstract BaseParser (Template Method) and chapter download/sanitization helper.
 */
import { HtmlSanitizer, extractHiddenClassesFromStyles, serializeChapterXhtml } from './sanitizer.js';
import {
  extractCleanSynopsis,
  extractVolumeLabel,
  normalizeSpaces,
  normalizeUrl,
  resolveSafeHttpUrl,
  toHighResCoverUrl
} from './text-utils.js';
import {
  canUseTabScripting,
  fetchDocumentWithOptions,
  fetchRenderedTabDocument,
  fetchWithRetry,
  isAntiBotChallengeDocument,
  isRateLimitDocument
} from './net-fetcher.js';

function compileStripRegexList(rawPatterns) {
  const lines = String(rawPatterns || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const compiled = [];
  for (const line of lines) {
    const rxMatch = line.match(/^\/(.+)\/([gimsuy]*)$/);
    try {
      if (rxMatch) {
        const flags = rxMatch[2].includes('g') ? rxMatch[2] : `${rxMatch[2]}g`;
        compiled.push(new RegExp(rxMatch[1], flags));
      } else {
        const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        compiled.push(new RegExp(escaped, 'gi'));
      }
    } catch {
      // Skip malformed user regex cleanly
    }
  }
  return compiled;
}

function applyCustomTextStripPatterns(nodes, rawPatterns) {
  if (!rawPatterns || !Array.isArray(nodes) || nodes.length === 0) return;
  const regexes = compileStripRegexList(rawPatterns);
  if (regexes.length === 0) return;

  const stripTextNodes = (root) => {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      let txt = root.nodeValue || '';
      for (const rx of regexes) {
        rx.lastIndex = 0;
        txt = txt.replace(rx, '');
      }
      root.nodeValue = txt;
      return;
    }
    if (root.childNodes) {
      for (const child of Array.from(root.childNodes)) {
        stripTextNodes(child);
      }
    }
  };

  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    stripTextNodes(node);
    const hasMedia = Boolean(node.querySelector?.('img, svg, hr, br'));
    if (!hasMedia && !normalizeSpaces(node.textContent || '')) {
      nodes.splice(i, 1);
    }
  }
}

/**
 * Abstract base class for all site-agnostic WebPullBook parser adapters.
 * Implements the Template Method pattern for series resolution, metadata extraction,
 * index pagination, chapter extraction, and sanitization.
 */
export class BaseParser {
  constructor({ id, name, maxIndexPages = 20 }) {
    this.id = id;
    this.name = name;
    this.maxIndexPages = maxIndexPages;
  }

  getIndexWaitSelector() {
    return '';
  }

  getChapterWaitSelector() {
    return '';
  }

  requiresTabForChapters() {
    return false;
  }

  /**
   * Return confidence score 0..100 for how well this parser matches the given DOM.
   */
  matchScore(_doc, _url) {
    return 0;
  }

  async resolveIndexDocument(inputUrl, doc, _signal, _options = {}) {
    return { targetUrl: normalizeUrl(inputUrl), doc };
  }

  /**
   * Extract JSON-LD schema.org Book / Article metadata if embedded in the page.
   */
  extractJsonLdMetadata(doc) {
    const result = {};
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || '{}');
        const nodes = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed['@graph'])
            ? parsed['@graph']
            : [parsed];
        for (const item of nodes) {
          const typeStr = String(item?.['@type'] || '');
          if (/Book|Novel|CreativeWork|Article|WebPage/i.test(typeStr)) {
            if (!result.title && item.name) result.title = normalizeSpaces(item.name);
            if (!result.author && item.author) {
              const authors = Array.isArray(item.author) ? item.author : [item.author];
              const names = authors.map((a) => normalizeSpaces(a?.name || a)).filter(Boolean);
              if (names.length) result.author = names.join(', ');
            }
            if (!result.synopsis && item.description) {
              result.synopsis = normalizeSpaces(item.description);
            }
            if (!result.coverUrl && item.image) {
              const imgVal = typeof item.image === 'string' ? item.image : item.image?.url;
              if (imgVal) result.coverUrl = imgVal;
            }
            if (!result.status && item.creativeWorkStatus) {
              result.status = normalizeSpaces(item.creativeWorkStatus);
            }
            if ((!result.genres || result.genres.length === 0) && item.genre) {
              const rawGenres = Array.isArray(item.genre) ? item.genre : [item.genre];
              const genres = rawGenres.map((g) => normalizeSpaces(g)).filter(Boolean);
              if (genres.length > 0) result.genres = genres;
            }
          }
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }
    return result;
  }

  _extractDlMetadata(doc) {
    const out = {};
    for (const dt of doc.querySelectorAll('dl dt')) {
      const label = normalizeSpaces(dt.textContent).toLowerCase();
      const dd = dt.parentElement?.querySelector('dd') || dt.nextElementSibling;
      const value = normalizeSpaces(dd?.textContent);
      if (!value) continue;
      if (!out.author && /^(?:autor|author|writer|escritor)$/i.test(label)) {
        out.author = value;
      } else if (!out.status && /^(?:status|situa[çc][ãa]o|state)$/i.test(label)) {
        out.status = value;
      }
    }
    return out;
  }

  extractCommonMetadata(doc, targetUrl) {
    const jsonLd = this.extractJsonLdMetadata(doc);
    const dlMeta = this._extractDlMetadata(doc);
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const h1Title = doc.querySelector('h1')?.textContent;
    const title = normalizeSpaces(h1Title || jsonLd.title || ogTitle || doc.title) || 'WebPullBook';

    const langAttr = (doc.documentElement.getAttribute('lang') || 'pt-BR').trim();
    const language = langAttr.split('-')[0].toLowerCase() || 'pt';

    const ogSiteName = normalizeSpaces(doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '');
    const rawMetaAuthor = normalizeSpaces(doc.querySelector('meta[name="author"]')?.getAttribute('content') || '');
    const validMetaAuthor =
      rawMetaAuthor && !(ogSiteName && rawMetaAuthor.toLowerCase() === ogSiteName.toLowerCase()) ? rawMetaAuthor : '';
    const authorMeta =
      validMetaAuthor ||
      doc.querySelector('[rel="author"], .author a, .author')?.textContent ||
      dlMeta.author ||
      '';
    const author = normalizeSpaces(authorMeta || jsonLd.author) || '<unknown>';

    const status = dlMeta.status || jsonLd.status || '';

    let genres = Array.isArray(jsonLd.genres) ? [...jsonLd.genres] : [];
    if (genres.length === 0) {
      const seenGenres = new Set();
      for (const a of doc.querySelectorAll('a[rel="tag"], .tags a, .genres a')) {
        if (a.closest('#comments, .comments, footer, [class*="related" i], [id*="parecidas" i]')) continue;
        const g = normalizeSpaces(a.textContent);
        if (g && !seenGenres.has(g)) {
          seenGenres.add(g);
          genres.push(g);
        }
      }
    }

    const ogCoverRaw = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
    const ogCover = /\/(?:og-default|default-og)\./i.test(ogCoverRaw) ? '' : ogCoverRaw;
    const rawCover =
      ogCover ||
      jsonLd.coverUrl ||
      doc.querySelector('.cover img, .thumb img, .book-cover img, main img')?.getAttribute('src') ||
      '';
    let coverUrl = '';
    if (rawCover) {
      try {
        coverUrl = new URL(rawCover, targetUrl).toString();
      } catch {
        coverUrl = '';
      }
    }

    const synContainer = doc.querySelector(
      '.synopsis, .description, .summary, [itemprop="description"], [data-testid*="synopsis"], [data-testid*="description"], .entry-content'
    );
    const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
    const synopsis = extractCleanSynopsis(synContainer) || jsonLd.synopsis || normalizeSpaces(ogDesc);

    return {
      startingUrl: targetUrl,
      title,
      author,
      language,
      status,
      genres,
      synopsis,
      coverUrl: toHighResCoverUrl(coverUrl) || coverUrl,
      coverThumbUrl: coverUrl
    };
  }

  /**
   * Subclasses override to add layout-specific metadata fields.
   */
  extractSiteMetadata(_doc, _targetUrl) {
    return {};
  }

  /**
   * Subclasses override to return normalized chapter entries from one index page.
   */
  collectChapterNodes(_doc, _targetUrl, _options) {
    return [];
  }

  /**
   * Shared custom CSS list-selector extraction so manual overrides work across every adapter.
   */
  collectChaptersByCustomSelector(doc, targetUrl, selector) {
    let links = [];
    try {
      links = Array.from(doc.querySelectorAll(selector));
    } catch {
      return [];
    }
    const seen = new Set();
    const out = [];
    for (const el of links) {
      const a = el.tagName.toLowerCase() === 'a' ? el : el.querySelector('a[href]');
      if (!a) continue;
      const absUrl = resolveSafeHttpUrl(a.getAttribute('href'), targetUrl);
      if (!absUrl) continue;
      if (seen.has(absUrl)) continue;
      seen.add(absUrl);
      const text = normalizeSpaces(a.textContent) || absUrl;
      out.push({
        url: absUrl,
        numText: '',
        titleText: text,
        dateText: '',
        displayTitle: text,
        volume: extractVolumeLabel('', text, absUrl),
        included: true
      });
    }
    return out;
  }

  findNextPageUrl(doc, currentUrl) {
    const nextEl = doc.querySelector(
      'a[rel="next"], .pagination a.next, .nav-links a.next, a.next.page-numbers'
    );
    const href = (nextEl?.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return null;
    try {
      const nextAbs = normalizeUrl(new URL(href, currentUrl).toString());
      return nextAbs !== normalizeUrl(currentUrl) ? nextAbs : null;
    } catch {
      return null;
    }
  }

  async collectAllChapters(indexDoc, targetUrl, options = {}, signal) {
    let activeListSelector = (options.customListSelector || '').trim();
    const onLog = typeof options.onLog === 'function' ? options.onLog : null;
    const allChapters = [];
    const seenUrls = new Set();
    const visitedPages = new Set([normalizeUrl(targetUrl)]);
    const maxPages = this.maxIndexPages || 20;

    let pageDoc = indexDoc;
    let pageUrl = normalizeUrl(targetUrl);
    const knownPrefixes = new Set();

    for (let pageCount = 0; pageCount < maxPages; pageCount++) {
      let pageItems = [];
      if (activeListSelector) {
        if (pageCount === 0) {
          onLog?.(`[PARSER] Usando seletor CSS customizado de lista: "${activeListSelector}"`, 'debug');
        }
        pageItems = this.collectChaptersByCustomSelector(pageDoc, pageUrl, activeListSelector);
        if (pageItems.length === 0 && pageCount === 0) {
          const nativeItems = this.collectChapterNodes(pageDoc, pageUrl, options, {
            pageIndex: pageCount,
            knownPrefixes
          });
          if (nativeItems.length > 0) {
            onLog?.(
              `[PARSER] Seletor customizado "${activeListSelector}" retornou 0 capítulos — usando extração automática do adaptador (${nativeItems.length} encontrados).`,
              'warn'
            );
            pageItems = nativeItems;
            activeListSelector = '';
          }
        }
      } else {
        pageItems = this.collectChapterNodes(pageDoc, pageUrl, options, { pageIndex: pageCount, knownPrefixes });
      }

      let addedThisPage = 0;
      for (const ch of pageItems) {
        const key = normalizeUrl(ch.url);
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        allChapters.push(ch);
        addedThisPage += 1;
        try {
          const parts = new URL(key).pathname.split('/').filter(Boolean);
          if (parts.length > 1) knownPrefixes.add(`/${parts[0]}/`);
        } catch {
          // ignore
        }
      }

      // Stop paginating immediately if this page contributed 0 new chapters (guards against chapter-page/cyclic loops)
      if (pageItems.length === 0 || addedThisPage === 0) break;

      const nextUrl = this.findNextPageUrl(pageDoc, pageUrl);
      const normNext = nextUrl ? normalizeUrl(nextUrl) : '';
      if (!normNext || visitedPages.has(normNext)) break;
      visitedPages.add(normNext);
      pageUrl = normNext;
      pageDoc = await fetchDocumentWithOptions(normNext, options, signal);
    }

    return allChapters;
  }

  async loadSeries(inputUrl, options = {}, signal, preloadedDoc = null) {
    const initialUrl = normalizeUrl(inputUrl);
    const initialDoc = preloadedDoc || (await fetchDocumentWithOptions(initialUrl, options, signal));
    let { targetUrl, doc: indexDoc } = await this.resolveIndexDocument(initialUrl, initialDoc, signal, options);
    let usedTabFallback = Boolean(
      options.renderWithTab ||
        options._usedTabFallback ||
        initialDoc?._wpbRenderedByTab ||
        indexDoc?._wpbRenderedByTab
    );
    let attemptedTabFallback = usedTabFallback;

    let allChapters = await this.collectAllChapters(indexDoc, targetUrl, options, signal);

    // If live DOM captured from the source tab yielded 0 chapters (e.g. still hydrating or mutated),
    // try a clean static HTTP fetch before falling back to SPA tab rendering.
    if (allChapters.length === 0 && indexDoc?._wpbFromSourceTab && !options.renderWithTab) {
      try {
        options.onLog?.(
          `[TAB] 0 capítulos no DOM da aba de origem -> tentando busca HTTP direta em ${targetUrl}`,
          'debug'
        );
        const fetchedDoc = await fetchWithRetry(targetUrl, {
          retries: options.maxRetries ?? 2,
          signal,
          onLog: options.onLog
        });
        const fetchedChapters = await this.collectAllChapters(fetchedDoc, targetUrl, options, signal);
        if (fetchedChapters.length > 0) {
          indexDoc = fetchedDoc;
          allChapters = fetchedChapters;
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
    }

    // Automatic SPA / dynamic DOM fallback if static HTML yielded 0 chapters (at most once)
    if (
      allChapters.length === 0 &&
      !usedTabFallback &&
      options.autoFallbackTab !== false &&
      canUseTabScripting()
    ) {
      attemptedTabFallback = true;
      try {
        const renderedDoc = await fetchRenderedTabDocument(targetUrl, {
          waitMs: options.renderWaitMs ?? 1100,
          preferOpenTab: options.preferOpenTabDom !== false,
          waitForSelector: this.getIndexWaitSelector(),
          signal
        });
        const retryChapters = await this.collectAllChapters(
          renderedDoc,
          targetUrl,
          { ...options, renderWithTab: true },
          signal
        );
        if (retryChapters.length > 0) {
          indexDoc = renderedDoc;
          allChapters = retryChapters;
          usedTabFallback = true;
        }
      } catch {
        // Keep empty list if fallback tab rendering fails
      }
    }

    const baseMeta = this.extractCommonMetadata(indexDoc, targetUrl);
    const siteMeta = this.extractSiteMetadata(indexDoc, targetUrl);
    const metadata = { ...baseMeta, ...siteMeta };

    const chapters = allChapters.map((ch, idx) => ({
      ...ch,
      id: `ch_${idx + 1}`,
      index: idx + 1,
      included: ch.included !== false,
      status: ch.status || 'pending',
      errorMsg: ''
    }));

    return {
      ...metadata,
      requiresTabRender: usedTabFallback || Boolean(this.requiresTabForChapters()),
      _attemptedTabFallback: attemptedTabFallback,
      chapters
    };
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('.epcontent, .chapter-content, #chapter-content, .reading-content, .entry-content, article, main');
  }

  extractChapterHeading(doc, chapter) {
    const h1El = doc.querySelector('h1.entry-title, h1');
    let h1 = '';
    if (h1El) {
      const clone = h1El.cloneNode(true);
      for (const hidden of clone.querySelectorAll('.sr-only, .visually-hidden, [aria-hidden="true"]')) {
        hidden.remove();
      }
      h1 = normalizeSpaces(clone.textContent);
    }
    const sub = normalizeSpaces(doc.querySelector('.cat-series')?.textContent);
    return {
      chapterTitle: h1 || chapter.displayTitle || chapter.url,
      subtitle: sub || chapter.titleText || ''
    };
  }

  extractChapter(doc, chapter, options = {}) {
    const customSelector = (options.customContentSelector || '').trim();
    let contentRoot = null;
    if (customSelector) {
      try {
        contentRoot = doc.querySelector(customSelector);
      } catch {
        contentRoot = null;
      }
    }
    if (!contentRoot) {
      contentRoot = this.findChapterContentRoot(doc);
    }

    const { chapterTitle, subtitle } = this.extractChapterHeading(doc, chapter);
    return { contentRoot, chapterTitle, subtitle };
  }

  async downloadChapter(chapter, options = {}, signal) {
    const onLog = typeof options.onLog === 'function' ? options.onLog : null;
    const preferOpenTab = options.preferOpenTabDom !== false;
    const useTabFirst = Boolean(options.renderWithTab || (chapter.tabId && preferOpenTab));
    let doc = options.pageDomCache?.get(chapter.url) || null;
    const chapterWaitSelector = this.getChapterWaitSelector();
    if (doc) {
      onLog?.(`[NET] Reaproveitado DOM em memória: ${chapter.url}`, 'debug');
    } else if (useTabFirst) {
      onLog?.(`[SPA] Capturando capítulo via aba: ${chapter.url}`, 'debug');
      doc = await fetchRenderedTabDocument(chapter.url, {
        waitMs: options.renderWaitMs ?? 950,
        tabId: chapter.tabId ?? null,
        preferOpenTab,
        tabPool: options.tabPool || null,
        waitForSelector: chapterWaitSelector,
        signal
      });
    } else {
      const maxRetries = Number.isFinite(Number(options.maxRetries))
        ? Math.max(0, Math.min(5, Number(options.maxRetries)))
        : 2;
      try {
        doc = await fetchWithRetry(chapter.url, { retries: maxRetries, signal, onLog });
      } catch (err) {
        if (
          options.autoFallbackTab !== false &&
          canUseTabScripting() &&
          !err.isRateLimit &&
          (err.status === 403 || err.status === 503)
        ) {
          onLog?.(`[SPA] HTTP ${err.status} em capítulo -> tentando via aba: ${chapter.url}`, 'debug');
          doc = await fetchRenderedTabDocument(chapter.url, {
            waitMs: options.renderWaitMs ?? 1100,
            tabId: chapter.tabId ?? null,
            preferOpenTab,
            tabPool: options.tabPool || null,
            waitForSelector: chapterWaitSelector,
            signal
          });
        } else {
          throw err;
        }
      }
    }

    if (doc && options.pageDomCache) {
      options.pageDomCache.set(chapter.url, doc);
    }

    let extracted = this.extractChapter(doc, chapter, options);

    // Automatic SPA / dynamic DOM fallback if static fetch found no readable contentRoot (only once)
    const hasReadableText =
      extracted?.contentRoot && normalizeSpaces(extracted.contentRoot.textContent).length >= 25;
    if (
      !hasReadableText &&
      !useTabFirst &&
      !doc?._wpbRenderedByTab &&
      options.autoFallbackTab !== false &&
      canUseTabScripting()
    ) {
      onLog?.(`[SPA] Conteúdo curto/ausente no HTML estático -> re-tentando via aba: ${chapter.url}`, 'debug');
      try {
        const renderedDoc = await fetchRenderedTabDocument(chapter.url, {
          waitMs: options.renderWaitMs ?? 1100,
          tabId: chapter.tabId ?? null,
          preferOpenTab,
          tabPool: options.tabPool || null,
          waitForSelector: chapterWaitSelector,
          signal
        });
        const retryExtracted = this.extractChapter(renderedDoc, chapter, options);
        if (retryExtracted?.contentRoot) {
          doc = renderedDoc;
          extracted = retryExtracted;
        }
      } catch {
        // Proceed to error check below
      }
    }

    if (!extracted?.contentRoot) {
      if (isAntiBotChallengeDocument(doc)) {
        const err = new Error(
          `Verificação anti-bot (Cloudflare) detectada em ${chapter.url}. Abra a página em uma aba normal e tente novamente.`
        );
        err.status = 403;
        err.isAntiBotChallenge = true;
        throw err;
      }
      if (isRateLimitDocument(doc)) {
        const err = new Error(`Limite de requisições (rate limit) detectado em ${chapter.url}`);
        err.status = 429;
        err.isRateLimit = true;
        throw err;
      }
      const err = new Error(`Conteúdo do capítulo não encontrado em ${chapter.url}`);
      err.isNoContent = true;
      throw err;
    }

    const hiddenClasses = extractHiddenClassesFromStyles(doc);
    if (hiddenClasses.size > 0) {
      onLog?.(
        `[PARSE] ${hiddenClasses.size} classe(s) CSS oculta(s) filtrada(s) em "${chapter.displayTitle || chapter.url}"`,
        'debug'
      );
    }
    const sanitizer = new HtmlSanitizer({
      skipImages: Boolean(options.skipImages),
      removeNavLinks: options.removeNavLinks !== false,
      excludeSelector: options.customExcludeSelector || '',
      hiddenClasses,
      nextPrevUrls: options.nextPrevUrls || chapter.nextPrevUrls || null,
      chapterTitle: extracted.chapterTitle || ''
    });
    const sanitized = sanitizer.sanitize(extracted.contentRoot, chapter.url);
    applyCustomTextStripPatterns(sanitized.nodes, options.customStripPatterns);

    return {
      chapter,
      chapterTitle: extracted.chapterTitle,
      subtitle: extracted.subtitle,
      ...sanitized,
      serialize(stylesheetHref, epub3, { popupFootnotes = false } = {}) {
        return serializeChapterXhtml({
          title: extracted.chapterTitle,
          subtitle: extracted.subtitle,
          xmlDoc: sanitized.xmlDoc,
          nodes: sanitized.nodes,
          stylesheetHref,
          epub3,
          popupFootnotes
        });
      }
    };
  }
}

export async function downloadAndParseChapter(chapter, parser, options = {}, signal) {
  return parser.downloadChapter(chapter, options, signal);
}
