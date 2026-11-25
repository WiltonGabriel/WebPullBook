import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-env.js';
import {
  PageDomCache,
  TabRenderPool,
  assertSafeHttpUrl,
  clearSpaDomainCircuit,
  decodeHtmlBytes,
  fetchDocumentWithOptions,
  fetchRenderedTabDocument,
  fetchWithRetry,
  isAntiBotChallengeDocument,
  isRateLimitDocument,
  isSpaDomainCircuitOpen,
  resolveSafeHttpUrl
} from '../src/core/parser-engine.js';
import {
  applyImageRefererRule,
  applyNavigationHeaderRules,
  clearImageRefererRules,
  clearNavigationHeaderRules
} from '../src/core/dnr-rules.js';
import { genericHtmlParser } from '../src/parsers/generic-html.js';

let restoreDom;
let origFetch;
let origChrome;

beforeEach(() => {
  restoreDom = installDomGlobals();
  origFetch = globalThis.fetch;
  origChrome = globalThis.chrome;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  globalThis.chrome = origChrome;
  restoreDom();
});

test('decodeHtmlBytes respects HTTP charset header and HTML meta charset without mojibake', () => {
  // "Capítulo 1: Coração" encoded in Windows-1252 / ISO-8859-1 bytes
  const latin1Bytes = Uint8Array.from([
    0x3c, 0x70, 0x3e, 0x43, 0x61, 0x70, 0xed, 0x74, 0x75, 0x6c, 0x6f, 0x20, 0x31, 0x3a, 0x20,
    0x43, 0x6f, 0x72, 0x61, 0xe7, 0xe3, 0x6f, 0x3c, 0x2f, 0x70, 0x3e
  ]);
  const fakeHeaders = new Headers({ 'content-type': 'text/html; charset=iso-8859-1' });
  assert.equal(decodeHtmlBytes(latin1Bytes, fakeHeaders), '<p>Capítulo 1: Coração</p>');

  const metaPrefix = new TextEncoder().encode('<meta charset="windows-1252">');
  const combined = new Uint8Array(metaPrefix.length + latin1Bytes.length);
  combined.set(metaPrefix, 0);
  combined.set(latin1Bytes, metaPrefix.length);
  assert.match(decodeHtmlBytes(combined, new Headers({ 'content-type': 'text/html' })), /Capítulo 1: Coração/);
});

test('fetchDocumentWithOptions reads live DOM directly from sourceTabId without network fetch or forced SPA flag', async () => {
  const url = 'https://ssr.example.org/series/alpha';
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called when sourceTabId provides live DOM');
  };
  globalThis.chrome = {
    tabs: {
      create: async () => {
        throw new Error('should not create background tab');
      },
      get: async (id) => ({ id, status: 'complete', url }),
      query: async () => []
    },
    scripting: {
      executeScript: async ({ target }) => {
        assert.equal(target.tabId, 42);
        return [{ result: '<html><head><title>Alpha</title></head><body><h1>Alpha</h1><p>Live DOM content</p></body></html>' }];
      }
    }
  };

  const doc = await fetchDocumentWithOptions(url, { sourceTabId: 42 });
  assert.equal(fetchCalled, false);
  assert.equal(doc._wpbFromSourceTab, true);
  assert.equal(Boolean(doc._wpbRenderedByTab), false);
  assert.match(doc.body.textContent, /Live DOM content/);
});

test('PageDomCache reuses preloaded 1st-page DOM and multi-chapter hash URLs without repeating fetch', async () => {
  const chUrl = 'https://cache.example.org/single-page-story';
  const html = '<html><body><h1>Single Story</h1><div class="entry-content"><p>Reusable prose paragraph with enough length for chapter extraction.</p></div></body></html>';
  const preloadedDoc = new DOMParser().parseFromString(html, 'text/html');
  const domCache = new PageDomCache();
  domCache.set(chUrl, preloadedDoc);

  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('Should reuse cached DOM instead of calling fetch');
  };

  const parsed1 = await genericHtmlParser.downloadChapter(
    { url: chUrl, displayTitle: 'Part 1' },
    { pageDomCache: domCache }
  );
  const parsed2 = await genericHtmlParser.downloadChapter(
    { url: `${chUrl}#part-2`, displayTitle: 'Part 2' },
    { pageDomCache: domCache }
  );
  assert.equal(fetchCalled, false);
  assert.match(parsed1.serialize('../styles/stylesheet.css', true), /Reusable prose paragraph/);
  assert.match(parsed2.serialize('../styles/stylesheet.css', true), /Reusable prose paragraph/);
});

