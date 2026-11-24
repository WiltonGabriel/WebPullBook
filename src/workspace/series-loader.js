import {
  downloadAndParseChapter,
  fetchDocumentWithOptions,
  normalizeSpaces,
  normalizeUrl,
  resolveSafeHttpUrl,
  sanitizeFilename
} from '../core/parser-engine.js';
import { loadSeriesWithParser, parserRegistry, resolveParserForChapterUrl } from '../parsers/index.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import { setButtonLabel } from './icons.js';
import { $, normalizeRuleDomain, state, t } from './state.js';
import { appendLog, hideBanner, showBanner } from './logger.js';
import { readOptionsFromUi, saveOptions, syncMetadataToUi } from './options-storage.js';
import { applyDomainRuleForUrl } from './domain-rules-ui.js';
import { getVolumeGroups, hydrateChaptersFromCache, populateRangeSelects, renderAllChapterViews } from './chapters-ui.js';
import { generateDefaultCoverDataUrl } from './cover-ui.js';

let currentLoadSeq = 0;

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

export async function handleLoadSeries(url, { sourceTabId = null, allowDuringBatch = false } = {}) {
  if (state.running || (state.batchRunning && !allowDuringBatch)) {
    showBanner(t('msgLoadBlockedExportRunning'), 'error');
    return;
  }
  const loadSeq = ++currentLoadSeq;
  hideBanner();
  setLoadingOverlay(true, url);
  const loadStartedAt = Date.now();
  const currentDomain = normalizeRuleDomain(url);
  if (!state.metadata?.startingUrl || normalizeUrl(state.metadata.startingUrl) !== normalizeUrl(url)) {
    state.seriesRequiresTab = false;
  }
  if (state.lastLoadedDomain && currentDomain && state.lastLoadedDomain !== currentDomain) {
    $('opt-list-selector').value = '';
    $('opt-content-selector').value = '';
    $('opt-exclude-selector').value = '';
    $('opt-strip-regex').value = '';
    state.autoFilledSelectors = null;
    state.appliedRuleDomain = '';
  } else if (state.autoFilledSelectors && state.autoFilledSelectors.domain !== currentDomain) {
    const prevAuto = state.autoFilledSelectors;
    if ($('opt-list-selector').value === prevAuto.listSelector) $('opt-list-selector').value = '';
    if ($('opt-content-selector').value === prevAuto.contentSelector) $('opt-content-selector').value = '';
    if ($('opt-exclude-selector').value === prevAuto.excludeSelector) $('opt-exclude-selector').value = '';
    state.autoFilledSelectors = null;
  }
  if (currentDomain) {
    state.lastLoadedDomain = currentDomain;
  }

  applyDomainRuleForUrl(url);
  readOptionsFromUi();
  const initialUseTab = Boolean(state.options.renderWithTab || state.seriesRequiresTab);
  const btn = $('btn-load-series');
  btn.disabled = true;
  setButtonLabel(btn, t('btnLoadingSeries'));
  const extVer = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '';
  const customSelNote = state.options.customListSelector ? `, listSelector="${state.options.customListSelector}"` : '';
  appendLog(
    `[LOAD] Carregando URL: ${url} | WebPullBook v${extVer || 'dev'} | parser=${state.options.parserId}, spa=${initialUseTab}${customSelNote}`,
    'info'
  );

  try {
    const { parser, series, initialDoc, usedAutoSpa } = await loadSeriesWithParser(url, {
      ...state.options,
      renderWithTab: initialUseTab,
      sourceTabId,
      onLog: appendLog
    });
    if (loadSeq !== currentLoadSeq) return;

    state.activeParser = parser;
    const domainRuleTab = Boolean(
      state.appliedRuleDomain &&
        Object.hasOwn(state.domainRules || {}, state.appliedRuleDomain) &&
        state.domainRules[state.appliedRuleDomain]?.renderWithTab
    );
    state.seriesRequiresTab = Boolean(series.requiresTabRender || usedAutoSpa || domainRuleTab);
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
              renderWithTab: Boolean(series.requiresTabRender || state.seriesRequiresTab || state.options.renderWithTab),
              onLog: appendLog
            });
          } catch {
            sampleChapterDoc = null;
          }
          if (loadSeq !== currentLoadSeq) return;
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

    const resolvedCoverUrl =
      series.coverUrl ||
      series.coverThumbUrl ||
      generateDefaultCoverDataUrl({ title: series.title, author: series.author });
    if (!series.coverUrl && !series.coverThumbUrl && resolvedCoverUrl) {
      appendLog('[IMG] Capa original não detectada na página — capa padrão aplicada automaticamente.', 'debug');
    }

    const hydratedChapters = await hydrateChaptersFromCache(series.chapters);
    if (loadSeq !== currentLoadSeq) return;

    state.metadata = {
      ...series,
      coverUrl: resolvedCoverUrl,
      coverThumbUrl: series.coverThumbUrl || resolvedCoverUrl,
      originalCoverUrl: series.coverUrl || series.coverThumbUrl || '',
      originalCoverThumbUrl: series.coverThumbUrl || series.coverUrl || '',
      filename: sanitizeFilename(series.title, true)
    };
    state.chapters = hydratedChapters;
    state.volumeFilter = null;
    state.lastClickedIdx = -1;
    state.lastClickedChapState = null;
    state.lastClickedVolIdx = -1;
    state.lastClickedVolState = null;

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
        `Aviso: nenhum capítulo localizado em ${url}. Tente Modo SPA ou Apontar nas Opções Avançadas.`,
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
    if (loadSeq !== currentLoadSeq) return;
    appendLog(`ERRO ao carregar obra (${url}): ${err.message}`, 'error');
    showBanner(
      t('msgLoadError', { error: err.message }),
      'error',
      err.isAntiBotChallenge ? { label: t('btnOpenVerifyPage'), url } : null
    );
  } finally {
    if (loadSeq === currentLoadSeq) {
      setLoadingOverlay(false);
      btn.disabled = false;
      setButtonLabel(btn, t('btnLoadSeries'));
    }
  }
}

