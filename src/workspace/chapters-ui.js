import {
  canUseTabScripting,
  extractVolumeLabel,
  normalizeUrl
} from '../core/parser-engine.js';
import { cacheStore, hydrateCachedChapter } from '../core/cache-store.js';
import { loadSeriesWithParser } from '../parsers/index.js';
import { createIconButtonContent } from './icons.js';
import { $, getCacheKey, getCurrentSeriesKey, state, t } from './state.js';
import { appendLog, createExternalLink, jumpToLog, showBanner } from './logger.js';
import { readOptionsFromUi } from './options-storage.js';

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

export function toggleAllVolumesSelection() {
  if (state.chapters.length === 0) return;
  const allSelected = state.chapters.every((c) => c.included);
  const nextVal = !allSelected;
  for (const ch of state.chapters) {
    ch.included = nextVal;
  }
  state.lastClickedVolIdx = -1;
  state.lastClickedVolState = nextVal;
  renderAllChapterViews();
}

export function renderVolumeChips() {
  const container = $('volume-chips');
  const groups = getVolumeGroups();
  $('volume-summary').textContent = groups.length ? t('volumesDetected', { count: groups.length }) : '';
  $('btn-filter-clear-vol').classList.toggle('hidden', !state.volumeFilter);

  const toggleAllBtn = $('btn-toggle-all-volumes');
  if (toggleAllBtn) {
    toggleAllBtn.disabled = groups.length === 0;
    const allSelected = state.chapters.length > 0 && state.chapters.every((c) => c.included);
    toggleAllBtn.textContent = allSelected ? t('btnUnselectAll') : t('btnSelectAll');
  }

  if (groups.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted sm';
    empty.textContent = t('volumesEmpty');
    container.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  groups.forEach((grp, volIdx) => {
    const selectedCount = grp.chapters.filter((c) => c.included).length;
    const allSel = selectedCount === grp.chapters.length;
    const partialSel = selectedCount > 0 && selectedCount < grp.chapters.length;

    const chip = document.createElement('div');
    chip.className = `vol-chip${allSel ? ' selected' : partialSel ? ' partial' : ''}`;
    chip.dataset.volIdx = String(volIdx);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = allSel;
    cb.indeterminate = partialSel;
    cb.title = grp.volume;

    const applyVolumeClick = (e, fromCheckbox = false) => {
      if (e.shiftKey) {
        window.getSelection?.()?.removeAllRanges?.();
        const anchorIdx =
          state.lastClickedVolIdx !== -1 && state.lastClickedVolIdx < groups.length
            ? state.lastClickedVolIdx
            : 0;
        const start = Math.min(anchorIdx, volIdx);
        const end = Math.max(anchorIdx, volIdx);
        let targetVal = fromCheckbox ? cb.checked : !allSel;
        if (state.lastClickedVolState !== null && start !== end) {
          const allMatchAnchor = groups
            .slice(start, end + 1)
            .every((g) => g.chapters.every((c) => c.included === state.lastClickedVolState));
          targetVal = allMatchAnchor ? !state.lastClickedVolState : state.lastClickedVolState;
        }
        for (let v = start; v <= end; v++) {
          for (const ch of groups[v].chapters) {
            ch.included = targetVal;
          }
        }
        state.lastClickedVolIdx = volIdx;
        state.lastClickedVolState = targetVal;
        renderAllChapterViews();
      } else {
        const targetVal = fromCheckbox ? cb.checked : !allSel;
        for (const ch of grp.chapters) {
          ch.included = targetVal;
        }
        state.lastClickedVolIdx = volIdx;
        state.lastClickedVolState = targetVal;
        renderAllChapterViews();
      }
    };

    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      applyVolumeClick(e, true);
    });

    const labelSpan = document.createElement('span');
    labelSpan.className = 'vol-chip-label';
    labelSpan.textContent = `${grp.volume} (${selectedCount}/${grp.chapters.length})`;

    chip.addEventListener('click', (e) => {
      if (e.target === cb || e.target.closest('.vol-filter-btn')) return;
      applyVolumeClick(e, false);
    });

    chip.append(cb, labelSpan);

    if (groups.length > 1) {
      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = `vol-filter-btn${state.volumeFilter === grp.volume ? ' active' : ''}`;
      filterBtn.textContent = t('btnVolFilterShort');
      filterBtn.title = t('volFilterBtnTitle');
      filterBtn.setAttribute('aria-label', `${t('volFilterBtnTitle')}: ${grp.volume}`);
      filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.volumeFilter = state.volumeFilter === grp.volume ? null : grp.volume;
        renderAllChapterViews();
      });
      chip.appendChild(filterBtn);
    }

    fragment.appendChild(chip);
  });

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
  const cached = state.chapterCache.has(ch.pinnedCacheKey || getCacheKey(ch.url));
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
  visible.forEach(({ ch, idx }, visPos) => {
    const tr = document.createElement('tr');
    tr.className = ch.included ? 'chap-row selected-row' : 'chap-row';
    tr.dataset.chapIdx = String(idx);

    const tdCheck = document.createElement('td');
    tdCheck.className = 'col-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = ch.included;

    const applyChapterClick = (e, fromCheckbox = false) => {
      if (e.shiftKey) {
        window.getSelection?.()?.removeAllRanges?.();
        const anchorIdx =
          state.lastClickedIdx !== -1 && state.lastClickedIdx < state.chapters.length
            ? state.lastClickedIdx
            : (visible[0]?.idx ?? 0);
        const anchorVisPos = visible.findIndex((item) => item.idx === anchorIdx);
        const rangeChapters = [];
        if (anchorVisPos !== -1) {
          const s = Math.min(anchorVisPos, visPos);
          const eIdx = Math.max(anchorVisPos, visPos);
          for (let k = s; k <= eIdx; k++) {
            rangeChapters.push(visible[k].ch);
          }
        } else {
          const minIdx = Math.min(anchorIdx, idx);
          const maxIdx = Math.max(anchorIdx, idx);
          for (const item of visible) {
            if (item.idx >= minIdx && item.idx <= maxIdx) {
              rangeChapters.push(item.ch);
            }
          }
          if (rangeChapters.length === 0) rangeChapters.push(ch);
        }
        let targetVal = fromCheckbox ? cb.checked : !ch.included;
        if (state.lastClickedChapState !== null && rangeChapters.length > 1) {
          const allMatchAnchor = rangeChapters.every((c) => c.included === state.lastClickedChapState);
          targetVal = allMatchAnchor ? !state.lastClickedChapState : state.lastClickedChapState;
        }
        for (const itemCh of rangeChapters) {
          itemCh.included = targetVal;
        }
        state.lastClickedIdx = idx;
        state.lastClickedChapState = targetVal;
        renderAllChapterViews();
      } else {
        const targetVal = fromCheckbox ? cb.checked : !ch.included;
        ch.included = targetVal;
        state.lastClickedIdx = idx;
        state.lastClickedChapState = targetVal;
        renderAllChapterViews();
      }
    };

    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      applyChapterClick(e, true);
    });
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, button, a, select, textarea')) return;
      applyChapterClick(e, false);
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
      const prevVol = ch.volume;
      ch.volume = volInput.value.trim() || 'Volume 01';
      if (
        state.volumeFilter &&
        state.volumeFilter === prevVol &&
        !state.chapters.some((c) => c.volume === state.volumeFilter)
      ) {
        state.volumeFilter = null;
      }
      renderAllChapterViews();
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
    createIconButtonContent(previewBtn, 'eye', t('btnPreviewShort'), { size: 14 });
    previewBtn.title = t('btnPreviewTitle');
    previewBtn.setAttribute('aria-label', `${t('btnPreviewTitle')}: ${ch.displayTitle}`);
    previewBtn.addEventListener('click', () => state.onOpenChapterPreview?.(idx));
    statusWrap.appendChild(previewBtn);

    tdStatus.appendChild(statusWrap);
    tr.append(tdCheck, tdIdx, tdVol, tdTitle, tdStatus);
    fragment.appendChild(tr);
  });

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
    metadata: {
      ...state.metadata,
      requiresTabRender: Boolean(state.seriesRequiresTab || state.metadata?.requiresTabRender)
    },
    parserId: state.activeParser?.id || 'auto',
    chapters: state.chapters,
    ttlDays: state.options.cacheTtlDays
  });
}

