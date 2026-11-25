/**
 * Network fetching, retry/backoff, anti-bot & rate-limit detection, and SPA tab rendering.
 */
import { normalizeSpaces, normalizeUrl } from './text-utils.js';

const RATE_LIMIT_TEXT_RX =
  /wordfence|rate[\s_-]?limit|too many requests|exceeded the maximum|acesso.+limitado|temporarily blocked|locked out/i;

const RETRYABLE_HTTP_STATUSES = new Set([408, 445, 500, 502, 503, 504, 520, 522, 524]);

/**
 * Detect character encoding from HTTP Content-Type header or HTML <meta charset> tags,
 * decoding raw response bytes cleanly without forcing UTF-8 on legacy sites.
 */
export function decodeHtmlBytes(bytes, headers = null) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  let charset = '';

  const contentType = headers?.get?.('content-type') || headers?.get?.('Content-Type') || '';
  const headerMatch = String(contentType).match(/charset\s*=\s*["']?([a-zA-Z0-9._-]+)["']?/i);
  if (headerMatch) {
    charset = headerMatch[1].trim().toLowerCase();
  }

  if (!charset && buf.length > 0) {
    const headLen = Math.min(buf.length, 2048);
    let asciiHead = '';
    for (let i = 0; i < headLen; i++) {
      asciiHead += String.fromCharCode(buf[i]);
    }
    const metaMatch =
      asciiHead.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9._-]+)/i) ||
      asciiHead.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-zA-Z0-9._-]+)/i);
    if (metaMatch) {
      charset = metaMatch[1].trim().toLowerCase();
    }
  }

  if (charset) {
    try {
      return new TextDecoder(charset).decode(buf);
    } catch {
      // Fall back to UTF-8 if charset label is unsupported
    }
  }
  return new TextDecoder('utf-8').decode(buf);
}

/**
 * Lightweight in-memory cache for reusing an already-loaded first-page DOM or
 * same-pathname multi-chapter HTML pages without repeating HTTP requests.
 */
export class PageDomCache {
  constructor(maxEntries = 6) {
    this.maxEntries = maxEntries;
    this._byNormalizedUrl = new Map();
    this._lastPath = '';
    this._lastDoc = null;
  }

  set(url, doc) {
    if (!url || !doc) return;
    const norm = normalizeUrl(url);
    this._byNormalizedUrl.set(norm, doc);
    while (this._byNormalizedUrl.size > this.maxEntries) {
      const oldestKey = this._byNormalizedUrl.keys().next().value;
      this._byNormalizedUrl.delete(oldestKey);
    }
    try {
      const u = new URL(url);
      this._lastPath = `${u.origin}${u.pathname}${u.search}`;
      this._lastDoc = doc;
    } catch {
      // ignore invalid URL
    }
  }

  _cloneSafe(doc) {
    try {
      return typeof doc?.cloneNode === 'function' ? doc.cloneNode(true) : doc;
    } catch {
      return doc;
    }
  }

  get(url) {
    if (!url) return null;
    const norm = normalizeUrl(url);
    if (this._byNormalizedUrl.has(norm)) {
      return this._cloneSafe(this._byNormalizedUrl.get(norm));
    }
    try {
      const u = new URL(url);
      const pathKey = `${u.origin}${u.pathname}${u.search}`;
      if (this._lastDoc && this._lastPath === pathKey && u.hash) {
        return this._cloneSafe(this._lastDoc);
      }
    } catch {
      // ignore
    }
    return null;
  }

  clear() {
    this._byNormalizedUrl.clear();
    this._lastPath = '';
    this._lastDoc = null;
  }
}

