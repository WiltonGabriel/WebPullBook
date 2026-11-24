import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-shim.js';
import { installIdbGlobals } from './helpers/idb-shim.js';
import { HtmlSanitizer } from '../src/core/sanitizer.js';
import {
  DEFAULT_CACHE_TTL_DAYS,
  cacheStore,
  hydrateCachedChapter,
  serializeNodesForCache
} from '../src/core/cache-store.js';
import { getCacheKey, state } from '../src/workspace/state.js';

let restoreDom;
let restoreIdb;

beforeEach(async () => {
  restoreDom = installDomGlobals();
  restoreIdb = installIdbGlobals();
  cacheStore._dbPromise = null;
  await cacheStore.clearAll();
});

afterEach(() => {
  cacheStore._dbPromise = null;
  restoreIdb();
  restoreDom();
});

function createChapterNodes(html) {
  const doc = new DOMParser().parseFromString(`<html><body><div id="c">${html}</div></body></html>`, 'text/html');
  return new HtmlSanitizer({ skipImages: false }).sanitize(doc.querySelector('#c'), 'https://example.com/ch').nodes;
}

test('serializeNodesForCache and hydrateCachedChapter restore chapter XML, images, and XHTML serialization', () => {
  const nodes = createChapterNodes('<p>Texto em cache com <b>negrito</b>.</p><img src="https://example.com/img.png" alt="Mapa">');
  const contentXml = serializeNodesForCache(nodes);

  const chapter = { id: 'ch_1', index: 1, url: 'https://example.com/ch/1', displayTitle: 'Cap 1', volume: 'Volume 01' };
  const hydrated = hydrateCachedChapter(chapter, {
    chapterTitle: 'Capítulo 1',
    subtitle: 'Subtítulo',
    contentXml
  });

  assert.equal(hydrated.chapterTitle, 'Capítulo 1');
  assert.equal(hydrated.subtitle, 'Subtítulo');
  assert.equal(hydrated.images.length, 1);
  assert.equal(hydrated.images[0].originalUrl, 'https://example.com/img.png');

  const xhtml = hydrated.serialize('../styles/stylesheet.css', true);
  const parsed = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  assert.equal(parsed.querySelector('parsererror'), null);
  assert.match(xhtml, /Texto em cache com/);
});

test('CacheStore persists chapters and sessions for download resume and prunes expired items', async () => {
  const nodes = createChapterNodes('<p>Conteúdo persistido</p>');
  const seriesKey = 'https://example.com/series/obra';
  const chKey = `${seriesKey}/cap-1|wp-lightnovel`;

  const saved = await cacheStore.putChapter({
    key: chKey,
    seriesKey,
    chapterUrl: `${seriesKey}/cap-1`,
    chapterTitle: 'Capítulo 1',
    subtitle: '',
    nodes,
    ttlDays: DEFAULT_CACHE_TTL_DAYS
  });
  assert.equal(saved, true);

  await cacheStore.putSession({
    seriesKey,
    metadata: {
      startingUrl: seriesKey,
      title: 'Obra Retomável',
      author: 'Autora',
      language: 'pt'
    },
    parserId: 'wp-lightnovel',
    chapters: [
      { id: 'ch_1', index: 1, url: `${seriesKey}/cap-1`, displayTitle: 'Cap 1', volume: 'Volume 01', status: 'ok' },
      { id: 'ch_2', index: 2, url: `${seriesKey}/cap-2`, displayTitle: 'Cap 2', volume: 'Volume 01', status: 'downloading' }
    ],
    ttlDays: DEFAULT_CACHE_TTL_DAYS
  });

  const rec = await cacheStore.getChapter(chKey);
  assert.ok(rec);
  assert.equal(rec.chapterTitle, 'Capítulo 1');

  const map = await cacheStore.hasChapters([chKey, 'missing-key']);
  assert.equal(map.size, 1);
  assert.ok(map.has(chKey));

  const stats = await cacheStore.listSessionsWithStats();
  assert.equal(stats.sessions.length, 1);
  assert.equal(stats.sessions[0].cachedCount, 1);
  // Active 'downloading' chapter is normalized back to 'pending' on session snapshot for safe resume
  assert.equal(stats.sessions[0].chapters[1].status, 'pending');
  assert.equal(stats.totalChapters, 1);
  assert.ok(stats.totalBytes > 200);

  // Disabled cache (ttlDays <= 0) must refuse writes
  const disabledWrite = await cacheStore.putChapter({
    key: 'no-save',
    seriesKey,
    chapterUrl: `${seriesKey}/cap-3`,
    chapterTitle: 'Cap 3',
    nodes,
    ttlDays: 0
  });
  assert.equal(disabledWrite, false);

  // Expired entries are skipped on getChapter and removed on pruneExpired()
  const db = await cacheStore.open();
  await new Promise((resolve) => {
    const tx = db.transaction('chapters', 'readwrite');
    tx.objectStore('chapters').put({
      key: 'expired-key',
      seriesKey,
      chapterUrl: `${seriesKey}/cap-old`,
      chapterTitle: 'Antigo',
      subtitle: '',
      contentXml: '<p>Velho</p>',
      byteSize: 220,
      savedAt: Date.now() - 100000,
      expiresAt: Date.now() - 5000
    });
    tx.oncomplete = resolve;
  });

  assert.equal(await cacheStore.getChapter('expired-key'), null);
  const removed = await cacheStore.pruneExpired();
  assert.ok(removed >= 0);

  await cacheStore.deleteSeriesCache(seriesKey);
  const afterDelete = await cacheStore.listSessionsWithStats();
  assert.equal(afterDelete.sessions.length, 0);
  assert.equal(await cacheStore.getChapter(chKey), null);
});