test('TabRenderPool reuses a single background worker tab across multiple SPA chapters and closes it once', async () => {
  let createCount = 0;
  let updateCount = 0;
  let removeCount = 0;
  let currentUrl = '';

  globalThis.chrome = {
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      query: async () => [],
      create: async ({ url }) => {
        createCount++;
        currentUrl = url;
        return { id: 700, status: 'complete', url };
      },
      update: async (id, { url }) => {
        updateCount++;
        currentUrl = url;
        return { id, status: 'complete', url };
      },
      get: async (id) => ({ id, status: 'complete', url: currentUrl }),
      remove: async () => {
        removeCount++;
      }
    },
    scripting: {
      executeScript: async () => [
        { result: `<html><body><article><p>Rendered content for ${currentUrl}</p></article></body></html>` }
      ]
    }
  };

  const pool = new TabRenderPool();
  const d1 = await fetchRenderedTabDocument('https://spa.example.org/ch-1', { waitMs: 0, tabPool: pool });
  const d2 = await fetchRenderedTabDocument('https://spa.example.org/ch-2', { waitMs: 0, tabPool: pool });
  const d3 = await fetchRenderedTabDocument('https://spa.example.org/ch-3', { waitMs: 0, tabPool: pool });
  await pool.close();

  assert.equal(createCount, 1, 'Should create only ONE worker tab for all 3 chapters');
  assert.equal(updateCount, 2, 'Chapters 2 and 3 should reuse the worker tab via tabs.update');
  assert.equal(removeCount, 1, 'Should close the single worker tab once on pool.close()');
  assert.match(d1.body.textContent, /ch-1/);
  assert.match(d2.body.textContent, /ch-2/);
  assert.match(d3.body.textContent, /ch-3/);
});

test('SPA security blocks unsafe protocols and trips per-domain anti-bot circuit breaker to prevent tab loops', async () => {
  assert.throws(() => assertSafeHttpUrl('javascript:alert(1)'), /Protocolo bloqueado/);
  assert.throws(() => assertSafeHttpUrl('chrome://settings'), /Protocolo bloqueado/);
  assert.throws(() => assertSafeHttpUrl('file:///etc/passwd'), /Protocolo bloqueado/);
  assert.equal(assertSafeHttpUrl('https://safe.example.org/ch/1'), 'https://safe.example.org/ch/1');

  const gatedUrl = 'https://cf-gated.example.org/chapter/1';
  clearSpaDomainCircuit(gatedUrl);
  let createCalls = 0;
  globalThis.chrome = {
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      query: async () => [],
      create: async ({ url }) => {
        createCalls++;
        return { id: 801, status: 'complete', url };
      },
      get: async (id) => ({ id, status: 'complete', url: gatedUrl }),
      remove: async () => {}
    },
    scripting: {
      executeScript: async () => [
        {
          result: {
            html: '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Checking your browser</div></body></html>',
            finalUrl: gatedUrl
          }
        }
      ]
    }
  };

  // First attempt detects Cloudflare and trips circuit breaker
  await assert.rejects(() => fetchRenderedTabDocument(gatedUrl, { waitMs: 0 }), (err) => Boolean(err.isAntiBotChallenge));
  assert.equal(createCalls, 1);
  assert.equal(isSpaDomainCircuitOpen(gatedUrl), true);

  // Second attempt on same domain MUST NOT spawn another background tab while circuit is open
  await assert.rejects(() => fetchRenderedTabDocument('https://cf-gated.example.org/chapter/2', { waitMs: 0 }), /Proteção SPA ativa/);
  assert.equal(createCalls, 1, 'Circuit breaker must prevent spawning additional background tabs');

  clearSpaDomainCircuit(gatedUrl);
  assert.equal(isSpaDomainCircuitOpen(gatedUrl), false);
});

