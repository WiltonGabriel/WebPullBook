import {
  BaseParser,
  canUseTabScripting,
  extractVolumeLabel,
  fetchDocumentWithOptions,
  normalizeSpaces,
  normalizeUrl,
  sleep,
  toHighResCoverUrl,
  waitForTabComplete
} from '../core/parser-engine.js';

/**
 * Adapter for Scribble Hub serialized web fiction
 * (`.fic_title`, `.auth_name_fic`, `ol.toc_ol > li.toc_w`, `#chp_raw`).
 */
export class ScribbleHubParser extends BaseParser {
  constructor() {
    super({
      id: 'scribblehub',
      name: 'Scribble Hub',
      maxIndexPages: 250
    });
    // Tab-based Scribble Hub chapter fetches trigger burst throttling if fired at 350ms
    this.minDelayMs = 2200;
  }

  matchScore(doc, url = '') {
    let score = 0;
    if (doc.querySelector('ol.toc_ol')) score += 45;
    if (doc.querySelector('.fic_title')) score += 20;
    if (doc.querySelector('.auth_name_fic')) score += 15;
    if (doc.querySelector('.wi_fic_desc, .wi_fic_table')) score += 15;
    if (doc.querySelector('#chp_raw, .chp_raw')) score += 60;
    if (url) {
      try {
        const host = new URL(url).hostname;
        if (/(?:^|\.)scribblehub\.com$/i.test(host)) score += 25;
      } catch {
        // ignore invalid URL
      }
    }
    return Math.min(100, score);
  }

  async resolveIndexDocument(inputUrl, doc, signal, options = {}) {
    let targetUrl = normalizeUrl(inputUrl);
    let activeDoc = doc;

    if (!activeDoc.querySelector('ol.toc_ol') && !activeDoc.querySelector('.fic_title')) {
      const seriesLink = activeDoc.querySelector(
        '.wi_breadcrumb a[href*="/series/"], .chp_byauthor a[href*="/series/"], .c_index a[href*="/series/"], a[href*="/series/"]'
      );
      if (seriesLink) {
        const resolved = normalizeUrl(new URL(seriesLink.getAttribute('href'), targetUrl).toString());
        if (resolved !== targetUrl) {
          const candidateDoc = await fetchDocumentWithOptions(resolved, options, signal);
          if (candidateDoc.querySelector('ol.toc_ol') || candidateDoc.querySelector('.fic_title')) {
            targetUrl = resolved;
            activeDoc = candidateDoc;
          }
        }
      }
    }
    return { targetUrl, doc: activeDoc };
  }

  _extractSynopsis(doc) {
    const container = doc.querySelector('.wi_fic_desc');
    if (!container) return '';
    const clone = container.cloneNode(true);
    for (const rm of clone.querySelectorAll('script, style')) {
      rm.remove();
    }
    for (const br of clone.querySelectorAll('br')) {
      br.replaceWith('\n');
    }

    const extractParagraphLines = (el) =>
      String(el.textContent || '')
        .split('\n')
        .map((line) => normalizeSpaces(line))
        .filter(Boolean)
        .join('\n');

    const pEls = Array.from(clone.querySelectorAll('p'));
    if (pEls.length > 0) {
      const blocks = pEls.map(extractParagraphLines).filter(Boolean);
      if (blocks.length > 0) return blocks.join('\n\n');
    }
    return extractParagraphLines(clone);
  }

