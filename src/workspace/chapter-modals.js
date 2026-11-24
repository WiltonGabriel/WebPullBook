import { downloadAndParseChapter, normalizeSpaces, resolveSafeHttpUrl } from '../core/parser-engine.js';
import { cacheStore, serializeNodesForCache } from '../core/cache-store.js';
import { sanitizeChapterContent } from '../core/sanitizer.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import { resolveParserForChapterUrl } from '../parsers/index.js';
import { setButtonLabel } from './icons.js';
import { $, getCacheKey, getCurrentSeriesKey, state, t } from './state.js';
import { appendLog, showBanner } from './logger.js';
import { readOptionsFromUi } from './options-storage.js';
import {
  getChapterFromCaches,
  getVisibleChapters,
  persistSessionSnapshot,
  populateRangeSelects,
  renderAllChapterViews,
  renderChaptersTable
} from './chapters-ui.js';

let previewSeq = 0;
let previewOriginalTitle = '';
let previewOriginalNodes = null;

function buildImageFallbacksMap(images = [], existingFallbacks = null) {
  const out = existingFallbacks && typeof existingFallbacks === 'object' ? { ...existingFallbacks } : {};
  for (const img of images || []) {
    if (img?.originalUrl && img?.fallbackUrl) {
      out[img.originalUrl] = img.fallbackUrl;
    }
  }
  return out;
}

function buildSafePreviewFragment(nodes, baseUrl) {
  const frag = document.createDocumentFragment();
  const base = /^https?:\/\//i.test(baseUrl || '') ? baseUrl : state.metadata.startingUrl || 'https://webpullbook.invalid/';
  for (const node of nodes || []) {
    const imported = document.importNode(node, true);
    const imgs = [];
    if (imported.matches?.('img[src]')) imgs.push(imported);
    if (imported.querySelectorAll) imgs.push(...imported.querySelectorAll('img[src]'));
    for (const img of imgs) {
      const rawSrc = (img.getAttribute('src') || '').trim();
      if (/^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(rawSrc)) {
        img.src = rawSrc;
      } else {
        const safeImgUrl = resolveSafeHttpUrl(rawSrc, base);
        if (safeImgUrl) {
          img.src = safeImgUrl;
        } else {
          img.removeAttribute('src');
        }
      }
    }

    const anchors = [];
    if (imported.matches?.('a[href]')) anchors.push(imported);
    if (imported.querySelectorAll) anchors.push(...imported.querySelectorAll('a[href]'));
    for (const anchor of anchors) {
      const rawHref = (anchor.getAttribute('href') || '').trim();
      if (!rawHref || rawHref.startsWith('#')) continue;
      const safeHref = resolveSafeHttpUrl(rawHref, base);
      if (safeHref) {
        anchor.setAttribute('href', safeHref);
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      } else {
        anchor.removeAttribute('href');
      }
    }
    frag.appendChild(imported);
  }
  return frag;
}

export function setPreviewEditMode(editable, { restoreSnapshot = editable === false } = {}) {
  const wasEditable = state.activePreviewEditable;
  state.activePreviewEditable = Boolean(editable);
  const contentEl = $('preview-modal-content');
  const titleWrap = $('preview-edit-title-wrap');
  const toggleBtn = $('btn-preview-toggle-edit');
  const saveBtn = $('btn-preview-save-edit');
  const titleInput = $('preview-edit-title-input');

  if (!wasEditable && state.activePreviewEditable) {
    previewOriginalTitle = $('preview-modal-title').textContent || '';
    previewOriginalNodes = Array.from(contentEl.childNodes, (n) => n.cloneNode(true));
  } else if (!state.activePreviewEditable) {
    if (restoreSnapshot && Array.isArray(previewOriginalNodes)) {
      contentEl.replaceChildren(...previewOriginalNodes.map((n) => n.cloneNode(true)));
      $('preview-modal-title').textContent = previewOriginalTitle;
    }
    previewOriginalNodes = null;
    previewOriginalTitle = '';
  }

  contentEl.contentEditable = state.activePreviewEditable ? 'true' : 'false';
  contentEl.setAttribute('spellcheck', state.activePreviewEditable ? 'true' : 'false');
  titleWrap.classList.toggle('hidden', !state.activePreviewEditable);
  saveBtn.classList.toggle('hidden', !state.activePreviewEditable);
  setButtonLabel(toggleBtn, state.activePreviewEditable ? t('btnPreviewCancelEdit') : t('btnPreviewToggleEdit'));
  if (state.activePreviewEditable && state.activePreviewChapter) {
    titleInput.value = $('preview-modal-title').textContent || state.activePreviewChapter.displayTitle || '';
    contentEl.focus();
  }
}