export async function getChapterFromCaches(ch, cacheKey) {
  const resolvedKey = ch?.pinnedCacheKey || cacheKey;
  let rec = state.chapterCache.get(resolvedKey);
  if (!rec && state.options.cacheTtlDays > 0) {
    const diskRec = await cacheStore.getChapter(resolvedKey);
    if (diskRec) {
      rec = {
        chapterTitle: diskRec.chapterTitle,
        subtitle: diskRec.subtitle,
        contentXml: diskRec.contentXml,
        ...(diskRec.imageFallbacks ? { imageFallbacks: diskRec.imageFallbacks } : {})
      };
      state.chapterCache.set(resolvedKey, rec);
    }
  }
  return rec ? hydrateCachedChapter(ch, rec) : null;
}

export async function hydrateChaptersFromCache(chapters) {
  const keys = chapters.map((ch) => ch.pinnedCacheKey || getCacheKey(ch.url));
  const diskMap = await cacheStore.hasChapters(keys);
  return chapters.map((ch) => {
    const key = ch.pinnedCacheKey || getCacheKey(ch.url);
    const diskRec = diskMap.get(key);
    if (diskRec) {
      state.chapterCache.set(key, {
        chapterTitle: diskRec.chapterTitle,
        subtitle: diskRec.subtitle,
        contentXml: diskRec.contentXml,
        ...(diskRec.imageFallbacks ? { imageFallbacks: diskRec.imageFallbacks } : {})
      });
    }
    return {
      ...ch,
      status: state.chapterCache.has(key) ? 'ok' : 'pending',
      errorMsg: ''
    };
  });
}