export async function handleAutoDetectSelectors() {
  const url = $('starting-url').value.trim();
  if (!url) {
    showBanner(t('msgAutoDetectNoUrl'), 'error');
    return;
  }

  readOptionsFromUi();
  const isSameActiveSeries = Boolean(
    state.metadata?.startingUrl && normalizeUrl(state.metadata.startingUrl) === normalizeUrl(url)
  );
  const useTab = Boolean(state.options.renderWithTab || (isSameActiveSeries && state.seriesRequiresTab));
  const btn = $('btn-auto-detect-selectors');
  btn.disabled = true;
  btn.textContent = t('btnAutoDetectingSelectors');

  try {
    let indexDoc = await fetchDocumentWithOptions(url, {
      renderWithTab: useTab,
      onLog: appendLog
    });
    let scan = genericHtmlParser.suggestSelectors({ indexDoc, targetUrl: url });
    if (scan.listCount === 0 && !useTab) {
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

    const sampleUrl = (isSameActiveSeries ? state.chapters?.[0]?.url : '') || scan.sampleChapterUrl || '';
    let chapterDoc = null;
    if (sampleUrl && sampleUrl !== url) {
      try {
        chapterDoc = await fetchDocumentWithOptions(sampleUrl, {
          renderWithTab: useTab,
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

export async function handleTestSelectors() {
  const url = $('starting-url').value.trim();
  const resultEl = $('selector-test-result');
  const btn = $('btn-test-selectors');
  const setTestResult = (msg) => {
    if (!resultEl) return;
    resultEl.textContent = msg;
    resultEl.classList.remove('hidden');
  };

  if (!url) {
    setTestResult(t('msgTestSelectorsNeedUrl'));
    return;
  }

  readOptionsFromUi();
  const validatorRoot = document.createDocumentFragment();
  for (const rawSel of [
    state.options.customListSelector,
    state.options.customContentSelector,
    state.options.customExcludeSelector
  ]) {
    const sel = String(rawSel || '').trim();
    if (!sel) continue;
    try {
      validatorRoot.querySelectorAll(sel);
    } catch (err) {
      setTestResult(t('msgTestSelectorsInvalidCss', { error: err.message }));
      return;
    }
  }
  for (const rawLine of String(state.options.customStripPatterns || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith('/')) continue;
    const rxMatch = line.match(/^\/(.+)\/([a-z]*)$/i);
    if (!rxMatch) {
      setTestResult(t('msgTestSelectorsInvalidRegex', { error: line }));
      return;
    }
    try {
      new RegExp(rxMatch[1], rxMatch[2]);
    } catch (err) {
      setTestResult(t('msgTestSelectorsInvalidRegex', { error: err.message }));
      return;
    }
  }

  btn.disabled = true;
  setButtonLabel(btn, t('btnTestingSelectors'));

  try {
    const isSameActiveSeries = Boolean(
      state.metadata?.startingUrl && normalizeUrl(state.metadata.startingUrl) === normalizeUrl(url)
    );
    const useTab = Boolean(state.options.renderWithTab || (isSameActiveSeries && state.seriesRequiresTab));
    const indexDoc = await fetchDocumentWithOptions(url, { renderWithTab: useTab, onLog: appendLog });
    const parser = parserRegistry.detect(indexDoc, url, state.options.parserId || 'auto');

    let listCount = 0;
    let sampleChapter = null;

    if (state.options.customListSelector) {
      const matched = Array.from(indexDoc.querySelectorAll(state.options.customListSelector));
      const seenUrls = new Set();
      for (const el of matched) {
        const anchor = el.matches?.('a[href]') ? el : el.querySelector?.('a[href]');
        const absUrl = anchor ? resolveSafeHttpUrl(anchor.getAttribute('href'), url) : null;
        if (absUrl && !seenUrls.has(absUrl)) {
          seenUrls.add(absUrl);
          if (!sampleChapter) {
            sampleChapter = { url: absUrl, displayTitle: normalizeSpaces(anchor.textContent) || absUrl };
          }
        }
      }
      listCount = seenUrls.size || matched.length;
    } else {
      const collected = parser.collectChapterNodes(indexDoc, url, state.options, {}) || [];
      if (collected.length > 0) {
        listCount = collected.length;
        sampleChapter = collected[0];
      } else if (state.chapters?.length > 0 && isSameActiveSeries) {
        listCount = state.chapters.length;
        sampleChapter = state.chapters[0];
      }
    }

    const sampleTarget = sampleChapter || { url, displayTitle: url };
    const sampleParser = resolveParserForChapterUrl(
      sampleTarget.url,
      parser || genericHtmlParser,
      state.options.parserId || 'auto',
      url
    );
    const effectiveOptions = {
      ...state.options,
      renderWithTab: useTab,
      onLog: appendLog
    };
    const parsed = await downloadAndParseChapter(sampleTarget, sampleParser, effectiveOptions);
    const words = normalizeSpaces((parsed.nodes || []).map((n) => n.textContent || '').join(' '))
      .split(' ')
      .filter(Boolean).length;
    const images = parsed.images?.length || 0;

    appendLog(
      `[TEST] Seletores: list=${listCount}, sampleWords=${words}, sampleImages=${images} (${sampleTarget.url})`,
      'info'
    );
    setTestResult(t('msgTestSelectorsResult', { listCount, words, images }));
  } catch (err) {
    appendLog(`ERRO ao testar seletores: ${err.message}`, 'error');
    setTestResult(t('msgTestSelectorsFailed', { error: err.message }));
  } finally {
    btn.disabled = false;
    setButtonLabel(btn, t('btnTestSelectors'));
  }
}
