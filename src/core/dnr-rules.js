/**
 * Session-scoped declarativeNetRequest rules that attach legitimate navigation headers
 * (Referer, Sec-Fetch-Mode, Sec-Fetch-Site) to extension background fetches for protected sites.
 * Uses rule IDs 100..119 so Firefox's Origin-removal rule (ID 1) is never disturbed.
 */

const NAV_RULE_ID_BASE = 100;
const NAV_RULE_ID_MAX = 119;

function getExtensionHost() {
  try {
    const extUrl = typeof chrome !== 'undefined' ? chrome.runtime?.getURL?.('') : '';
    return extUrl ? new URL(extUrl).hostname : '';
  } catch {
    return '';
  }
}

/**
 * Install temporary session rules for the given target domains so extension fetches
 * carry the expected Referer and Sec-Fetch headers.
 */
export async function applyNavigationHeaderRules(domains = [], refererUrl = '') {
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
      const effectiveReferer = refererUrl && /^https?:\/\//i.test(refererUrl) ? refererUrl : `https://${domain}/`;
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
          resourceTypes: ['xmlhttprequest', 'other']
        }
      };
    });

    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    return true;
  } catch {
    return false;
  }
}

export async function clearNavigationHeaderRules() {
  try {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.updateSessionRules) {
      return;
    }
    const existing = (await chrome.declarativeNetRequest.getSessionRules?.()) || [];
    const removeRuleIds = existing
      .map((r) => r.id)
      .filter((id) => id >= NAV_RULE_ID_BASE && id <= NAV_RULE_ID_MAX);
    if (removeRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    }
  } catch {
    // Ignore when session rules are unavailable
  }
}
