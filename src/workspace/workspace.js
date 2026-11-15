import {
  buildEpubStylesheet,
  normalizeSpaces,
  sanitizeFilename,
  toHighResCoverUrl
} from '../core/parser-engine.js';
import { cacheStore } from '../core/cache-store.js';
import { applyI18nToDom } from './i18n.js';
import {
  DEFAULT_OPTIONS,
  $,
  getCacheKey,
  state,
  switchTab,
  t
} from './state.js';
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
  clearSavedDirectoryHandle,
  handleSaveDomainRule,
  loadDomainRules,
  loadLibrary,
  loadOptions,
  populateRegistries,
  readOptionsFromUi,
  renderDomainRules,
  saveDomainRules,
  saveOptions,
  syncOptionsToUi,
  updateCoverPreview,
  updatePackButtonLabel,
  updatePathPreview,
  updateSaveLocationUi,
  updateTypographyPreview
} from './options-storage.js';
import {
  applyMergeSelectedChapters,
  getVisibleChapters,
  handleGenerateCover,
  handleRedetectVolumes,
  handleSavePreviewEdit,
  handleUploadCoverFile,
  openChapterPreview,
  openMergeChaptersModal,
  populateRangeSelects,
  renderAllChapterViews,
  renderChaptersTable,
  renderVolumeChips,
  setPreviewEditMode
} from './chapters-ui.js';
import { handleAutoDetectSelectors, handleLoadSeries } from './series-loader.js';
import {
  downloadBlobToChrome,
  handlePackEpub,
  handlePickSaveFolder,
  handleUseDownloadsFolder
} from './export-runner.js';
import {
  handleCheckAllLibrary,
  handleDownloadLibraryUpdates,
  renderCacheSessions,
  renderLibrary,
  saveCurrentSeriesToLibrary,
  updateLibraryAfterExport
} from './library-ui.js';
import {
  applyMergedTabsSelection,
  getMergeCandidates,
  handleMergeOpenTabs,
  handleStartSelectorPicker,
  queryMergeableTabs,
  registerPickerMessageListener,
  renderMergeTabsList,
  setMergeCandidates
} from './tab-picker.js';

