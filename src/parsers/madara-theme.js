import {
  BaseParser,
  ensureAscendingChapterOrder,
  extractCleanSynopsis,
  extractUniqueTexts,
  extractVolumeLabel,
  fetchWithRetry,
  normalizeSpaces,
  normalizeUrl,
  toHighResCoverUrl
} from '../core/parser-engine.js';

/**
 * Adapter for serialized fiction platforms built on Madara-style WordPress layouts
 * (`.wp-manga-chapter`, `.listing-chapters_wrap`, `.reading-content`).
 */
export class MadaraThemeParser extends BaseParser {
  constructor() {
    super({
      id: 'madara-theme',
      name: 'Madara Novel/Chapter Theme'
    });
  }

  matchScore(doc) {
    let score = 0;
    if (doc.querySelector('.wp-manga-chapter')) score += 55;
    if (doc.querySelector('.listing-chapters_wrap')) score += 30;
    if (doc.querySelector('.reading-content .text-left, .reading-content')) score += 45;
    if (doc.querySelector('.summary_image')) score += 10;
    return Math.min(100, score);
  }

  async resolveIndexDocument(inputUrl, doc, signal, options = {}) {
    let targetUrl = normalizeUrl(inputUrl);
    let activeDoc = doc;

    if (!activeDoc.querySelector('.wp-manga-chapter')) {
      const seriesLinks = activeDoc.querySelectorAll(
        '.breadcrumb li:nth-last-child(2) a[href], .c-breadcrumb a[href*="/novel/"], .c-breadcrumb a[href*="/manga/"]'
      );
      const tried = new Set([targetUrl]);
      for (const seriesLink of seriesLinks) {
        const rawHref = (seriesLink.getAttribute('href') || '').trim();
        if (!rawHref || rawHref.startsWith('#') || /^javascript:/i.test(rawHref)) continue;
        let resolved;
        try {
          const u = new URL(rawHref, targetUrl);
          if (!u.pathname || u.pathname === '/') continue;
          u.hash = '';
          resolved = normalizeUrl(u.toString());
        } catch {
          continue;
        }
        if (tried.has(resolved)) continue;
        tried.add(resolved);
        try {
          const candidateDoc = await fetchWithRetry(resolved, {
            retries: options.maxRetries ?? 2,
            signal,
            onLog: options.onLog
          });
          if (candidateDoc.querySelector('.wp-manga-chapter')) {
            targetUrl = resolved;
            activeDoc = candidateDoc;
            break;
          }
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
        }
        if (tried.size >= 3) break;
      }
    }
    return { targetUrl, doc: activeDoc };
  }

  findNextPageUrl() {
    // Madara renders the chapter list on the series page; never follow chapter post rel="next"
    return null;
  }

  extractSiteMetadata(doc, targetUrl) {
    const out = {};
    const titleEl = doc.querySelector('.post-title h1, h1');
    if (titleEl) out.title = normalizeSpaces(titleEl.textContent);

    const author = normalizeSpaces(doc.querySelector('.author-content')?.textContent);
    if (author) out.author = author;

    const genres = extractUniqueTexts(doc, '.genres-content a');
    if (genres.length > 0) out.genres = genres;

    const syn = extractCleanSynopsis(doc.querySelector('.summary__content, .description-summary .summary__content'));
    if (syn) out.synopsis = syn;

    const img = doc.querySelector('.summary_image img');
    const rawSrc = img?.getAttribute('data-src') || img?.getAttribute('data-lazy-src') || img?.getAttribute('src');
    if (rawSrc) {
      const thumb = new URL(rawSrc, targetUrl).toString();
      out.coverThumbUrl = thumb;
      out.coverUrl = toHighResCoverUrl(thumb) || thumb;
    }

    return out;
  }

  collectChapterNodes(doc, targetUrl) {
    const raw = [];
    const seen = new Set();

    const groups = Array.from(doc.querySelectorAll('.listing-chapters_wrap .parent.has-child'));
    if (groups.length > 0) {
      for (const grp of groups) {
        const volHeader = normalizeSpaces(grp.querySelector(':scope > a, :scope > span')?.textContent || '');
        const volLabel = extractVolumeLabel(volHeader);
        for (const li of grp.querySelectorAll('.wp-manga-chapter')) {
          const item = this._parseChapterLi(li, targetUrl, volLabel, seen);
          if (item) raw.push(item);
        }
      }
    }

    for (const li of doc.querySelectorAll('.wp-manga-chapter')) {
      const item = this._parseChapterLi(li, targetUrl, '', seen);
      if (item) raw.push(item);
    }

    return ensureAscendingChapterOrder(raw, true);
  }

  _parseChapterLi(li, targetUrl, fallbackVol, seen) {
    const a = li.querySelector('a[href]');
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return null;

    let absUrl;
    try {
      absUrl = normalizeUrl(new URL(href, targetUrl).toString());
    } catch {
      return null;
    }
    if (seen.has(absUrl)) return null;
    seen.add(absUrl);

    const text = normalizeSpaces(a.textContent);
    return {
      url: absUrl,
      numText: '',
      titleText: text,
      dateText: normalizeSpaces(li.querySelector('.chapter-release-date')?.textContent || ''),
      displayTitle: text || absUrl,
      volume: extractVolumeLabel(fallbackVol, text, absUrl),
      included: true
    };
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('.reading-content .text-left, .reading-content, .entry-content');
  }
}

export const madaraThemeParser = new MadaraThemeParser();
