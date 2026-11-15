import { HtmlSanitizer, extractHiddenClassesFromStyles, serializeChapterXhtml } from './sanitizer.js';

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

function parseChapterOrderNum(ch) {
  const candidates = [ch?.numText, ch?.displayTitle, ch?.titleText];
  for (const text of candidates) {
    if (!text) continue;
    const m =
      String(text).match(/(?:cap(?:[íi]tulo)?|chapter|ch\.?|ep\.?|#|parte)\s*(\d+(?:\.\d+)?)/i) ||
      String(text).match(/^\s*(\d+(?:\.\d+)?)\b/);
    if (m) return parseFloat(m[1]);
  }
  const urlMatch = String(ch?.url || '').match(/(\d+(?:\.\d+)?)\/?$/);
  return urlMatch ? parseFloat(urlMatch[1]) : null;
}

export function ensureAscendingChapterOrder(chapters, defaultReversed = false) {
  if (!Array.isArray(chapters) || chapters.length < 2) return chapters;
  const nums = chapters.map(parseChapterOrderNum).filter((n) => n !== null && Number.isFinite(n));
  if (nums.length >= 2 && nums[0] !== nums[nums.length - 1]) {
    if (nums[0] > nums[nums.length - 1]) {
      chapters.reverse();
    }
    return chapters;
  }
  if (defaultReversed) chapters.reverse();
  return chapters;
}

export function sanitizeFilename(name, removeIllegal = true) {
  let out = normalizeSpaces(name);
  if (removeIllegal) {
    out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  }
  return out || 'webpullbook-ebook';
}

export const FOLDER_LAYOUT_TEMPLATES = {
  'root-title': '%Root%/%Title%',
  'root-author-title': '%Root%/%Author%/%Title%',
  'root-format-title': '%Root%/%Format%/%Title%',
  'root-only': '%Root%',
  'title-only': '%Title%',
  'author-title': '%Author%/%Title%',
  flat: ''
};

/**
 * Sanitizes a single relative path segment (file stem or directory name) for Chrome Downloads and File System Access API.
 */
export function sanitizePathSegment(name, removeIllegal = true) {
  let out = normalizeSpaces(name);
  if (removeIllegal) {
    out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  }
  out = out.replace(/^[\s.]+|[\s.]+$/g, '');
  if (!out || out === '.' || out === '..') return '';
  if (removeIllegal && /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(out)) {
    out = `_${out}`;
  }
  return out;
}

/**
 * Builds the relative output file path (folders + sanitized filename + extension) from metadata and user folder options.
 */
export function buildOutputPath({
  baseFilename = '',
  title = '',
  author = '',
  volumeLabel = '',
  suffix = '',
  extension = 'epub',
  language = '',
  options = {}
} = {}) {
  const removeIllegal = options.removeIllegal !== false;
  const filenameTemplate = options.customFilename || '%Filename%';
  let rawFile = filenameTemplate
    .replace(/%Filename%/gi, baseFilename || title || 'webpullbook-ebook')
    .replace(/%Title%/gi, title || baseFilename || 'WebPullBook')
    .replace(/%Author%/gi, author || '')
    .replace(/%Volume%/gi, volumeLabel || '');

  if (volumeLabel && !/%Volume%/i.test(filenameTemplate)) {
    rawFile = `${rawFile} - ${volumeLabel}`;
  }
  if (suffix) {
    rawFile = `${rawFile} ${suffix}`;
  }

  const cleanFile = sanitizePathSegment(rawFile, removeIllegal) || 'webpullbook-ebook';
  const cleanExt = String(extension || 'epub').replace(/^\.+/, '').toLowerCase() || 'epub';
  const filePart = `${cleanFile}.${cleanExt}`;

  const layout =
    options.folderLayout != null
      ? options.folderLayout
      : options.subfolder === false
        ? 'flat'
        : 'root-title';

  if (layout === 'flat') {
    return filePart;
  }

  const folderTemplate =
    layout === 'custom'
      ? String(options.customFolderTemplate || '')
      : FOLDER_LAYOUT_TEMPLATES[layout] ?? FOLDER_LAYOUT_TEMPLATES['root-title'];

  if (!folderTemplate.trim()) {
    return filePart;
  }

  const rawRoot = options.rootFolderName !== undefined ? String(options.rootFolderName) : 'WebPullBook';
  const rootSegments = rawRoot
    .split(/[/\\]+/)
    .map((seg) => sanitizePathSegment(seg, true))
    .filter(Boolean);

  const safeTitle = sanitizePathSegment(title || baseFilename || '', true);
  const safeFilename = sanitizePathSegment(baseFilename || title || '', true);
  const safeAuthor = sanitizePathSegment(author || '', true);
  const safeVolume = sanitizePathSegment(volumeLabel || '', true);
  const safeFormat = sanitizePathSegment(cleanExt.toUpperCase(), true);
  const safeLang = sanitizePathSegment(language || '', true);

  const folderSegments = [];
  for (const part of folderTemplate.split(/[/\\]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (/^%Root%$/i.test(trimmed)) {
      folderSegments.push(...rootSegments);
      continue;
    }
    const expanded = trimmed
      .replace(/%Root%/gi, rootSegments.join('_'))
      .replace(/%Title%/gi, safeTitle)
      .replace(/%Filename%/gi, safeFilename)
      .replace(/%Author%/gi, safeAuthor)
      .replace(/%Volume%/gi, safeVolume)
      .replace(/%Format%/gi, safeFormat)
      .replace(/%Language%/gi, safeLang);

    const cleanSeg = sanitizePathSegment(expanded, true);
    if (cleanSeg) {
      folderSegments.push(cleanSeg);
    }
  }

  return folderSegments.length > 0 ? `${folderSegments.join('/')}/${filePart}` : filePart;
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
    const match = String(src).match(/(?:\bvol(?:ume)?[.\s_-]*|\blivro\s*|\bbook\s*|\btome\s*|[-/]volume-)(\d+)/i);
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

const RATE_LIMIT_TEXT_RX =
  /wordfence|rate[\s_-]?limit|too many requests|exceeded the maximum|acesso.+limitado|temporarily blocked|locked out/i;

export async function fetchHtmlDocument(url, signal, onLog = null) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    credentials: 'include',
    signal
  });
  const elapsedMs = Date.now() - startedAt;
  if (!response.ok) {
    let bodySnippet = '';
    try {
      bodySnippet = (await response.text()).slice(0, 2500);
    } catch {
      bodySnippet = '';
    }
    const err = new Error(`HTTP ${response.status} ao carregar ${url}`);
    err.status = response.status;
    const retryAfterRaw = response.headers?.get?.('Retry-After');
    if (retryAfterRaw && /^\d+$/.test(retryAfterRaw.trim())) {
      err.retryAfterSec = parseInt(retryAfterRaw.trim(), 10);
    }
    err.isRateLimit =
      response.status === 429 ||
      (response.status === 503 && RATE_LIMIT_TEXT_RX.test(bodySnippet));
    onLog?.(`[NET] HTTP ${response.status} (${elapsedMs} ms) -> ${url}`, err.isRateLimit ? 'warn' : 'debug');
    throw err;
  }
  const html = await response.text();
  const kb = (html.length / 1024).toFixed(1);
  const redirectedNote = response.url && response.url !== url ? ` -> redirecionado para ${response.url}` : '';
  onLog?.(`[NET] HTTP ${response.status} (${kb} KB, ${elapsedMs} ms) ${url}${redirectedNote}`, 'debug');
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

export async function fetchWithRetry(url, { retries = 2, signal, onLog = null } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fetchHtmlDocument(url, signal, onLog);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      // Do not hammer rate-limiting firewalls with rapid retries
      if (err.isRateLimit) throw err;
      const retryable = !err.status || err.status >= 500;
      if (!retryable || attempt >= retries) throw err;
      attempt += 1;
      const waitMs = 1200 * attempt;
      onLog?.(`[NET] Retry ${attempt}/${retries} para ${url} (${err.status ? `HTTP ${err.status}` : err.message}); aguardando ${waitMs}ms`, 'warn');
      await sleep(waitMs, signal);
    }
  }
}

