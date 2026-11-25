import {
  buildEpubStylesheet,
  clearSpaDomainCircuit,
  sanitizeFilename,
  toHighResCoverUrl
} from '../core/parser-engine.js';
import { cacheStore } from '../core/cache-store.js';
import { applyStaticIcons, createIcon } from './icons.js';
import { applyI18nToDom } from './i18n.js';
import { $, state, switchTab, t } from './state.js';
import {
  appendLog,
  formatLogsPlainText,
  renderExportReport,
  renderLogsOutput,
  setLogFilter,
  showBanner,
  updateLogBadges
} from './logger.js';
import {
  applyReaderPreset,
  applyThemeChoice,
  loadLibrary,
  loadOptions,
  populateRegistries,
  readOptionsFromUi,
  saveOptions,
  updateCoverPreview,
  updatePackButtonLabel
} from './options-storage.js';
import { updatePathPreview, updateSaveLocationUi } from './directory-handle.js';
import { loadDomainRules, renderDomainRules, sanitizeDomainRules } from './domain-rules-ui.js';
import {
  getVisibleChapters,
  populateRangeSelects,
  renderAllChapterViews,
  renderChaptersTable,
  renderVolumeChips,
  toggleAllVolumesSelection
} from './chapters-ui.js';
import {
  generateDefaultCoverDataUrl,
  handleGenerateCover,
  handleReloadCover,
  handleUploadCoverFile
} from './cover-ui.js';
import {
  applyMergeSelectedChapters,
  handleSavePreviewEdit,
  openChapterPreview,
  openMergeChaptersModal,
  setPreviewEditMode
} from './chapter-modals.js';
import { handleLoadSeries, setLoadingOverlay } from './series-loader.js';
import { handlePackEpub } from './export-runner.js';
import {
  downloadBlobToChrome,
  handlePickSaveFolder,
  handleUseDownloadsFolder
} from './download-storage.js';
import {
  handleCheckAllLibrary,
  handleDownloadLibraryUpdates,
  renderLibrary,
  saveCurrentSeriesToLibrary,
  updateLibraryAfterExport
} from './library-ui.js';
import { renderCacheSessions } from './cache-sessions-ui.js';
import {
  applyMergedTabsSelection,
  getMergeCandidates,
  handleMergeOpenTabs,
  queryMergeableTabs,
  renderMergeTabsList,
  setMergeCandidates
} from './tab-picker.js';
import { wireVolumeAndUrlModalEvents } from './volume-modals.js';
import { wireSettingsIoEvents } from './settings-io.js';

let pendingInitialLoad = null;

function renderFirefoxPermissionBanner() {
  const banner = $('firefox-perm-banner');
  if (!banner) return;
  if (!state.firefoxPermMissing) {
    banner.classList.add('hidden');
    banner.replaceChildren();
    return;
  }
  const textSpan = document.createElement('span');
  textSpan.textContent = `${t('firefoxPermBannerMsg')} `;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn secondary sm';
  btn.textContent = t('firefoxPermGrantBtn');
  btn.addEventListener('click', () => {
    if (!chrome?.permissions?.request) return;
    // Trigger chrome.permissions.request synchronously inside the click handler for Firefox user-gesture compliance
    chrome.permissions
      .request({ origins: ['https://*/*', 'http://*/*'] })
      .then(async (granted) => {
        if (granted) {
          state.firefoxPermMissing = false;
          renderFirefoxPermissionBanner();
          showBanner(t('firefoxPermGrantedMsg'), 'success');
          if (pendingInitialLoad) {
            const { url, sourceTabId } = pendingInitialLoad;
            pendingInitialLoad = null;
            await handleLoadSeries(url, { sourceTabId });
          }
        } else {
          showBanner(t('firefoxPermDeniedMsg'), 'error');
        }
      })
      .catch(() => {
        showBanner(t('firefoxPermDeniedMsg'), 'error');
      });
  });
  banner.replaceChildren(createIcon('info', { size: 17, className: 'banner-icon' }), textSpan, btn);
  banner.classList.remove('hidden');
}

async function checkFirefoxHostPermissions() {
  try {
    const extUrl = typeof chrome !== 'undefined' ? chrome.runtime?.getURL?.('') || '' : '';
    if (!extUrl.startsWith('moz-extension://') || !chrome?.permissions?.contains) {
      return;
    }
    const granted = await chrome.permissions.contains({ origins: ['https://*/*', 'http://*/*'] });
    state.firefoxPermMissing = !granted;
    renderFirefoxPermissionBanner();
  } catch {
    // Ignore when browser permissions API is restricted
  }
}