function applyLanguageChoice(lang) {
  state.options.uiLang = lang === 'en' ? 'en' : 'pt';
  applyI18nToDom(state.options.uiLang);
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
    if (url) handleLoadSeries(url);
  });

  $('btn-merge-tabs').addEventListener('click', handleMergeOpenTabs);
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

  $('opt-safe-mode-quick').addEventListener('change', async () => {
    const val = $('opt-safe-mode-quick').checked;
    $('opt-safe-mode').checked = val;
    readOptionsFromUi();
    await saveOptions();
  });
  $('opt-safe-mode').addEventListener('change', async () => {
    const val = $('opt-safe-mode').checked;
    $('opt-safe-mode-quick').checked = val;
    readOptionsFromUi({ markCustom: true });
    await saveOptions();
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
  $('meta-cover-url').addEventListener('change', updateCoverPreview);
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
  $('btn-hires-cover').addEventListener('click', () => {
    const cur = $('meta-cover-url').value.trim();
    if (cur) {
      $('meta-cover-url').value = toHighResCoverUrl(cur);
      updateCoverPreview();
    }
  });
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
    const regenerated = buildEpubStylesheet({
      fontFamily: state.options.fontFamily,
      textAlign: state.options.textAlign,
      lineHeight: state.options.lineHeight,
      paragraphIndent: state.options.paragraphIndent
    });
    $('opt-stylesheet').value = regenerated;
    state.options.stylesheet = regenerated;
    updateCoverPreview();
    await saveOptions();
  };
  $('reader-preset').addEventListener('change', () => handleReaderPresetChange($('reader-preset').value));
  $('adv-reader-preset').addEventListener('change', () => handleReaderPresetChange($('adv-reader-preset').value));

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
    state.chapters.reverse();
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
    await navigator.clipboard.writeText(urls);
    showBanner(t('msgCopiedUrls', { count: urls.split('\n').length }), 'success');
  });

  $('btn-pack-epub').addEventListener('click', handlePackEpub);
  $('btn-retry-failed').addEventListener('click', handlePackEpub);
  $('btn-pause').addEventListener('click', () => {
    if (!state.running && !state.batchRunning) return;
    state.paused = !state.paused;
    $('btn-pause').textContent = state.paused ? t('btnResume') : t('btnPause');
    if (state.paused) {
      state._prePauseProgressLabel = $('progress-label').textContent;
      $('progress-label').textContent = t('progressPaused');
    } else if ($('progress-label').textContent === t('progressPaused') && state._prePauseProgressLabel) {
      $('progress-label').textContent = state._prePauseProgressLabel;
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

  const volDialog = $('volume-modal');
  $('btn-redetect-volumes').addEventListener('click', handleRedetectVolumes);
  $('btn-open-volume-modal').addEventListener('click', () => {
    if (state.chapters.length) {
      $('vol-range-to').value = String(Math.min(25, state.chapters.length));
    }
    volDialog.showModal();
  });
  volDialog.addEventListener('close', () => {
    volDialog.returnValue = '';
  });

  $('btn-apply-chunk-vols').addEventListener('click', () => {
    const size = Math.max(1, parseInt($('vol-chunk-size').value, 10) || 25);
    const startNum = Math.max(1, parseInt($('vol-chunk-start').value, 10) || 1);
    state.chapters.forEach((ch, idx) => {
      const volNum = startNum + Math.floor(idx / size);
      ch.volume = `Volume ${String(volNum).padStart(2, '0')}`;
    });
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(`Volumes: ${size} caps/vol.`, 'success');
  });

  $('btn-apply-range-vol').addEventListener('click', () => {
    const from = Math.max(1, parseInt($('vol-range-from').value, 10) || 1) - 1;
    const to = Math.min(state.chapters.length, parseInt($('vol-range-to').value, 10) || state.chapters.length) - 1;
    const name = $('vol-range-name').value.trim() || 'Volume 01';
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      if (state.chapters[i]) state.chapters[i].volume = name;
    }
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(`${name}`, 'success');
  });

  $('btn-apply-selected-vol').addEventListener('click', () => {
    const name = $('vol-selected-name').value.trim() || 'Volume 01';
    let count = 0;
    for (const ch of state.chapters) {
      if (ch.included) {
        ch.volume = name;
        count++;
      }
    }
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(`${count} -> "${name}".`, 'success');
  });

  $('btn-apply-batch-vols').addEventListener('click', () => {
    const lines = $('vol-batch-rules').value.split('\n');
    let applied = 0;
    for (const line of lines) {
      const m = line.match(/^\s*(\d+)\s*-\s*(\d+)\s*:\s*(.+)$/);
      if (!m) continue;
      const a = Math.max(1, parseInt(m[1], 10)) - 1;
      const b = Math.min(state.chapters.length, parseInt(m[2], 10)) - 1;
      const name = normalizeSpaces(m[3]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
        if (state.chapters[i]) {
          state.chapters[i].volume = name;
          applied++;
        }
      }
    }
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(`Batch: ${applied}`, 'success');
  });

  const editDialog = $('edit-urls-modal');
  $('btn-edit-urls').addEventListener('click', () => {
    $('edit-urls-textarea').value = state.chapters
      .map((c) => `${c.url} | ${c.displayTitle} | ${c.volume}`)
      .join('\n');
    editDialog.showModal();
  });
  editDialog.addEventListener('close', () => {
    if (editDialog.returnValue === 'save') {
      const lines = $('edit-urls-textarea')
        .value.split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      state.chapters = lines.map((line, i) => {
        const parts = line.split('|').map((s) => s.trim());
        const url = parts[0];
        const displayTitle = parts[1] || url;
        const volume = parts[2] || 'Volume 01';
        return {
          id: `ch_${i + 1}`,
          index: i + 1,
          url,
          numText: '',
          titleText: displayTitle,
          dateText: '',
          displayTitle,
          volume,
          included: true,
          status: state.chapterCache.has(getCacheKey(url)) ? 'ok' : 'pending',
          errorMsg: ''
        };
      });
      populateRangeSelects();
      renderAllChapterViews();
      showBanner(`${state.chapters.length} caps.`, 'success');
    }
    editDialog.returnValue = '';
  });

  $('output-format').addEventListener('change', async () => {
    readOptionsFromUi();
    updatePackButtonLabel();
    await saveOptions();
  });

  const typoIds = ['opt-font-family', 'opt-text-align', 'opt-line-height', 'opt-paragraph-indent'];
  for (const tid of typoIds) {
    $(tid).addEventListener('change', async () => {
      readOptionsFromUi({ markCustom: true });
      const regenerated = buildEpubStylesheet({
        fontFamily: state.options.fontFamily,
        textAlign: state.options.textAlign,
        lineHeight: state.options.lineHeight,
        paragraphIndent: state.options.paragraphIndent
      });
      $('opt-stylesheet').value = regenerated;
      state.options.stylesheet = regenerated;
      updateTypographyPreview();
      await saveOptions();
    });
  }

  const advInputs = document.querySelectorAll('#tab-advanced input, #tab-advanced select, #tab-advanced textarea');
  for (const el of advInputs) {
    if (typoIds.includes(el.id) || el.id === 'opt-safe-mode' || el.id === 'adv-reader-preset' || el.type === 'file') continue;
    el.addEventListener('change', async () => {
      readOptionsFromUi({ markCustom: true });
      await saveOptions();
    });
  }

  const confirmResetDialog = $('confirm-reset-modal');
  let pendingResetAction = null;

  const openConfirmResetModal = ({ title, desc, confirmLabel, onConfirm }) => {
    $('confirm-reset-title').textContent = title;
    $('confirm-reset-desc').textContent = desc;
    $('btn-confirm-reset-all').textContent = confirmLabel;
    pendingResetAction = onConfirm;
    confirmResetDialog.showModal();
  };

  const resetOptionSection = (sectionHeadingKey, keys, afterReset) => {
    const sectionName = t(sectionHeadingKey);
    openConfirmResetModal({
      title: t('modalResetSectionTitle', { section: sectionName }),
      desc: t('modalResetSectionDesc', { section: sectionName }),
      confirmLabel: t('btnConfirmResetSection'),
      onConfirm: () => {
        for (const key of keys) {
          state.options[key] = DEFAULT_OPTIONS[key];
        }
        const tail = afterReset ? afterReset() : null;
        syncOptionsToUi();
        showBanner(t('msgSectionReset', { section: sectionName }), 'info');
        confirmResetDialog.close('confirm');
        Promise.resolve(tail).then(() => saveOptions());
      }
    });
  };

  $('btn-reset-files').addEventListener('click', () =>
    resetOptionSection(
      'advFilesHeading',
      [
        'saveTargetMode',
        'customDirName',
        'rootFolderName',
        'folderLayout',
        'customFolderTemplate',
        'customFilename',
        'maxChaptersPerEpub',
        'noSaveAs',
        'removeIllegal',
        'createEpub3',
        'popupFootnotes',
        'addInfoPage',
        'removeNavLinks'
      ],
      async () => {
        await clearSavedDirectoryHandle();
        updateSaveLocationUi();
        updatePathPreview();
      }
    )
  );

  $('btn-reset-extraction').addEventListener('click', () =>
    resetOptionSection('advExtractionHeading', [
      'parserId',
      'customListSelector',
      'customContentSelector',
      'customExcludeSelector',
      'customStripPatterns',
      'crawlNextLinks'
    ])
  );

  $('btn-reset-network').addEventListener('click', () =>
    resetOptionSection('advNetworkOnlyHeading', [
      'delayMs',
      'concurrency',
      'maxRetries',
      'safeRpm',
      'safeBatchSize',
      'renderWaitMs',
      'safeMode',
      'autoPauseOnRateLimit',
      'continueOnError',
      'skip404',
      'renderWithTab',
      'autoFallbackTab',
      'preferOpenTabDom'
    ])
  );

  $('btn-reset-images').addEventListener('click', () =>
    resetOptionSection('advImagesHeading', [
      'compressedResolution',
      'compressedFormat',
      'imageQuality',
      'restrictCoverJpeg',
      'compressImages',
      'skipImages',
      'useSvgForImages'
    ])
  );

  $('btn-reset-css').addEventListener('click', () =>
    resetOptionSection(
      'advTypoHeading',
      ['fontFamily', 'textAlign', 'lineHeight', 'paragraphIndent', 'stylesheet'],
      updateTypographyPreview
    )
  );

  $('btn-auto-detect-selectors').addEventListener('click', () => handleAutoDetectSelectors());
  $('btn-pick-list-selector').addEventListener('click', () => handleStartSelectorPicker('list'));
  $('btn-pick-content-selector').addEventListener('click', () => handleStartSelectorPicker('content'));
  $('btn-pick-exclude-selector').addEventListener('click', () => handleStartSelectorPicker('exclude'));
  registerPickerMessageListener();

  $('btn-save-domain-rule').addEventListener('click', () => handleSaveDomainRule());

  $('btn-export-opts').addEventListener('click', () => {
    readOptionsFromUi();
    const bundle = {
      options: state.options,
      domainRules: state.domainRules
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    downloadBlobToChrome(blob, 'webpullbook-options.json');
  });

  $('input-import-opts').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const importedOpts = parsed?.options && typeof parsed.options === 'object' ? parsed.options : parsed;
      state.options = { ...DEFAULT_OPTIONS, ...importedOpts, grayscaleImages: false };
      if (parsed?.domainRules && typeof parsed.domainRules === 'object') {
        state.domainRules = { ...state.domainRules, ...parsed.domainRules };
        await saveDomainRules();
      }
      syncOptionsToUi();
      applyThemeChoice(state.options.theme);
      applyLanguageChoice(state.options.uiLang);
      await saveOptions();
      showBanner('OK', 'success');
    } catch (err) {
      showBanner(`JSON Error: ${err.message}`, 'error');
    }
    e.target.value = '';
  });

  $('btn-reset-all-opts').addEventListener('click', () => {
    openConfirmResetModal({
      title: t('modalResetTitle'),
      desc: t('modalResetDesc'),
      confirmLabel: t('btnConfirmResetAll'),
      onConfirm: () => {
        state.customDirHandle = null;
        state.customDirPermission = 'none';
        state.options = {
          ...DEFAULT_OPTIONS,
          uiLang: state.options.uiLang,
          theme: state.options.theme,
          cacheTtlDays: state.options.cacheTtlDays
        };
        syncOptionsToUi();
        showBanner(t('msgOptionsReset'), 'info');
        confirmResetDialog.close('confirm');
        clearSavedDirectoryHandle().then(() => saveOptions());
      }
    });
  });

  $('btn-confirm-reset-all').addEventListener('click', async () => {
    const action = pendingResetAction;
    pendingResetAction = null;
    if (action) await action();
    if (confirmResetDialog.open) {
      confirmResetDialog.close('confirm');
    }
  });

  for (const filterBtn of document.querySelectorAll('.log-filter-btn')) {
    filterBtn.addEventListener('click', () => {
      setLogFilter(filterBtn.dataset.logFilter || 'all');
    });
  }
  $('btn-copy-logs').addEventListener('click', async () => {
    if (state.logs.length === 0) return;
    await navigator.clipboard.writeText(formatLogsPlainText());
    showBanner(t('msgLogsCopied'), 'success');
  });
  $('btn-clear-logs').addEventListener('click', () => {
    state.logs = [];
    $('log-output').textContent = t('logsCleared');
    updateLogBadges();
  });
  $('btn-download-logs').addEventListener('click', () => {
    const blob = new Blob([formatLogsPlainText()], { type: 'text/plain;charset=utf-8' });
    downloadBlobToChrome(blob, 'webpullbook-log.txt');
  });

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.wpbLibrary?.newValue) {
        state.library = changes.wpbLibrary.newValue;
        renderLibrary();
        renderCacheSessions();
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
  state.onCacheChanged = renderCacheSessions;
  state.onLibraryUpdateAfterExport = updateLibraryAfterExport;

  populateRegistries();
  await loadOptions(applyLanguageChoice);
  await loadDomainRules();
  await cacheStore.pruneExpired();
  await loadLibrary(renderLibrary);
  await renderCacheSessions();
  wireEvents();

  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get('url');
  if (initialUrl && /^https?:\/\//i.test(initialUrl)) {
    $('starting-url').value = initialUrl;
    await handleLoadSeries(initialUrl);
  }
}

init();
