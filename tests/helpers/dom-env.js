import { JSDOM } from 'jsdom';

/**
 * Installs standard JSDOM globals (`Node`, `DOMParser`, `XMLSerializer`, `document`)
 * onto `globalThis` for Node unit tests and returns a cleanup callback.
 */
export function installDomGlobals() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
  const keys = ['Node', 'DOMParser', 'XMLSerializer', 'document'];
  const prev = new Map();

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(globalThis, key)) {
      prev.set(key, globalThis[key]);
    }
    globalThis[key] = dom.window[key];
  }

  return () => {
    for (const key of keys) {
      if (prev.has(key)) {
        globalThis[key] = prev.get(key);
      } else {
        delete globalThis[key];
      }
    }
    dom.window.close();
  };
}
