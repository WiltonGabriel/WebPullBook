import { fetchDocumentWithOptions, sanitizeFilename } from '../core/parser-engine.js';
import { loadSeriesWithParser } from '../parsers/index.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import { $, normalizeRuleDomain, state, t } from './state.js';
import { appendLog, hideBanner, showBanner } from './logger.js';
import { readOptionsFromUi, saveOptions, syncMetadataToUi } from './options-storage.js';
import { applyDomainRuleForUrl } from './domain-rules-ui.js';
import { getVolumeGroups, hydrateChaptersFromCache, populateRangeSelects, renderAllChapterViews } from './chapters-ui.js';

export function setLoadingOverlay(visible, detailText = '') {
  const overlay = $('loading-overlay');
  if (!visible) {
    delete document.documentElement.dataset.initialLoading;
  }
  if (!overlay) return;
  const titleEl = $('loading-overlay-title');
  const detailEl = $('loading-overlay-detail');
  if (visible) {
    if (titleEl) titleEl.textContent = t('loadingOverlayTitle');
    if (detailEl) detailEl.textContent = detailText || t('loadingOverlayDetail');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-busy', 'true');
  } else {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-busy', 'false');
  }
}

export async function handleLoadSeries(url, { sourceTabId = null } = {}) {
  hideBanner();
  setLoadingOverlay(true, url);
  const loadStartedAt = Date.now();
  const currentDomain = normalizeRuleDomain(url);
  if (state.autoFilledSelectors && state.autoFilledSelectors.domain !== currentDomain) {
    const prevAuto = state.autoFilledSelectors;
    if ($('opt-list-selector').value === prevAuto.listSelector) $('opt-list-selector').value = '';
    if ($('opt-content-selector').value === prevAuto.contentSelector) $('opt-content-selector').value = '';
    if ($('opt-exclude-selector').value === prevAuto.excludeSelector) $('opt-exclude-selector').value = '';
    state.autoFilledSelectors = null;
  }

  applyDomainRuleForUrl(url);
  readOptionsFromUi();
  const btn = $('btn-load-series');
  btn.disabled = true;
  btn.textContent = t('btnLoadingSeries');
  const extVer = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '';
  appendLog(
    `[LOAD] Carregando URL: ${url} | WebPullBook v${extVer || 'dev'} | parser=${state.options.parserId}, spa=${state.options.renderWithTab}`,
    'info'
  );

  try {
    const { parser, series, initialDoc, usedAutoSpa } = await loadSeriesWithParser(url, {
      ...state.options,
      sourceTabId,
      onLog: appendLog
    });
    state.activeParser = parser;
    state.seriesRequiresTab = Boolean(series.requiresTabRender || usedAutoSpa);
    state.pageDomCache.clear();
    if (initialDoc) {
      state.pageDomCache.set(url, initialDoc);
    }

    if (usedAutoSpa && !state.options.renderWithTab) {
      appendLog(
        '[SPA] Captura via aba usada automaticamente apenas para esta obra (opção global de Modo SPA preservada).',
        'info'
      );
    }

    if (parser.id === 'generic-html' && !state.appliedRuleDomain && initialDoc) {
      const needList = !$('opt-list-selector').value.trim();
      const needContent = !$('opt-content-selector').value.trim();
      const needExclude = !$('opt-exclude-selector').value.trim();
      if (needList || needContent || needExclude) {
        let sampleChapterDoc = null;
        const sampleUrl = series.chapters?.[0]?.url || '';
        if (needContent && sampleUrl && sampleUrl !== url && /^https?:\/\//i.test(sampleUrl)) {
          try {
            sampleChapterDoc = await fetchDocumentWithOptions(sampleUrl, {
              renderWithTab: Boolean(series.requiresTabRender || state.options.renderWithTab),
              onLog: appendLog
            });
          } catch {
            sampleChapterDoc = null;
          }
        } else if (series.chapters.length <= 1) {
          sampleChapterDoc = initialDoc;
        }

        const scan = genericHtmlParser.suggestSelectors({
          indexDoc: initialDoc,
          chapterDoc: sampleChapterDoc,
          targetUrl: url
        });
        const filled = {
          domain: currentDomain,
          listSelector: '',
          contentSelector: '',
          excludeSelector: ''
        };
        let changed = false;
        if (needList && scan.listSelector && scan.listCount >= 2) {
          $('opt-list-selector').value = scan.listSelector;
          filled.listSelector = scan.listSelector;
          changed = true;
        }
        if (needContent && scan.contentSelector && scan.contentChars >= 80) {
          $('opt-content-selector').value = scan.contentSelector;
          filled.contentSelector = scan.contentSelector;
          changed = true;
        }
        if (needExclude && scan.excludeSelector) {
          $('opt-exclude-selector').value = scan.excludeSelector;
          filled.excludeSelector = scan.excludeSelector;
          changed = true;
        }
        if (changed) {
          state.autoFilledSelectors = filled;
          readOptionsFromUi();
          appendLog(
            `[AUTO] Seletores detectados: list="${filled.listSelector || '-'}", content="${filled.contentSelector || '-'}", exclude="${filled.excludeSelector || '-'}"`,
            'debug'
          );
        }
      }
    }

    state.metadata = {
      ...series,
      filename: sanitizeFilename(series.title, true)
    };
    state.chapters = await hydrateChaptersFromCache(series.chapters);
    state.volumeFilter = null;
    state.lastClickedIdx = -1;

    const vols = getVolumeGroups().length;
    const modeRadio = document.querySelector(`input[name="pack-mode"][value="${vols > 1 ? 'by-volume' : 'single'}"]`);
    if (modeRadio) modeRadio.checked = true;

    syncMetadataToUi();
    populateRangeSelects();
    renderAllChapterViews();

    const loadMs = Date.now() - loadStartedAt;
    appendLog(
      `Obra carregada (${parser.name}) em ${loadMs}ms: "${series.title}" | Autor: ${series.author} | ${series.chapters.length} capítulos em ${vols} volume(s).`
    );
    if (series.chapters.length === 0) {
      appendLog(
        `Aviso: nenhum capítulo localizado em ${url}. Tente Modo SPA ou 🎯 Apontar nas Opções Avançadas.`,
        'warn'
      );
      showBanner(t('msgLoadedZero'), 'info');
    } else {
      showBanner(
        t('msgLoadedSuccess', {
          parser: parser.name,
          count: series.chapters.length,
          vols
        }),
        'success'
      );
    }
  } catch (err) {
    appendLog(`ERRO ao carregar obra (${url}): ${err.message}`, 'error');
    showBanner(
      t('msgLoadError', { error: err.message }),
      'error',
      err.isAntiBotChallenge ? { label: t('btnOpenVerifyPage'), url } : null
    );
  } finally {
    setLoadingOverlay(false);
    btn.disabled = false;
    btn.textContent = t('btnLoadSeries');
  }
}

