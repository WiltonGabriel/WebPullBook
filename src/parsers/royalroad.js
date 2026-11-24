import {
  BaseParser,
  extractCleanSynopsis,
  extractUniqueTexts,
  extractVolumeLabel,
  extractWindowJsonArray,
  fetchDocumentWithOptions,
  normalizeSpaces,
  normalizeUrl,
  resolveAbsoluteUrl,
  toHighResCoverUrl
} from '../core/parser-engine.js';

const STATUS_RX = /^(ONGOING|COMPLETED|HIATUS|INACTIVE|STUB|DROPPED)$/i;
const FICTION_PATH_RX = /^\/fiction\/(\d+)(?:\/[^/?#]+)?\/?$/i;

function formatRoyalRoadVolume(vol) {
  const title = normalizeSpaces(vol?.title || '');
  const order = Number(vol?.order);
  if (title) {
    if (/\d+/.test(title)) return title;
    if (Number.isFinite(order) && order > 0) {
      return `Volume ${String(order).padStart(2, '0')} — ${title}`;
    }
    return title;
  }
  if (Number.isFinite(order) && order > 0) {
    return `Volume ${String(order).padStart(2, '0')}`;
  }
  return 'Volume 01';
}

/**
 * Adapter for Royal Road (royalroad.com) fiction index and chapter pages.
 */
export class RoyalRoadParser extends BaseParser {
  constructor() {
    super({
      id: 'royalroad',
      name: 'Royal Road'
    });
  }

  matchScore(doc, url = '') {
    let score = 0;
    let isRoyalRoadHost = false;
    try {
      const host = new URL(url).hostname;
      if (/(?:^|\.)royalroad\.com$/i.test(host)) {
        score += 45;
        isRoyalRoadHost = true;
      }
    } catch {
      // ignore invalid/empty URL
    }

    if (doc.querySelector('meta[property="og:site_name"][content="Royal Road"]')) score += 30;
    if (doc.querySelector('table#chapters tr.chapter-row')) {
      score += 45;
    } else if (isRoyalRoadHost && doc.querySelector('table#chapters')) {
      score += 45;
    }
    if (doc.querySelector('.chapter-inner.chapter-content')) score += 45;
    if (doc.querySelector('.cover-art-container') && doc.querySelector('.fiction-tag')) score += 20;

    return Math.min(100, score);
  }

  _extractWindowJsonArray(doc, varName) {
    return extractWindowJsonArray(doc, varName);
  }

  async resolveIndexDocument(inputUrl, doc, signal, options = {}) {
    const targetUrl = normalizeUrl(inputUrl);
    if (doc.querySelector('table#chapters') || this._extractWindowJsonArray(doc, 'chapters').length > 0) {
      return { targetUrl, doc };
    }

    const expectedMatch = targetUrl.match(/\/fiction\/(\d+)(?:\/|$)/i);
    const expectedFictionId = expectedMatch ? expectedMatch[1] : '';
    const prioritized = [];
    const secondary = [];
    const tried = new Set([targetUrl]);

    const considerAnchor = (a, isPrimary) => {
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref) return;
      try {
        const u = new URL(rawHref, targetUrl);
        const m = u.pathname.match(FICTION_PATH_RX);
        if (!m) return;
        u.hash = '';
        u.search = '';
        const abs = u.toString();
        if (tried.has(abs)) return;
        tried.add(abs);
        if (expectedFictionId && m[1] === expectedFictionId) {
          prioritized.push(abs);
        } else if (!expectedFictionId && isPrimary) {
          prioritized.push(abs);
        } else if (!expectedFictionId) {
          secondary.push(abs);
        }
      } catch {
        // ignore invalid href
      }
    };

    for (const a of doc.querySelectorAll('.fic-header a[href*="/fiction/"], .portlet-title a[href*="/fiction/"]')) {
      considerAnchor(a, true);
    }
    for (const a of doc.querySelectorAll('a[href*="/fiction/"]')) {
      considerAnchor(a, false);
    }
    if (expectedFictionId) {
      try {
        const canonical = new URL(`/fiction/${expectedFictionId}/`, targetUrl).toString();
        if (!tried.has(canonical)) {
          tried.add(canonical);
          prioritized.push(canonical);
        }
      } catch {
        // ignore
      }
    }

    const candidates = [...prioritized, ...secondary].slice(0, 3);
    for (const resolvedUrl of candidates) {
      try {
        const candidateDoc = await fetchDocumentWithOptions(resolvedUrl, options, signal);
        if (
          candidateDoc.querySelector('table#chapters') ||
          this._extractWindowJsonArray(candidateDoc, 'chapters').length > 0
        ) {
          return { targetUrl: resolvedUrl, doc: candidateDoc };
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
    }

    return { targetUrl, doc };
  }

  findNextPageUrl() {
    // Royal Road embeds the full chapter list on the fiction page; never follow chapter rel="next"
    return null;
  }

  extractSiteMetadata(doc, targetUrl) {
    const out = {};

    const titleEl = doc.querySelector('.fic-header h1, h1.font-white, h1');
    const title = normalizeSpaces(titleEl?.textContent);
    if (title) out.title = title;

    const authorRaw =
      doc.querySelector('.fic-header h4 a[href*="/profile/"]')?.textContent ||
      doc.querySelector('.fic-header h4 a')?.textContent ||
      doc.querySelector('meta[property="books:author"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="twitter:creator"]')?.getAttribute('content') ||
      '';
    const author = normalizeSpaces(authorRaw);
    if (author) out.author = author;

    for (const labelEl of doc.querySelectorAll('.fiction-info span.label, .margin-bottom-10 > span.label')) {
      const txt = normalizeSpaces(labelEl.textContent);
      if (STATUS_RX.test(txt)) {
        out.status = txt;
        break;
      }
    }

    const genres = extractUniqueTexts(doc, '.tags .fiction-tag, a.fiction-tag');
    if (genres.length > 0) out.genres = genres;

    const hiddenDesc = doc.querySelector('.description .hidden-content');
    if (hiddenDesc) {
      const syn = extractCleanSynopsis(hiddenDesc);
      if (syn) out.synopsis = syn;
    } else {
      const descEl = doc.querySelector('.description');
      if (descEl) {
        const clone = descEl.cloneNode(true);
        for (const uiEl of clone.querySelectorAll('input, label')) {
          uiEl.remove();
        }
        const syn = extractCleanSynopsis(clone);
        if (syn) out.synopsis = syn;
      }
    }

    const ogCover = resolveAbsoluteUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), targetUrl);
    const domCover = resolveAbsoluteUrl(doc.querySelector('.cover-art-container img')?.getAttribute('src'), targetUrl);
    const primaryCover = ogCover || domCover;
    const thumbCover = domCover || ogCover;
    if (primaryCover) {
      out.coverUrl = toHighResCoverUrl(primaryCover) || primaryCover;
      out.coverThumbUrl = thumbCover;
    }

    return out;
  }

  collectChapterNodes(doc, targetUrl) {
    const windowVolumes = this._extractWindowJsonArray(doc, 'volumes');
    const volumeMap = new Map();
    for (const vol of windowVolumes) {
      if (vol?.id != null) {
        volumeMap.set(String(vol.id), formatRoyalRoadVolume(vol));
      }
    }

    const windowChapters = this._extractWindowJsonArray(doc, 'chapters');
    const domRows = Array.from(doc.querySelectorAll('table#chapters tbody tr.chapter-row, table#chapters tbody tr'));
    const chapters = [];
    const seenUrls = new Set();

    if (windowChapters.length > 0 && windowChapters.length >= domRows.length) {
      const ordered = windowChapters
        .map((ch, idx) => ({ ch, idx }))
        .sort((a, b) => (Number(a.ch?.order ?? a.idx) - Number(b.ch?.order ?? b.idx)) || (a.idx - b.idx));

      for (const { ch } of ordered) {
        const rawHref = ch?.url || '';
        if (!rawHref) continue;
        let absUrl;
        try {
          absUrl = normalizeUrl(new URL(rawHref, targetUrl).toString());
        } catch {
          continue;
        }
        if (seenUrls.has(absUrl)) continue;
        seenUrls.add(absUrl);

        const titleText = normalizeSpaces(ch.title) || absUrl;
        const volKey = ch.volumeId != null ? String(ch.volumeId) : '';
        const volume = volKey && volumeMap.has(volKey)
          ? volumeMap.get(volKey)
          : extractVolumeLabel('', titleText, absUrl);

        chapters.push({
          url: absUrl,
          numText: '',
          titleText,
          dateText: ch.date ? String(ch.date).slice(0, 10) : '',
          displayTitle: titleText,
          volume,
          included: ch.isUnlocked !== false
        });
      }
      return chapters;
    }

    for (const tr of domRows) {
      const a = tr.querySelector('a[href*="/chapter/"], a[href]');
      if (!a) continue;
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#')) continue;

      let absUrl;
      try {
        absUrl = normalizeUrl(new URL(rawHref, targetUrl).toString());
      } catch {
        continue;
      }
      if (seenUrls.has(absUrl)) continue;
      seenUrls.add(absUrl);

      const titleText = normalizeSpaces(a.textContent) || absUrl;
      const volAttr = tr.getAttribute('data-volume-id');
      const volKey = volAttr && volAttr !== 'null' ? volAttr : '';
      const volume = volKey && volumeMap.has(volKey)
        ? volumeMap.get(volKey)
        : extractVolumeLabel('', titleText, absUrl);
      const timeEl = tr.querySelector('time');
      const dateText = (timeEl?.getAttribute('datetime') || '').slice(0, 10) || normalizeSpaces(timeEl?.textContent);

      chapters.push({
        url: absUrl,
        numText: '',
        titleText,
        dateText,
        displayTitle: titleText,
        volume,
        included: true
      });
    }

    return chapters;
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('.chapter-inner.chapter-content, .chapter-inner, .chapter-content');
  }

  extractChapterHeading(doc, chapter) {
    const h1 = normalizeSpaces(doc.querySelector('.fic-header h1, h1')?.textContent);
    return {
      chapterTitle: h1 || chapter.displayTitle || chapter.url,
      subtitle: ''
    };
  }
}

export const royalRoadParser = new RoyalRoadParser();
