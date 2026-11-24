import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

/**
 * Installs an isolated `fake-indexeddb` instance onto `globalThis` (`indexedDB` and `IDBKeyRange`)
 * per test and returns a restore callback.
 */
export function installIdbGlobals() {
  const keys = ['indexedDB', 'IDBKeyRange'];
  const prev = new Map();

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(globalThis, key)) {
      prev.set(key, globalThis[key]);
    }
  }

  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;

  return () => {
    for (const key of keys) {
      if (prev.has(key)) {
        globalThis[key] = prev.get(key);
      } else {
        delete globalThis[key];
      }
    }
  };
}
