import {
  BaseParser,
  assertSafeHttpUrl,
  extractCleanSynopsis,
  extractUniqueTexts,
  extractVolumeLabel,
  fetchDocumentWithOptions,
  isSpaDomainCircuitOpen,
  normalizeSpaces,
  normalizeUrl,
  resolveAbsoluteUrl,
  resolveSafeHttpUrl,
  toHighResCoverUrl
} from '../core/parser-engine.js';
import { normalizeGroupedChaptersAscending } from '../core/parser-helpers.js';

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

  getIndexWaitSelector() {
    return '.wp-manga-chapter';
  }

  matchScore(doc) {
    let score = 0;
    const hasWpManga = Boolean(doc.querySelector('.wp-manga-chapter'));
    const hasListingWrap = Boolean(doc.querySelector('.listing-chapters_wrap, #manga-chapters-holder'));
    const hasSummaryImg = Boolean(doc.querySelector('.summary_image'));
    const hasBreadcrumb = Boolean(doc.querySelector('.c-breadcrumb'));
    const hasMadaraMarkers = Boolean(
      doc.querySelector(
        'body.single-wp-manga, body.wp-theme-madara, .profile-manga, .c-page-content .post-content_item'
      )
    );
    if (hasWpManga) score += 55;
    if (hasListingWrap) score += 30;
    if (hasMadaraMarkers) score += 25;
    if (doc.querySelector('.reading-content .text-left')) {
      score += 45;
    } else if (doc.querySelector('.reading-content')) {
      score +=
        hasWpManga || hasListingWrap || hasSummaryImg || hasBreadcrumb || hasMadaraMarkers ? 45 : 15;
    }
    if (hasSummaryImg) score += 10;
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
          if (
            candidateDoc.querySelector('.wp-manga-chapter') ||
            candidateDoc.querySelector('.listing-chapters_wrap, #manga-chapters-holder')
          ) {
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

    if (
      !activeDoc.querySelector('.wp-manga-chapter') &&
      activeDoc.querySelector('.listing-chapters_wrap, #manga-chapters-holder')
    ) {
      await this._tryPopulateAjaxChapters(activeDoc, targetUrl, signal);
    }
    return { targetUrl, doc: activeDoc };
  }

  async _tryPopulateAjaxChapters(activeDoc, seriesUrl, signal) {
    try {
      const base = new URL(seriesUrl);
      if (base.protocol !== 'http:' && base.protocol !== 'https:') return false;
      base.hash = '';
      base.search = '';
      base.pathname = base.pathname.replace(/\/+$/, '') + '/ajax/chapters/';
      const ajaxUrl = assertSafeHttpUrl(base.toString());
      if (isSpaDomainCircuitOpen(ajaxUrl)) return false;

      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(() => timeoutCtrl.abort(), 12000);
      const reqSignal = signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeoutCtrl.signal])
        : signal || timeoutCtrl.signal;
      let res;
      try {
        res = await fetch(ajaxUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          signal: reqSignal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res?.ok) return false;
      const html = await res.text();
      if (!html || !html.includes('wp-manga-chapter')) return false;

      const ajaxDoc = new DOMParser().parseFromString(html, 'text/html');
      if (!ajaxDoc?.querySelector('.wp-manga-chapter')) return false;

      const container =
        activeDoc.querySelector('.listing-chapters_wrap, #manga-chapters-holder') || activeDoc.body;
      if (!container) return false;
      for (const child of Array.from(ajaxDoc.body?.children || [])) {
        const imported = typeof activeDoc.importNode === 'function' ? activeDoc.importNode(child, true) : child.cloneNode(true);
        container.appendChild(imported);
      }
      return Boolean(activeDoc.querySelector('.wp-manga-chapter'));
    } catch (err) {
      if (err?.name === 'AbortError' && signal?.aborted) throw err;
      return false;
    }
  }

  findNextPageUrl() {
    // Madara renders the chapter list on the series page; never follow chapter post rel="next"
    return null;
  }

  extractSiteMetadata(doc, targetUrl) {
    const out = {};
    const titleEl = doc.querySelector('.post-title h1, h1');
    const h1Title = normalizeSpaces(titleEl?.textContent);
    if (h1Title) out.title = h1Title;

    const author = normalizeSpaces(doc.querySelector('.author-content')?.textContent);
    if (author) out.author = author;

    for (const item of doc.querySelectorAll('.post-status .post-content_item, .post-content_item')) {
      const heading = normalizeSpaces(item.querySelector('.summary-heading')?.textContent);
      if (/status/i.test(heading)) {
        const statusVal = normalizeSpaces(item.querySelector('.summary-content')?.textContent);
        if (statusVal) {
          out.status = statusVal;
          break;
        }
      }
    }

    const genres = extractUniqueTexts(doc, '.genres-content a');
    if (genres.length > 0) out.genres = genres;

    const rawSyn = extractCleanSynopsis(doc.querySelector('.summary__content, .description-summary .summary__content'));
    const syn = rawSyn
      .replace(/^you(?:['’]re|\s+are)\s+reading\s+["“”]?[^\n]{1,180}?["“”]?\s+novel\s+at\s+[^\n]+(?:\n+|$)/i, '')
      .trim();
    if (syn || rawSyn) out.synopsis = syn || rawSyn;

    const img = doc.querySelector('.summary_image img');
    const rawSrc = img?.getAttribute('data-src') || img?.getAttribute('data-lazy-src') || img?.getAttribute('src');
    const thumb = resolveAbsoluteUrl(rawSrc, targetUrl);
    if (thumb) {
      out.coverThumbUrl = thumb;
      out.coverUrl = toHighResCoverUrl(thumb) || thumb;
    }

    return out;
  }

  collectChapterNodes(doc, targetUrl) {
    const seen = new Set();
    const groups = [];

    const groupEls = Array.from(doc.querySelectorAll('.listing-chapters_wrap .parent.has-child'));
    if (groupEls.length > 0) {
      for (const grp of groupEls) {
        const volHeader = normalizeSpaces(grp.querySelector(':scope > a, :scope > span')?.textContent || '');
        const volLabel = extractVolumeLabel(volHeader);
        const groupChapters = [];
        for (const li of grp.querySelectorAll('.wp-manga-chapter')) {
          const item = this._parseChapterLi(li, targetUrl, volLabel, seen);
          if (item) groupChapters.push(item);
        }
        if (groupChapters.length > 0) {
          groups.push({ label: volLabel, chapters: groupChapters });
        }
      }
    }

    const ungrouped = [];
    for (const li of doc.querySelectorAll('.wp-manga-chapter')) {
      const item = this._parseChapterLi(li, targetUrl, '', seen);
      if (item) ungrouped.push(item);
    }

    return normalizeGroupedChaptersAscending(groups, ungrouped);
  }

  _parseChapterLi(li, targetUrl, fallbackVol, seen) {
    const a = li.querySelector('a[href]');
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    const absUrl = resolveSafeHttpUrl(href, targetUrl);
    if (!absUrl) return null;
    const norm = normalizeUrl(absUrl);
    if (seen.has(norm)) return null;
    seen.add(norm);

    const text = normalizeSpaces(a.textContent);
    return {
      url: norm,
      numText: '',
      titleText: text,
      dateText: normalizeSpaces(li.querySelector('.chapter-release-date')?.textContent || ''),
      displayTitle: text || norm,
      volume: extractVolumeLabel(fallbackVol, text, norm),
      included: true
    };
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('.reading-content .text-left, .reading-content, .entry-content');
  }
}

export const madaraThemeParser = new MadaraThemeParser();
