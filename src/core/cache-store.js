import { XHTML_NS, serializeChapterXhtml } from './sanitizer.js';

const DB_NAME = 'WebPullBookCache';
const DB_VERSION = 1;
const STORE_CHAPTERS = 'chapters';
const STORE_SESSIONS = 'sessions';

export const DEFAULT_CACHE_TTL_DAYS = 7;
export const MAX_CACHE_BYTES = 64 * 1024 * 1024; // 64 MB safety cap

function ttlMsFromDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 24 * 60 * 60 * 1000);
}

function estimateBytes(str) {
  return new Blob([String(str || '')]).size;
}

export function serializeNodesForCache(nodes) {
  const serializer = new XMLSerializer();
  return nodes.map((n) => serializer.serializeToString(n)).join('\n');
}

export function hydrateCachedChapter(chapter, record) {
  const parser = new DOMParser();
  const wrapped = `<?xml version="1.0" encoding="utf-8"?><html xmlns="${XHTML_NS}"><body>${record.contentXml || ''}</body></html>`;
  const xmlDoc = parser.parseFromString(wrapped, 'application/xhtml+xml');
  const bodyEl =
    xmlDoc.getElementsByTagNameNS(XHTML_NS, 'body')[0] ||
    xmlDoc.documentElement?.lastElementChild ||
    xmlDoc.documentElement;

  const nodes = bodyEl ? Array.from(bodyEl.childNodes) : [];
  const images = bodyEl
    ? Array.from(bodyEl.getElementsByTagNameNS(XHTML_NS, 'img')).map((el) => ({
        originalUrl: el.getAttribute('src') || '',
        element: el
      }))
    : [];

  return {
    chapter,
    chapterTitle: record.chapterTitle || chapter.displayTitle || chapter.url,
    subtitle: record.subtitle || '',
    xmlDoc,
    nodes,
    images,
    serialize(stylesheetHref, epub3) {
      return serializeChapterXhtml({
        title: record.chapterTitle || chapter.displayTitle || chapter.url,
        subtitle: record.subtitle || '',
        xmlDoc,
        nodes,
        stylesheetHref,
        epub3
      });
    }
  };
}

class CacheStore {
  constructor() {
    this._dbPromise = null;
  }

  isSupported() {
    return typeof indexedDB !== 'undefined';
  }