test('CacheStore.enforceStorageCap evicts oldest entries down to 85% threshold', async () => {
  const db = await cacheStore.open();
  const now = Date.now();
  await new Promise((resolve) => {
    const tx = db.transaction('chapters', 'readwrite');
    const store = tx.objectStore('chapters');
    for (let i = 1; i <= 5; i++) {
      store.put({
        key: `k${i}`,
        seriesKey: 's1',
        chapterUrl: `https://example.com/${i}`,
        chapterTitle: `Ch ${i}`,
        subtitle: '',
        contentXml: '<p>x</p>',
        byteSize: 300,
        savedAt: now + i * 1000,
        expiresAt: now + 600000
      });
    }
    tx.oncomplete = resolve;
  });

  // Total 1500 bytes, cap 1000 bytes -> evicts oldest until <= 850 bytes (keeps 2 newest: k4, k5 = 600 bytes)
  await cacheStore.enforceStorageCap(1000);
  assert.equal(await cacheStore.getChapter('k1'), null);
  assert.equal(await cacheStore.getChapter('k2'), null);
  assert.equal(await cacheStore.getChapter('k3'), null);
  assert.ok(await cacheStore.getChapter('k4'));
  assert.ok(await cacheStore.getChapter('k5'));
});

test('idb-shim sorts cursors by key/index, supports key ranges, and enforces readonly transactions', async () => {
  const db = await cacheStore.open();
  await new Promise((resolve) => {
    const tx = db.transaction('chapters', 'readwrite');
    const store = tx.objectStore('chapters');
    store.put({ key: 'c', seriesKey: 's1', savedAt: 300, expiresAt: 900 });
    store.put({ key: 'a', seriesKey: 's1', savedAt: 100, expiresAt: 700 });
    store.put({ key: 'b', seriesKey: 's1', savedAt: 200, expiresAt: 800 });
    tx.oncomplete = resolve;
  });

  // Primary key cursor iterates in ascending key order (a, b, c) despite insertion order (c, a, b)
  const keys = [];
  await new Promise((resolve) => {
    const tx = db.transaction('chapters', 'readonly');
    tx.objectStore('chapters').openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return;
      keys.push(cur.key);
      cur.continue();
    };
    tx.oncomplete = resolve;
  });
  assert.deepEqual(keys, ['a', 'b', 'c']);

  // Index cursor iterates sorted by savedAt within IDBKeyRange.bound
  const bounded = [];
  await new Promise((resolve) => {
    const tx = db.transaction('chapters', 'readonly');
    tx.objectStore('chapters').index('savedAt').openCursor(IDBKeyRange.bound(100, 250)).onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return;
      bounded.push({ key: cur.primaryKey, savedAt: cur.key });
      cur.continue();
    };
    tx.oncomplete = resolve;
  });
  assert.deepEqual(bounded, [
    { key: 'a', savedAt: 100 },
    { key: 'b', savedAt: 200 }
  ]);

  // Readonly transactions must reject mutating operations
  const roTx = db.transaction('chapters', 'readonly');
  assert.throws(
    () => roTx.objectStore('chapters').put({ key: 'z', seriesKey: 's1', savedAt: 1, expiresAt: 2 }),
    (err) => err?.name === 'ReadOnlyError'
  );
  assert.throws(
    () => roTx.objectStore('chapters').delete('a'),
    (err) => err?.name === 'ReadOnlyError'
  );
});