export async function handleAutoDetectSelectors() {
  const url = $('starting-url').value.trim();
  if (!url) {
    showBanner(t('msgAutoDetectNoUrl'), 'error');
    return;
  }

  readOptionsFromUi();
  const btn = $('btn-auto-detect-selectors');
  btn.disabled = true;
  btn.textContent = t('btnAutoDetectingSelectors');

  try {
    let indexDoc = await fetchDocumentWithOptions(url, {
      renderWithTab: state.options.renderWithTab,
      onLog: appendLog
    });
    let scan = genericHtmlParser.suggestSelectors({ indexDoc, targetUrl: url });
    if (scan.listCount === 0 && !state.options.renderWithTab) {
      try {
        const renderedDoc = await fetchDocumentWithOptions(url, { renderWithTab: true, onLog: appendLog });
        const renderedScan = genericHtmlParser.suggestSelectors({ indexDoc: renderedDoc, targetUrl: url });
        if (renderedScan.listCount > 0) {
          indexDoc = renderedDoc;
          scan = renderedScan;
        }
      } catch {
        // Keep static result if SPA fallback is unavailable
      }
    }

    const sampleUrl = state.chapters?.[0]?.url || scan.sampleChapterUrl || '';
    let chapterDoc = null;
    if (sampleUrl && sampleUrl !== url) {
      try {
        chapterDoc = await fetchDocumentWithOptions(sampleUrl, {
          renderWithTab: state.options.renderWithTab,
          onLog: appendLog
        });
      } catch {
        chapterDoc = null;
      }
    } else if (!scan.listSelector) {
      chapterDoc = indexDoc;
    }

    const fullScan = genericHtmlParser.suggestSelectors({
      indexDoc,
      chapterDoc,
      targetUrl: url
    });

    if (fullScan.listSelector) $('opt-list-selector').value = fullScan.listSelector;
    if (fullScan.contentSelector) $('opt-content-selector').value = fullScan.contentSelector;
    if (fullScan.excludeSelector && !$('opt-exclude-selector').value.trim()) {
      $('opt-exclude-selector').value = fullScan.excludeSelector;
    }

    readOptionsFromUi();
    await saveOptions();
    appendLog(
      `[AUTO] Heurística manual: list="${fullScan.listSelector || '-'}" (${fullScan.listCount}), content="${fullScan.contentSelector || '-'}" (${fullScan.contentChars} chars), exclude="${fullScan.excludeSelector || '-'}"`
    );
    showBanner(
      t('msgAutoDetectResult', {
        listCount: fullScan.listCount,
        contentChars: fullScan.contentChars
      }),
      fullScan.listCount > 0 || fullScan.contentChars > 0 ? 'success' : 'info'
    );
  } catch (err) {
    appendLog(`ERRO na heurística: ${err.message}`, 'error');
    showBanner(t('msgAutoDetectFailed', { error: err.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnAutoDetectSelectors');
  }
}
