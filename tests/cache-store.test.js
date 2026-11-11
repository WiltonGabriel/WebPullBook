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