export function canUseTabScripting() {
  return Boolean(
    typeof chrome !== 'undefined' && chrome?.tabs?.create && chrome?.scripting?.executeScript
  );
}

export function isAntiBotChallengeDocument(doc) {
  if (!doc) return false;
  const hasContent = Boolean(doc.querySelector('#chp_raw, .epcontent, .reading-content, ol.toc_ol'));
  if (hasContent) return false;

  const title = normalizeSpaces(doc.title || '');
  const hasChallengeEl = Boolean(
    doc.querySelector(
      '#challenge-running, #cf-challenge-running, #challenge-stage, #challenge-error-text, form#challenge-form, iframe[src*="challenges.cloudflare.com"]'
    )
  );
  const isChallengeTitle =
    /^(?:just a moment|um momento|un momento|un instant|einen moment|un attimo|checking your browser|verificação de segurança)\b|^attention required!\s*\|\s*cloudflare|^ddos-guard/i.test(
      title
    );
  if (hasChallengeEl || isChallengeTitle) return true;

  const bodyText = normalizeSpaces((doc.body?.textContent || '').slice(0, 2000));
  return /este site utiliza um serviço de segurança para proteção contra bots|this website is using a security service to protect itself from online attacks|performing security verification|executando verificação de segurança|enable javascript and cookies to continue|ative o javascript e os cookies para continuar/i.test(
    bodyText
  );
}

