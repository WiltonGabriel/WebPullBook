/**
 * Minimal in-memory IndexedDB + IDBKeyRange shim for testing `CacheStore`
 * persistence, TTL expiration, session restoration, and storage-cap eviction in Node.
 */

function keyTypeRank(val) {
  if (typeof val === 'number') return 1;
  if (val instanceof Date) return 2;
  if (typeof val === 'string') return 3;
  if (Array.isArray(val)) return 4;
  return 5;
}

function compareIdbKeys(a, b) {
  if (a === b) return 0;
  const ra = keyTypeRank(a);
  const rb = keyTypeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number') return a - b;
  if (a instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a)) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const cmp = compareIdbKeys(a[i], b[i]);
      if (cmp !== 0) return cmp;
    }
    return a.length - b.length;
  }
  return String(a) < String(b) ? -1 : 1;
}

class ShimKeyRange {
  constructor(lower, upper, lowerOpen = false, upperOpen = false) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = Boolean(lowerOpen);
    this.upperOpen = Boolean(upperOpen);
  }

  matches(key) {
    if (key === undefined || key === null) return false;
    if (this.lower !== undefined) {
      const cmp = compareIdbKeys(key, this.lower);
      if (this.lowerOpen ? cmp <= 0 : cmp < 0) return false;
    }
    if (this.upper !== undefined) {
      const cmp = compareIdbKeys(key, this.upper);
      if (this.upperOpen ? cmp >= 0 : cmp > 0) return false;
    }
    return true;
  }

  static only(value) {
    return new ShimKeyRange(value, value, false, false);
  }

  static lowerBound(value, open = false) {
    return new ShimKeyRange(value, undefined, open, false);
  }

  static upperBound(value, open = false) {
    return new ShimKeyRange(undefined, value, false, open);
  }

  static bound(lower, upper, lowerOpen = false, upperOpen = false) {
    return new ShimKeyRange(lower, upper, lowerOpen, upperOpen);
  }
}

class ShimRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }
}

function cloneValue(val) {
  return structuredClone(val);
}

class ShimObjectStore {
  constructor(name, keyPath, tx) {
    this.name = name;
    this.keyPath = keyPath;
    this._tx = tx;
    this._records = new Map();
    this._indexes = new Map();
  }

  createIndex(name, keyPath, options = {}) {
    this._indexes.set(name, { name, keyPath, unique: Boolean(options.unique) });
    return this._indexes.get(name);
  }

  _bindTx(storeData, tx) {
    const assertWritable = () => {
      if (tx.mode !== 'readwrite') {
        throw new DOMException('Transaction is readonly', 'ReadOnlyError');
      }
    };

    const reqWrap = (fn) => {
      const req = new ShimRequest();
      tx._pending++;
      queueMicrotask(() => {
        try {
          req.result = fn();
          req.onsuccess?.({ target: req });
        } catch (err) {
          req.error = err;
          req.onerror?.({ target: req });
        } finally {
          tx._finishOne();
        }
      });
      return req;
    };

    const makeCursorApi = (entriesList) => {
      const req = new ShimRequest();
      tx._pending++;
      let idx = 0;

      const step = () => {
        if (idx >= entriesList.length) {
          req.result = null;
          req.onsuccess?.({ target: req });
          tx._finishOne();
          return;
        }
        const entry = entriesList[idx];
        const cursor = {
          key: entry.cursorKey,
          primaryKey: entry.primaryKey,
          value: cloneValue(entry.value),
          delete: () => {
            assertWritable();
            storeData.delete(entry.primaryKey);
          },
          continue: () => {
            idx++;
            queueMicrotask(step);
          }
        };
        req.result = cursor;
        req.onsuccess?.({ target: req });
      };

      queueMicrotask(step);
      return req;
    };

    return {
      get: (key) => reqWrap(() => (storeData.has(key) ? cloneValue(storeData.get(key)) : undefined)),
      put: (record) => {
        assertWritable();
        return reqWrap(() => {
          const k = record[this.keyPath];
          storeData.set(k, cloneValue(record));
          return k;
        });
      },
      delete: (key) => {
        assertWritable();
        return reqWrap(() => {
          storeData.delete(key);
          return undefined;
        });
      },
      clear: () => {
        assertWritable();
        return reqWrap(() => {
          storeData.clear();
          return undefined;
        });
      },
      openCursor: (range = null, direction = 'next') => {
        const list = [];
        for (const [k, v] of storeData.entries()) {
          if (!range || range.matches(k)) {
            list.push({ cursorKey: k, primaryKey: k, value: v });
          }
        }
        list.sort((a, b) => compareIdbKeys(a.cursorKey, b.cursorKey));
        if (direction === 'prev' || direction === 'prevunique') list.reverse();
        return makeCursorApi(list);
      },
      index: (indexName) => {
        const idxDef = this._indexes.get(indexName);
        if (!idxDef) throw new Error(`Missing index: ${indexName}`);
        return {
          openCursor: (range = null, direction = 'next') => {
            const list = [];
            for (const [k, v] of storeData.entries()) {
              const idxVal = v[idxDef.keyPath];
              if (idxVal === undefined || idxVal === null) continue;
              if (!range || range.matches(idxVal)) {
                list.push({ cursorKey: idxVal, primaryKey: k, value: v });
              }
            }
            list.sort(
              (a, b) => compareIdbKeys(a.cursorKey, b.cursorKey) || compareIdbKeys(a.primaryKey, b.primaryKey)
            );
            if (direction === 'prev' || direction === 'prevunique') list.reverse();
            return makeCursorApi(list);
          }
        };
      }
    };
  }
}

class ShimDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this._stores = new Map();
    this.onversionchange = null;
  }

  get objectStoreNames() {
    const names = Array.from(this._stores.keys());
    return {
      contains: (n) => names.includes(n)
    };
  }

  createObjectStore(name, options = {}) {
    const store = new ShimObjectStore(name, options.keyPath || 'id', null);
    this._stores.set(name, store);
    return store;
  }

  transaction(storeNames, mode = 'readonly') {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = {
      mode,
      _pending: 0,
      oncomplete: null,
      onerror: null,
      onabort: null,
      _finishOne() {
        this._pending--;
        if (this._pending <= 0) {
          queueMicrotask(() => {
            this.oncomplete?.();
          });
        }
      },
      objectStore: (name) => {
        if (!names.includes(name)) throw new Error(`Store ${name} not in transaction`);
        const store = this._stores.get(name);
        return store._bindTx(store._records, tx);
      }
    };
    return tx;
  }

  close() {}
}

export function createMemoryIndexedDb() {
  const dbs = new Map();
  return {
    open(name, version = 1) {
      const req = new ShimRequest();
      queueMicrotask(() => {
        let db = dbs.get(name);
        const isNew = !db || db.version < version;
        if (!db) {
          db = new ShimDatabase(name, version);
          dbs.set(name, db);
        }
        req.result = db;
        if (isNew && req.onupgradeneeded) {
          req.onupgradeneeded({ target: req });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    }
  };
}

export function installIdbGlobals() {
  const prev = {
    indexedDB: globalThis.indexedDB,
    IDBKeyRange: globalThis.IDBKeyRange
  };
  globalThis.indexedDB = createMemoryIndexedDb();
  globalThis.IDBKeyRange = ShimKeyRange;
  return () => {
    globalThis.indexedDB = prev.indexedDB;
    globalThis.IDBKeyRange = prev.IDBKeyRange;
  };
}