function applyLanguageChoice(lang) {
  state.options.uiLang = lang === 'en' ? 'en' : 'pt';
  applyI18nToDom(state.options.uiLang);
  renderFirefoxPermissionBanner();
  renderVolumeChips();
  renderChaptersTable();
  renderDomainRules();
  updatePathPreview();
  updatePackButtonLabel();
  updateSaveLocationUi();
  if (state.logs.length === 0) {
    renderLogsOutput();
  }
  if (state.lastReport && !$('export-report').classList.contains('hidden')) {
    renderExportReport(state.lastReport);
  }
  renderLibrary();
  renderCacheSessions();
}

function wireEvents() {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'library') renderCacheSessions();
    });
  }

  const tablist = document.querySelector('.tabs[role="tablist"]');
  if (tablist) {
    tablist.addEventListener('keydown', (e) => {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx !== -1) {
        e.preventDefault();
        const nextTab = tabs[nextIdx];
        switchTab(nextTab.dataset.tab);
        if (nextTab.dataset.tab === 'library') renderCacheSessions();
        nextTab.focus();
      }
    });
  }

  $('load-series-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('starting-url').value.trim();
    if (!url) return;
    if (state.firefoxPermMissing) {
      pendingInitialLoad = { url, sourceTabId: null };
      renderFirefoxPermissionBanner();
      $('firefox-perm-banner')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      $('firefox-perm-banner')?.querySelector('button')?.focus?.();
      showBanner(t('firefoxPermBannerMsg'), 'warn');
      return;
    }
    handleLoadSeries(url);
  });

  $('btn-merge-tabs').addEventListener('click', () => {
    if (state.firefoxPermMissing) {
      renderFirefoxPermissionBanner();
      $('firefox-perm-banner')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      $('firefox-perm-banner')?.querySelector('button')?.focus?.();
      showBanner(t('firefoxPermBannerMsg'), 'warn');
      return;
    }
    handleMergeOpenTabs();
  });
  $('merge-select-all').addEventListener('change', () => {
    const checked = $('merge-select-all').checked;
    for (const item of getMergeCandidates()) item.included = checked;
    renderMergeTabsList();
  });
  $('merge-all-windows').addEventListener('change', async () => {
    const detected = await queryMergeableTabs($('merge-all-windows').checked);
    const prevSelected = new Map(getMergeCandidates().map((m) => [m.url, m]));
    setMergeCandidates(
      detected.map((item) => {
        const old = prevSelected.get(item.url);
        return old
          ? {
              ...item,
              included: old.included,
              title: old.title,
              customVolume: old.customVolume,
              customBookTitle: old.customBookTitle
            }
          : item;
      })
    );
    renderMergeTabsList();
  });
  $('merge-organize-mode').addEventListener('change', renderMergeTabsList);
  $('btn-confirm-merge-tabs').addEventListener('click', applyMergedTabsSelection);
  $('btn-save-library').addEventListener('click', saveCurrentSeriesToLibrary);
  $('btn-save-library-tab').addEventListener('click', saveCurrentSeriesToLibrary);
  $('btn-check-all-library').addEventListener('click', handleCheckAllLibrary);
  $('btn-download-library-updates').addEventListener('click', handleDownloadLibraryUpdates);
  $('opt-library-view-mode').addEventListener('change', async () => {
    state.options.libraryViewMode = $('opt-library-view-mode').value === 'by-site' ? 'by-site' : 'unified';
    await saveOptions();
    renderLibrary();
    await renderCacheSessions();
  });
  $('library-site-filter').addEventListener('change', async () => {
    state.librarySiteFilter = $('library-site-filter').value || 'all';
    renderLibrary();
    await renderCacheSessions();
  });

  $('opt-safe-mode-quick').addEventListener('change', async () => {
    const val = $('opt-safe-mode-quick').checked;
    $('opt-safe-mode').checked = val;
    readOptionsFromUi();
    if (state.running || state.batchRunning) {
      appendLog(
        val
          ? '[SAFE] Modo Seguro ativado em tempo real (1x sequencial, ritmo adaptativo).'
          : '[SAFE] Modo Seguro desativado em tempo real.',
        'info'
      );
    }
    await saveOptions();
  });
  $('opt-safe-mode').addEventListener('change', async () => {
    const val = $('opt-safe-mode').checked;
    $('opt-safe-mode-quick').checked = val;
    readOptionsFromUi();
    if (state.running || state.batchRunning) {
      appendLog(
        val
          ? '[SAFE] Modo Seguro ativado em tempo real (1x sequencial, ritmo adaptativo).'
          : '[SAFE] Modo Seguro desativado em tempo real.',
        'info'
      );
    }
    await saveOptions();
  });

  $('opt-delay').addEventListener('change', () => {
    const val = Math.max(0, Math.min(30000, parseInt($('opt-delay').value, 10) || 0));
    $('opt-delay').value = val;
    if (state.running || state.batchRunning) {
      appendLog(`[CFG] Latência entre capítulos ajustada ao vivo para ${val} ms.`, 'info');
    }
  });

  $('opt-cache-ttl').addEventListener('change', async () => {
    readOptionsFromUi();
    await saveOptions();
    if (state.options.cacheTtlDays <= 0) {
      await cacheStore.clearAll();
      state.chapterCache.clear();
      await renderCacheSessions();
      renderChaptersTable();
    }
  });

  $('btn-clear-all-cache').addEventListener('click', async () => {
    await cacheStore.clearAll();
    state.chapterCache.clear();
    for (const ch of state.chapters) {
      if (ch.status === 'ok') ch.status = 'pending';
    }
    await renderCacheSessions();
    renderChaptersTable();
    showBanner(t('msgCacheCleared'), 'info');
  });

  $('ui-lang-top').addEventListener('change', async () => {
    const newLang = $('ui-lang-top').value;
    applyLanguageChoice(newLang);
    await saveOptions();
  });

  $('ui-theme-top').addEventListener('change', async () => {
    const newTheme = $('ui-theme-top').value;
    state.options.theme = newTheme;
    applyThemeChoice(newTheme);
    await saveOptions();
  });

  $('meta-title').addEventListener('input', () => {
    $('meta-filename').value = sanitizeFilename($('meta-title').value, true);
    updatePathPreview();
  });

  for (const liveId of [
    'meta-author',
    'meta-filename',
    'meta-language',
    'opt-root-folder',
    'opt-folder-template',
    'opt-custom-filename'
  ]) {
    $(liveId).addEventListener('input', updatePathPreview);
  }
  $('opt-folder-layout').addEventListener('change', updatePathPreview);
  $('opt-remove-illegal').addEventListener('change', updatePathPreview);
  $('btn-pick-save-folder').addEventListener('click', handlePickSaveFolder);
  $('btn-use-downloads-folder').addEventListener('click', handleUseDownloadsFolder);

  $('meta-cover-url').addEventListener('input', updateCoverPreview);
  $('meta-cover-url').addEventListener('change', () => {
    const cur = $('meta-cover-url').value.trim();
    if (/^https?:\/\//i.test(cur)) {
      $('meta-cover-url').value = toHighResCoverUrl(cur) || cur;
    }
    updateCoverPreview();
  });
  $('cover-preview').addEventListener('error', () => {
    const failedUrl = $('meta-cover-url').value.trim();
    if (!failedUrl || /^data:/i.test(failedUrl)) return;
    const fallbackCover = generateDefaultCoverDataUrl({
      title: state.metadata.title || $('meta-title').value.trim(),
      author: state.metadata.author || $('meta-author').value.trim()
    });
    if (fallbackCover) {
      $('meta-cover-url').value = fallbackCover;
      state.metadata.coverUrl = fallbackCover;
      state.metadata.coverThumbUrl = fallbackCover;
      updateCoverPreview();
      appendLog(`[IMG] Falha ao carregar capa remota (${failedUrl}) — capa padrão aplicada automaticamente.`, 'debug');
    }
  });
  $('btn-upload-cover').addEventListener('click', () => $('input-upload-cover').click());
  $('input-upload-cover').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await handleUploadCoverFile(file);
      } catch (err) {
        showBanner(err.message, 'error');
      }
    }
    e.target.value = '';
  });
  $('btn-generate-cover').addEventListener('click', handleGenerateCover);
  $('btn-clear-cover').addEventListener('click', () => {
    $('meta-cover-url').value = '';
    state.metadata.coverUrl = '';
    state.metadata.coverThumbUrl = '';
    updateCoverPreview();
  });
  $('btn-reload-cover').addEventListener('click', handleReloadCover);
  $('btn-preview-chapter').addEventListener('click', () => openChapterPreview(-1));
  $('btn-preview-toggle-edit').addEventListener('click', () => {
    setPreviewEditMode(!state.activePreviewEditable);
  });
  $('btn-preview-save-edit').addEventListener('click', handleSavePreviewEdit);
  $('preview-modal').addEventListener('close', () => {
    setPreviewEditMode(false);
    state.activePreviewChapter = null;
  });
  $('btn-merge-chapters').addEventListener('click', openMergeChaptersModal);
  $('btn-confirm-merge-chapters').addEventListener('click', applyMergeSelectedChapters);
  $('opt-cover-jpeg').addEventListener('change', updateCoverPreview);
  const handleReaderPresetChange = async (presetKey) => {
    applyReaderPreset(presetKey);
    if (presetKey !== 'custom') {
      const regenerated = buildEpubStylesheet({
        fontFamily: state.options.fontFamily,
        textAlign: state.options.textAlign,
        lineHeight: state.options.lineHeight,
        paragraphIndent: state.options.paragraphIndent
      });
      $('opt-stylesheet').value = regenerated;
      state.options.stylesheet = regenerated;
    }
    updateCoverPreview();
    await saveOptions();
  };
  $('reader-preset').addEventListener('change', () => handleReaderPresetChange($('reader-preset').value));
  $('adv-reader-preset').addEventListener('change', () => handleReaderPresetChange($('adv-reader-preset').value));

  $('btn-toggle-all-volumes').addEventListener('click', toggleAllVolumesSelection);
  $('btn-filter-clear-vol').addEventListener('click', () => {
    state.volumeFilter = null;
    renderAllChapterViews();
  });

  const applyRangeSelection = () => {
    const a = parseInt($('first-chapter').value, 10);
    const b = parseInt($('last-chapter').value, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    state.chapters.forEach((ch, idx) => {
      ch.included = idx >= min && idx <= max;
    });
    renderAllChapterViews();
  };
  $('first-chapter').addEventListener('change', applyRangeSelection);
  $('last-chapter').addEventListener('change', applyRangeSelection);
  $('chapter-filter').addEventListener('input', renderChaptersTable);

  $('master-checkbox').addEventListener('change', () => {
    const target = $('master-checkbox').checked;
    for (const { ch } of getVisibleChapters()) {
      ch.included = target;
    }
    renderAllChapterViews();
  });

  $('btn-select-all').addEventListener('click', () => {
    state.chapters.forEach((c) => {
      c.included = true;
    });
    renderAllChapterViews();
  });
  $('btn-unselect-all').addEventListener('click', () => {
    state.chapters.forEach((c) => {
      c.included = false;
    });
    renderAllChapterViews();
  });
  $('btn-reverse-order').addEventListener('click', () => {
    if (state.running || state.batchRunning) {
      showBanner(t('msgLoadBlockedExportRunning'), 'error');
      return;
    }
    state.chapters.reverse();
    state.chapters.forEach((ch, idx) => {
      ch.index = idx + 1;
    });
    state.lastClickedIdx = -1;
    state.lastClickedChapState = null;
    state.lastClickedVolIdx = -1;
    state.lastClickedVolState = null;
    populateRangeSelects();
    renderAllChapterViews();
  });
  $('btn-select-failed').addEventListener('click', () => {
    state.chapters.forEach((c) => {
      c.included = c.status === 'error';
    });
    populateRangeSelects();
    renderAllChapterViews();
  });

  $('toggle-show-urls').addEventListener('change', () => {
    state.showUrls = $('toggle-show-urls').checked;
    renderChaptersTable();
  });

  $('btn-copy-urls').addEventListener('click', async () => {
    const urls = state.chapters
      .filter((c) => c.included)
      .map((c) => c.url)
      .join('\n');
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls);
      showBanner(t('msgCopiedUrls', { count: urls.split('\n').length }), 'success');
    } catch (err) {
      showBanner(err?.message || 'Clipboard error', 'error');
    }
  });

  $('btn-pack-epub').addEventListener('click', handlePackEpub);
  $('btn-retry-failed').addEventListener('click', handlePackEpub);
  $('btn-pause').addEventListener('click', () => {
    if (!state.running && !state.batchRunning) return;
    state.paused = !state.paused;
    $('btn-pause').textContent = state.paused ? t('btnResume') : t('btnPause');
    if (state.paused) {
      const curLabel = $('progress-label').textContent;
      if (curLabel && curLabel !== t('progressPaused')) {
        state._prePauseProgressLabel = curLabel;
      }
      $('progress-label').textContent = t('progressPaused');
    } else {
      clearSpaDomainCircuit();
      if ($('progress-label').textContent === t('progressPaused') && state._prePauseProgressLabel) {
        $('progress-label').textContent = state._prePauseProgressLabel;
        state._prePauseProgressLabel = '';
      }
    }
  });
  const cancelDialog = $('confirm-cancel-modal');
  $('btn-cancel').addEventListener('click', () => {
    if (!state.running && !state.batchRunning) return;
    cancelDialog.showModal();
  });
  $('btn-confirm-cancel-run').addEventListener('click', () => {
    cancelDialog.close('confirm');
    if (state.running || state.batchRunning) state.abortController?.abort();
  });

  // Warn before closing/reloading the tab while an export is running (Chrome and Firefox)
  window.addEventListener('beforeunload', (e) => {
    if (!state.running && !state.batchRunning) return;
    e.preventDefault();
    e.returnValue = '';
  });

  wireVolumeAndUrlModalEvents();
  wireSettingsIoEvents({ applyLanguageChoice });

  for (const filterBtn of document.querySelectorAll('.log-filter-btn')) {
    filterBtn.addEventListener('click', () => {
      setLogFilter(filterBtn.dataset.logFilter || 'all');
    });
  }
  $('btn-copy-logs').addEventListener('click', async () => {
    if (state.logs.length === 0) return;
    try {
      await navigator.clipboard.writeText(formatLogsPlainText());
      showBanner(t('msgLogsCopied'), 'success');
    } catch (err) {
      showBanner(err?.message || 'Clipboard error', 'error');
    }
  });
  $('btn-clear-logs').addEventListener('click', () => {
    state.logs = [];
    $('log-output').textContent = t('logsCleared');
    updateLogBadges();
  });
  $('btn-download-logs').addEventListener('click', async () => {
    const blob = new Blob([formatLogsPlainText()], { type: 'text/plain;charset=utf-8' });
    try {
      await downloadBlobToChrome(blob, 'webpullbook-log.txt');
    } catch (err) {
      if (!/cancel/i.test(err?.message || '')) {
        showBanner(err?.message || 'Download error', 'error');
      }
    }
  });

  // Backdrop click-outside dismiss fallback for browsers without native dialog closedby="any" (e.g. Firefox < 141)
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog || !dialog.open) return;
      const rect = dialog.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        dialog.close();
      }
    });
  }

  const extUrl = typeof chrome !== 'undefined' ? chrome.runtime?.getURL?.('') || '' : '';
  if (extUrl.startsWith('moz-extension://') && chrome?.permissions) {
    chrome.permissions.onAdded?.addListener(() => {
      checkFirefoxHostPermissions();
    });
    chrome.permissions.onRemoved?.addListener(() => {
      checkFirefoxHostPermissions();
    });
  }

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.wpbLibrary?.newValue) {
        state.library = changes.wpbLibrary.newValue;
        renderLibrary();
        renderCacheSessions();
      }
      if (changes.wpbDomainRules?.newValue) {
        state.domainRules = sanitizeDomainRules(changes.wpbDomainRules.newValue);
        renderDomainRules();
      }
    });
  }

  window.addEventListener('storage', (e) => {
    if (e.key === 'wpb-color-scheme') {
      applyThemeChoice(e.newValue || 'system');
    }
  });

  const darkSchemeMq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (darkSchemeMq) {
    darkSchemeMq.addEventListener('change', () => {
      if (state.options.theme === 'system') {
        applyThemeChoice('system');
      }
    });
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get('url');
  const rawSourceTabId = params.get('sourceTabId');
  const parsedTabId = rawSourceTabId && /^\d+$/.test(rawSourceTabId) ? parseInt(rawSourceTabId, 10) : null;
  const hasInitialUrl = Boolean(initialUrl && /^https?:\/\//i.test(initialUrl));
  if (hasInitialUrl) {
    setLoadingOverlay(true, initialUrl);
  }

  try {
    state.onCacheChanged = renderCacheSessions;
    state.onLibraryUpdateAfterExport = updateLibraryAfterExport;
    state.onOpenChapterPreview = openChapterPreview;

    populateRegistries();
    applyStaticIcons();
    await loadOptions(applyLanguageChoice);
    await checkFirefoxHostPermissions();
    await loadDomainRules();
    await cacheStore.pruneExpired();
    await loadLibrary(renderLibrary);
    await renderCacheSessions();
    wireEvents();

    if (hasInitialUrl) {
      $('starting-url').value = initialUrl;
      if (state.firefoxPermMissing) {
        pendingInitialLoad = { url: initialUrl, sourceTabId: parsedTabId };
        appendLog('[PERM] Aguardando permissão de acesso em sites no Firefox antes de carregar URL inicial.', 'info');
      } else {
        await handleLoadSeries(initialUrl, { sourceTabId: parsedTabId });
      }
    }
  } finally {
    setLoadingOverlay(false);
  }
}

init();