  open() {
    if (!this.isSupported()) return Promise.resolve(null);
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
            const chStore = db.createObjectStore(STORE_CHAPTERS, { keyPath: 'key' });
            chStore.createIndex('seriesKey', 'seriesKey', { unique: false });
            chStore.createIndex('savedAt', 'savedAt', { unique: false });
            chStore.createIndex('expiresAt', 'expiresAt', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
            const sessStore = db.createObjectStore(STORE_SESSIONS, { keyPath: 'seriesKey' });
            sessStore.createIndex('expiresAt', 'expiresAt', { unique: false });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            this._dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    return this._dbPromise;
  }

  async _tx(storeNames, mode, fn) {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeNames, mode);
        const result = fn(tx);
        tx.oncomplete = () => resolve(result?._value ?? result ?? true);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async getChapter(key) {
    const db = await this.open();
    if (!db || !key) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_CHAPTERS, 'readonly');
        const req = tx.objectStore(STORE_CHAPTERS).get(key);
        req.onsuccess = () => {
          const rec = req.result;
          if (!rec) return resolve(null);
          if (rec.expiresAt && rec.expiresAt <= Date.now()) {
            this.deleteChapter(key).catch(() => {});
            return resolve(null);
          }
          resolve(rec);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async hasChapters(keys) {
    const map = new Map();
    const db = await this.open();
    if (!db || !keys.length) return map;
    const now = Date.now();
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_CHAPTERS, 'readonly');
        const store = tx.objectStore(STORE_CHAPTERS);
        for (const key of keys) {
          const req = store.get(key);
          req.onsuccess = () => {
            const rec = req.result;
            if (rec && (!rec.expiresAt || rec.expiresAt > now)) {
              map.set(key, rec);
            }
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    return map;
  }

  async putChapter({
    key,
    seriesKey,
    chapterUrl,
    chapterTitle,
    subtitle,
    nodes,
    ttlDays = DEFAULT_CACHE_TTL_DAYS
  }) {
    const ttlMs = ttlMsFromDays(ttlDays);
    if (ttlMs <= 0) return false;
    const contentXml = serializeNodesForCache(nodes);
    const now = Date.now();
    const record = {
      key,
      seriesKey: seriesKey || '',
      chapterUrl,
      chapterTitle,
      subtitle: subtitle || '',
      contentXml,
      byteSize: estimateBytes(contentXml) + 200,
      savedAt: now,
      expiresAt: now + ttlMs
    };
    await this._tx([STORE_CHAPTERS], 'readwrite', (tx) => {
      tx.objectStore(STORE_CHAPTERS).put(record);
    });
    await this.enforceStorageCap();
    return true;
  }

  async deleteChapter(key) {
    return this._tx([STORE_CHAPTERS], 'readwrite', (tx) => {
      tx.objectStore(STORE_CHAPTERS).delete(key);
    });
  }

  async putSession({ seriesKey, metadata, parserId, chapters, ttlDays = DEFAULT_CACHE_TTL_DAYS }) {
    const ttlMs = ttlMsFromDays(ttlDays);
    if (!seriesKey || ttlMs <= 0) return false;
    const now = Date.now();
    const compactChapters = chapters.map((ch) => ({
      id: ch.id,
      index: ch.index,
      url: ch.url,
      numText: ch.numText || '',
      titleText: ch.titleText || '',
      dateText: ch.dateText || '',
      displayTitle: ch.displayTitle,
      volume: ch.volume || 'Volume 01',
      included: ch.included !== false,
      status: ch.status === 'downloading' ? 'pending' : (ch.status || 'pending'),
      errorMsg: ch.errorMsg || ''
    }));

    const session = {
      seriesKey,
      metadata: {
        startingUrl: metadata.startingUrl || seriesKey,
        title: metadata.title || 'WebPullBook',
        author: metadata.author || '<unknown>',
        language: metadata.language || 'pt',
        filename: metadata.filename || '',
        coverUrl: metadata.coverUrl || '',
        coverThumbUrl: metadata.coverThumbUrl || '',
        genres: Array.isArray(metadata.genres) ? metadata.genres : [],
        synopsis: metadata.synopsis || '',
        status: metadata.status || ''
      },
      parserId: parserId || 'auto',
      chapters: compactChapters,
      updatedAt: now,
      expiresAt: now + ttlMs
    };

    return this._tx([STORE_SESSIONS], 'readwrite', (tx) => {
      tx.objectStore(STORE_SESSIONS).put(session);
    });
  }

  async listSessionsWithStats() {
    const db = await this.open();
    if (!db) return { sessions: [], totalChapters: 0, totalBytes: 0 };

    const now = Date.now();
    const sessions = [];
    const perSeriesStats = new Map();
    let totalChapters = 0;
    let totalBytes = 0;

    await new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_SESSIONS, STORE_CHAPTERS], 'readonly');

        tx.objectStore(STORE_CHAPTERS).openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const rec = cursor.value;
          if (!rec.expiresAt || rec.expiresAt > now) {
            totalChapters++;
            const sz = rec.byteSize || 0;
            totalBytes += sz;
            const cur = perSeriesStats.get(rec.seriesKey) || { cachedCount: 0, bytes: 0 };
            cur.cachedCount++;
            cur.bytes += sz;
            perSeriesStats.set(rec.seriesKey, cur);
          }
          cursor.continue();
        };

        tx.objectStore(STORE_SESSIONS).openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const sess = cursor.value;
          if (!sess.expiresAt || sess.expiresAt > now) {
            sessions.push(sess);
          }
          cursor.continue();
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });

    const enriched = sessions
      .map((s) => {
        const st = perSeriesStats.get(s.seriesKey) || { cachedCount: 0, bytes: 0 };
        return {
          ...s,
          cachedCount: st.cachedCount,
          bytes: st.bytes
        };
      })
      .filter((s) => s.cachedCount > 0 || s.chapters?.some((c) => c.status === 'error'))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return { sessions: enriched, totalChapters, totalBytes };
  }

  async deleteSeriesCache(seriesKey) {
    const db = await this.open();
    if (!db || !seriesKey) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_CHAPTERS, STORE_SESSIONS], 'readwrite');
        tx.objectStore(STORE_SESSIONS).delete(seriesKey);
        const idx = tx.objectStore(STORE_CHAPTERS).index('seriesKey');
        idx.openCursor(IDBKeyRange.only(seriesKey)).onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async pruneExpired() {
    const db = await this.open();
    if (!db) return 0;
    const now = Date.now();
    let removed = 0;

    await new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_CHAPTERS, STORE_SESSIONS], 'readwrite');
        const chRange = IDBKeyRange.upperBound(now);
        tx.objectStore(STORE_CHAPTERS).index('expiresAt').openCursor(chRange).onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          cursor.delete();
          removed++;
          cursor.continue();
        };
        tx.objectStore(STORE_SESSIONS).index('expiresAt').openCursor(chRange).onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });

    return removed;
  }

  async enforceStorageCap(maxBytes = MAX_CACHE_BYTES) {
    const db = await this.open();
    if (!db) return;

    const entries = [];
    let totalBytes = 0;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_CHAPTERS, 'readonly');
        tx.objectStore(STORE_CHAPTERS).openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const sz = cursor.value.byteSize || 0;
          totalBytes += sz;
          entries.push({ key: cursor.value.key, savedAt: cursor.value.savedAt || 0, byteSize: sz });
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });

    if (totalBytes <= maxBytes) return;
    entries.sort((a, b) => a.savedAt - b.savedAt);

    const toDelete = [];
    for (const item of entries) {
      if (totalBytes <= maxBytes * 0.85) break;
      toDelete.push(item.key);
      totalBytes -= item.byteSize;
    }

    if (toDelete.length > 0) {
      await this._tx([STORE_CHAPTERS], 'readwrite', (tx) => {
        const store = tx.objectStore(STORE_CHAPTERS);
        for (const k of toDelete) store.delete(k);
      });
    }
  }

  async clearAll() {
    return this._tx([STORE_CHAPTERS, STORE_SESSIONS], 'readwrite', (tx) => {
      tx.objectStore(STORE_CHAPTERS).clear();
      tx.objectStore(STORE_SESSIONS).clear();
    });
  }
}

export const cacheStore = new CacheStore();