  extractSiteMetadata(doc, targetUrl) {
    const out = {};

    const titleEl = doc.querySelector('.fic_title, [property="name"]');
    if (titleEl) {
      const t = normalizeSpaces(titleEl.textContent);
      if (t) out.title = t;
    }

    const authorEl = doc.querySelector('.auth_name_fic');
    if (authorEl) {
      const a = normalizeSpaces(authorEl.textContent);
      if (a) out.author = a;
    }

    const genres = [];
    const seenGenres = new Set();
    for (const a of doc.querySelectorAll('.wi_fic_genre .fic_genre, a.fic_genre')) {
      const g = normalizeSpaces(a.textContent);
      if (g && !seenGenres.has(g)) {
        seenGenres.add(g);
        genres.push(g);
      }
    }
    if (genres.length > 0) out.genres = genres;

    for (const li of doc.querySelectorAll('.copyright ul li, .wi_fic_stats li')) {
      const hasStatusIcon = Boolean(li.querySelector('i.status, i.fa-question.status'));
      const rawText = normalizeSpaces(li.textContent);
      if (hasStatusIcon || /^(?:ongoing|completed|hiatus|dropped)\b/i.test(rawText)) {
        const cleanStatus = normalizeSpaces(rawText.replace(/\s*-\s*Updated\b.*$/i, ''));
        if (cleanStatus) {
          out.status = cleanStatus;
          break;
        }
      }
    }

    const synopsis = this._extractSynopsis(doc);
    if (synopsis) out.synopsis = synopsis;

    const coverImg = doc.querySelector('.fic_image img');
    const rawCover =
      coverImg?.getAttribute('data-src') ||
      coverImg?.getAttribute('data-lazy-src') ||
      coverImg?.getAttribute('src') ||
      doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      '';
    if (rawCover) {
      try {
        const thumb = new URL(rawCover, targetUrl).toString();
        out.coverThumbUrl = thumb;
        out.coverUrl = toHighResCoverUrl(thumb) || thumb;
      } catch {
        // Ignore invalid cover URL
      }
    }

    return out;
  }

  findNextPageUrl(doc, currentUrl) {
    const nextEl = doc.querySelector('#pagination-mesh-toc a.page-link.next, #pagination-mesh-toc a.next');
    const href = nextEl?.getAttribute('href') || '';
    if (!href) return null;
    try {
      const nextAbs = normalizeUrl(new URL(href, currentUrl).toString());
      return nextAbs !== normalizeUrl(currentUrl) ? nextAbs : null;
    } catch {
      return null;
    }
  }

  _extractPostId(doc, targetUrl) {
    const inputVal = doc.querySelector('#mypostid, input[name="mypostid"]')?.getAttribute('value');
    if (inputVal && /^\d+$/.test(inputVal.trim())) {
      return inputVal.trim();
    }
    const urlMatch = String(targetUrl || '').match(/\/series\/(\d+)(?:\/|$)/);
    return urlMatch ? urlMatch[1] : '';
  }

