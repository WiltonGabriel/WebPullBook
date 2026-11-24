/**
 * Opens the WebPullBook workspace in a dedicated tab, passing the active tab URL when applicable.
 */
let firefoxRulePromise = null;

async function setupCrossOriginHeaderWorkaroundForFirefox() {
  if (firefoxRulePromise) return firefoxRulePromise;
  firefoxRulePromise = (async () => {
    try {
      const extUrl = chrome.runtime.getURL('');
      if (!extUrl.startsWith('moz-extension://') || !chrome.declarativeNetRequest?.updateSessionRules) {
        return;
      }
      const extHost = new URL(extUrl).hostname;
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [1],
        addRules: [
          {
            id: 1,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [{ header: 'Origin', operation: 'remove' }]
            },
            condition: {
              initiatorDomains: [extHost],
              resourceTypes: ['xmlhttprequest', 'image', 'other']
            }
          }
        ]
      });
    } catch {
      // Ignore if browser restricts session header rules
    } finally {
      firefoxRulePromise = null;
    }
  })();
  return firefoxRulePromise;
}

setupCrossOriginHeaderWorkaroundForFirefox();
chrome.runtime?.onInstalled?.addListener(() => {
  setupCrossOriginHeaderWorkaroundForFirefox();
});
chrome.runtime?.onStartup?.addListener(() => {
  setupCrossOriginHeaderWorkaroundForFirefox();
});
chrome.permissions?.onAdded?.addListener(() => {
  setupCrossOriginHeaderWorkaroundForFirefox();
});

async function cleanupOrphanedSessionDnrRules() {
  try {
    if (!chrome?.tabs?.query || !chrome?.declarativeNetRequest?.updateSessionRules) return;
    const workspacePrefix = chrome.runtime.getURL('src/workspace/workspace.html');
    const tabs = await chrome.tabs.query({});
    const hasWorkspaceTab = (tabs || []).some((tb) => String(tb?.url || '').startsWith(workspacePrefix));
    if (hasWorkspaceTab) return;
    const existing = (await chrome.declarativeNetRequest.getSessionRules?.()) || [];
    const removeRuleIds = existing.map((r) => r.id).filter((id) => id >= 100 && id <= 129);
    if (removeRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    }
  } catch {
    // Ignore cleanup errors when tabs/DNR are restricted
  }
}

chrome.tabs?.onRemoved?.addListener(() => {
  cleanupOrphanedSessionDnrRules();
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const sourceUrl = tab?.url && /^https?:\/\//i.test(tab.url) ? tab.url : '';
    const workspaceUrl = new URL(chrome.runtime.getURL('src/workspace/workspace.html'));
    if (sourceUrl) {
      workspaceUrl.searchParams.set('url', sourceUrl);
      if (typeof tab?.id === 'number') {
        workspaceUrl.searchParams.set('sourceTabId', String(tab.id));
      }
    }
    await chrome.tabs.create({
      url: workspaceUrl.toString(),
      index: typeof tab?.index === 'number' ? tab.index + 1 : undefined,
      active: true
    });
  } catch (err) {
    console.error('WebPullBook: failed to open workspace tab', err);
  }
});
