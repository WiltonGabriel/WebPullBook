import {
  canUseTabScripting,
  downloadAndParseChapter,
  extractVolumeLabel,
  normalizeSpaces,
  normalizeUrl
} from '../core/parser-engine.js';
import { cacheStore, hydrateCachedChapter, serializeNodesForCache } from '../core/cache-store.js';
import { sanitizeChapterContent } from '../core/sanitizer.js';
import { loadSeriesWithParser } from '../parsers/index.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import { $, getCacheKey, getCurrentSeriesKey, state, t } from './state.js';
import { appendLog, createExternalLink, jumpToLog, showBanner } from './logger.js';
import { readMetadataFromUi, readOptionsFromUi, updateCoverPreview } from './options-storage.js';

export function getVolumeGroups() {
  const map = new Map();
  for (const ch of state.chapters) {
    const vol = ch.volume || 'Volume 01';
    if (!map.has(vol)) map.set(vol, []);
    map.get(vol).push(ch);
  }
  return Array.from(map.entries()).map(([volume, chapters]) => ({ volume, chapters }));
}

function extractChapterNumberHint(ch) {
  const txt = `${ch?.numText || ''} ${ch?.displayTitle || ch?.titleText || ''}`;
  const m = txt.match(/(?:cap[íi]tulo|cap\.?|chapter|ch\.?|epis[óo]dio|ep\.?|#)\s*(\d+)/i) || txt.match(/^(\d+)\b/);
  if (m) return parseInt(m[1], 10);
  const urlStr = String(ch?.url || '');
  const tail = urlStr.match(/(\d+)(?:\/|\.html?)?(?:[?#].*)?$/i);
  return tail ? parseInt(tail[1], 10) : null;
}

export function updateFailedButtonsState() {
  const failedCount = state.chapters.filter((c) => c.status === 'error').length;
  const retryBtn = $('btn-retry-failed');
  const selFailedBtn = $('btn-select-failed');

  if (failedCount > 0 && !state.running) {
    retryBtn.textContent = t('btnRetryFailed', { count: failedCount });
    retryBtn.classList.remove('hidden');
    selFailedBtn.classList.remove('hidden');
  } else {
    retryBtn.classList.add('hidden');
    selFailedBtn.classList.add('hidden');
  }
}

export async function handleRedetectVolumes() {
  if (state.chapters.length === 0) {
    showBanner(t('msgRedetectNoChapters'), 'info');
    return;
  }

  readOptionsFromUi();
  const btn = $('btn-redetect-volumes');
  btn.disabled = true;
  btn.textContent = t('btnRedetectingVolumes');

  try {
    const volumeByUrl = new Map();

    if (state.metadata.startingUrl && /^https?:\/\//i.test(state.metadata.startingUrl)) {
      try {
        const tryStatic = await loadSeriesWithParser(state.metadata.startingUrl, {
          ...state.options,
          onLog: appendLog
        });
        const staticVols = new Set((tryStatic.series.chapters || []).map((c) => c.volume || 'Volume 01'));
        let bestChapters = tryStatic.series.chapters || [];

        if (staticVols.size <= 1 && !state.options.renderWithTab && canUseTabScripting()) {
          try {
            const trySpa = await loadSeriesWithParser(state.metadata.startingUrl, {
              ...state.options,
              renderWithTab: true,
              onLog: appendLog
            });
            const spaVols = new Set((trySpa.series.chapters || []).map((c) => c.volume || 'Volume 01'));
            if (spaVols.size > staticVols.size) {
              bestChapters = trySpa.series.chapters || [];
              state.seriesRequiresTab = true;
            }
          } catch {
            // Keep static detection if SPA retry fails
          }
        }

        for (const fresh of bestChapters) {
          if (fresh.url && fresh.volume) {
            volumeByUrl.set(normalizeUrl(fresh.url), fresh.volume);
          }
        }
      } catch (err) {
        appendLog(`Aviso: erro ao re-escanear página da obra para volumes: ${err.message}`, 'warn');
      }
    }

    for (const ch of state.chapters) {
      const matchedVol = volumeByUrl.get(normalizeUrl(ch.url));
      const inferred = extractVolumeLabel('', `${ch.numText || ''} ${ch.displayTitle || ch.titleText || ''}`, ch.url);
      if (matchedVol && matchedVol !== 'Volume 01') {
        ch.volume = matchedVol;
      } else if (inferred && inferred !== 'Volume 01') {
        ch.volume = inferred;
      } else if (matchedVol) {
        ch.volume = matchedVol;
      }
    }

    if (new Set(state.chapters.map((c) => c.volume || 'Volume 01')).size <= 1 && state.chapters.length >= 4) {
      let currentVol = 1;
      let prevNum = null;
      const inferredList = [];
      for (const ch of state.chapters) {
        const num = extractChapterNumberHint(ch);
        if (num === 1 && prevNum !== null && prevNum >= 3) {
          currentVol += 1;
        }
        inferredList.push(`Volume ${String(currentVol).padStart(2, '0')}`);
        if (num !== null) prevNum = num;
      }
      if (currentVol > 1) {
        state.chapters.forEach((ch, idx) => {
          ch.volume = inferredList[idx];
        });
      }
    }

    state.volumeFilter = null;
    const totalVols = getVolumeGroups().length;
    const modeRadio = document.querySelector(`input[name="pack-mode"][value="${totalVols > 1 ? 'by-volume' : 'single'}"]`);
    if (modeRadio) modeRadio.checked = true;

    renderAllChapterViews();
    populateRangeSelects();
    appendLog(`[PARSE] Re-detecção de volumes concluída: ${totalVols} volume(s).`);
    showBanner(t('msgVolumesRedetected', { count: totalVols }), totalVols > 1 ? 'success' : 'info');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnRedetectVolumes');
  }
}

export function renderVolumeChips() {
  const container = $('volume-chips');
  const groups = getVolumeGroups();
  $('volume-summary').textContent = groups.length ? t('volumesDetected', { count: groups.length }) : '';
  $('btn-filter-clear-vol').classList.toggle('hidden', !state.volumeFilter);

  if (groups.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted sm';
    empty.textContent = t('volumesEmpty');
    container.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const grp of groups) {
    const selectedCount = grp.chapters.filter((c) => c.included).length;
    const allSel = selectedCount === grp.chapters.length;
    const partialSel = selectedCount > 0 && selectedCount < grp.chapters.length;

    const chip = document.createElement('div');
    chip.className = `vol-chip${allSel ? ' selected' : partialSel ? ' partial' : ''}`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = allSel;
    cb.indeterminate = partialSel;
    cb.title = grp.volume;
    cb.addEventListener('change', () => {
      const target = cb.checked;
      for (const ch of grp.chapters) ch.included = target;
      renderAllChapterViews();
    });

    const labelBtn = document.createElement('button');
    labelBtn.type = 'button';
    labelBtn.className = 'vol-filter-btn';
    labelBtn.textContent = `${grp.volume} (${selectedCount}/${grp.chapters.length})`;
    labelBtn.addEventListener('click', () => {
      state.volumeFilter = state.volumeFilter === grp.volume ? null : grp.volume;
      renderAllChapterViews();
    });

    chip.append(cb, labelBtn);
    fragment.appendChild(chip);
  }

  container.replaceChildren(fragment);
}

export function populateRangeSelects() {
  const firstSel = $('first-chapter');
  const lastSel = $('last-chapter');
  const optsFirst = [];
  const optsLast = [];

  for (let i = 0; i < state.chapters.length; i++) {
    const ch = state.chapters[i];
    const label = `${i + 1}. [${ch.volume}] ${ch.displayTitle}`;
    const o1 = document.createElement('option');
    o1.value = String(i);
    o1.textContent = label;
    optsFirst.push(o1);

    const o2 = document.createElement('option');
    o2.value = String(i);
    o2.textContent = label;
    optsLast.push(o2);
  }

  firstSel.replaceChildren(...optsFirst);
  lastSel.replaceChildren(...optsLast);
  if (state.chapters.length > 0) {
    firstSel.value = '0';
    lastSel.value = String(state.chapters.length - 1);
  }
}

export function getVisibleChapters() {
  const query = $('chapter-filter').value.trim().toLowerCase();
  return state.chapters
    .map((ch, idx) => ({ ch, idx }))
    .filter(({ ch }) => {
      if (state.volumeFilter && ch.volume !== state.volumeFilter) return false;
      if (!query) return true;
      return (
        ch.displayTitle.toLowerCase().includes(query) ||
        ch.volume.toLowerCase().includes(query) ||
        ch.url.toLowerCase().includes(query)
      );
    });
}

function buildStatusPill(ch) {
  const cached = state.chapterCache.has(getCacheKey(ch.url));
  const st = ch.status || (cached ? 'ok' : 'pending');
  const warnings = Array.isArray(ch.warnings) ? ch.warnings : [];

  if (st === 'ok' && warnings.length > 0) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'status-pill warn clickable';
    btn.textContent = cached
      ? t('statusCachedWarn', { count: warnings.length })
      : t('statusOkWarn', { count: warnings.length });
    btn.title = warnings.map((w) => w.message).join('\n');
    btn.addEventListener('click', () => jumpToLog(warnings[0]?.logId));
    return btn;
  }

  if (st === 'error') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'status-pill error clickable';
    btn.textContent = t('statusErrorShort');
    if (ch.errorMsg) btn.title = ch.errorMsg;
    btn.addEventListener('click', () => jumpToLog(ch.logId));
    return btn;
  }

  const pill = document.createElement('span');
  if (st === 'ok') {
    pill.className = 'status-pill ok';
    pill.textContent = cached ? t('statusCached') : t('statusOk');
    if (cached) pill.title = t('statusCachedTooltip');
  } else if (st === 'downloading') {
    pill.className = 'status-pill downloading';
    pill.textContent = t('statusDownloading');
  } else if (st === 'skipped') {
    pill.className = 'status-pill';
    pill.textContent = t('statusSkipped');
    if (ch.errorMsg) pill.title = ch.errorMsg;
  } else {
    pill.className = 'status-pill';
    pill.textContent = t('statusPending');
  }
  return pill;
}

export function renderChaptersTable() {
  const tbody = $('chapters-tbody');
  const visible = getVisibleChapters();

  const totalSelected = state.chapters.filter((c) => c.included).length;
  const volCount = getVolumeGroups().length;
  $('chapter-count-badge').textContent = t('chapterCountBadge', {
    selected: totalSelected,
    total: state.chapters.length,
    volumes: volCount
  });
  $('btn-pack-epub').disabled = totalSelected === 0 || state.running;
  updateFailedButtonsState();

  const master = $('master-checkbox');
  if (visible.length > 0) {
    const visSel = visible.filter(({ ch }) => ch.included).length;
    master.checked = visSel === visible.length;
    master.indeterminate = visSel > 0 && visSel < visible.length;
  } else {
    master.checked = false;
    master.indeterminate = false;
  }

  if (visible.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty-cell';
    td.textContent = state.chapters.length ? t('emptyChaptersFilter') : t('emptyChaptersInitial');
    tr.appendChild(td);
    tbody.replaceChildren(tr);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const { ch, idx } of visible) {
    const tr = document.createElement('tr');

    const tdCheck = document.createElement('td');
    tdCheck.className = 'col-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = ch.included;
    cb.addEventListener('click', (e) => {
      if (e.shiftKey && state.lastClickedIdx !== -1) {
        const start = Math.min(state.lastClickedIdx, idx);
        const end = Math.max(state.lastClickedIdx, idx);
        const targetVal = cb.checked;
        for (let k = start; k <= end; k++) {
          state.chapters[k].included = targetVal;
        }
        renderAllChapterViews();
      } else {
        ch.included = cb.checked;
        state.lastClickedIdx = idx;
        renderVolumeChips();
        const count = state.chapters.filter((c) => c.included).length;
        $('chapter-count-badge').textContent = t('chapterCountBadge', {
          selected: count,
          total: state.chapters.length,
          volumes: getVolumeGroups().length
        });
        $('btn-pack-epub').disabled = count === 0 || state.running;
      }
    });
    tdCheck.appendChild(cb);

    const tdIdx = document.createElement('td');
    tdIdx.className = 'col-idx';
    tdIdx.textContent = String(idx + 1);

    const tdVol = document.createElement('td');
    tdVol.className = 'col-vol';
    const volInput = document.createElement('input');
    volInput.type = 'text';
    volInput.className = 'vol-inline-input';
    volInput.value = ch.volume;
    volInput.setAttribute('aria-label', `Volume ${idx + 1}`);
    volInput.addEventListener('change', () => {
      ch.volume = volInput.value.trim() || 'Volume 01';
      renderVolumeChips();
      populateRangeSelects();
    });
    tdVol.appendChild(volInput);

    const tdTitle = document.createElement('td');
    const titleSpan = document.createElement('span');
    titleSpan.textContent = ch.displayTitle;
    tdTitle.appendChild(titleSpan);
    if (ch.edited) {
      const editBadge = document.createElement('span');
      editBadge.className = 'badge edited';
      editBadge.textContent = t('badgeEdited');
      tdTitle.appendChild(editBadge);
    }
    if (state.showUrls) {
      const urlSpan = document.createElement('span');
      urlSpan.className = 'chap-url-line';
      urlSpan.textContent = ch.url;
      tdTitle.appendChild(urlSpan);
    }
    if (ch.status === 'error' && ch.errorMsg) {
      const row = document.createElement('div');
      row.className = 'chap-issue-row';
      const errBtn = document.createElement('button');
      errBtn.type = 'button';
      errBtn.className = 'chap-issue-btn error';
      const shortErr = ch.errorMsg.length > 85 ? `${ch.errorMsg.slice(0, 82)}...` : ch.errorMsg;
      errBtn.textContent = t('chapErrorLink', { msg: shortErr });
      errBtn.title = ch.errorMsg;
      errBtn.addEventListener('click', () => jumpToLog(ch.logId));
      row.appendChild(errBtn);
      const openPage = createExternalLink(ch.url, t('chapOpenPage'), 'chap-open-link');
      if (openPage) row.appendChild(openPage);
      tdTitle.appendChild(row);
    } else if (ch.status === 'ok' && ch.warnings?.length) {
      const row = document.createElement('div');
      row.className = 'chap-issue-row';
      const warnBtn = document.createElement('button');
      warnBtn.type = 'button';
      warnBtn.className = 'chap-issue-btn warn';
      warnBtn.textContent = t('chapWarnLink', { count: ch.warnings.length });
      warnBtn.title = ch.warnings.map((w) => w.message).join('\n');
      warnBtn.addEventListener('click', () => jumpToLog(ch.warnings[0]?.logId));
      row.appendChild(warnBtn);
      const openPage = createExternalLink(ch.url, t('chapOpenPage'), 'chap-open-link');
      if (openPage) row.appendChild(openPage);
      tdTitle.appendChild(row);
    }

    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    const statusWrap = document.createElement('div');
    statusWrap.className = 'chap-status-wrap';
    statusWrap.appendChild(buildStatusPill(ch));

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'btn ghost sm chap-preview-btn';
    previewBtn.textContent = '👁';
    previewBtn.title = t('btnPreviewTitle');
    previewBtn.setAttribute('aria-label', `${t('btnPreviewTitle')}: ${ch.displayTitle}`);
    previewBtn.addEventListener('click', () => openChapterPreview(idx));
    statusWrap.appendChild(previewBtn);

    tdStatus.appendChild(statusWrap);
    tr.append(tdCheck, tdIdx, tdVol, tdTitle, tdStatus);
    fragment.appendChild(tr);
  }

  tbody.replaceChildren(fragment);
}

export function renderAllChapterViews() {
  renderVolumeChips();
  renderChaptersTable();
}

export async function persistSessionSnapshot() {
  if (state.options.cacheTtlDays <= 0 || state.chapters.length === 0) return;
  await cacheStore.putSession({
    seriesKey: getCurrentSeriesKey(),
    metadata: state.metadata,
    parserId: state.activeParser?.id || 'auto',
    chapters: state.chapters,
    ttlDays: state.options.cacheTtlDays
  });
}

export async function getChapterFromCaches(ch, cacheKey) {
  let rec = state.chapterCache.get(cacheKey);
  if (!rec && state.options.cacheTtlDays > 0) {
    const diskRec = await cacheStore.getChapter(cacheKey);
    if (diskRec) {
      rec = {
        chapterTitle: diskRec.chapterTitle,
        subtitle: diskRec.subtitle,
        contentXml: diskRec.contentXml
      };
      state.chapterCache.set(cacheKey, rec);
    }
  }
  return rec ? hydrateCachedChapter(ch, rec) : null;
}

export async function hydrateChaptersFromCache(chapters) {
  const keys = chapters.map((ch) => getCacheKey(ch.url));
  const diskMap = await cacheStore.hasChapters(keys);
  return chapters.map((ch) => {
    const key = getCacheKey(ch.url);
    const diskRec = diskMap.get(key);
    if (diskRec) {
      state.chapterCache.set(key, {
        chapterTitle: diskRec.chapterTitle,
        subtitle: diskRec.subtitle,
        contentXml: diskRec.contentXml
      });
    }
    return {
      ...ch,
      status: state.chapterCache.has(key) ? 'ok' : 'pending',
      errorMsg: ''
    };
  });
}

export async function handleUploadCoverFile(file) {
  if (!file || !/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type || '')) {
    showBanner(t('msgCoverUploadInvalid'), 'error');
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsDataURL(file);
  });
  $('meta-cover-url').value = dataUrl;
  readMetadataFromUi();
  updateCoverPreview();
  appendLog(`[IMG] Capa local carregada (${file.type}, ${(file.size / 1024).toFixed(1)} KB)`, 'debug');
  showBanner(t('msgCoverUploaded'), 'success');
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = normalizeSpaces(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 7);
}

export function handleGenerateCover() {
  readMetadataFromUi();
  const title = state.metadata.title || $('meta-title').value.trim() || 'WebPullBook';
  const author =
    (state.metadata.author && state.metadata.author !== '<unknown>' ? state.metadata.author : '') ||
    $('meta-author').value.trim() ||
    'WebPullBook Edition';

  const w = 800;
  const h = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#162032');
  grad.addColorStop(1, '#263447');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 0, 56, h);
  ctx.fillStyle = 'rgba(96, 165, 250, 0.45)';
  ctx.fillRect(56, 0, 8, h);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(102, 72, w - 150, h - 144);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 58px Georgia, serif';
  ctx.textBaseline = 'top';
  const titleLines = wrapCanvasText(ctx, title, w - 230);
  let y = 210;
  for (const line of titleLines) {
    ctx.fillText(line, 148, y);
    y += 76;
  }

  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(148, Math.min(820, y + 32), 140, 6);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '34px system-ui, -apple-system, sans-serif';
  ctx.fillText(author.slice(0, 48), 148, h - 220);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('WEBPULLBOOK', 148, h - 135);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  $('meta-cover-url').value = dataUrl;
  readMetadataFromUi();
  updateCoverPreview();
  showBanner(t('msgCoverGenerated', { title }), 'success');
}

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
