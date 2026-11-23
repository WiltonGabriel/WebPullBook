import {
  BaseParser,
  extractCleanSynopsis,
  extractUniqueTexts,
  extractVolumeLabel,
  fetchDocumentWithOptions,
  normalizeSpaces,
  normalizeUrl,
  resolveAbsoluteUrl,
  sleep
} from '../core/parser-engine.js';

const NOVEL_PATH_RX = /^\/novels\/([^/?#]+)(?:\/capitulos\/([^/?#]+))?\/?$/i;

function extractNovelSlug(url) {
  try {
    const match = new URL(url).pathname.match(NOVEL_PATH_RX);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function formatNovelManiaVolume(unity, titleText = '', href = '') {
  const rawName = normalizeSpaces(unity?.name || '');
  const rawSub = normalizeSpaces(unity?.title || '');

  if (rawName) {
    const simpleVol = rawName.match(/^Volume\s+(\d+)$/i);
    if (simpleVol) {
      const padded = `Volume ${String(parseInt(simpleVol[1], 10)).padStart(2, '0')}`;
      return rawSub ? `${padded} — ${rawSub}` : padded;
    }
    return rawName;
  }

  return extractVolumeLabel('', titleText, href);
}

/**
 * Adapter for Novel Mania (novelmania.com.br) novel index and chapter pages.
 */
export class NovelManiaParser extends BaseParser {
  constructor() {
    super({
      id: 'novelmania',
      name: 'Novel Mania'
    });
  }

  matchScore(doc, url = '') {
    let score = 0;
    try {
      const host = new URL(url).hostname;
      if (/(?:^|\.)novelmania\.com\.br$/i.test(host)) score += 25;
    } catch {
      // Ignore invalid/empty URL
    }

    if (doc.querySelector('meta[property="og:site_name"][content="Novel Mania"]')) score += 25;
    if (doc.querySelector('[data-testid="novel-synopsis"]')) score += 35;
    if (doc.querySelector('a[id^="chapter-"][href*="/capitulos/"]')) score += 25;
    if (doc.querySelector('#reader-chapter-title')) score += 45;
    if (doc.querySelector('.rich-text-content') && doc.querySelector('a[href*="/novels/"][href*="/capitulos/"]')) {
      score += 25;
    }

    return Math.min(100, score);
  }

  async resolveIndexDocument(inputUrl, doc, signal, options = {}) {
    const targetUrl = normalizeUrl(inputUrl);
    const slug = extractNovelSlug(targetUrl);
    const isChapterUrl = /\/capitulos\//i.test(targetUrl) || Boolean(doc.querySelector('#reader-chapter-title'));

    if (!isChapterUrl) {
      return { targetUrl, doc };
    }

    const candidates = [];
    for (const a of doc.querySelectorAll('nav a[href*="/novels/"], a[href*="/novels/"]')) {
      const href = a.getAttribute('href') || '';
      if (!href || /\/capitulos\//i.test(href)) continue;
      try {
        const abs = normalizeUrl(new URL(href, targetUrl).toString());
        if (extractNovelSlug(abs)) candidates.push(abs);
      } catch {
        // Ignore malformed URL
      }
    }

    if (slug) {
      try {
        const canonical = new URL(`/novels/${slug}`, targetUrl).toString();
        if (!candidates.includes(canonical)) candidates.push(canonical);
      } catch {
        // Ignore
      }
    }

    for (const candidateUrl of candidates) {
      if (candidateUrl === targetUrl) continue;
      try {
        const candidateDoc = await fetchDocumentWithOptions(candidateUrl, options, signal);
        const h1Text = normalizeSpaces(candidateDoc.querySelector('h1')?.textContent);
        if (
          candidateDoc.querySelector('[data-testid="novel-synopsis"]') ||
          (h1Text && !/não foi possível carregar/i.test(h1Text))
        ) {
          return { targetUrl: candidateUrl, doc: candidateDoc };
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
    }

    return { targetUrl, doc };
  }

  extractSiteMetadata(doc, targetUrl) {
    const out = {};
    const jsonLd = this.extractJsonLdMetadata(doc);

    const h1El = doc.querySelector('h1');
    const h1Title = normalizeSpaces(h1El?.textContent);
    if (h1Title && !/não foi possível carregar/i.test(h1Title)) {
      out.title = h1Title;
    }

    for (const dt of doc.querySelectorAll('dl dt')) {
      const label = normalizeSpaces(dt.textContent).toLowerCase();
      const dd = dt.parentElement?.querySelector('dd');
      const value = normalizeSpaces(dd?.textContent);
      if (!value) continue;
      if (label === 'autor' && !out.author) {
        out.author = value;
      } else if (label === 'status' && !out.status) {
        out.status = value;
      }
    }

    if (!out.author && jsonLd.author) out.author = jsonLd.author;

    // Scope genre links to the novel header block to avoid picking up similar-novel cards
    const genreScope = h1El?.parentElement || doc;
    const genres = extractUniqueTexts(genreScope, 'a[href^="/genero/"]');
    if (genres.length > 0) {
      out.genres = genres;
    } else if (Array.isArray(jsonLd.genres) && jsonLd.genres.length > 0) {
      out.genres = jsonLd.genres;
    }

    if (!out.status && jsonLd.status) {
      out.status = jsonLd.status;
    }

    const synContainer = doc.querySelector('[data-testid="novel-synopsis"] .rich-text-content, [data-testid="novel-synopsis"]');
    const synopsis = extractCleanSynopsis(synContainer);
    if (synopsis) out.synopsis = synopsis;

    const ogCoverRaw = resolveAbsoluteUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), targetUrl);
    const ogCover = /\/og-default\.png$/i.test(ogCoverRaw) ? '' : ogCoverRaw;
    const domCover = resolveAbsoluteUrl(
      doc.querySelector('aside img[src], img[src*="/uploads/novel/cover/"]')?.getAttribute('src'),
      targetUrl
    );
    const primary = ogCover || domCover;
    const thumb = domCover || ogCover;
    if (primary) {
      out.coverUrl = primary;
      out.coverThumbUrl = thumb;
    }

    return out;
  }

  async _fetchJson(url, signal, retries = 2) {
    let attempt = 0;
    while (true) {
      try {
        const resp = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal
        });
        if (!resp.ok) {
          const err = new Error(`HTTP ${resp.status} ao consultar ${url}`);
          err.status = resp.status;
          err.isRateLimit = resp.status === 429;
          throw err;
        }
        return await resp.json();
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (err?.isRateLimit) throw err;
        const retryable = !err?.status || err.status >= 500;
        if (!retryable || attempt >= retries) return null;
        attempt += 1;
        await sleep(800 * attempt, signal);
      }
    }
  }

  _mapApiChapters(items, targetUrl, slug) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
      if (!item?.slug) continue;
      let absUrl;
      try {
        absUrl = normalizeUrl(new URL(`/novels/${slug}/capitulos/${item.slug}`, targetUrl).toString());
      } catch {
        continue;
      }
      if (seen.has(absUrl)) continue;
      seen.add(absUrl);

      const titleText = normalizeSpaces(item.title || item.longTitle || item.slug);
      const dateText = item.publishedAt ? String(item.publishedAt).slice(0, 10) : '';
      const volume = formatNovelManiaVolume(item.unity, titleText, absUrl);

      out.push({
        url: absUrl,
        numText: '',
        titleText,
        dateText,
        displayTitle: titleText || absUrl,
        volume,
        included: true
      });
    }
    return out;
  }

  async collectAllChapters(indexDoc, targetUrl, options = {}, signal) {
    const customListSelector = (options.customListSelector || '').trim();
    const slug = extractNovelSlug(targetUrl);

    if (!customListSelector && !options.disableApiToc && slug) {
      const baseApi = new URL(`/api/novels/${slug}/chapters`, targetUrl).toString();
      const firstPage = await this._fetchJson(`${baseApi}?page=1&items=50&sort=asc`, signal);

      if (firstPage?.success && Array.isArray(firstPage.data) && firstPage.data.length > 0) {
        const totalPages = Math.max(1, Number(firstPage.meta?.pages) || 1);
        const rawItems = [...firstPage.data];

        const batchSize = 4;
        for (let start = 2; start <= totalPages; start += batchSize) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const batchPages = [];
          for (let p = start; p < start + batchSize && p <= totalPages; p++) {
            batchPages.push(this._fetchJson(`${baseApi}?page=${p}&items=50&sort=asc`, signal));
          }
          const results = await Promise.all(batchPages);
          for (const pageRes of results) {
            if (pageRes?.success && Array.isArray(pageRes.data)) {
              rawItems.push(...pageRes.data);
            }
          }
        }

        const mapped = this._mapApiChapters(rawItems, targetUrl, slug);
        if (mapped.length > 0) return mapped;
      }
    }

    return super.collectAllChapters(indexDoc, targetUrl, options, signal);
  }

  collectChapterNodes(doc, targetUrl) {
    const chapters = [];
    const seen = new Set();

    const listAnchors = Array.from(doc.querySelectorAll('a[id^="chapter-"][href*="/capitulos/"]'));
    const fallbackAnchors =
      listAnchors.length > 0
        ? listAnchors
        : Array.from(doc.querySelectorAll('a[href*="/capitulos/"]')).filter(
            (a) => !/^(?:come[çc]ar\s+a\s+ler|continuar\s+lendo)/i.test(normalizeSpaces(a.textContent))
          );

    for (const a of fallbackAnchors) {
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#')) continue;

      let absUrl;
      try {
        absUrl = normalizeUrl(new URL(rawHref, targetUrl).toString());
      } catch {
        continue;
      }
      if (seen.has(absUrl)) continue;
      seen.add(absUrl);

      const titleSpan = a.querySelector('span');
      const titleText = normalizeSpaces(titleSpan?.textContent || a.textContent) || absUrl;
      const timeEl = a.querySelector('time');
      const dateText = (timeEl?.getAttribute('datetime') || '').slice(0, 10) || normalizeSpaces(timeEl?.textContent);

      let volume = '';
      const groupWrap = a.parentElement?.parentElement;
      const headerDiv = groupWrap?.firstElementChild;
      if (headerDiv && headerDiv !== a.parentElement && headerDiv.querySelector('span')) {
        const volName = normalizeSpaces(headerDiv.querySelector('span')?.textContent);
        const volSub = normalizeSpaces(headerDiv.querySelector('h3')?.textContent);
        if (volName) {
          volume = formatNovelManiaVolume({ name: volName, title: volSub }, titleText, absUrl);
        }
      }
      if (!volume) {
        volume = extractVolumeLabel('', titleText, absUrl);
      }

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

  async loadSeries(inputUrl, options = {}, signal, preloadedDoc = null) {
    const series = await super.loadSeries(inputUrl, options, signal, preloadedDoc);
    const slug = extractNovelSlug(series.startingUrl || inputUrl);

    if (!options.disableApiToc && slug) {
      try {
        const apiUrl = new URL(`/api/novels/${slug}`, series.startingUrl || inputUrl).toString();
        const payload = await this._fetchJson(apiUrl, signal, 1);
        const data = payload?.data;
        if (payload?.success && data) {
          if (data.title && (!series.title || /não foi possível carregar/i.test(series.title))) {
            series.title = normalizeSpaces(data.title);
          }
          if (data.author && (!series.author || series.author === '<unknown>')) {
            series.author = normalizeSpaces(data.author);
          }
          if (data.status && !series.status) {
            series.status = normalizeSpaces(data.status);
          }
          if (Array.isArray(data.categories) && data.categories.length > 0 && (!series.genres || series.genres.length === 0)) {
            series.genres = data.categories.map((c) => normalizeSpaces(c?.name)).filter(Boolean);
          }
          if (data.synopsis && !series.synopsis) {
            const synDoc = new DOMParser().parseFromString(String(data.synopsis), 'text/html');
            const cleanSyn = extractCleanSynopsis(synDoc.body);
            if (cleanSyn) series.synopsis = cleanSyn;
          }
          if (data.cover?.original) {
            series.coverUrl = data.cover.original;
            series.coverThumbUrl = data.cover.large || data.cover.small || series.coverThumbUrl || data.cover.original;
          } else if (data.cover?.large && !series.coverUrl) {
            series.coverUrl = data.cover.large;
            series.coverThumbUrl = data.cover.small || data.cover.large;
          }
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
    }

    return series;
  }

  findChapterContentRoot(doc) {
    const headerContent = doc
      .querySelector('#reader-chapter-title')
      ?.closest('header')
      ?.parentElement?.querySelector('.rich-text-content');
    if (headerContent) return headerContent;
    return doc.querySelector('[class*="_body_"].rich-text-content, main .rich-text-content, .rich-text-content');
  }

  extractChapterHeading(doc, chapter) {
    const { chapterTitle } = super.extractChapterHeading(doc, chapter);
    return {
      chapterTitle,
      subtitle: ''
    };
  }
}

export const novelManiaParser = new NovelManiaParser();
