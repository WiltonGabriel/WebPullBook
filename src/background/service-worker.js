/**
 * Opens the WebPullBook workspace in a dedicated tab, passing the active tab URL when applicable.
 */
async function setupCrossOriginHeaderWorkaroundForFirefox() {
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
  }
}

setupCrossOriginHeaderWorkaroundForFirefox();

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
