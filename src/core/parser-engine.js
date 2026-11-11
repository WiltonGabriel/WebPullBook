import { HtmlSanitizer, serializeChapterXhtml } from './sanitizer.js';

/**
 * Build e-reader-friendly EPUB CSS without locking body font-family/px font-size
 * unless the user explicitly selects a font override.
 */
export function buildEpubStylesheet({
  fontFamily = 'reader-default',
  textAlign = 'justify',
  lineHeight = 1.55,
  paragraphIndent = false
} = {}) {
  const fontRule =
    fontFamily === 'serif'
      ? '  font-family: Georgia, "Times New Roman", serif;\n'
      : fontFamily === 'sans'
        ? '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n'
        : '';

  const pMargin = paragraphIndent ? '0.15em 0' : '0.55em 0';
  const pIndent = paragraphIndent ? '  text-indent: 1.4em;\n' : '';
  const safeLineHeight = Math.min(2.4, Math.max(1.1, Number(lineHeight) || 1.55));
  const safeAlign = textAlign === 'left' ? 'left' : 'justify';

  return `body {
  margin: 2% 4%;
  line-height: ${safeLineHeight};
${fontRule}}
h1 {
  font-size: 1.55em;
  font-weight: bold;
  text-align: center;
  margin: 1.2em 0 0.7em;
  line-height: 1.25;
}
h2, h2.chapter-title {
  font-size: 1.35em;
  font-weight: bold;
  text-align: center;
  margin: 1.1em 0 0.6em;
  line-height: 1.25;
}
h3, h4, h5, h6 {
  font-size: 1.15em;
  font-weight: bold;
  text-align: center;
  margin: 1em 0 0.5em;
  line-height: 1.3;
}
.chapter-subtitle {
  font-size: 1.05em;
  text-align: center;
  font-style: italic;
  opacity: 0.85;
  margin-top: -0.3em;
  margin-bottom: 1.4em;
}
p {
  margin: ${pMargin};
  text-align: ${safeAlign};
${pIndent}  overflow-wrap: break-word;
}
b, strong, .wpb-bold { font-weight: bold; }
i, em, .wpb-italic { font-style: italic; }
u, .wpb-underline { text-decoration: underline; }
s, del, .wpb-strike { text-decoration: line-through; }
small, .wpb-sm { font-size: 0.85em; }
.wpb-lg { font-size: 1.2em; }
.wpb-mono, code, pre { font-family: monospace; }
.wpb-center { text-align: center; text-indent: 0; }
.wpb-right { text-align: right; text-indent: 0; }
.wpb-left { text-align: left; }
blockquote {
  margin: 0.9em 1.2em;
  padding-left: 0.85em;
  border-left: 3px solid #888;
  font-style: italic;
}
code { font-size: 0.9em; }
pre {
  font-size: 0.88em;
  white-space: pre-wrap;
  margin: 0.8em 0;
  padding: 0.6em;
  border: 1px solid #999;
}
ul, ol {
  margin: 0.6em 0;
  padding-left: 1.6em;
}
li { margin: 0.25em 0; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.8em 0;
  font-size: 0.92em;
}
th, td {
  border: 1px solid #888;
  padding: 0.35em 0.5em;
}
img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  margin: 0.8em auto;
}
.info-box {
  border: 1px solid #999;
  padding: 0.8em 1em;
  margin: 1em 0;
}
.info-meta p {
  text-align: left;
  text-indent: 0;
  margin: 0.3em 0;
}
div.svg_outer {
  display: block;
  margin: 0;
  padding: 0;
  text-align: center;
}
div.svg_inner {
  display: block;
  text-align: center;
}
hr {
  border: none;
  border-top: 1px solid #888;
  margin: 1.2em 0;
}
`;
}

export const DEFAULT_EPUB_CSS = buildEpubStylesheet();

