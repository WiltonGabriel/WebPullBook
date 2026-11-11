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
 * Adapter for serialized fiction sites using WordPress light-novel themes
 * (`.eplister`, `.ts-chl-collapsible`, `.epcontent`, `.spe`).
 */
export class WpNovelThemeParser extends BaseParser {
  constructor() {
    super({
      id: 'wp-lightnovel',
      name: 'WordPress Novel Theme (Auto)'
    });
  }

  matchScore(doc) {
    let score = 0;
    if (doc.querySelector('.eplister')) score += 55;
    if (doc.querySelector('.ts-chl-collapsible')) score += 25;
    if (doc.querySelector('div.epcontent')) score += 45;
    if (doc.querySelector('.spe span')) score += 10;
    return Math.min(100, score);
  }

  async resolveIndexDocument(inputUrl, doc, signal) {
    let targetUrl = normalizeUrl(inputUrl);
    let activeDoc = doc;

    if (!activeDoc.querySelector('.eplister')) {
      const seriesLink = activeDoc.querySelector(
        '.ts-breadcrumb a[href*="/series/"], .allc a[href*="/series/"], .breadcrumb a[href*="/series/"], .allc a[href]'
      );
      if (seriesLink) {
        const resolved = normalizeUrl(new URL(seriesLink.getAttribute('href'), targetUrl).toString());
        if (resolved !== targetUrl) {
          const candidateDoc = await fetchWithRetry(resolved, { retries: 2, signal });
          if (candidateDoc.querySelector('.eplister') || candidateDoc.querySelector('.ts-chl-collapsible')) {
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
    const titleEl = doc.querySelector('h1.entry-title, .infox h1');
    if (titleEl) out.title = normalizeSpaces(titleEl.textContent);

    for (const span of doc.querySelectorAll('.spe span')) {
      const txt = normalizeSpaces(span.textContent);
      if (/^(?:autor|author)\s*:/i.test(txt)) {
        const author = normalizeSpaces(txt.replace(/^(?:autor|author)\s*:/i, ''));
        if (author) out.author = author;
      } else if (/^status\s*:/i.test(txt)) {
        out.status = normalizeSpaces(txt.replace(/^status\s*:/i, ''));
      }
    }

    const genres = Array.from(doc.querySelectorAll('.genxed a, .mgen a'))
      .map((a) => normalizeSpaces(a.textContent))
      .filter(Boolean);
    if (genres.length > 0) out.genres = genres;

    const synContainer = doc.querySelector(
      '.entry-content[itemprop="description"], .synp .entry-content, .entry-content'
    );
    const syn = extractCleanSynopsis(synContainer);
    if (syn) out.synopsis = syn;

    const coverImg = doc.querySelector('.thumb img, .thumbook img');
    const rawCoverSrc =
      coverImg?.getAttribute('data-lazy-src') ||
      coverImg?.getAttribute('data-src') ||
      coverImg?.getAttribute('src');
    if (rawCoverSrc) {
      const thumb = new URL(rawCoverSrc, targetUrl).toString();
      out.coverThumbUrl = thumb;
      out.coverUrl = toHighResCoverUrl(thumb) || thumb;
    }

    return out;
  }

  collectChapterNodes(doc, targetUrl) {
    const rawChapters = [];
    const seenUrls = new Set();

    const addLi = (li, sectionVolLabel = '') => {
      const a = li.querySelector('a[href]:not(.dlpdf)');
      if (!a) return;
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref || /\/pdf\/?$/i.test(rawHref)) return;

      const absUrl = normalizeUrl(new URL(rawHref, targetUrl).toString());
      if (seenUrls.has(absUrl)) return;
      seenUrls.add(absUrl);

      const numText = normalizeSpaces(a.querySelector('.epl-num')?.textContent || '');
      const titleText = normalizeSpaces(a.querySelector('.epl-title')?.textContent || '');
      const dateText = normalizeSpaces(a.querySelector('.epl-date')?.textContent || '');
      const fallbackText = normalizeSpaces(a.textContent);

      const volume = extractVolumeLabel(sectionVolLabel, numText, absUrl);

      let displayTitle = '';
      if (numText && titleText) {
        displayTitle = `${numText} — ${titleText}`;
      } else if (numText || titleText) {
        displayTitle = numText || titleText;
      } else {
        displayTitle = fallbackText || absUrl;
      }

      rawChapters.push({
        url: absUrl,
        numText,
        titleText,
        dateText,
        displayTitle,
        volume,
        included: true
      });
    };

    const collapsibles = Array.from(doc.querySelectorAll('.ts-chl-collapsible'));
    if (collapsibles.length > 0) {
      for (const header of collapsibles) {
        const volText = normalizeSpaces(header.textContent);
        const next = header.nextElementSibling;
        const list = next?.querySelectorAll('.eplister li') || [];
        for (const li of list) {
          addLi(li, volText);
        }
      }
    }

    for (const li of doc.querySelectorAll('.eplister li')) {
      addLi(li, '');
    }

    rawChapters.reverse();
    return rawChapters;
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('div.epcontent, .epcontent, .entry-content');
  }
}

export const wpLightNovelParser = new WpNovelThemeParser();