test('Firefox moz-extension DNR rule ID 1 is preserved when applying and clearing navigation header rules (IDs 100..129)', async () => {
  let sessionRules = [
    {
      id: 1,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Origin', operation: 'remove' }] }
    }
  ];
  globalThis.chrome = {
    runtime: {
      getURL: (p = '') => `moz-extension://8f3b2c1a-4d5e-6f7a-8b9c-0d1e2f3a4b5c/${p}`
    },
    declarativeNetRequest: {
      getSessionRules: async () => [...sessionRules],
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        sessionRules = sessionRules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
      }
    }
  };

  const applied = await applyNavigationHeaderRules(['fiction.example.org'], 'https://fiction.example.org/toc');
  assert.equal(applied, true);
  assert.ok(sessionRules.some((r) => r.id === 1), 'Firefox Origin-removal rule ID 1 must remain intact');
  const navRule = sessionRules.find((r) => r.id === 100);
  assert.ok(navRule, 'Navigation rule ID 100 must be added');
  assert.ok(navRule.condition.resourceTypes.includes('image'), 'Navigation rule should cover image requests');

  const imgApplied = await applyImageRefererRule('https://cdn.example.org/cover.jpg', 'https://fiction.example.org/toc');
  assert.equal(imgApplied, true);
  assert.ok(sessionRules.some((r) => r.id === 120), 'Image Referer rule ID 120 must be added');
  await clearImageRefererRules();
  assert.ok(!sessionRules.some((r) => r.id === 120) && sessionRules.some((r) => r.id === 100) && sessionRules.some((r) => r.id === 1));

  await applyImageRefererRule('https://cdn.example.org/cover.jpg', 'https://fiction.example.org/toc');
  await clearNavigationHeaderRules();
  assert.deepEqual(
    sessionRules.map((r) => r.id),
    [1],
    'Clearing navigation rules must remove IDs 100..129 while keeping Firefox rule ID 1'
  );
});

test('resolveSafeHttpUrl allows only HTTP/HTTPS and blocks javascript, data, and vbscript schemes', () => {
  assert.equal(resolveSafeHttpUrl('/chapter/2#sec', 'https://fiction.example.org/series/'), 'https://fiction.example.org/chapter/2');
  assert.equal(resolveSafeHttpUrl('http://local.example.org/test'), 'http://local.example.org/test');
  assert.equal(resolveSafeHttpUrl('#anchor-only', 'https://fiction.example.org/'), null);
  assert.equal(resolveSafeHttpUrl('javascript:alert(1)', 'https://fiction.example.org/'), null);
  assert.equal(resolveSafeHttpUrl('  JaVaScRiPt:alert(1)', 'https://fiction.example.org/'), null);
  assert.equal(resolveSafeHttpUrl('data:text/html,<script>alert(1)</script>', 'https://fiction.example.org/'), null);
  assert.equal(resolveSafeHttpUrl('vbscript:msgbox(1)', 'https://fiction.example.org/'), null);
  assert.equal(resolveSafeHttpUrl('file:///etc/passwd', 'https://fiction.example.org/'), null);
});