export async function handleSavePreviewEdit() {
  const ch = state.activePreviewChapter;
  if (!ch || ch.readOnlyPreview) return;

  const newTitle = normalizeSpaces($('preview-edit-title-input').value) || ch.displayTitle || ch.title || 'Capítulo';
  const baseUrl = /^https?:\/\//i.test(ch.url) ? ch.url : state.metadata.startingUrl || 'https://webpullbook.invalid/';
  const cleaned = sanitizeChapterContent($('preview-modal-content'), baseUrl, state.options);
  const chParser = resolveParserForChapterUrl(
    ch.url,
    state.activeParser,
    state.options.parserId,
    state.metadata.startingUrl
  );
  const key = ch.pinnedCacheKey || getCacheKey(ch.url, chParser?.id || state.activeParser?.id || 'auto');
  ch.pinnedCacheKey = key;
  const serializedNodes = serializeNodesForCache(cleaned.nodes);
  const prevFallbacks = state.chapterCache.get(key)?.imageFallbacks || null;
  const imageFallbacks = buildImageFallbacksMap(cleaned.images, prevFallbacks);
  const rec = {
    chapterTitle: newTitle,
    subtitle: '',
    contentXml: serializedNodes,
    ...(Object.keys(imageFallbacks).length > 0 ? { imageFallbacks } : {})
  };

  state.chapterCache.set(key, rec);
  if (state.options.cacheTtlDays > 0) {
    await cacheStore.putChapter({
      key,
      seriesKey: getCurrentSeriesKey(),
      chapterUrl: ch.url,
      chapterTitle: newTitle,
      subtitle: '',
      nodes: cleaned.nodes,
      imageFallbacks,
      ttlDays: state.options.cacheTtlDays
    });
  }

  ch.displayTitle = newTitle;
  ch.titleText = newTitle;
  ch.edited = true;
  ch.status = 'ok';
  ch.errorMsg = '';

  const contentEl = $('preview-modal-content');
  const renderedFrag = buildSafePreviewFragment(cleaned.nodes, baseUrl);
  if (!renderedFrag.hasChildNodes()) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = t('previewEmpty');
    renderedFrag.appendChild(empty);
  }
  contentEl.replaceChildren(renderedFrag);
  $('preview-modal-title').textContent = newTitle;
  setPreviewEditMode(false, { restoreSnapshot: false });
  renderChaptersTable();
  await persistSessionSnapshot();
  await state.onCacheChanged?.();
  appendLog(`[EDIT] Capítulo editado salvo no cache: "${newTitle}".`);
  showBanner(t('msgPreviewEditSaved'), 'success');
}

export function openMergeChaptersModal() {
  if (state.running || state.batchRunning) {
    showBanner(t('msgLoadBlockedExportRunning'), 'error');
    return;
  }
  const selected = state.chapters.filter((c) => c.included);
  if (selected.length < 2) {
    showBanner(t('msgMergeChaptersNeedTwo'), 'error');
    return;
  }
  const first = selected[0];
  const last = selected[selected.length - 1];
  $('merge-chapters-desc').textContent = t('mergeChaptersDesc', { count: selected.length });
  $('merge-chapters-title-input').value = `${first.displayTitle} + ${last.displayTitle}`;
  $('merge-chapters-modal').showModal();
}

