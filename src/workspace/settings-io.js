import { buildEpubStylesheet } from '../core/parser-engine.js';
import { $, DEFAULT_OPTIONS, state, t } from './state.js';
import { showBanner } from './logger.js';
import {
  applyThemeChoice,
  readOptionsFromUi,
  saveOptions,
  stripSiteScopedOptions,
  syncOptionsToUi,
  updatePackButtonLabel,
  updateTypographyPreview
} from './options-storage.js';
import {
  clearSavedDirectoryHandle,
  updatePathPreview,
  updateSaveLocationUi
} from './directory-handle.js';
import { handleSaveDomainRule, saveDomainRules } from './domain-rules-ui.js';
import { handleAutoDetectSelectors } from './series-loader.js';
import { downloadBlobToChrome } from './download-storage.js';
import { handleStartSelectorPicker, registerPickerMessageListener } from './tab-picker.js';

export function wireSettingsIoEvents({ applyLanguageChoice }) {
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
    if (typoIds.includes(el.id) || el.id === 'opt-safe-mode' || el.id === 'adv-reader-preset' || el.type === 'file') {
      continue;
    }
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
        'infoPageTitle',
        'infoShowTitle',
        'infoShowAuthor',
        'infoShowGenres',
        'infoShowSource',
        'infoShowSynopsis',
        'includeTocPage',
        'tocTitle',
        'addEndPage',
        'endPageTitle',
        'endPageMessage',
        'endShowSummary',
        'endShowSource',
        'endShowGenerator',
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
      options: stripSiteScopedOptions(state.options),
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
      state.options = {
        ...DEFAULT_OPTIONS,
        ...stripSiteScopedOptions(importedOpts),
        grayscaleImages: false
      };
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
}