test('TabRenderPool waits until tab URL transitions off previous chapter when tabs.get returns stale complete URL', async () => {
  let activeTabUrl = 'https://spa.example.org/read/book/chapter-1';
  let pollCount = 0;

  globalThis.chrome = {
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      query: async () => [],
      create: async ({ url }) => {
        activeTabUrl = url;
        return { id: 901, status: 'complete', url };
      },
      update: async (id, { url }) => {
        pollCount = 0;
        // Simulate Chrome keeping previous URL with status complete for multiple polls before loading next URL
        setTimeout(() => {
          activeTabUrl = url;
        }, 280);
        return { id, status: 'complete', url: activeTabUrl };
      },
      get: async (id) => {
        pollCount++;
        return { id, status: 'complete', url: activeTabUrl };
      },
      remove: async () => {}
    },
    scripting: {
      executeScript: async () => [
        { result: `<html><body><article><p>Hydrated prose for ${activeTabUrl}</p></article></body></html>` }
      ]
    }
  };

  const pool = new TabRenderPool();
  const ch1 = await fetchRenderedTabDocument('https://spa.example.org/read/book/chapter-1', { waitMs: 0, tabPool: pool });
  const ch2 = await fetchRenderedTabDocument('https://spa.example.org/read/book/chapter-2', { waitMs: 0, tabPool: pool });
  await pool.close();

  assert.match(ch1.body.textContent, /chapter-1/);
  assert.match(ch2.body.textContent, /chapter-2/);
  assert.ok(pollCount >= 2, 'Should poll until tab URL transitions off chapter-1');
});

test('PageDomCache keeps query parameters distinct, long prose does not trip anti-bot detection, and DNR image slots are ref-counted', async () => {
  const domCache = new PageDomCache();
  const d1 = new DOMParser().parseFromString('<p>Page 1</p>', 'text/html');
  const d2 = new DOMParser().parseFromString('<p>Page 2</p>', 'text/html');
  domCache.set('https://example.org/list?page=1', d1);
  domCache.set('https://example.org/list?page=2', d2);
  assert.equal(domCache.get('https://example.org/list?page=1').body.textContent.trim(), 'Page 1');
  assert.equal(domCache.get('https://example.org/list?page=2').body.textContent.trim(), 'Page 2');

  const longProse = '<article><p>' + 'Story text mentioning Cloudflare and human verification. '.repeat(90) + '</p></article>';
  const longDoc = new DOMParser().parseFromString(longProse, 'text/html');
  assert.equal(isAntiBotChallengeDocument(longDoc), false);

  for (const selectorClass of ['reader-content', 'rich-text-content']) {
    const shortChapter = new DOMParser().parseFromString(
      `<title>Just a moment</title><div class="${selectorClass}"><p>You are being rate limited in dialogue. Enable javascript and cookies to continue.</p></div>`,
      'text/html'
    );
    assert.equal(isAntiBotChallengeDocument(shortChapter), false);
    assert.equal(isRateLimitDocument(shortChapter), false);
  }

  let sessionRules = [{ id: 1, priority: 1, action: { type: 'modifyHeaders' }, condition: {} }];
  globalThis.chrome = {
    runtime: { getURL: (p = '') => `moz-extension://uuid/${p}` },
    declarativeNetRequest: {
      getSessionRules: async () => [...sessionRules],
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        sessionRules = sessionRules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
      }
    }
  };
  await applyImageRefererRule('https://cdn1.example.org/a.jpg', 'https://origin.example.org/1');
  await applyImageRefererRule('https://cdn1.example.org/c.jpg', 'https://origin.example.org/1');
  await applyImageRefererRule('https://cdn2.example.org/b.jpg', 'https://origin.example.org/1');
  assert.equal(sessionRules.filter((r) => r.id >= 120 && r.id <= 129).length, 2);

  await clearImageRefererRules('https://cdn1.example.org/a.jpg', 'https://origin.example.org/1');
  assert.equal(sessionRules.filter((r) => r.id >= 120 && r.id <= 129).length, 2, 'Ref-counted slot stays until last holder releases');
  await clearImageRefererRules('https://cdn1.example.org/c.jpg', 'https://origin.example.org/1');
  assert.equal(sessionRules.filter((r) => r.id >= 120 && r.id <= 129).length, 1);
  await clearImageRefererRules();
  assert.equal(sessionRules.length, 1);
  assert.equal(sessionRules[0].id, 1);

  let fetchAttempts = 0;
  globalThis.fetch = async () => {
    fetchAttempts++;
    return new Response('ok');
  };
  await assert.rejects(() => fetchWithRetry('file:///etc/passwd', {}, 3), /Protocolo bloqueado/);
  assert.equal(fetchAttempts, 0);
});