export function isRateLimitDocument(doc) {
  if (!doc) return false;
  const hasContent = Boolean(doc.querySelector('#chp_raw, .epcontent, .reading-content, ol.toc_ol'));
  if (hasContent) return false;
  const text = normalizeSpaces(`${doc.title || ''} ${(doc.body?.textContent || '').slice(0, 2000)}`);
  return RATE_LIMIT_TEXT_RX.test(text) || /\berror\s*1015\b|you are being rate limited/i.test(text);
}

function isTabNavigationComplete(tab) {
  return Boolean(tab?.status === 'complete' && tab?.url && tab.url !== 'about:blank');
}

export async function waitForTabComplete(tabId, initialTab = null, signal = null, timeoutMs = 12000) {
  if (isTabNavigationComplete(initialTab)) return;

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

    const timeout = setTimeout(finish, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poller);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    function listener(updatedId, changeInfo, tab) {
      if (updatedId !== tabId) return;
      const effectiveUrl = tab?.url || changeInfo?.url || '';
      if (changeInfo.status === 'complete' && effectiveUrl && effectiveUrl !== 'about:blank') {
        finish();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    const poller = setInterval(async () => {
      try {
        const tabInfo = await chrome.tabs.get(tabId);
        if (isTabNavigationComplete(tabInfo)) finish();
      } catch {
        finish();
      }
    }, 120);
  });
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
        const parsedLive = new DOMParser().parseFromString(liveHtml, 'text/html');
        if (!isAntiBotChallengeDocument(parsedLive) && !isRateLimitDocument(parsedLive)) {
          return parsedLive;
        }
      }
    } catch {
      // Fall back to opening a background tab below
    }
  }

  let createdTab = null;
  try {
    createdTab = await chrome.tabs.create({ url, active: false });
    const targetTabId = createdTab.id;

    await waitForTabComplete(targetTabId, createdTab, signal, 12000);

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
    const parsedDoc = new DOMParser().parseFromString(renderedHtml, 'text/html');
    if (isAntiBotChallengeDocument(parsedDoc)) {
      const err = new Error(
        `Verificação anti-bot (Cloudflare) pendente em ${url}. Abra a página em uma aba normal e conclua a verificação antes de tentar novamente.`
      );
      err.status = 403;
      err.isAntiBotChallenge = true;
      throw err;
    }
    if (isRateLimitDocument(parsedDoc)) {
      const err = new Error(`HTTP 429 ao carregar ${url}`);
      err.status = 429;
      err.isRateLimit = true;
      throw err;
    }
    parsedDoc._wpbRenderedByTab = true;
    return parsedDoc;
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
  const onLog = typeof options.onLog === 'function' ? options.onLog : null;
  if (options.renderWithTab && canUseTabScripting()) {
    onLog?.(`[SPA] Renderizando via aba ativa: ${url}`, 'debug');
    return fetchRenderedTabDocument(url, {
      waitMs: options.renderWaitMs ?? 950,
      tabId: options.tabId ?? null,
      signal
    });
  }
  const maxRetries = Number.isFinite(Number(options.maxRetries))
    ? Math.max(0, Math.min(5, Number(options.maxRetries)))
    : 2;
  try {
    return await fetchWithRetry(url, { retries: maxRetries, signal, onLog });
  } catch (err) {
    if (
      options.autoFallbackTab !== false &&
      canUseTabScripting() &&
      !err.isRateLimit &&
      (err.status === 403 || err.status === 503)
    ) {
      onLog?.(`[SPA] HTTP ${err.status} em ${url} -> alternando para captura via aba renderizada`, 'debug');
      return fetchRenderedTabDocument(url, {
        waitMs: options.renderWaitMs ?? 1100,
        tabId: options.tabId ?? null,
        signal
      });
    }
    throw err;
  }
}