export async function fetchHtmlDocument(url, signal, onLog = null, { timeoutMs = 30000 } = {}) {
  const safeUrl = assertSafeHttpUrl(url);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const reqController = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => reqController.abort(signal?.reason);
  if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });
  const reqTimer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          reqController.abort(new Error(`Timeout after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;

  const startedAt = Date.now();
  let response;
  let html;
  try {
    response = await fetch(safeUrl, {
      credentials: 'include',
      signal: reqController.signal
    });
    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) {
      let bodySnippet = '';
      try {
        bodySnippet = (await response.text()).slice(0, 2500);
      } catch {
        bodySnippet = '';
      }
      const err = new Error(`HTTP ${response.status} ao carregar ${safeUrl}`);
      err.status = response.status;
      const retryAfterRaw = response.headers?.get?.('Retry-After')?.trim();
      if (retryAfterRaw) {
        if (/^\d+$/.test(retryAfterRaw)) {
          err.retryAfterSec = parseInt(retryAfterRaw, 10);
        } else {
          const parsedDate = Date.parse(retryAfterRaw);
          if (Number.isFinite(parsedDate)) {
            const deltaSec = Math.ceil((parsedDate - Date.now()) / 1000);
            if (deltaSec > 0) err.retryAfterSec = deltaSec;
          }
        }
      }
      err.isRateLimit =
        response.status === 429 ||
        response.status === 509 ||
        (response.status === 503 && RATE_LIMIT_TEXT_RX.test(bodySnippet));
      onLog?.(`[NET] HTTP ${response.status} (${elapsedMs} ms) -> ${safeUrl}`, err.isRateLimit ? 'warn' : 'debug');
      throw err;
    }
    if (typeof response.arrayBuffer === 'function') {
      const rawBytes = new Uint8Array(await response.arrayBuffer());
      html = decodeHtmlBytes(rawBytes, response.headers);
    } else {
      html = await response.text();
    }
    const kb = (html.length / 1024).toFixed(1);
    const redirectedNote = response.url && response.url !== url ? ` -> redirecionado para ${response.url}` : '';
    onLog?.(`[NET] HTTP ${response.status} (${kb} KB, ${elapsedMs} ms) ${url}${redirectedNote}`, 'debug');
  } catch (err) {
    if (timedOut && !signal?.aborted) {
      throw new Error(`Tempo limite HTTP (${timeoutMs} ms) excedido ao carregar ${safeUrl}`);
    }
    throw err;
  } finally {
    if (reqTimer) clearTimeout(reqTimer);
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  }
  return new DOMParser().parseFromString(html, 'text/html');
}

export function sleep(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
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
      // Do not hammer rate-limiting firewalls or retry deterministic validation errors
      if (err.isRateLimit || err.nonRetryable) throw err;
      const retryable = !err.status || err.status >= 500 || RETRYABLE_HTTP_STATUSES.has(err.status);
      if (!retryable || attempt >= retries) throw err;
      attempt += 1;
      const waitMs = 1200 * attempt;
      onLog?.(
        `[NET] Retry ${attempt}/${retries} para ${url} (${err.status ? `HTTP ${err.status}` : err.message}); aguardando ${waitMs}ms`,
        'warn'
      );
      await sleep(waitMs, signal);
    }
  }
}

export function canUseTabScripting() {
  return Boolean(
    typeof chrome !== 'undefined' && chrome?.tabs?.create && chrome?.scripting?.executeScript
  );
}

const CHAPTER_CONTENT_MARKER_SELECTOR =
  '#chp_raw, .epcontent, .reading-content, .reader-content, .rich-text-content, ol.toc_ol, .chapter-inner, #chr-content, #chapter-content';

export function isAntiBotChallengeDocument(doc) {
  if (!doc) return false;
  if (doc.querySelector(CHAPTER_CONTENT_MARKER_SELECTOR)) return false;

  const title = normalizeSpaces(doc.title || '');
  const hasChallengeEl = Boolean(
    doc.querySelector(
      '#challenge-running, #cf-challenge-running, #challenge-stage, #challenge-error-text, form#challenge-form, iframe[src*="challenges.cloudflare.com"]'
    )
  );
  if (hasChallengeEl) return true;

  const fullTextLen = (doc.body?.textContent || '').trim().length;
  if (fullTextLen > 4000) return false;

  const isChallengeTitle =
    /^(?:just a moment|um momento|un momento|un instant|einen moment|un attimo|checking your browser|verificação de segurança)\b|^attention required!\s*\|\s*cloudflare|^ddos-guard/i.test(
      title
    );
  if (isChallengeTitle) return true;

  const bodyText = normalizeSpaces((doc.body?.textContent || '').slice(0, 2000));
  return /este site utiliza um serviço de segurança para proteção contra bots|this website is using a security service to protect itself from online attacks|performing security verification|executando verificação de segurança|enable javascript and cookies to continue|ative o javascript e os cookies para continuar/i.test(
    bodyText
  );
}

export function isRateLimitDocument(doc) {
  if (!doc) return false;
  if (doc.querySelector(CHAPTER_CONTENT_MARKER_SELECTOR)) return false;
  const fullTextLen = (doc.body?.textContent || '').trim().length;
  if (fullTextLen > 4000) return false;
  const text = normalizeSpaces(`${doc.title || ''} ${(doc.body?.textContent || '').slice(0, 2000)}`);
  return RATE_LIMIT_TEXT_RX.test(text) || /\berror\s*1015\b|you are being rate limited/i.test(text);
}

function isTabNavigationComplete(
  tab,
  { expectedUrl = '', previousUrl = '', sawLoading = false } = {}
) {
  if (!(tab?.status === 'complete' && tab?.url && tab.url !== 'about:blank')) {
    return false;
  }
  if (previousUrl && expectedUrl && normalizeUrl(previousUrl) !== normalizeUrl(expectedUrl)) {
    return sawLoading || normalizeUrl(tab.url) !== normalizeUrl(previousUrl);
  }
  return true;
}

export async function waitForTabComplete(
  tabId,
  initialTab = null,
  signal = null,
  timeoutMs = 12000,
  navOpts = {}
) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (isTabNavigationComplete(initialTab, navOpts)) return;

  await new Promise((resolve, reject) => {
    let settled = false;
    let sawLoading = initialTab?.status === 'loading';
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
      if (changeInfo.status === 'loading' || tab?.status === 'loading') {
        sawLoading = true;
      }
      const effectiveUrl = tab?.url || changeInfo?.url || '';
      if (
        changeInfo.status === 'complete' &&
        isTabNavigationComplete({ status: 'complete', url: effectiveUrl }, { ...navOpts, sawLoading })
      ) {
        finish();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    const poller = setInterval(async () => {
      try {
        const tabInfo = await chrome.tabs.get(tabId);
        if (tabInfo?.status === 'loading') {
          sawLoading = true;
        }
        if (isTabNavigationComplete(tabInfo, { ...navOpts, sawLoading })) finish();
      } catch {
        finish();
      }
    }, 120);
  });
}

const SPA_CIRCUIT_COOLDOWN_MS = 25000;
const spaBlockedDomains = new Map();

function getHostKey(rawUrl) {
  try {
    return new URL(String(rawUrl || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function assertSafeHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    const err = new Error(`URL inválida para captura SPA: ${rawUrl}`);
    err.nonRetryable = true;
    throw err;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error(`Protocolo bloqueado na captura SPA (${parsed.protocol}): apenas HTTP/HTTPS é permitido.`);
    err.nonRetryable = true;
    throw err;
  }
  return parsed.toString();
}

export function isSpaDomainCircuitOpen(rawUrl, now = Date.now()) {
  const host = getHostKey(rawUrl);
  if (!host) return false;
  const entry = spaBlockedDomains.get(host);
  if (!entry) return false;
  if (entry.until <= now) {
    spaBlockedDomains.delete(host);
    return false;
  }
  return true;
}

export function tripSpaDomainCircuit(rawUrl, reason = 'antibot', cooldownMs = SPA_CIRCUIT_COOLDOWN_MS) {
  const host = getHostKey(rawUrl);
  if (!host) return;
  spaBlockedDomains.set(host, {
    reason,
    until: Date.now() + Math.max(1000, cooldownMs)
  });
}

export function clearSpaDomainCircuit(rawUrl = '') {
  if (!rawUrl) {
    spaBlockedDomains.clear();
    return;
  }
  const host = getHostKey(rawUrl);
  if (host) spaBlockedDomains.delete(host);
}

/**
 * Reusable single background tab pool for SPA / tab-rendered chapter queues.
 * Avoids creating and destroying a new browser tab for every chapter.
 */
export class TabRenderPool {
  constructor() {
    this._tabId = null;
    this._lastUrl = '';
    this._lock = Promise.resolve();
  }

  async runExclusive(fn) {
    const prev = this._lock;
    let release;
    this._lock = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async navigate(url, signal) {
    const safeUrl = assertSafeHttpUrl(url);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (typeof this._tabId === 'number' && chrome?.tabs?.update) {
      try {
        let prevUrl = this._lastUrl;
        if (chrome.tabs.get) {
          try {
            const cur = await chrome.tabs.get(this._tabId);
            if (cur?.url) prevUrl = cur.url;
          } catch {
            // keep _lastUrl fallback
          }
        }
        const updated = await chrome.tabs.update(this._tabId, { url: safeUrl, active: false });
        if (updated?.id !== undefined) {
          await waitForTabComplete(this._tabId, null, signal, 12000, {
            expectedUrl: safeUrl,
            previousUrl: prevUrl
          });
          let actualUrl = safeUrl;
          if (chrome.tabs.get) {
            try {
              const info = await chrome.tabs.get(this._tabId);
              if (info?.url) actualUrl = info.url;
            } catch {
              // ignore
            }
          }
          this._lastUrl = actualUrl;
          return this._tabId;
        }
      } catch (err) {
        if (err?.name === 'AbortError') {
          await this.close();
          throw err;
        }
        const staleId = this._tabId;
        this._tabId = null;
        this._lastUrl = '';
        if (typeof staleId === 'number' && chrome?.tabs?.remove) {
          chrome.tabs.remove(staleId).catch(() => {});
        }
      }
    }
    const created = await chrome.tabs.create({ url: safeUrl, active: false });
    this._tabId = created.id;
    try {
      await waitForTabComplete(this._tabId, created, signal, 12000, { expectedUrl: safeUrl });
      let actualUrl = safeUrl;
      if (chrome.tabs.get) {
        try {
          const info = await chrome.tabs.get(this._tabId);
          if (info?.url) actualUrl = info.url;
        } catch {
          // ignore
        }
      }
      this._lastUrl = actualUrl;
    } catch (err) {
      if (err?.name === 'AbortError') {
        await this.close();
      }
      throw err;
    }
    return this._tabId;
  }

  async close() {
    const id = this._tabId;
    this._tabId = null;
    this._lastUrl = '';
    if (typeof id === 'number' && chrome?.tabs?.remove) {
      try {
        await chrome.tabs.remove(id);
      } catch {
        // Ignore if already closed
      }
    }
  }
}

/**
 * Wait intelligently inside a rendered tab until DOM content stabilizes (MutationObserver + debounce)
 * instead of blindly sleeping for a fixed interval. Exits immediately if an anti-bot challenge is detected.
 */
async function waitForDomStabilityInTab(tabId, waitMs, signal, waitForSelector = '') {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!waitMs || waitMs <= 0) return;
  const selectorStr = String(waitForSelector || '').trim();
  const maxWaitMs = selectorStr ? Math.max(waitMs, 6000) : Math.max(waitMs, 2600);
  let abortListener = null;
  try {
    const scriptPromise = chrome.scripting.executeScript({
      target: { tabId },
      args: [maxWaitMs, selectorStr],
      func: (timeoutMs, targetSelector) =>
        new Promise((resolve) => {
          const started = Date.now();
          let lastSig = '';
          let stableTimer = null;
          let finished = false;
          const done = () => {
            if (finished) return;
            finished = true;
            if (stableTimer) clearTimeout(stableTimer);
            clearInterval(poller);
            clearTimeout(hardCap);
            if (observer) observer.disconnect();
            resolve(true);
          };
          const isChallenge = () =>
            Boolean(
              document.querySelector(
                '#challenge-running, #cf-challenge-running, #challenge-stage, form#challenge-form, iframe[src*="challenges.cloudflare.com"]'
              )
            );
          const hasVisibleSkeleton = () =>
            Array.from(document.querySelectorAll('.skeleton, [class*="skeleton-"]')).some(
              (el) => el.offsetParent !== null
            );
          const measure = () => {
            const textLen = (document.body?.innerText || '').trim().length;
            const linkCount = document.querySelectorAll('a[href]').length;
            const pCount = document.querySelectorAll('p').length;
            let selectorReady = false;
            if (targetSelector) {
              try {
                selectorReady = Boolean(document.querySelector(targetSelector));
              } catch {
                selectorReady = false;
              }
            }
            const skeletonVisible = hasVisibleSkeleton();
            return {
              textLen,
              linkCount,
              pCount,
              selectorReady,
              skeletonVisible,
              sig: `${textLen}:${linkCount}:${pCount}:${selectorReady ? 1 : 0}:${skeletonVisible ? 1 : 0}`
            };
          };
          const check = () => {
            if (isChallenge()) {
              done();
              return;
            }
            const m = measure();
            const nearTimeout = Date.now() - started >= Math.max(800, timeoutMs - 500);
            const hasContent = targetSelector
              ? m.selectorReady && (!m.skeletonVisible || nearTimeout)
              : (m.textLen >= 220 || m.pCount >= 2 || m.linkCount >= 8) && (!m.skeletonVisible || nearTimeout);
            if (m.sig !== lastSig) {
              lastSig = m.sig;
              if (stableTimer) clearTimeout(stableTimer);
              if (hasContent) {
                stableTimer = setTimeout(done, 250);
              }
            } else if (hasContent && !stableTimer && Date.now() - started >= 180) {
              stableTimer = setTimeout(done, 200);
            }
          };
          const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(check) : null;
          if (observer && document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
          }
          const poller = setInterval(check, 150);
          const hardCap = setTimeout(done, timeoutMs);
          check();
        })
    });
    const res = signal
      ? await Promise.race([
          scriptPromise,
          new Promise((_, reject) => {
            abortListener = () => reject(new DOMException('Aborted', 'AbortError'));
            signal.addEventListener('abort', abortListener, { once: true });
          })
        ])
      : await scriptPromise;
    if (res?.[0]?.result === true) return;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Fall back to bounded sleep if script injection cannot run async waiter
  } finally {
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
  await sleep(waitMs, signal);
}

/**
 * Render a page inside a browser tab (or read an existing open tab) to extract
 * JavaScript/SPA/React-hydrated DOM when plain background fetch() is insufficient.
 */
export async function fetchRenderedTabDocument(
  url,
  { waitMs = 950, tabId = null, preferOpenTab = true, tabPool = null, waitForSelector = '', onLog = null, signal } = {}
) {
  const safeUrl = assertSafeHttpUrl(url);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (!chrome?.tabs || !chrome?.scripting?.executeScript) {
    return fetchWithRetry(safeUrl, { retries: 2, signal, onLog });
  }

  // Try reading an already-open tab (explicit tabId or matching open tab URL) before spawning a background tab
  const hasExplicitTabId = typeof tabId === 'number';
  let candidateTabId = hasExplicitTabId ? tabId : null;
  if (hasExplicitTabId && chrome?.tabs?.get) {
    try {
      const tb = await chrome.tabs.get(candidateTabId);
      if (
        !tb?.url ||
        (tb.status && tb.status !== 'complete') ||
        normalizeUrl(tb.url) !== normalizeUrl(safeUrl)
      ) {
        candidateTabId = null;
      }
    } catch {
      candidateTabId = null;
    }
  }
  if (candidateTabId === null && preferOpenTab && chrome?.tabs?.query) {
    try {
      const normTarget = normalizeUrl(safeUrl);
      const openTabs = await chrome.tabs.query({});
      const matched = (openTabs || []).find(
        (tb) =>
          typeof tb.id === 'number' &&
          tb.status === 'complete' &&
          tb.url &&
          normalizeUrl(tb.url) === normTarget
      );
      if (matched) candidateTabId = matched.id;
    } catch {
      // Ignore query errors and fall back to opening a background tab
    }
  }

  if (typeof candidateTabId === 'number') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: candidateTabId },
        func: () => document.documentElement.outerHTML
      });
      const liveHtml = results?.[0]?.result;
      if (liveHtml && liveHtml.length > 60) {
        const parsedLive = new DOMParser().parseFromString(liveHtml, 'text/html');
        let selectorSatisfied = true;
        if (waitForSelector) {
          try {
            selectorSatisfied = Boolean(parsedLive.querySelector(waitForSelector));
          } catch {
            selectorSatisfied = true;
          }
        }
        if (selectorSatisfied && !isAntiBotChallengeDocument(parsedLive) && !isRateLimitDocument(parsedLive)) {
          clearSpaDomainCircuit(safeUrl);
          parsedLive._wpbRenderedByTab = true;
          return parsedLive;
        }
      }
    } catch {
      // Fall back to opening a background tab below
    }
  }

  const assertCircuitClosed = () => {
    if (isSpaDomainCircuitOpen(safeUrl)) {
      const err = new Error(
        `Proteção SPA ativa: novas abas em segundo plano pausadas temporariamente para ${getHostKey(safeUrl)} devido a verificação anti-bot recente. Conclua a verificação em uma aba normal e retome.`
      );
      err.status = 403;
      err.isAntiBotChallenge = true;
      throw err;
    }
  };

  // Circuit breaker: refuse to spawn new background tabs against a domain currently showing Cloudflare/rate-limit
  assertCircuitClosed();

  const expectedHost = getHostKey(safeUrl);

  const extractFromTab = async (targetTabId) => {
    await waitForDomStabilityInTab(targetTabId, waitMs, signal, waitForSelector);
    const injected = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => ({
        html: document.documentElement.outerHTML,
        finalUrl: window.location?.href || ''
      })
    });
    const payload = injected?.[0]?.result;
    const renderedHtml = typeof payload === 'string' ? payload : payload?.html || '';
    const finalUrl = typeof payload === 'object' ? payload?.finalUrl || '' : '';
    if (!renderedHtml) {
      throw new Error(`Não foi possível extrair o DOM renderizado da aba para ${safeUrl}`);
    }
    if (finalUrl) {
      const finalHost = getHostKey(finalUrl);
      if (finalHost && expectedHost && finalHost !== expectedHost && !finalHost.endsWith(`.${expectedHost}`)) {
        onLog?.(
          `[SPA] Aviso de segurança: redirecionamento cross-origin detectado (${expectedHost} -> ${finalHost}) em ${safeUrl}`,
          'warn'
        );
      }
    }
    const parsedDoc = new DOMParser().parseFromString(renderedHtml, 'text/html');
    if (isAntiBotChallengeDocument(parsedDoc)) {
      tripSpaDomainCircuit(safeUrl, 'antibot');
      const err = new Error(
        `Verificação anti-bot (Cloudflare) pendente em ${safeUrl}. Abra a página em uma aba normal e conclua a verificação antes de tentar novamente.`
      );
      err.status = 403;
      err.isAntiBotChallenge = true;
      throw err;
    }
    if (isRateLimitDocument(parsedDoc)) {
      tripSpaDomainCircuit(safeUrl, 'ratelimit');
      const err = new Error(`HTTP 429 ao carregar ${safeUrl}`);
      err.status = 429;
      err.isRateLimit = true;
      throw err;
    }
    clearSpaDomainCircuit(safeUrl);
    parsedDoc._wpbRenderedByTab = true;
    return parsedDoc;
  };

  if (tabPool) {
    return tabPool.runExclusive(async () => {
      assertCircuitClosed();
      const targetTabId = await tabPool.navigate(safeUrl, signal);
      return extractFromTab(targetTabId);
    });
  }

  let createdTab = null;
  try {
    createdTab = await chrome.tabs.create({ url: safeUrl, active: false });
    await waitForTabComplete(createdTab.id, createdTab, signal, 12000);
    return await extractFromTab(createdTab.id);
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

/**
 * Read live DOM from an existing open tab without creating or closing any background tab.
 * Returns null if the tab does not exist, navigated elsewhere, or shows an anti-bot challenge.
 */
export async function readOpenTabDocument(url, { tabId = null, preferOpenTab = true } = {}) {
  if (!chrome?.tabs || !chrome?.scripting?.executeScript) return null;
  const normTarget = normalizeUrl(url);
  let targetId = typeof tabId === 'number' && Number.isInteger(tabId) ? tabId : null;

  if (targetId !== null && chrome.tabs.get) {
    try {
      const tb = await chrome.tabs.get(targetId);
      if (
        !tb?.url ||
        (tb.status && tb.status !== 'complete') ||
        normalizeUrl(tb.url) !== normTarget
      ) {
        targetId = null;
      }
    } catch {
      targetId = null;
    }
  }

  if (targetId === null && preferOpenTab && chrome.tabs.query) {
    try {
      const openTabs = await chrome.tabs.query({});
      const matched = (openTabs || []).find(
        (tb) =>
          typeof tb.id === 'number' &&
          tb.status === 'complete' &&
          tb.url &&
          normalizeUrl(tb.url) === normTarget
      );
      if (matched) targetId = matched.id;
    } catch {
      return null;
    }
  }

  if (targetId === null) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetId },
      func: () => document.documentElement.outerHTML
    });
    const liveHtml = results?.[0]?.result;
    if (!liveHtml || liveHtml.length <= 60) return null;
    const parsedLive = new DOMParser().parseFromString(liveHtml, 'text/html');
    if (isAntiBotChallengeDocument(parsedLive) || isRateLimitDocument(parsedLive)) {
      return null;
    }
    return parsedLive;
  } catch {
    return null;
  }
}

export async function fetchDocumentWithOptions(url, options = {}, signal) {
  const onLog = typeof options.onLog === 'function' ? options.onLog : null;
  const preferOpenTab = options.preferOpenTabDom !== false;

  // Reuse live DOM directly from the originating active tab (zero cold fetch / zero temp tab)
  if (
    !options.renderWithTab &&
    typeof options.sourceTabId === 'number' &&
    preferOpenTab &&
    canUseTabScripting()
  ) {
    const liveDoc = await readOpenTabDocument(url, {
      tabId: options.sourceTabId,
      preferOpenTab: false
    });
    if (liveDoc) {
      liveDoc._wpbFromSourceTab = true;
      onLog?.(`[TAB] DOM vivo capturado diretamente da aba de origem (#${options.sourceTabId}): ${url}`, 'debug');
      return liveDoc;
    }
  }

  if (options.renderWithTab && canUseTabScripting()) {
    onLog?.(`[SPA] Renderizando via aba ativa: ${url}`, 'debug');
    return fetchRenderedTabDocument(url, {
      waitMs: options.renderWaitMs ?? 950,
      tabId: options.tabId ?? null,
      preferOpenTab,
      waitForSelector: options.waitForSelector || '',
      onLog,
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
        preferOpenTab,
        waitForSelector: options.waitForSelector || '',
        onLog,
        signal
      });
    }
    throw err;
  }
}
