/**
 * Session-scoped declarativeNetRequest rules that attach legitimate navigation headers
 * (Referer, Sec-Fetch-Mode, Sec-Fetch-Site) to extension background fetches for protected sites.
 * Uses rule IDs 100..119 so Firefox's Origin-removal rule (ID 1) is never disturbed.
 */

const NAV_RULE_ID_BASE = 100;
const NAV_RULE_ID_MAX = 119;
const IMG_REFERER_RULE_ID_BASE = 120;
const IMG_REFERER_RULE_ID_MAX = 129;

let dnrMutex = Promise.resolve();
const activeImageSlots = new Map(); // `${host}|${referer}` -> { id, count }

function withDnrLock(fn) {
  const next = dnrMutex.then(fn, fn);
  dnrMutex = next.catch(() => {});
  return next;
}

function getExtensionHost() {
  try {
    const extUrl = typeof chrome !== 'undefined' ? chrome.runtime?.getURL?.('') : '';
    return extUrl ? new URL(extUrl).hostname : '';
  } catch {
    return '';
  }
}

function normalizeRefererUrl(rawReferer, fallbackOriginDomain = '') {
  if (rawReferer && /^https?:\/\//i.test(rawReferer)) {
    try {
      return new URL(rawReferer).href;
    } catch {
      // fall through to fallback
    }
  }
  return fallbackOriginDomain ? `https://${fallbackOriginDomain}/` : '';
}

/**
 * Install temporary session rules for the given target domains so extension fetches
 * carry the expected Referer and Sec-Fetch headers.
 */
export function applyNavigationHeaderRules(domains = [], refererUrl = '') {
  return withDnrLock(async () => {
    try {
      if (
        typeof chrome === 'undefined' ||
        !chrome.declarativeNetRequest?.updateSessionRules ||
        !Array.isArray(domains) ||
        domains.length === 0
      ) {
        return false;
      }
      const extHost = getExtensionHost();
      if (!extHost) return false;

      const cleanDomains = [...new Set(domains.map((d) => String(d || '').trim().toLowerCase()).filter(Boolean))].slice(
        0,
        NAV_RULE_ID_MAX - NAV_RULE_ID_BASE + 1
      );
      if (cleanDomains.length === 0) return false;

      const existing = (await chrome.declarativeNetRequest.getSessionRules?.()) || [];
      const removeRuleIds = existing
        .map((r) => r.id)
        .filter((id) => id >= NAV_RULE_ID_BASE && id <= NAV_RULE_ID_MAX);

      const addRules = cleanDomains.map((domain, idx) => {
        const effectiveReferer = normalizeRefererUrl(refererUrl, domain);
        return {
          id: NAV_RULE_ID_BASE + idx,
          priority: 2,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Referer', operation: 'set', value: effectiveReferer },
              { header: 'Sec-Fetch-Mode', operation: 'set', value: 'navigate' },
              { header: 'Sec-Fetch-Site', operation: 'set', value: 'same-origin' }
            ]
          },
          condition: {
            initiatorDomains: [extHost],
            requestDomains: [domain],
            resourceTypes: ['xmlhttprequest', 'image', 'other']
          }
        };
      });

      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Install a temporary session rule setting the Referer header for protected image CDNs
 * when direct credentialed and anonymous image requests fail.
 * Uses rule IDs 120..129 so Firefox rule ID 1 and navigation rules 100..119 stay intact.
 */
export function applyImageRefererRule(imageUrl, refererUrl) {
  return withDnrLock(async () => {
    try {
      if (
        typeof chrome === 'undefined' ||
        !chrome.declarativeNetRequest?.updateSessionRules ||
        !imageUrl ||
        !refererUrl ||
        !/^https?:\/\//i.test(refererUrl)
      ) {
        return false;
      }
      const extHost = getExtensionHost();
      if (!extHost) return false;

      const imgHost = new URL(imageUrl).hostname.trim().toLowerCase();
      if (!imgHost) return false;
      const safeReferer = normalizeRefererUrl(refererUrl);
      if (!safeReferer) return false;

      const slotKey = `${imgHost}|${safeReferer}`;
      const existing = (await chrome.declarativeNetRequest.getSessionRules?.()) || [];
      const existingIds = new Set(existing.map((r) => r.id));

      const tracked = activeImageSlots.get(slotKey);
      if (tracked && existingIds.has(tracked.id)) {
        tracked.count += 1;
        return true;
      }

      let slotId = null;
      for (let id = IMG_REFERER_RULE_ID_BASE; id <= IMG_REFERER_RULE_ID_MAX; id++) {
        if (!existingIds.has(id)) {
          slotId = id;
          break;
        }
      }
      if (slotId === null) {
        const oldestEntry = activeImageSlots.entries().next().value;
        if (oldestEntry) {
          activeImageSlots.delete(oldestEntry[0]);
          slotId = oldestEntry[1].id;
        } else {
          slotId = IMG_REFERER_RULE_ID_BASE;
        }
      }

      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: existingIds.has(slotId) ? [slotId] : [],
        addRules: [
          {
            id: slotId,
            priority: 3,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [{ header: 'Referer', operation: 'set', value: safeReferer }]
            },
            condition: {
              initiatorDomains: [extHost],
              requestDomains: [imgHost],
              resourceTypes: ['xmlhttprequest', 'image', 'other']
            }
          }
        ]
      });
      activeImageSlots.set(slotKey, { id: slotId, count: 1 });
      return true;
    } catch {
      return false;
    }
  });
}

export function clearImageRefererRules(imageUrl = '', refererUrl = '') {
  return withDnrLock(async () => {
    try {
      if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.updateSessionRules) {
        return;
      }
      if (imageUrl) {
        try {
          const imgHost = new URL(imageUrl).hostname.trim().toLowerCase();
          const safeReferer = normalizeRefererUrl(refererUrl);
          const slotKey = `${imgHost}|${safeReferer}`;
          const tracked = activeImageSlots.get(slotKey);
          if (!tracked) return;
          tracked.count -= 1;
          if (tracked.count > 0) return;
          activeImageSlots.delete(slotKey);
          await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tracked.id] });
          return;
        } catch {
          return;
        }
      }

      activeImageSlots.clear();
      const existing = (await chrome.declarativeNetRequest.getSessionRules?.()) || [];
      const removeRuleIds = existing
        .map((r) => r.id)
        .filter((id) => id >= IMG_REFERER_RULE_ID_BASE && id <= IMG_REFERER_RULE_ID_MAX);
      if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
      }
    } catch {
      // Ignore when session rules are unavailable
    }
  });
}

export function clearNavigationHeaderRules() {
  return withDnrLock(async () => {
    try {
      activeImageSlots.clear();
      if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.updateSessionRules) {
        return;
      }
      const existing = (await chrome.declarativeNetRequest.getSessionRules?.()) || [];
      const removeRuleIds = existing
        .map((r) => r.id)
        .filter((id) => id >= NAV_RULE_ID_BASE && id <= IMG_REFERER_RULE_ID_MAX);
      if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
      }
    } catch {
      // Ignore when session rules are unavailable
    }
  });
}