  async _runAjaxTocInTab(tabId, postId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [String(postId)],
      func: async (id) => {
        try {
          const body = new URLSearchParams({
            action: 'wi_getreleases_pagination',
            pagenum: '-1',
            mypostid: id
          }).toString();
          const resp = await fetch('/wp-admin/admin-ajax.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body
          });
          if (!resp.ok) return { ok: false, status: resp.status, html: '' };
          return { ok: true, status: resp.status, html: await resp.text() };
        } catch {
          return { ok: false, status: 0, html: '' };
        }
      }
    });
    const payload = results?.[0]?.result;
    if (payload?.ok && payload.html && payload.html.includes('toc_ol')) {
      return new DOMParser().parseFromString(payload.html, 'text/html');
    }
    return null;
  }

  async _fetchFullTocViaAjax(indexDoc, targetUrl, signal) {
    if (!canUseTabScripting() || signal?.aborted) return null;
    const postId = this._extractPostId(indexDoc, targetUrl);
    if (!postId) return null;

    try {
      const origin = new URL(targetUrl).origin;
      if (chrome?.tabs?.query) {
        const openTabs = await chrome.tabs.query({ url: `${origin}/*` });
        const readyTab = openTabs.find(
          (t) => typeof t.id === 'number' && t.status === 'complete' && t.url && t.url !== 'about:blank'
        );
        if (readyTab) {
          const docFromOpen = await this._runAjaxTocInTab(readyTab.id, postId);
          if (docFromOpen) return docFromOpen;
        }
      }
    } catch {
      // Fall back to temporary background tab below
    }

    let createdTab = null;
    try {
      createdTab = await chrome.tabs.create({ url: targetUrl, active: false });
      const targetTabId = createdTab.id;

      await waitForTabComplete(targetTabId, createdTab, signal, 12000);

      await sleep(250, signal);
      return await this._runAjaxTocInTab(targetTabId, postId);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return null;
    } finally {
      if (createdTab?.id !== undefined) {
        try {
          await chrome.tabs.remove(createdTab.id);
        } catch {
          // ignore
        }
      }
    }
  }

  _sortChaptersChronological(chapters) {
    if (chapters.length <= 1) return chapters;
    const allNumericOrder = chapters.every((c) => /^\d+$/.test(c.numText || ''));
    if (allNumericOrder) {
      return [...chapters].sort((a, b) => parseInt(a.numText, 10) - parseInt(b.numText, 10));
    }
    return [...chapters].reverse();
  }

  collectChapterNodes(doc, targetUrl, _options = {}, context = {}) {
    const items = Array.from(doc.querySelectorAll('ol.toc_ol > li, li.toc_w'));
    const seen = new Set();
    const out = [];

    for (const li of items) {
      const a = li.querySelector('a.toc_a[href], a[href]');
      if (!a) continue;
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;

      let absUrl;
      try {
        absUrl = normalizeUrl(new URL(rawHref, targetUrl).toString());
      } catch {
        continue;
      }
      if (seen.has(absUrl)) continue;
      seen.add(absUrl);

      const titleText = normalizeSpaces(a.textContent);
      const dateText = normalizeSpaces(li.querySelector('.fic_date_pub')?.textContent || '');
      const orderAttr = li.getAttribute('order');
      const numText = orderAttr && /^\d+$/.test(orderAttr.trim()) ? orderAttr.trim() : '';

      out.push({
        url: absUrl,
        numText,
        titleText,
        dateText,
        displayTitle: titleText || absUrl,
        volume: extractVolumeLabel('', titleText, absUrl),
        included: true
      });
    }

    if (context?.pageIndex !== undefined) {
      return out;
    }
    return this._sortChaptersChronological(out);
  }

  async collectAllChapters(indexDoc, targetUrl, options = {}, signal) {
    const customListSelector = (options.customListSelector || '').trim();
    if (!customListSelector && indexDoc.querySelector('#pagination-mesh-toc') && !options.disableAjaxToc) {
      const ajaxDoc = await this._fetchFullTocViaAjax(indexDoc, targetUrl, signal);
      if (ajaxDoc) {
        const ajaxChapters = this.collectChapterNodes(ajaxDoc, targetUrl, options);
        if (ajaxChapters.length > 0) {
          return ajaxChapters;
        }
      }
    }

    const collected = await super.collectAllChapters(indexDoc, targetUrl, options, signal);
    if (customListSelector) return collected;
    return this._sortChaptersChronological(collected);
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('#chp_raw, .chp_raw');
  }

  extractChapterHeading(doc, chapter) {
    const chTitle = normalizeSpaces(doc.querySelector('.chapter-title, h1')?.textContent);
    return {
      chapterTitle: chTitle || chapter.displayTitle || chapter.url,
      subtitle: ''
    };
  }

  extractChapter(doc, chapter, options = {}) {
    const extracted = super.extractChapter(doc, chapter, options);
    const customSelector = (options.customContentSelector || '').trim();
    if (!extracted?.contentRoot || customSelector) {
      return extracted;
    }

    const cleanedRoot = extracted.contentRoot.cloneNode(true);
    for (const junk of cleanedRoot.querySelectorAll('.prenext, .nav_chp_fi, .ad_box, .wi-ad, .sh-ad, .wi_authornotes .p-avatar-wrap')) {
      junk.remove();
    }

    for (const note of cleanedRoot.querySelectorAll('.wi_authornotes')) {
      const prev = note.previousElementSibling;
      if (!prev || prev.tagName.toLowerCase() !== 'hr') {
        const hr = doc.createElement('hr');
        note.replaceWith(hr, note.cloneNode(true));
      }
    }

    // Remove redundant leading heading when it duplicates the extracted chapterTitle
    const targetTitleNorm = normalizeSpaces(extracted.chapterTitle).toLowerCase();
    const firstEl = cleanedRoot.firstElementChild;
    if (firstEl && /^h[1-4]$/i.test(firstEl.tagName) && normalizeSpaces(firstEl.textContent).toLowerCase() === targetTitleNorm) {
      firstEl.remove();
      const nextEl = cleanedRoot.firstElementChild;
      if (nextEl && nextEl.tagName.toLowerCase() === 'p' && !normalizeSpaces(nextEl.textContent) && !nextEl.querySelector('img')) {
        nextEl.remove();
      }
    }

    return {
      ...extracted,
      contentRoot: cleanedRoot
    };
  }
}

export const scribbleHubParser = new ScribbleHubParser();