/**
 * Abstract base class for all site-agnostic WebPullBook parser adapters.
 * Implements the Template Method pattern for series resolution, metadata extraction,
 * index pagination, chapter extraction, and sanitization.
 */
export class BaseParser {
  constructor({ id, name, maxIndexPages = 20 }) {
    this.id = id;
    this.name = name;
    this.maxIndexPages = maxIndexPages;
  }

  /**
   * Return confidence score 0..100 for how well this parser matches the given DOM.
   */
  matchScore(_doc, _url) {
    return 0;
  }

  async resolveIndexDocument(inputUrl, doc, _signal, _options = {}) {
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
            if (!result.status && item.creativeWorkStatus) {
              result.status = normalizeSpaces(item.creativeWorkStatus);
            }
            if ((!result.genres || result.genres.length === 0) && item.genre) {
              const rawGenres = Array.isArray(item.genre) ? item.genre : [item.genre];
              const genres = rawGenres.map((g) => normalizeSpaces(g)).filter(Boolean);
              if (genres.length > 0) result.genres = genres;
            }
          }
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }
    return result;
  }

  _extractDlMetadata(doc) {
    const out = {};
    for (const dt of doc.querySelectorAll('dl dt')) {
      const label = normalizeSpaces(dt.textContent).toLowerCase();
      const dd = dt.parentElement?.querySelector('dd') || dt.nextElementSibling;
      const value = normalizeSpaces(dd?.textContent);
      if (!value) continue;
      if (!out.author && /^(?:autor|author|writer|escritor)$/i.test(label)) {
        out.author = value;
      } else if (!out.status && /^(?:status|situa[çc][ãa]o|state)$/i.test(label)) {
        out.status = value;
      }
    }
    return out;
  }

  extractCommonMetadata(doc, targetUrl) {
    const jsonLd = this.extractJsonLdMetadata(doc);
    const dlMeta = this._extractDlMetadata(doc);
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const h1Title = doc.querySelector('h1')?.textContent;
    const title = normalizeSpaces(h1Title || jsonLd.title || ogTitle || doc.title) || 'WebPullBook';

    const langAttr = (doc.documentElement.getAttribute('lang') || 'pt-BR').trim();
    const language = langAttr.split('-')[0].toLowerCase() || 'pt';

    const authorMeta =
      doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
      doc.querySelector('[rel="author"], .author a, .author')?.textContent ||
      dlMeta.author ||
      '';
    const author = normalizeSpaces(authorMeta || jsonLd.author) || '<unknown>';

    const status = dlMeta.status || jsonLd.status || '';

    let genres = Array.isArray(jsonLd.genres) ? [...jsonLd.genres] : [];
    if (genres.length === 0) {
      const seenGenres = new Set();
      for (const a of doc.querySelectorAll('a[rel="tag"], .tags a, .genres a')) {
        if (a.closest('#comments, .comments, footer, [class*="related" i], [id*="parecidas" i]')) continue;
        const g = normalizeSpaces(a.textContent);
        if (g && !seenGenres.has(g)) {
          seenGenres.add(g);
          genres.push(g);
        }
      }
    }

    const ogCoverRaw = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
    const ogCover = /\/(?:og-default|default-og)\./i.test(ogCoverRaw) ? '' : ogCoverRaw;
    const rawCover =
      ogCover ||
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

    const synContainer = doc.querySelector(
      '.synopsis, .description, .summary, [itemprop="description"], [data-testid*="synopsis"], [data-testid*="description"], .entry-content'
    );
    const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
    const synopsis = extractCleanSynopsis(synContainer) || jsonLd.synopsis || normalizeSpaces(ogDesc);

    return {
      startingUrl: targetUrl,
      title,
      author,
      language,
      status,
      genres,
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

  async collectAllChapters(indexDoc, targetUrl, options = {}, signal) {
    const customListSelector = (options.customListSelector || '').trim();
    const allChapters = [];
    const seenUrls = new Set();
    const visitedPages = new Set([targetUrl]);
    const maxPages = this.maxIndexPages || 20;

    let pageDoc = indexDoc;
    let pageUrl = targetUrl;
    const knownPrefixes = new Set();

    for (let pageCount = 0; pageCount < maxPages; pageCount++) {
      const pageItems = customListSelector
        ? this.collectChaptersByCustomSelector(pageDoc, pageUrl, customListSelector)
        : this.collectChapterNodes(pageDoc, pageUrl, options, { pageIndex: pageCount, knownPrefixes });

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
      pageDoc = await fetchDocumentWithOptions(nextUrl, options, signal);
    }

    return allChapters;
  }

  async loadSeries(inputUrl, options = {}, signal, preloadedDoc = null) {
    const initialUrl = normalizeUrl(inputUrl);
    const initialDoc = preloadedDoc || (await fetchDocumentWithOptions(initialUrl, options, signal));
    let { targetUrl, doc: indexDoc } = await this.resolveIndexDocument(initialUrl, initialDoc, signal, options);
    let usedTabFallback = Boolean(
      options.renderWithTab ||
        options._usedTabFallback ||
        initialDoc?._wpbRenderedByTab ||
        indexDoc?._wpbRenderedByTab
    );

    let allChapters = await this.collectAllChapters(indexDoc, targetUrl, options, signal);

    // Automatic SPA / dynamic DOM fallback if static HTML yielded 0 chapters
    if (allChapters.length === 0 && !options.renderWithTab && options.autoFallbackTab !== false && canUseTabScripting()) {
      try {
        const renderedDoc = await fetchRenderedTabDocument(targetUrl, {
          waitMs: options.renderWaitMs ?? 1100,
          signal
        });
        const retryChapters = await this.collectAllChapters(
          renderedDoc,
          targetUrl,
          { ...options, renderWithTab: true },
          signal
        );
        if (retryChapters.length > 0) {
          indexDoc = renderedDoc;
          allChapters = retryChapters;
          usedTabFallback = true;
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
      requiresTabRender: usedTabFallback,
      chapters
    };
  }

  findChapterContentRoot(doc) {
    return doc.querySelector('.epcontent, .chapter-content, #chapter-content, .reading-content, .entry-content, article, main');
  }

  extractChapterHeading(doc, chapter) {
    const h1El = doc.querySelector('h1.entry-title, h1');
    let h1 = '';
    if (h1El) {
      const clone = h1El.cloneNode(true);
      for (const hidden of clone.querySelectorAll('.sr-only, .visually-hidden, [aria-hidden="true"]')) {
        hidden.remove();
      }
      h1 = normalizeSpaces(clone.textContent);
    }
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
    const onLog = typeof options.onLog === 'function' ? options.onLog : null;
    const useTabFirst = Boolean(options.renderWithTab || (chapter.tabId && options.preferOpenTabDom));
    let doc;
    if (useTabFirst) {
      onLog?.(`[SPA] Capturando capítulo via aba: ${chapter.url}`, 'debug');
      doc = await fetchRenderedTabDocument(chapter.url, {
        waitMs: options.renderWaitMs ?? 950,
        tabId: chapter.tabId ?? null,
        signal
      });
    } else {
      const maxRetries = Number.isFinite(Number(options.maxRetries))
        ? Math.max(0, Math.min(5, Number(options.maxRetries)))
        : 2;
      try {
        doc = await fetchWithRetry(chapter.url, { retries: maxRetries, signal, onLog });
      } catch (err) {
        if (
          options.autoFallbackTab !== false &&
          canUseTabScripting() &&
          !err.isRateLimit &&
          (err.status === 403 || err.status === 503)
        ) {
          onLog?.(`[SPA] HTTP ${err.status} em capítulo -> tentando via aba: ${chapter.url}`, 'debug');
          doc = await fetchRenderedTabDocument(chapter.url, {
            waitMs: options.renderWaitMs ?? 1100,
            tabId: chapter.tabId ?? null,
            signal
          });
        } else {
          throw err;
        }
      }
    }

    let extracted = this.extractChapter(doc, chapter, options);

    // Automatic SPA / dynamic DOM fallback if static fetch found no readable contentRoot
    const hasReadableText =
      extracted?.contentRoot && normalizeSpaces(extracted.contentRoot.textContent).length >= 25;
    if (!hasReadableText && !useTabFirst && options.autoFallbackTab !== false && canUseTabScripting()) {
      onLog?.(`[SPA] Conteúdo curto/ausente no HTML estático -> re-tentando via aba: ${chapter.url}`, 'debug');
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

    const hiddenClasses = extractHiddenClassesFromStyles(doc);
    if (hiddenClasses.size > 0) {
      onLog?.(`[PARSE] ${hiddenClasses.size} classe(s) CSS oculta(s) filtrada(s) em "${chapter.displayTitle || chapter.url}"`, 'debug');
    }
    const sanitizer = new HtmlSanitizer({
      skipImages: Boolean(options.skipImages),
      removeNavLinks: options.removeNavLinks !== false,
      excludeSelector: options.customExcludeSelector || '',
      hiddenClasses
    });
    const sanitized = sanitizer.sanitize(extracted.contentRoot, chapter.url);
    applyCustomTextStripPatterns(sanitized.nodes, options.customStripPatterns);

    return {
      chapter,
      chapterTitle: extracted.chapterTitle,
      subtitle: extracted.subtitle,
      ...sanitized,
      serialize(stylesheetHref, epub3, { popupFootnotes = false } = {}) {
        return serializeChapterXhtml({
          title: extracted.chapterTitle,
          subtitle: extracted.subtitle,
          xmlDoc: sanitized.xmlDoc,
          nodes: sanitized.nodes,
          stylesheetHref,
          epub3,
          popupFootnotes
        });
      }
    };
  }
}

function compileStripRegexList(rawPatterns) {
  const lines = String(rawPatterns || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const compiled = [];
  for (const line of lines) {
    const rxMatch = line.match(/^\/(.+)\/([gimsuy]*)$/);
    try {
      if (rxMatch) {
        const flags = rxMatch[2].includes('g') ? rxMatch[2] : `${rxMatch[2]}g`;
        compiled.push(new RegExp(rxMatch[1], flags));
      } else {
        const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        compiled.push(new RegExp(escaped, 'gi'));
      }
    } catch {
      // Skip malformed user regex cleanly
    }
  }
  return compiled;
}

function applyCustomTextStripPatterns(nodes, rawPatterns) {
  if (!rawPatterns || !Array.isArray(nodes) || nodes.length === 0) return;
  const regexes = compileStripRegexList(rawPatterns);
  if (regexes.length === 0) return;

  const stripTextNodes = (root) => {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      let txt = root.nodeValue || '';
      for (const rx of regexes) {
        rx.lastIndex = 0;
        txt = txt.replace(rx, '');
      }
      root.nodeValue = txt;
      return;
    }
    if (root.childNodes) {
      for (const child of Array.from(root.childNodes)) {
        stripTextNodes(child);
      }
    }
  };

  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    stripTextNodes(node);
    const hasMedia = Boolean(node.querySelector?.('img, svg, hr, br'));
    if (!hasMedia && !normalizeSpaces(node.textContent || '')) {
      nodes.splice(i, 1);
    }
  }
}

export async function downloadAndParseChapter(chapter, parser, options = {}, signal) {
  return parser.downloadChapter(chapter, options, signal);
}

function escapeCssIdent(ident) {
  const s = String(ident || '');
  if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
    return globalThis.CSS.escape(s);
  }
  return s.replace(/([^\w-])/g, '\\$1');
}

function isStableCssClass(cls) {
  if (!cls || cls.length > 48) return false;
  if (/^(?:active|selected|current|open|closed|show|hide|hidden|hover|focus|wpb-)/i.test(cls)) return false;
  if (/^js-/i.test(cls) || /\d{5,}/.test(cls)) return false;
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(cls);
}

function describeSingleElement(el) {
  const tag = el.tagName?.toLowerCase() || 'div';
  const id = (el.getAttribute?.('id') || '').trim();
  if (id && !/\d{5,}/.test(id)) {
    return `#${escapeCssIdent(id)}`;
  }
  const rawClass = typeof el.className === 'string' ? el.className : el.getAttribute?.('class') || '';
  const classTokens = rawClass.trim() ? rawClass.trim().split(/\s+/) : Array.from(el.classList || []);
  const classes = classTokens.filter(isStableCssClass).slice(0, 2);
  if (classes.length > 0) {
    return `${tag}.${classes.map(escapeCssIdent).join('.')}`;
  }
  return tag;
}

/**
 * Generates a concise, reusable CSS selector for an element picked interactively on a page.
 */
export function generateCssSelector(targetEl, mode = 'content') {
  if (!targetEl || !targetEl.ownerDocument) return '';
  const doc = targetEl.ownerDocument;
  let el = targetEl;

  if (mode === 'list') {
    const anchor = el.closest?.('a') || (el.tagName?.toLowerCase() === 'a' ? el : null);
    if (anchor) {
      let cur = anchor.parentElement;
      for (let depth = 0; depth < 4 && cur && cur !== doc.body && cur !== doc.documentElement; depth++) {
        const tag = cur.tagName?.toLowerCase();
        if (tag === 'ul' || tag === 'ol' || cur.querySelectorAll('a[href]').length >= 3) {
          const base = describeSingleElement(cur);
          if (base !== tag || tag === 'nav' || tag === 'ul' || tag === 'ol') {
            return `${base} a`;
          }
        }
        cur = cur.parentElement;
      }
      const aDesc = describeSingleElement(anchor);
      if (aDesc !== 'a') return aDesc;
    }
  }

  const parts = [];
  let cur = el;
  for (let depth = 0; depth < 4 && cur && cur !== doc.body && cur !== doc.documentElement; depth++) {
    const seg = describeSingleElement(cur);
    parts.unshift(seg);
    const candidate = parts.join(' > ');
    try {
      const matched = doc.querySelectorAll(candidate);
      if (seg.startsWith('#') || (mode !== 'exclude' && matched.length === 1)) {
        return candidate;
      }
      if (mode === 'exclude' && matched.length >= 1 && seg.includes('.')) {
        return seg;
      }
    } catch {
      // ignore invalid selector attempt
    }
    cur = cur.parentElement;
  }

  return parts.join(' > ') || describeSingleElement(el);
}
