import {
  BaseParser,
  extractCleanSynopsis,
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

  async resolveIndexDocument(inputUrl, doc, signal) {
    let targetUrl = normalizeUrl(inputUrl);
    let activeDoc = doc;

    if (!activeDoc.querySelector('.wp-manga-chapter')) {
      const seriesLink = activeDoc.querySelector('.breadcrumb li:nth-last-child(2) a[href], .c-breadcrumb a[href*="/novel/"], .c-breadcrumb a[href*="/manga/"]');
      if (seriesLink) {
        const resolved = normalizeUrl(new URL(seriesLink.getAttribute('href'), targetUrl).toString());
        if (resolved !== targetUrl) {
          const candidateDoc = await fetchWithRetry(resolved, { retries: 2, signal });
          if (candidateDoc.querySelector('.wp-manga-chapter')) {
            targetUrl = resolved;
            activeDoc = candidateDoc;
          }
        }
      }
    }
    return { targetUrl, doc: activeDoc };
  }

  extractSiteMetadata(doc, targetUrl) {
    const out = {};
    const titleEl = doc.querySelector('.post-title h1, h1');
    if (titleEl) out.title = normalizeSpaces(titleEl.textContent);

    const author = normalizeSpaces(doc.querySelector('.author-content')?.textContent);
    if (author) out.author = author;

    const genres = Array.from(doc.querySelectorAll('.genres-content a'))
      .map((a) => normalizeSpaces(a.textContent))
      .filter(Boolean);
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

    raw.reverse();
    return raw;
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
