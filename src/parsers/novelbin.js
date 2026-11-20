import {
  BaseParser,
  canUseTabScripting,
  extractCleanSynopsis,
  extractVolumeLabel,
  fetchDocumentWithOptions,
  normalizeSpaces,
  normalizeUrl,
  resolveSafeHttpUrl
} from '../core/parser-engine.js';

const READ_SLUG_RX = /^\/read\/([^/?#]+)(?:\/([^/?#]+))?\/?$/i;
const NOVEL_OR_READ_PATH_RX = /^\/(?:novel|read)\/[^/?#]+/i;
const DEFAULT_OG_IMAGE_RX = /\/(?:og-image|og-default|default-og)\./i;

function extractSlugFromPath(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname;
    const readMatch = pathname.match(READ_SLUG_RX);
    if (readMatch) return { slug: readMatch[1], isChapterPath: true };
    const novelMatch = pathname.match(/^\/novel\/([^/?#]+)\/?$/i);
    if (novelMatch) return { slug: novelMatch[1], isChapterPath: false };
    return { slug: '', isChapterPath: false };
  } catch {
    return { slug: '', isChapterPath: false };
  }
}

/**
 * Structural adapter for NovelBin React SPA novel index and chapter reader pages.
 */
export class NovelBinParser extends BaseParser {
  constructor() {
    super({
      id: 'novelbin',
      name: 'NovelBin'
    });
  }

  getIndexWaitSelector() {
    return '.chapter-list a.chapter-item';
  }

  getChapterWaitSelector() {
    return '.reader-content p, .reader-content h2, .reader-content h3';
  }

  requiresTabForChapters() {
    return true;
  }

  matchScore(doc, url = '') {
    let score = 0;
    let pathname = '';
    try {
      const parsed = new URL(url);
      pathname = parsed.pathname || '';
      if (/(?:^|\.)novelbin\.xyz$/i.test(parsed.hostname)) {
        score += 25;
      }
    } catch {
      // Ignore invalid/empty URL
    }

    const ogSiteName = normalizeSpaces(
      doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || ''
    );
    const isNovelBinMeta = /^novelbin$/i.test(ogSiteName);
    if (isNovelBinMeta) score += 20;

    if (doc.querySelector('#ssr-novel-card')) score += 35;
    if (doc.querySelector('.novel-detail-hero, .novel-page-wrapper')) score += 35;
    if (doc.querySelector('.chapter-box .chapter-list a.chapter-item')) score += 35;
    if (doc.querySelector('.reader-wrapper .reader-content, .reader-header-chapter')) score += 45;

    if (NOVEL_OR_READ_PATH_RX.test(pathname) && (isNovelBinMeta || doc.querySelector('#ssr-home-fallback'))) {
      score += 20;
    }

    return Math.min(100, score);
  }

  async resolveIndexDocument(inputUrl, doc, signal, options = {}) {
    const targetUrl = normalizeUrl(inputUrl);
    const { slug, isChapterPath } = extractSlugFromPath(targetUrl);
    const isChapterDom = Boolean(doc.querySelector('.reader-wrapper, .reader-header-chapter'));
    if (!isChapterPath && !isChapterDom) {
      return { targetUrl, doc };
    }

    const candidates = [];
    const addCandidate = (rawHref) => {
      const abs = resolveSafeHttpUrl(rawHref, targetUrl);
      if (!abs || /\/read\//i.test(abs)) return;
      const norm = normalizeUrl(abs);
      if (!candidates.includes(norm)) candidates.push(norm);
    };

    // Always prefer the canonical slug derived from /read/<slug>/... before falling back to header links,
    // and never read links from <noscript>, #ssr-home-fallback, or related recommendations.
    if (slug) {
      addCandidate(`/novel/${slug}`);
    }
    for (const a of doc.querySelectorAll('.reader-header a[href*="/novel/"]')) {
      if (a.closest?.('noscript, #ssr-home-fallback, .related-container')) continue;
      addCandidate(a.getAttribute('href'));
    }

    const useTab = canUseTabScripting();
    const fetchOpts = {
      ...options,
      ...(useTab
        ? {
            renderWithTab: true,
            renderWaitMs: Math.max(options.renderWaitMs ?? 1100, 1500),
            waitForSelector: this.getIndexWaitSelector()
          }
        : {})
    };

    for (const candidateUrl of candidates) {
      if (candidateUrl === targetUrl) continue;
      try {
        const candidateDoc = await fetchDocumentWithOptions(candidateUrl, fetchOpts, signal);
        if (candidateDoc.querySelector('.chapter-list a.chapter-item, .novel-detail-hero, #ssr-novel-card')) {
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

    const h1Title = normalizeSpaces(doc.querySelector('h1.detail-title, #ssr-novel-card h1')?.textContent);
    if (h1Title) {
      out.title = h1Title;
    } else if (jsonLd.title) {
      out.title = jsonLd.title;
    }

    let ssrAuthor = '';
    let ssrStatus = '';
    for (const p of doc.querySelectorAll('#ssr-novel-card p')) {
      const txt = normalizeSpaces(p.textContent);
      const authorMatch = txt.match(/^Author:\s*(.+)$/i);
      if (authorMatch && !ssrAuthor) {
        ssrAuthor = normalizeSpaces(authorMatch[1]);
        continue;
      }
      const statusMatch = txt.match(/^Status:\s*(.+)$/i);
      if (statusMatch && !ssrStatus) {
        ssrStatus = normalizeSpaces(statusMatch[1]);
      }
    }

    if (jsonLd.author) {
      out.author = jsonLd.author;
    } else if (ssrAuthor) {
      out.author = ssrAuthor;
    }

    const rawDetailStatus = normalizeSpaces(doc.querySelector('.detail-status')?.textContent)
      .replace(/^[✓✔●•·\s]+/, '')
      .trim();
    if (rawDetailStatus) {
      out.status = rawDetailStatus;
    } else if (ssrStatus) {
      out.status = ssrStatus;
    } else if (jsonLd.status) {
      out.status = jsonLd.status;
    }

    const genres = [];
    const seenGenres = new Set();
    const genreLinks = doc.querySelectorAll('.novel-detail-hero .genre-tags a.genre-tag');
    const fallbackGenreLinks = genreLinks.length > 0 ? genreLinks : doc.querySelectorAll('#ssr-novel-card a[href^="/genre/"]');
    for (const a of fallbackGenreLinks) {
      const g = normalizeSpaces(a.textContent);
      if (g && !seenGenres.has(g)) {
        seenGenres.add(g);
        genres.push(g);
      }
    }
    if (genres.length > 0) {
      out.genres = genres;
    } else if (Array.isArray(jsonLd.genres) && jsonLd.genres.length > 0) {
      out.genres = [...jsonLd.genres];
    }

    const synEl = doc.querySelector('.synopsis-content, .detail-desc') || doc.querySelector('#ssr-novel-card section div');
    const synopsis = extractCleanSynopsis(synEl);
    if (synopsis) out.synopsis = synopsis;

    const ogCoverRaw = resolveSafeHttpUrl(
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
      targetUrl
    );
    const ogCover = ogCoverRaw && !DEFAULT_OG_IMAGE_RX.test(ogCoverRaw) ? ogCoverRaw : '';
    const domCover = resolveSafeHttpUrl(
      doc.querySelector('img.detail-cover[src], #ssr-novel-card img[src]')?.getAttribute('src'),
      targetUrl
    );
    const ldCover = resolveSafeHttpUrl(jsonLd.coverUrl, targetUrl);
    const primaryCover = domCover || ldCover || ogCover;
    if (primaryCover) {
      out.coverUrl = primaryCover;
      out.coverThumbUrl = domCover || ogCover || primaryCover;
    }

    return out;
  }

  collectChapterNodes(doc, targetUrl) {
    const chapters = [];
    const seen = new Set();

    const scopedAnchors = doc.querySelectorAll('.chapter-box .chapter-list a.chapter-item[href]');
    const anchors = scopedAnchors.length > 0 ? scopedAnchors : doc.querySelectorAll('.chapter-list a.chapter-item[href]');

    for (const a of anchors) {
      const absUrl = resolveSafeHttpUrl(a.getAttribute('href'), targetUrl);
      if (!absUrl) continue;
      const key = normalizeUrl(absUrl);
      if (seen.has(key)) continue;
      seen.add(key);

      const titleText = normalizeSpaces(a.querySelector('span')?.textContent || a.textContent) || absUrl;
      chapters.push({
        url: absUrl,
        numText: '',
        titleText,
        dateText: '',
        displayTitle: titleText,
        volume: extractVolumeLabel('', titleText, absUrl),
        included: true
      });
    }

    return chapters;
  }

  findChapterContentRoot(doc) {
    const root = doc.querySelector('.reader-content');
    if (!root || root.querySelector('.skeleton')) return null;
    if (root.querySelector('p') || normalizeSpaces(root.textContent).length >= 25) {
      return root;
    }
    return null;
  }

  extractChapterHeading(doc, chapter) {
    const readerChapter = normalizeSpaces(doc.querySelector('.reader-header-chapter')?.textContent);
    if (readerChapter) {
      return {
        chapterTitle: readerChapter,
        subtitle: ''
      };
    }
    return {
      chapterTitle: chapter.displayTitle || chapter.url,
      subtitle: ''
    };
  }
}

export const novelBinParser = new NovelBinParser();