test('getCacheKey includes customStripPatterns while keeping legacy key when empty', () => {
  const prevStrip = state.options.customStripPatterns;
  try {
    state.options.customStripPatterns = '';
    const base = getCacheKey('https://example.com/ch-1#top');
    assert.equal(base.endsWith('|'), true);

    state.options.customStripPatterns = 'Sponsored Ad';
    const withPattern = getCacheKey('https://example.com/ch-1');
    assert.notEqual(withPattern, base);

    state.options.customStripPatterns = '/Read more at .*/gi';
    const withOtherPattern = getCacheKey('https://example.com/ch-1');
    assert.notEqual(withOtherPattern, withPattern);
  } finally {
    state.options.customStripPatterns = prevStrip;
  }
});

test('hydrateCachedChapter rejects XML parsererror and preserves imageFallbacks across putChapter', async () => {
  const malformed = hydrateCachedChapter(
    { url: 'https://example.com/bad', displayTitle: 'Bad' },
    { chapterTitle: 'Bad', subtitle: '', contentXml: '<div><unclosed></div>' }
  );
  assert.equal(malformed, null);

  const nodes = createChapterNodes('<p>Pic</p><img src="https://cdn.example.com/full.jpg" alt="pic"/>');
  await cacheStore.putChapter({
    key: 'fb-k1',
    seriesKey: 'series-fb',
    chapterUrl: 'https://example.com/ch1',
    chapterTitle: 'Ch 1',
    subtitle: '',
    nodes,
    imageFallbacks: { 'https://cdn.example.com/full.jpg': 'https://cdn.example.com/thumb.jpg' },
    ttlDays: 7
  });
  const stored = await cacheStore.getChapter('fb-k1');
  assert.equal(stored.imageFallbacks['https://cdn.example.com/full.jpg'], 'https://cdn.example.com/thumb.jpg');
  const hydrated = hydrateCachedChapter({ url: 'https://example.com/ch1', displayTitle: 'Ch 1' }, stored);
  assert.equal(hydrated.images[0].fallbackUrl, 'https://cdn.example.com/thumb.jpg');
});

test('idb-shim queues put() before openCursor(), validates keyPath, unique indexes, version upgrades, and tx.abort()', async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('shim-regression', 1);
    req.onupgradeneeded = (e) => {
      const s = e.target.result.createObjectStore('items', { keyPath: 'id' });
      s.createIndex('slug', 'slug', { unique: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });

  // 1. put() queued before openCursor() in same transaction must be visible to cursor
  const keysSeen = await new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    const st = tx.objectStore('items');
    st.put({ id: 'b', slug: 's2' });
    st.put({ id: 'a', slug: 's1' });
    const seen = [];
    st.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return resolve(seen);
      seen.push(cur.key);
      cur.continue();
    };
    tx.onerror = (e) => reject(e.target.error);
  });
  assert.deepEqual(keysSeen, ['a', 'b']);

  // 2. unique index conflict rejects
  await assert.rejects(
    () =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('items', 'readwrite');
        const req = tx.objectStore('items').put({ id: 'c', slug: 's1' });
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      }),
    (err) => err?.name === 'ConstraintError'
  );

  // 3. version upgrade updates db.version and tx.abort triggers onabort
  const dbV2 = await new Promise((resolve) => {
    const req = indexedDB.open('shim-regression', 2);
    req.onsuccess = (e) => resolve(e.target.result);
  });
  assert.equal(dbV2.version, 2);

  await new Promise((resolve) => {
    const tx = dbV2.transaction('items', 'readwrite');
    tx.onabort = () => resolve();
    tx.abort();
  });
});