export async function applyMergeSelectedChapters() {
  if (state.running || state.batchRunning) {
    showBanner(t('msgLoadBlockedExportRunning'), 'error');
    return;
  }
  const checkedEntries = state.chapters
    .map((ch, idx) => ({ ch, idx }))
    .filter(({ ch }) => ch.included);
  if (checkedEntries.length < 2) {
    showBanner(t('msgMergeChaptersNeedTwo'), 'error');
    return;
  }

  const btn = $('btn-confirm-merge-chapters');
  btn.disabled = true;
  readOptionsFromUi();

  try {
    const mergedTitle =
      normalizeSpaces($('merge-chapters-title-input').value) ||
      `${checkedEntries[0].ch.displayTitle} (${checkedEntries.length})`;
    const container = document.createElement('div');
    const collectedFallbacks = {};
    const effectiveOptions = {
      ...state.options,
      renderWithTab: state.options.renderWithTab || state.seriesRequiresTab,
      onLog: appendLog
    };

    for (const { ch } of checkedEntries) {
      const chParser =
        resolveParserForChapterUrl(ch.url, state.activeParser, state.options.parserId, state.metadata.startingUrl) ||
        genericHtmlParser;
      const chKey = ch.pinnedCacheKey || getCacheKey(ch.url, chParser?.id || state.activeParser?.id || 'auto');
      let parsed = await getChapterFromCaches(ch, chKey);
      if (!parsed) {
        parsed = await downloadAndParseChapter(ch, chParser, effectiveOptions);
      }
      const cachedFallbacks = state.chapterCache.get(chKey)?.imageFallbacks || null;
      Object.assign(collectedFallbacks, buildImageFallbacksMap(parsed.images, cachedFallbacks));
      const subHeading = document.createElement('h3');
      subHeading.textContent = parsed.chapterTitle || ch.displayTitle || ch.url;
      container.appendChild(subHeading);
      for (const node of parsed.nodes || []) {
        container.appendChild(document.importNode(node, true));
      }
    }

    const baseUrl = checkedEntries[0].ch.url || state.metadata.startingUrl || 'https://webpullbook.invalid/';
    const cleaned = sanitizeChapterContent(container, baseUrl, state.options);
    const imageFallbacks = buildImageFallbacksMap(cleaned.images, collectedFallbacks);
    const mergedUrl = `urn:webpullbook:merged:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const key = getCacheKey(mergedUrl);
    const serializedNodes = serializeNodesForCache(cleaned.nodes);
    const rec = {
      chapterTitle: mergedTitle,
      subtitle: '',
      contentXml: serializedNodes,
      ...(Object.keys(imageFallbacks).length > 0 ? { imageFallbacks } : {})
    };

    state.chapterCache.set(key, rec);
    if (state.options.cacheTtlDays > 0) {
      await cacheStore.putChapter({
        key,
        seriesKey: getCurrentSeriesKey(),
        chapterUrl: mergedUrl,
        chapterTitle: mergedTitle,
        subtitle: '',
        nodes: cleaned.nodes,
        imageFallbacks,
        ttlDays: state.options.cacheTtlDays
      });
    }

    const insertIdx = checkedEntries[0].idx;
    const firstCh = checkedEntries[0].ch;
    const mergedRow = {
      ...firstCh,
      id: `merged_${Date.now()}`,
      url: mergedUrl,
      pinnedCacheKey: key,
      readOnlyPreview: false,
      titleText: mergedTitle,
      displayTitle: mergedTitle,
      included: true,
      edited: true,
      status: 'ok',
      errorMsg: '',
      warnings: []
    };

    const removeSet = new Set(checkedEntries.map((entry) => entry.idx));
    const nextChapters = [];
    for (let i = 0; i < state.chapters.length; i++) {
      if (i === insertIdx) nextChapters.push(mergedRow);
      if (!removeSet.has(i)) nextChapters.push(state.chapters[i]);
    }
    nextChapters.forEach((c, idx) => {
      c.index = idx + 1;
    });
    state.chapters = nextChapters;
    state.volumeFilter = null;
    state.lastClickedIdx = -1;
    state.lastClickedChapState = null;
    state.lastClickedVolIdx = -1;
    state.lastClickedVolState = null;

    $('merge-chapters-modal').close('confirm');
    populateRangeSelects();
    renderAllChapterViews();
    await persistSessionSnapshot();
    await state.onCacheChanged?.();
    appendLog(`[EDIT] Mesclados ${checkedEntries.length} capítulos em "${mergedTitle}".`);
    showBanner(t('msgChaptersMerged', { count: checkedEntries.length, title: mergedTitle }), 'success');
  } catch (err) {
    appendLog(`Erro ao mesclar capítulos: ${err.message}`, 'error');
    showBanner(`Erro: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

export async function openChapterPreviewForTarget(
  ch,
  parser = state.activeParser,
  { bypassCache = false, readOnly = false } = {}
) {
  if (!ch) return;

  const seq = ++previewSeq;
  const effectiveReadOnly = Boolean(readOnly || ch.readOnlyPreview);
  const dialog = $('preview-modal');
  const titleEl = $('preview-modal-title');
  const metaEl = $('preview-modal-meta');
  const contentEl = $('preview-modal-content');
  const toggleBtn = $('btn-preview-toggle-edit');

  state.activePreviewChapter = ch;
  setPreviewEditMode(false, { restoreSnapshot: false });
  toggleBtn.classList.add('hidden');
  titleEl.textContent = ch.displayTitle || ch.title || ch.url;
  metaEl.textContent = t('previewLoading');
  contentEl.replaceChildren();
  dialog.showModal();

  try {
    readOptionsFromUi();
    const effectiveParser =
      resolveParserForChapterUrl(ch.url, parser || state.activeParser, state.options.parserId, state.metadata.startingUrl) ||
      genericHtmlParser;
    const cacheKey = ch.pinnedCacheKey || getCacheKey(ch.url, effectiveParser?.id || state.activeParser?.id || 'auto');
    let parsed = bypassCache ? null : await getChapterFromCaches(ch, cacheKey);
    if (seq !== previewSeq || state.activePreviewChapter !== ch) return;
    if (!parsed) {
      const effectiveOptions = {
        ...state.options,
        renderWithTab: state.options.renderWithTab || state.seriesRequiresTab,
        onLog: appendLog
      };
      parsed = await downloadAndParseChapter(ch, effectiveParser, effectiveOptions);
      if (seq !== previewSeq || state.activePreviewChapter !== ch) return;
    }

    titleEl.textContent = parsed.chapterTitle || ch.displayTitle || ch.title || ch.url;
    const textLen = (parsed.nodes || []).map((n) => n.textContent || '').join(' ');
    const words = normalizeSpaces(textLen).split(' ').filter(Boolean).length;
    const images = parsed.images?.length || 0;
    metaEl.textContent = t('previewMetaInfo', {
      words,
      images,
      parser: effectiveParser?.name || 'Universal Smart Extractor'
    });

    const frag = buildSafePreviewFragment(parsed.nodes, ch.url);
    if (!frag.hasChildNodes()) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = t('previewEmpty');
      frag.appendChild(empty);
    }
    contentEl.replaceChildren(frag);
    toggleBtn.classList.toggle('hidden', effectiveReadOnly);
  } catch (err) {
    if (seq !== previewSeq || state.activePreviewChapter !== ch) return;
    metaEl.textContent = t('msgPreviewError', { error: err.message });
    const errP = document.createElement('p');
    errP.className = 'muted';
    errP.textContent = err.message;
    contentEl.replaceChildren(errP);
  }
}

export async function openChapterPreview(chapterIdx = -1) {
  if (state.chapters.length === 0) {
    showBanner(t('msgPreviewNoChapters'), 'info');
    return;
  }

  let targetIdx = chapterIdx;
  if (targetIdx < 0 || targetIdx >= state.chapters.length) {
    const visible = getVisibleChapters();
    const selVisible = visible.find((v) => v.ch.included);
    targetIdx = selVisible ? selVisible.idx : (visible[0]?.idx ?? 0);
  }
  await openChapterPreviewForTarget(state.chapters[targetIdx], state.activeParser);
}
