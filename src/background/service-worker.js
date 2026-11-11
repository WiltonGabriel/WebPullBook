/**
 * Opens the WebPullBook workspace in a dedicated tab, passing the active tab URL when applicable.
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    const sourceUrl = tab?.url && /^https?:\/\//i.test(tab.url) ? tab.url : '';
    const workspaceUrl = new URL(chrome.runtime.getURL('src/workspace/workspace.html'));
    if (sourceUrl) {
      workspaceUrl.searchParams.set('url', sourceUrl);
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
