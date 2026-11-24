import {
  BaseParser,
  extractCleanSynopsis,
  extractUniqueTexts,
  extractVolumeLabel,
  fetchDocumentWithOptions,
  normalizeSpaces,
  normalizeUrl,
  resolveAbsoluteUrl,
  resolveSafeHttpUrl,
  toHighResCoverUrl
} from '../core/parser-engine.js';
import { normalizeGroupedChaptersAscending } from '../core/parser-helpers.js';

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

  async resolveIndexDocument(inputUrl, doc, signal, options = {}) {
    let targetUrl = normalizeUrl(inputUrl);
    let activeDoc = doc;

    if (!activeDoc.querySelector('.eplister')) {
      const seriesLinks = activeDoc.querySelectorAll(
        '.ts-breadcrumb a[href*="/series/"], .allc a[href*="/series/"], .breadcrumb a[href*="/series/"], .allc a[href]'
      );
      const tried = new Set([targetUrl]);
      for (const seriesLink of seriesLinks) {
        const rawHref = (seriesLink.getAttribute('href') || '').trim();
        if (!rawHref || rawHref.startsWith('#') || /^javascript:/i.test(rawHref)) continue;
        const resolved = resolveSafeHttpUrl(rawHref, targetUrl);
        if (!resolved) continue;
        try {
          const u = new URL(resolved);
          if (!u.pathname || u.pathname === '/') continue;
        } catch {
          continue;
        }
        const normResolved = normalizeUrl(resolved);
        if (tried.has(normResolved)) continue;
        tried.add(normResolved);
        try {
          const candidateDoc = await fetchDocumentWithOptions(normResolved, options, signal);
          if (candidateDoc.querySelector('.eplister') || candidateDoc.querySelector('.ts-chl-collapsible')) {
            targetUrl = normResolved;
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
    // WordPress novel theme renders the full chapter list on the series page; never follow post rel="next"
    return null;
  }

  extractSiteMetadata(doc, targetUrl) {
    const out = {};
    const titleEl = doc.querySelector('h1.entry-title, .infox h1');
    const h1Title = normalizeSpaces(titleEl?.textContent);
    if (h1Title) out.title = h1Title;

    for (const span of doc.querySelectorAll('.spe span')) {
      const txt = normalizeSpaces(span.textContent);
      if (/^(?:autor|author)\s*:/i.test(txt)) {
        const author = normalizeSpaces(txt.replace(/^(?:autor|author)\s*:/i, ''));
        if (author) out.author = author;
      } else if (/^status\s*:/i.test(txt)) {
        const status = normalizeSpaces(txt.replace(/^status\s*:/i, ''));
        if (status) out.status = status;
      }
    }

    const genres = extractUniqueTexts(doc, '.genxed a, .mgen a');
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
    const thumb = resolveAbsoluteUrl(rawCoverSrc, targetUrl);
    if (thumb) {
      out.coverThumbUrl = thumb;
      out.coverUrl = toHighResCoverUrl(thumb) || thumb;
    }

    return out;
  }

  collectChapterNodes(doc, targetUrl) {
    const seenUrls = new Set();

    const buildEntry = (li, sectionVolLabel = '') => {
      const a = li.querySelector('a[href]:not(.dlpdf)');
      if (!a) return null;
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref || /\/pdf\/?$/i.test(rawHref)) return null;

      const absUrl = resolveSafeHttpUrl(rawHref, targetUrl);
      if (!absUrl) return null;
      const norm = normalizeUrl(absUrl);
      if (seenUrls.has(norm)) return null;
      seenUrls.add(norm);

      const numText = normalizeSpaces(a.querySelector('.epl-num')?.textContent || '');
      const titleText = normalizeSpaces(a.querySelector('.epl-title')?.textContent || '');
      const dateText = normalizeSpaces(a.querySelector('.epl-date')?.textContent || '');
      const fallbackText = normalizeSpaces(a.textContent);

      const volume = extractVolumeLabel(sectionVolLabel, numText, norm);

      let displayTitle = '';
      if (numText && titleText) {
        displayTitle = `${numText} — ${titleText}`;
      } else if (numText || titleText) {
        displayTitle = numText || titleText;
      } else {
        displayTitle = fallbackText || norm;
      }

      return {
        url: norm,
        numText,
        titleText,
        dateText,
        displayTitle,
        volume,
        included: true
      };
    };

    const groups = [];
    const collapsibles = Array.from(doc.querySelectorAll('.ts-chl-collapsible'));
    if (collapsibles.length > 0) {
      for (const header of collapsibles) {
        const volText = normalizeSpaces(header.textContent);
        const next = header.nextElementSibling;
        const list = next?.querySelectorAll('.eplister li') || [];
        const groupChapters = [];
        for (const li of list) {
          const item = buildEntry(li, volText);
          if (item) groupChapters.push(item);
        }
        if (groupChapters.length > 0) {
          groups.push({ label: volText, chapters: groupChapters });
        }
      }
    }

    const ungrouped = [];
    for (const li of doc.querySelectorAll('.eplister li')) {
      const item = buildEntry(li, '');
      if (item) ungrouped.push(item);
    }

    return normalizeGroupedChaptersAscending(groups, ungrouped);
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('div.epcontent, .epcontent, .entry-content');
  }
}

export const wpLightNovelParser = new WpNovelThemeParser();
