/**
 * Minimal in-memory IndexedDB + IDBKeyRange shim for testing `CacheStore`
 * persistence, TTL expiration, session restoration, and storage-cap eviction in Node.
 */

class ShimKeyRange {
  constructor(type, value) {
    this.type = type;
    this.value = value;
  }

  matches(key) {
    if (this.type === 'only') return key === this.value;
    if (this.type === 'upper') return typeof key === 'number' && key <= this.value;
    return true;
  }

  static only(value) {
    return new ShimKeyRange('only', value);
  }

  static upperBound(value) {
    return new ShimKeyRange('upper', value);
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
        const [k, v] = entriesList[idx];
        const cursor = {
          key: k,
          value: cloneValue(v),
          delete: () => {
            storeData.delete(k);
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
      put: (record) =>
        reqWrap(() => {
          const k = record[this.keyPath];
          storeData.set(k, cloneValue(record));
          return k;
        }),
      delete: (key) =>
        reqWrap(() => {
          storeData.delete(key);
          return undefined;
        }),
      clear: () =>
        reqWrap(() => {
          storeData.clear();
          return undefined;
        }),
      openCursor: (range = null) => {
        const list = [];
        for (const [k, v] of storeData.entries()) {
          if (!range || range.matches(k)) list.push([k, v]);
        }
        return makeCursorApi(list);
      },
      index: (indexName) => {
        const idxDef = this._indexes.get(indexName);
        if (!idxDef) throw new Error(`Missing index: ${indexName}`);
        return {
          openCursor: (range = null) => {
            const list = [];
            for (const [k, v] of storeData.entries()) {
              const idxVal = v[idxDef.keyPath];
              if (!range || range.matches(idxVal)) list.push([k, v]);
            }
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

  transaction(storeNames, _mode = 'readonly') {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = {
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
