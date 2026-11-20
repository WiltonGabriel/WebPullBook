import { normalizeSpaces } from '../core/parser-engine.js';
import { $, getCacheKey, state } from './state.js';
import { showBanner } from './logger.js';
import {
  handleRedetectVolumes,
  populateRangeSelects,
  renderAllChapterViews
} from './chapters-ui.js';

export function wireVolumeAndUrlModalEvents() {
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
}