export function normalizeSpaces(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export function sanitizeFilename(name, removeIllegal = true) {
  let out = normalizeSpaces(name);
  if (removeIllegal) {
    out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  }
  return out || 'webpullbook-ebook';
}

export function toHighResCoverUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (/^i\d+\.wp\.com$/i.test(u.hostname)) {
      const strippedPath = u.pathname.replace(/^\/+/, '');
      return new URL(`https://${strippedPath}`).toString();
    }
    if (u.searchParams.has('resize')) {
      u.searchParams.delete('resize');
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function extractVolumeLabel(rawLabel, numText = '', href = '') {
  const sources = [rawLabel, numText, href];
  for (const src of sources) {
    if (!src) continue;
    const match = String(src).match(/(?:vol(?:ume)?\.?\s*|livro\s*|book\s*|tome\s*|[-/]volume-)(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!Number.isNaN(n)) {
        return `Volume ${String(n).padStart(2, '0')}`;
      }
    }
  }
  if (rawLabel && normalizeSpaces(rawLabel)) {
    return normalizeSpaces(rawLabel);
  }
  return 'Volume 01';
}

export function extractVolumeNumber(volumeLabel) {
  const m = String(volumeLabel ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

export function extractCleanSynopsis(container) {
  if (!container) return '';
  const clone = container.cloneNode(true);
  for (const rm of clone.querySelectorAll('script, style, .aviso, .notice, .disclaimer')) {
    rm.remove();
  }

  const lines = [];
  for (const child of clone.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'hr') break;
    if (child.querySelector('hr')) break;
    if (/^(aviso|notice|disclaimer)$/i.test(normalizeSpaces(child.textContent))) break;

    if (tag === 'p') {
      const txt = normalizeSpaces(child.textContent);
      if (txt) lines.push(txt);
    } else {
      for (const p of child.querySelectorAll('p')) {
        const txt = normalizeSpaces(p.textContent);
        if (txt) lines.push(txt);
      }
    }
  }

  if (lines.length === 0) {
    return normalizeSpaces(clone.textContent);
  }
  return lines.join('\n\n');
}

export async function fetchHtmlDocument(url, signal) {
  const response = await fetch(url, {
    credentials: 'include',
    signal
  });
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status} ao carregar ${url}`);
    err.status = response.status;
    throw err;
  }
  const html = await response.text();
  return new DOMParser().parseFromString(html, 'text/html');
}

export function sleep(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    }
  });
}

export async function fetchWithRetry(url, { retries = 2, signal } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fetchHtmlDocument(url, signal);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      const retryable = !err.status || err.status === 429 || err.status >= 500;
      if (!retryable || attempt >= retries) throw err;
      attempt += 1;
      await sleep(800 * attempt, signal);
    }
  }
}

export function canUseTabScripting() {
  return Boolean(
    typeof chrome !== 'undefined' && chrome?.tabs?.create && chrome?.scripting?.executeScript
  );
}

/**
 * Render a page inside a browser tab (or read an existing open tab) to extract
 * JavaScript/SPA/React-hydrated DOM when plain background fetch() is insufficient.
 */
export async function fetchRenderedTabDocument(url, { waitMs = 950, tabId = null, signal } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (!chrome?.tabs || !chrome?.scripting?.executeScript) {
    return fetchWithRetry(url, { retries: 2, signal });
  }

  // If an existing open tab ID was supplied (e.g., Merge Open Tabs mode), try reading it directly first
  if (typeof tabId === 'number') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.outerHTML
      });
      const liveHtml = results?.[0]?.result;
      if (liveHtml && liveHtml.length > 60) {
        return new DOMParser().parseFromString(liveHtml, 'text/html');
      }
    } catch {
      // Fall back to opening a background tab below
    }
  }

  let createdTab = null;
  try {
    createdTab = await chrome.tabs.create({ url, active: false });
    const targetTabId = createdTab.id;

    if (createdTab.status !== 'complete') {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          clearInterval(poller);
          if (signal) signal.removeEventListener('abort', onAbort);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        };

        const timeout = setTimeout(finish, 12000);

        const onAbort = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          clearInterval(poller);
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        function listener(updatedId, changeInfo) {
          if (updatedId === targetTabId && changeInfo.status === 'complete') {
            finish();
          }
        }

        chrome.tabs.onUpdated.addListener(listener);

        const poller = setInterval(async () => {
          try {
            const tabInfo = await chrome.tabs.get(targetTabId);
            if (tabInfo?.status === 'complete') finish();
          } catch {
            finish();
          }
        }, 120);
      });
    }

    if (waitMs > 0) {
      await sleep(waitMs, signal);
    }

    const injected = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => document.documentElement.outerHTML
    });
    const renderedHtml = injected?.[0]?.result || '';
    if (!renderedHtml) {
      throw new Error(`Não foi possível extrair o DOM renderizado da aba para ${url}`);
    }
    return new DOMParser().parseFromString(renderedHtml, 'text/html');
  } finally {
    if (createdTab?.id !== undefined) {
      try {
        await chrome.tabs.remove(createdTab.id);
      } catch {
        // Ignore if tab was already closed
      }
    }
  }
}

export async function fetchDocumentWithOptions(url, options = {}, signal) {
  if (options.renderWithTab && canUseTabScripting()) {
    return fetchRenderedTabDocument(url, {
      waitMs: options.renderWaitMs ?? 950,
      signal
    });
  }
  return fetchWithRetry(url, { retries: 2, signal });
}

/**
 * Abstract base class for all site-agnostic WebPullBook parser adapters.
 * Implements the Template Method pattern for series resolution, metadata extraction,
 * index pagination, chapter extraction, and sanitization.
 */
export class BaseParser {
  constructor({ id, name }) {
    this.id = id;
    this.name = name;
  }

  /**
   * Return confidence score 0..100 for how well this parser matches the given DOM.
   */
  matchScore(_doc, _url) {
    return 0;
  }

  async resolveIndexDocument(inputUrl, doc, _signal) {
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
          }
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }
    return result;
  }

  extractCommonMetadata(doc, targetUrl) {
    const jsonLd = this.extractJsonLdMetadata(doc);
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const h1Title = doc.querySelector('h1')?.textContent;
    const title = normalizeSpaces(h1Title || jsonLd.title || ogTitle || doc.title) || 'WebPullBook';

    const langAttr = (doc.documentElement.getAttribute('lang') || 'pt-BR').trim();
    const language = langAttr.split('-')[0].toLowerCase() || 'pt';

    const authorMeta =
      doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
      doc.querySelector('[rel="author"], .author a, .author')?.textContent ||
      '';
    const author = normalizeSpaces(authorMeta || jsonLd.author) || '<unknown>';

    const rawCover =
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
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

    const synContainer = doc.querySelector('.synopsis, .description, .summary, .entry-content');
    const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
    const synopsis = extractCleanSynopsis(synContainer) || jsonLd.synopsis || normalizeSpaces(ogDesc);

    return {
      startingUrl: targetUrl,
      title,
      author,
      language,
      status: '',
      genres: [],
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
    const links = Array.from(doc.querySelectorAll(selector));
    const seen = new Set();
    const out = [];
    for (const el of links) {
      const a = el.tagName.toLowerCase() === 'a' ? el : el.querySelector('a[href]');
      if (!a) continue;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      let absUrl;
      try {
        absUrl = normalizeUrl(new URL(href, targetUrl).toString());
      } catch {
        continue;
      }
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
      'a[rel="next"], link[rel="next"], .pagination a.next, .nav-links a.next, a.next.page-numbers'
    );
    const href = nextEl?.getAttribute('href') || '';
    if (!href) return null;
    try {
      const nextAbs = normalizeUrl(new URL(href, currentUrl).toString());
      return nextAbs !== normalizeUrl(currentUrl) ? nextAbs : null;
    } catch {
      return null;
    }
  }

  async loadSeries(inputUrl, options = {}, signal, preloadedDoc = null) {
    const initialUrl = normalizeUrl(inputUrl);
    const initialDoc = preloadedDoc || (await fetchDocumentWithOptions(initialUrl, options, signal));
    let { targetUrl, doc: indexDoc } = await this.resolveIndexDocument(initialUrl, initialDoc, signal);

    const customListSelector = (options.customListSelector || '').trim();
    const collectFromIndex = async (startDoc, startUrl, fetchOpts) => {
      const allChapters = [];
      const seenUrls = new Set();
      const visitedPages = new Set([startUrl]);
      const maxPages = 20;

      let pageDoc = startDoc;
      let pageUrl = startUrl;
      const knownPrefixes = new Set();

      for (let pageCount = 0; pageCount < maxPages; pageCount++) {
        const pageItems = customListSelector
          ? this.collectChaptersByCustomSelector(pageDoc, pageUrl, customListSelector)
          : this.collectChapterNodes(pageDoc, pageUrl, fetchOpts, { pageIndex: pageCount, knownPrefixes });

        for (const ch of pageItems) {
          const key = normalizeUrl(ch.url);
          if (seenUrls.has(key)) continue;
          seenUrls.add(key);
          allChapters.push(ch);
          try {
            const parts = new URL(key).pathname.split('/').filter(Boolean);
            if (parts.length > 1) knownPrefixes.add(`/${parts[0]}/`);
          } catch {
            // ignore
          }
        }

        const nextUrl = this.findNextPageUrl(pageDoc, pageUrl);
        if (!nextUrl || visitedPages.has(nextUrl)) break;
        visitedPages.add(nextUrl);
        pageUrl = nextUrl;
        pageDoc = await fetchDocumentWithOptions(nextUrl, fetchOpts, signal);
      }

      return allChapters;
    };

    let allChapters = await collectFromIndex(indexDoc, targetUrl, options);

    // Automatic SPA / dynamic DOM fallback if static HTML yielded 0 chapters
    if (allChapters.length === 0 && !options.renderWithTab && options.autoFallbackTab !== false && canUseTabScripting()) {
      try {
        const renderedDoc = await fetchRenderedTabDocument(targetUrl, {
          waitMs: options.renderWaitMs ?? 1100,
          signal
        });
        const retryChapters = await collectFromIndex(
          renderedDoc,
          targetUrl,
          { ...options, renderWithTab: true }
        );
        if (retryChapters.length > 0) {
          indexDoc = renderedDoc;
          allChapters = retryChapters;
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
      chapters
    };
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('.epcontent, .chapter-content, #chapter-content, .reading-content, .entry-content, article, main');
  }

  extractChapterHeading(doc, chapter) {
    const h1 = normalizeSpaces(doc.querySelector('h1.entry-title, h1')?.textContent);
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
    const useTabFirst = Boolean(options.renderWithTab || (chapter.tabId && options.preferOpenTabDom));
    let doc = useTabFirst
      ? await fetchRenderedTabDocument(chapter.url, {
          waitMs: options.renderWaitMs ?? 950,
          tabId: chapter.tabId ?? null,
          signal
        })
      : await fetchWithRetry(chapter.url, { retries: 2, signal });

    let extracted = this.extractChapter(doc, chapter, options);

    // Automatic SPA / dynamic DOM fallback if static fetch found no readable contentRoot
    const hasReadableText =
      extracted?.contentRoot && normalizeSpaces(extracted.contentRoot.textContent).length >= 25;
    if (!hasReadableText && !useTabFirst && options.autoFallbackTab !== false && canUseTabScripting()) {
      try {
        const renderedDoc = await fetchRenderedTabDocument(chapter.url, {
          waitMs: options.renderWaitMs ?? 1100,
          tabId: chapter.tabId ?? null,
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
      const err = new Error(`Conteúdo do capítulo não encontrado em ${chapter.url}`);
      err.isNoContent = true;
      throw err;
    }

    const sanitizer = new HtmlSanitizer({
      skipImages: Boolean(options.skipImages),
      removeNavLinks: options.removeNavLinks !== false,
      excludeSelector: options.customExcludeSelector || ''
    });
    const sanitized = sanitizer.sanitize(extracted.contentRoot, chapter.url);

    return {
      chapter,
      chapterTitle: extracted.chapterTitle,
      subtitle: extracted.subtitle,
      ...sanitized,
      serialize(stylesheetHref, epub3) {
        return serializeChapterXhtml({
          title: extracted.chapterTitle,
          subtitle: extracted.subtitle,
          xmlDoc: sanitized.xmlDoc,
          nodes: sanitized.nodes,
          stylesheetHref,
          epub3
        });
      }
    };
  }
}

export async function downloadAndParseChapter(chapter, parser, options = {}, signal) {
  return parser.downloadChapter(chapter, options, signal);
}
