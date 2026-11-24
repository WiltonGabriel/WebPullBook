import { normalizeSpaces, resolveSafeHttpUrl } from '../core/parser-engine.js';
import { $, state, t } from './state.js';
import { showBanner } from './logger.js';
import {
  handleRedetectVolumes,
  hydrateChaptersFromCache,
  populateRangeSelects,
  renderAllChapterViews
} from './chapters-ui.js';

function syncVolumeFilterAfterRename() {
  if (state.volumeFilter && !state.chapters.some((c) => c.volume === state.volumeFilter)) {
    state.volumeFilter = null;
  }
}

export function wireVolumeAndUrlModalEvents() {
  const volDialog = $('volume-modal');
  $('btn-redetect-volumes').addEventListener('click', () => {
    if (state.running || state.batchRunning) {
      showBanner(t('msgLoadBlockedExportRunning'), 'error');
      return;
    }
    handleRedetectVolumes();
  });
  $('btn-open-volume-modal').addEventListener('click', () => {
    if (state.running || state.batchRunning) {
      showBanner(t('msgLoadBlockedExportRunning'), 'error');
      return;
    }
    if (state.chapters.length) {
      $('vol-range-to').value = String(Math.min(25, state.chapters.length));
    }
    volDialog.showModal();
  });
  volDialog.addEventListener('close', () => {
    volDialog.returnValue = '';
  });

  $('btn-apply-chunk-vols').addEventListener('click', () => {
    if (state.running || state.batchRunning) {
      showBanner(t('msgLoadBlockedExportRunning'), 'error');
      return;
    }
    const size = Math.max(1, parseInt($('vol-chunk-size').value, 10) || 25);
    const startNum = Math.max(1, parseInt($('vol-chunk-start').value, 10) || 1);
    state.chapters.forEach((ch, idx) => {
      const volNum = startNum + Math.floor(idx / size);
      ch.volume = `Volume ${String(volNum).padStart(2, '0')}`;
    });
    syncVolumeFilterAfterRename();
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(`Volumes: ${size} caps/vol.`, 'success');
  });

  $('btn-apply-range-vol').addEventListener('click', () => {
    if (state.running || state.batchRunning) {
      showBanner(t('msgLoadBlockedExportRunning'), 'error');
      return;
    }
    const from = Math.max(1, parseInt($('vol-range-from').value, 10) || 1) - 1;
    const to = Math.min(state.chapters.length, parseInt($('vol-range-to').value, 10) || state.chapters.length) - 1;
    const name = $('vol-range-name').value.trim() || 'Volume 01';
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      if (state.chapters[i]) state.chapters[i].volume = name;
    }
    syncVolumeFilterAfterRename();
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(`${name}`, 'success');
  });

  $('btn-apply-selected-vol').addEventListener('click', () => {
    if (state.running || state.batchRunning) {
      showBanner(t('msgLoadBlockedExportRunning'), 'error');
      return;
    }
    const name = $('vol-selected-name').value.trim() || 'Volume 01';
    let count = 0;
    for (const ch of state.chapters) {
      if (ch.included) {
        ch.volume = name;
        count++;
      }
    }
    syncVolumeFilterAfterRename();
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(`${count} -> "${name}".`, 'success');
  });

  $('btn-apply-batch-vols').addEventListener('click', () => {
    if (state.running || state.batchRunning) {
      showBanner(t('msgLoadBlockedExportRunning'), 'error');
      return;
    }
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
    syncVolumeFilterAfterRename();
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(`Batch: ${applied}`, 'success');
  });

  const editDialog = $('edit-urls-modal');
  $('btn-edit-urls').addEventListener('click', () => {
    if (state.running || state.batchRunning) {
      showBanner(t('msgLoadBlockedExportRunning'), 'error');
      return;
    }
    $('edit-urls-textarea').value = state.chapters
      .map((c) => `${c.url} | ${c.displayTitle} | ${c.volume}`)
      .join('\n');
    editDialog.showModal();
  });
  editDialog.addEventListener('close', async () => {
    if (editDialog.returnValue === 'save') {
      if (state.running || state.batchRunning) {
        showBanner(t('msgLoadBlockedExportRunning'), 'error');
        editDialog.returnValue = '';
        return;
      }
      const existingByUrl = new Map(state.chapters.map((c) => [c.url, c]));
      const lines = $('edit-urls-textarea')
        .value.split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const parsedRows = [];
      let invalidCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const firstPipe = line.indexOf('|');
        const lastPipe = line.lastIndexOf('|');
        const rawUrl = (firstPipe === -1 ? line : line.slice(0, firstPipe)).trim();
        let displayTitle = '';
        let volume = 'Volume 01';
        if (firstPipe !== -1) {
          if (lastPipe > firstPipe) {
            displayTitle = line.slice(firstPipe + 1, lastPipe).trim();
            volume = line.slice(lastPipe + 1).trim() || 'Volume 01';
          } else {
            displayTitle = line.slice(firstPipe + 1).trim();
          }
        }
        const safeUrl = /^urn:webpullbook:/i.test(rawUrl)
          ? rawUrl
          : resolveSafeHttpUrl(rawUrl, state.metadata.startingUrl || undefined);
        if (!safeUrl) {
          invalidCount++;
          continue;
        }
        const prev = existingByUrl.get(safeUrl) || existingByUrl.get(rawUrl);
        const resolvedTitle = displayTitle || prev?.displayTitle || safeUrl;
        parsedRows.push({
          id: `ch_${parsedRows.length + 1}`,
          index: parsedRows.length + 1,
          url: safeUrl,
          ...(prev?.pinnedCacheKey ? { pinnedCacheKey: prev.pinnedCacheKey } : {}),
          ...(prev?.readOnlyPreview ? { readOnlyPreview: true } : {}),
          ...(prev?.edited ? { edited: true } : {}),
          numText: '',
          titleText: resolvedTitle,
          dateText: '',
          displayTitle: resolvedTitle,
          volume,
          included: true,
          status: 'pending',
          errorMsg: ''
        });
      }

      if (invalidCount > 0 && parsedRows.length === 0) {
        showBanner(t('msgEditUrlsInvalid', { count: invalidCount }), 'error');
        editDialog.returnValue = '';
        return;
      }
      state.chapters = await hydrateChaptersFromCache(parsedRows);
      state.volumeFilter = null;
      state.lastClickedIdx = -1;
      state.lastClickedChapState = null;
      state.lastClickedVolIdx = -1;
      state.lastClickedVolState = null;
      populateRangeSelects();
      renderAllChapterViews();
      showBanner(
        invalidCount > 0
          ? t('msgEditUrlsInvalid', { count: invalidCount })
          : `${state.chapters.length} caps.`,
        invalidCount > 0 ? 'error' : 'success'
      );
    }
    editDialog.returnValue = '';
  });
}
