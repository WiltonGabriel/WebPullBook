import { downloadAndParseChapter, normalizeSpaces } from '../core/parser-engine.js';
import { cacheStore, serializeNodesForCache } from '../core/cache-store.js';
import { sanitizeChapterContent } from '../core/sanitizer.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
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

export function setPreviewEditMode(editable) {
  state.activePreviewEditable = Boolean(editable);
  const contentEl = $('preview-modal-content');
  const titleWrap = $('preview-edit-title-wrap');
  const toggleBtn = $('btn-preview-toggle-edit');
  const saveBtn = $('btn-preview-save-edit');
  const titleInput = $('preview-edit-title-input');

  contentEl.contentEditable = state.activePreviewEditable ? 'true' : 'false';
  contentEl.setAttribute('spellcheck', state.activePreviewEditable ? 'true' : 'false');
  titleWrap.classList.toggle('hidden', !state.activePreviewEditable);
  saveBtn.classList.toggle('hidden', !state.activePreviewEditable);
  toggleBtn.textContent = state.activePreviewEditable ? t('btnPreviewCancelEdit') : t('btnPreviewToggleEdit');
  if (state.activePreviewEditable && state.activePreviewChapter) {
    titleInput.value = $('preview-modal-title').textContent || state.activePreviewChapter.displayTitle || '';
    contentEl.focus();
  }
}

export async function handleSavePreviewEdit() {
  const ch = state.activePreviewChapter;
  if (!ch) return;

  const newTitle = normalizeSpaces($('preview-edit-title-input').value) || ch.displayTitle || ch.title || 'Capítulo';
  const baseUrl = /^https?:\/\//i.test(ch.url) ? ch.url : state.metadata.startingUrl || 'https://webpullbook.invalid/';
  const cleaned = sanitizeChapterContent($('preview-modal-content'), baseUrl, state.options);
  const key = getCacheKey(ch.url);
  const serializedNodes = serializeNodesForCache(cleaned.nodes);
  const rec = {
    chapterTitle: newTitle,
    subtitle: '',
    contentXml: serializedNodes
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
      ttlDays: state.options.cacheTtlDays
    });
  }

  ch.displayTitle = newTitle;
  ch.titleText = newTitle;
  ch.edited = true;
  ch.status = 'ok';
  ch.errorMsg = '';

  $('preview-modal-title').textContent = newTitle;
  setPreviewEditMode(false);
  renderChaptersTable();
  await persistSessionSnapshot();
  await state.onCacheChanged?.();
  appendLog(`[EDIT] Capítulo editado salvo no cache: "${newTitle}".`);
  showBanner(t('msgPreviewEditSaved'), 'success');
}

export function openMergeChaptersModal() {
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
    const parser = state.activeParser || genericHtmlParser;
    const effectiveOptions = {
      ...state.options,
      renderWithTab: state.options.renderWithTab || state.seriesRequiresTab,
      onLog: appendLog
    };

    for (const { ch } of checkedEntries) {
      let parsed = await getChapterFromCaches(ch, getCacheKey(ch.url));
      if (!parsed) {
        parsed = await downloadAndParseChapter(ch, parser, effectiveOptions);
      }
      const subHeading = document.createElement('h3');
      subHeading.textContent = parsed.chapterTitle || ch.displayTitle || ch.url;
      container.appendChild(subHeading);
      for (const node of parsed.nodes || []) {
        container.appendChild(document.importNode(node, true));
      }
    }

    const baseUrl = checkedEntries[0].ch.url || state.metadata.startingUrl || 'https://webpullbook.invalid/';
    const cleaned = sanitizeChapterContent(container, baseUrl, state.options);
    const mergedUrl = `urn:webpullbook:merged:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const key = getCacheKey(mergedUrl);
    const serializedNodes = serializeNodesForCache(cleaned.nodes);
    const rec = {
      chapterTitle: mergedTitle,
      subtitle: '',
      contentXml: serializedNodes
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
        ttlDays: state.options.cacheTtlDays
      });
    }

    const insertIdx = checkedEntries[0].idx;
    const firstCh = checkedEntries[0].ch;
    const mergedRow = {
      ...firstCh,
      id: `merged_${Date.now()}`,
      url: mergedUrl,
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

export async function openChapterPreviewForTarget(ch, parser = state.activeParser) {
  if (!ch) return;

  const dialog = $('preview-modal');
  const titleEl = $('preview-modal-title');
  const metaEl = $('preview-modal-meta');
  const contentEl = $('preview-modal-content');
  const toggleBtn = $('btn-preview-toggle-edit');

  state.activePreviewChapter = ch;
  setPreviewEditMode(false);
  toggleBtn.classList.add('hidden');
  titleEl.textContent = ch.displayTitle || ch.title || ch.url;
  metaEl.textContent = t('previewLoading');
  contentEl.replaceChildren();
  dialog.showModal();

  try {
    readOptionsFromUi();
    let parsed = await getChapterFromCaches(ch, getCacheKey(ch.url));
    if (!parsed) {
      const effectiveOptions = {
        ...state.options,
        renderWithTab: state.options.renderWithTab || state.seriesRequiresTab,
        onLog: appendLog
      };
      parsed = await downloadAndParseChapter(ch, parser || genericHtmlParser, effectiveOptions);
    }

    titleEl.textContent = parsed.chapterTitle || ch.displayTitle || ch.title || ch.url;
    const textLen = (parsed.nodes || []).map((n) => n.textContent || '').join(' ');
    const words = normalizeSpaces(textLen).split(' ').filter(Boolean).length;
    const images = parsed.images?.length || 0;
    metaEl.textContent = t('previewMetaInfo', {
      words,
      images,
      parser: (parser || genericHtmlParser)?.name || 'Universal Smart Extractor'
    });

    const frag = document.createDocumentFragment();
    for (const node of parsed.nodes || []) {
      const imported = document.importNode(node, true);
      if (imported.querySelectorAll) {
        for (const img of imported.querySelectorAll('img[src]')) {
          const rawSrc = img.getAttribute('src') || '';
          try {
            img.src = new URL(rawSrc, ch.url).toString();
          } catch {
            // keep src
          }
        }
      }
      frag.appendChild(imported);
    }
    if (!frag.hasChildNodes()) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = t('previewEmpty');
      frag.appendChild(empty);
    }
    contentEl.replaceChildren(frag);
    toggleBtn.classList.remove('hidden');
  } catch (err) {
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
