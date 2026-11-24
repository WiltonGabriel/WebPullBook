import { normalizeSpaces, normalizeUrl, sanitizeFilename } from '../core/parser-engine.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import { $, normalizeRuleDomain, state, t } from './state.js';
import { appendLog, hideBanner, showBanner } from './logger.js';
import { readOptionsFromUi, saveOptions, syncMetadataToUi } from './options-storage.js';
import { populateRangeSelects, renderAllChapterViews } from './chapters-ui.js';
import { openChapterPreviewForTarget } from './chapter-modals.js';
import { generateDefaultCoverDataUrl } from './cover-ui.js';

let mergeCandidates = [];

export function getMergeCandidates() {
  return mergeCandidates;
}

export function setMergeCandidates(list) {
  mergeCandidates = Array.isArray(list) ? list : [];
}

export async function queryMergeableTabs(allWindows = false) {
  let tabs = [];
  if (chrome?.tabs?.query) {
    tabs = await chrome.tabs.query(allWindows ? {} : { currentWindow: true });
    if ((!tabs || tabs.length === 0) && !allWindows) {
      tabs = await chrome.tabs.query({});
    }
  }
  const currentWorkspaceUrl = window.location.href.split('?')[0];
  return (tabs || [])
    .filter((tab) => {
      const u = tab.url || '';
      return /^https?:\/\//i.test(u) && !u.startsWith(currentWorkspaceUrl);
    })
    .map((tab, i) => {
      const cleanUrl = normalizeUrl(tab.url);
      const tabTitle = normalizeSpaces(tab.title) || cleanUrl;
      let host = '';
      try {
        host = new URL(cleanUrl).hostname;
      } catch {
        host = cleanUrl;
      }
      return {
        uid: `${tab.id ?? 'x'}_${i}`,
        tabId: typeof tab.id === 'number' ? tab.id : null,
        url: cleanUrl,
        host,
        title: tabTitle,
        customVolume: `Volume ${String(i + 1).padStart(2, '0')}`,
        included: true
      };
    });
}

function updateMergeTabsHeaderState() {
  const total = mergeCandidates.length;
  const selectedCount = mergeCandidates.filter((item) => item.included).length;
  $('merge-tabs-summary').textContent = t('mergeTabsSummary', {
    total,
    selected: selectedCount
  });
  $('merge-select-all').checked = total > 0 && selectedCount === total;
  $('merge-select-all').indeterminate = selectedCount > 0 && selectedCount < total;
  const confirmBtn = $('btn-confirm-merge-tabs');
  confirmBtn.disabled = selectedCount === 0;
  confirmBtn.textContent = `${t('btnConfirmMergeTabs')} (${selectedCount})`;

  const mode = $('merge-organize-mode').value || 'same-book';
  $('merge-collection-wrap').classList.toggle('hidden', mode === 'separate-books');
}

export function renderMergeTabsList() {
  const listEl = $('merge-tabs-list');
  const mode = $('merge-organize-mode').value || 'same-book';
  const frag = document.createDocumentFragment();

  mergeCandidates.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = item.included ? 'merge-tab-row' : 'merge-tab-row unchecked';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.included;
    cb.addEventListener('change', () => {
      item.included = cb.checked;
      row.classList.toggle('unchecked', !item.included);
      updateMergeTabsHeaderState();
    });

    const idxSpan = document.createElement('span');
    idxSpan.className = 'merge-tab-idx';
    idxSpan.textContent = `#${idx + 1}`;

    const mainCol = document.createElement('div');
    mainCol.className = 'merge-tab-main';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = item.title;
    titleInput.addEventListener('input', () => {
      item.title = titleInput.value;
    });
    const hostSpan = document.createElement('span');
    hostSpan.className = 'merge-tab-host';
    hostSpan.textContent = `${item.host} — ${item.url}`;
    hostSpan.title = item.url;
    mainCol.append(titleInput, hostSpan);

    const volInput = document.createElement('input');
    volInput.type = 'text';
    volInput.className = 'merge-tab-vol';
    if (mode === 'same-book') {
      volInput.value = 'Volume 01';
      volInput.disabled = true;
    } else if (mode === 'separate-books') {
      volInput.value = item.customBookTitle ?? item.title;
      volInput.disabled = false;
      volInput.addEventListener('input', () => {
        item.customBookTitle = volInput.value;
      });
    } else {
      volInput.value = item.customVolume;
      volInput.disabled = false;
      volInput.addEventListener('input', () => {
        item.customVolume = volInput.value;
      });
    }

    const actions = document.createElement('div');
    actions.className = 'merge-tab-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn ghost sm';
    upBtn.textContent = '↑';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => {
      if (idx === 0) return;
      [mergeCandidates[idx - 1], mergeCandidates[idx]] = [mergeCandidates[idx], mergeCandidates[idx - 1]];
      renderMergeTabsList();
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn ghost sm';
    downBtn.textContent = '↓';
    downBtn.disabled = idx === mergeCandidates.length - 1;
    downBtn.addEventListener('click', () => {
      if (idx >= mergeCandidates.length - 1) return;
      [mergeCandidates[idx], mergeCandidates[idx + 1]] = [mergeCandidates[idx + 1], mergeCandidates[idx]];
      renderMergeTabsList();
    });

    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = 'btn ghost sm';
    eyeBtn.textContent = t('btnPreviewShort');
    eyeBtn.title = t('btnPreviewTitle');
    eyeBtn.addEventListener('click', () => {
      openChapterPreviewForTarget(
        {
          url: item.url,
          tabId: item.tabId,
          displayTitle: normalizeSpaces(item.title) || item.url,
          readOnlyPreview: true
        },
        genericHtmlParser,
        { readOnly: true }
      );
    });

    actions.append(upBtn, downBtn, eyeBtn);
    row.append(cb, idxSpan, mainCol, volInput, actions);
    frag.appendChild(row);
  });

  listEl.replaceChildren(frag);
  updateMergeTabsHeaderState();
}

export function applyMergedTabsSelection() {
  if (state.running || state.batchRunning) {
    showBanner(t('msgLoadBlockedExportRunning'), 'error');
    return;
  }
  const chosen = mergeCandidates.filter((item) => item.included);
  if (chosen.length === 0) {
    showBanner(t('msgNoTabsSelected'), 'error');
    return;
  }

  const mode = $('merge-organize-mode').value || 'same-book';
  const rawBookTitle = normalizeSpaces($('merge-collection-title').value);
  const fallbackTitle =
    state.options.uiLang === 'en'
      ? `Open Tabs Anthology (${chosen.length})`
      : `Coletânea de Abas (${chosen.length})`;
  const defaultTitle = rawBookTitle || fallbackTitle;

  const defaultCover = generateDefaultCoverDataUrl({ title: defaultTitle, author: 'WebPullBook' });
  state.activeParser = genericHtmlParser;
  state.seriesRequiresTab = false;
  state.metadata = {
    startingUrl: chosen[0].url,
    title: defaultTitle,
    author: 'WebPullBook',
    language: state.options.uiLang === 'en' ? 'en' : 'pt',
    filename: sanitizeFilename(defaultTitle, true),
    coverUrl: defaultCover,
    coverThumbUrl: defaultCover,
    genres: [],
    synopsis: chosen.map((tab, i) => `${i + 1}. ${normalizeSpaces(tab.title) || tab.url}`).join('\n'),
    status: `${chosen.length} tabs`,
    separateBooksMode: mode === 'separate-books'
  };

  state.chapters = chosen.map((tab, i) => {
    const cleanTitle = normalizeSpaces(tab.title) || tab.url;
    let volumeLabel = 'Volume 01';
    if (mode === 'same-book-volumes') {
      volumeLabel = normalizeSpaces(tab.customVolume) || `Volume ${String(i + 1).padStart(2, '0')}`;
    } else if (mode === 'separate-books') {
      volumeLabel = normalizeSpaces(tab.customBookTitle || tab.title) || `Livro ${String(i + 1).padStart(2, '0')}`;
    }
    return {
      id: `ch_${i + 1}`,
      index: i + 1,
      url: tab.url,
      tabId: tab.tabId,
      numText: `${i + 1}`,
      titleText: cleanTitle,
      dateText: '',
      displayTitle: mode === 'separate-books' ? cleanTitle : `${i + 1}. ${cleanTitle}`,
      volume: volumeLabel,
      included: true,
      status: 'pending',
      errorMsg: ''
    };
  });

  const targetPackRadio =
    mode === 'separate-books'
      ? document.querySelector('input[name="pack-mode"][value="by-volume"]')
      : document.querySelector('input[name="pack-mode"][value="single"]');
  if (targetPackRadio) targetPackRadio.checked = true;

  state.volumeFilter = null;
  state.lastClickedIdx = -1;
  state.lastClickedChapState = null;
  state.lastClickedVolIdx = -1;
  state.lastClickedVolState = null;
  syncMetadataToUi();
  populateRangeSelects();
  renderAllChapterViews();

  $('merge-tabs-modal').close('confirm');
  appendLog(`Modo Juntar Abas: ${chosen.length} aba(s) carregadas (${mode}).`);
  showBanner(t('msgTabsMerged', { count: chosen.length }), 'success');
}

export async function handleMergeOpenTabs() {
  hideBanner();
  try {
    const allWindows = $('merge-all-windows').checked;
    const detected = await queryMergeableTabs(allWindows);
    if (detected.length === 0) {
      showBanner(t('msgNoTabsFound'), 'error');
      return;
    }

    mergeCandidates = detected;
    $('merge-collection-title').value =
      state.options.uiLang === 'en'
        ? `Open Tabs Anthology (${detected.length})`
        : `Coletânea de Abas (${detected.length})`;
    renderMergeTabsList();
    $('merge-tabs-modal').showModal();
  } catch (err) {
    appendLog(`Erro ao juntar abas: ${err.message}`, 'error');
    showBanner(`Erro: ${err.message}`, 'error');
  }
}

function injectWebPullBookPicker(requestId, hudHintText, cancelText, mode) {
  if (typeof window.__wpbPickerCleanup === 'function') {
    window.__wpbPickerCleanup();
  }

  const UTILITY_RX =
    /^(?:flex|inline-flex|grid|block|inline-block|hidden|relative|absolute|fixed|sticky|prose|container|mx-auto|(?:m|p|px|py|pt|pb|pl|pr|mt|mb|ml|mr|gap|space-[xy]|w|h|min-w|min-h|max-w|max-h|text|bg|border|rounded|shadow|overflow|items|justify|self|col|row|z)-.+|_[a-zA-Z0-9_-]{4,}|[a-zA-Z0-9-]+_[a-zA-Z0-9]{5,})$/;
  const esc = (v) =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(v)
      : String(v).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  const stableId = (id) => Boolean(id) && !/^\d/.test(id) && !/^:?r\d+:?$/i.test(id) && !/_[a-zA-Z0-9]{6,}$/.test(id);
  const simpleSel = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute('id') || '';
    if (stableId(id)) return `#${esc(id)}`;
    const raw = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
    const classes = raw
      .trim()
      .split(/\s+/)
      .filter((c) => c && !UTILITY_RX.test(c) && !c.startsWith('wpb-'));
    if (classes.length > 0) return `${tag}.${classes.slice(0, 2).map(esc).join('.')}`;
    return tag;
  };
  const pickTargetEl = (rawEl) => {
    const el = rawEl;
    if (mode === 'list') {
      const container = el?.closest?.('ul, ol, table, section, .chapter-list, .chapters, #chapter-list, div');
      if (container && container.querySelectorAll('a[href]').length >= 2) return container;
    } else if (mode === 'content') {
      if (el?.matches?.('p, span, strong, em, b, i') && el.parentElement) {
        const proseWrap = el.closest('article, main, .chapter-content, .epcontent, .entry-content, div, section');
        if (proseWrap) return proseWrap;
      }
    }
    return el;
  };
  const buildSelector = (targetEl) => {
    if (!targetEl || targetEl.nodeType !== 1) return '';
    const base = simpleSel(targetEl);
    if (mode !== 'list') {
      try {
        if (base && document.querySelectorAll(base).length === 1) return base;
      } catch {
        // continue building chain
      }
    }
    const parts = [base];
    let cur = targetEl.parentElement;
    for (let i = 0; i < 3 && cur && cur.tagName.toLowerCase() !== 'html'; i++) {
      const pSel = simpleSel(cur);
      parts.unshift(pSel);
      const joined = parts.join(' > ');
      if (mode === 'list') {
        const listSel = `${pSel.startsWith('#') || pSel.includes('.') ? `${pSel} ${base}` : joined} a[href]`;
        try {
          if (document.querySelectorAll(listSel).length >= 2) return listSel;
        } catch {
          // continue
        }
      } else {
        try {
          if (document.querySelectorAll(joined).length === 1) return joined;
        } catch {
          // continue
        }
      }
      if (pSel.startsWith('#') || cur.tagName.toLowerCase() === 'body') break;
      cur = cur.parentElement;
    }
    return mode === 'list' ? `${parts.join(' > ')} a` : parts.join(' > ');
  };

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    border: '2px solid #2563eb',
    background: 'rgba(37, 99, 235, 0.14)',
    borderRadius: '4px',
    display: 'none'
  });

  const hud = document.createElement('div');
  Object.assign(hud.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    background: '#111827',
    color: '#f9fafb',
    padding: '8px 14px',
    borderRadius: '10px',
    font: '600 13px/1.35 system-ui, sans-serif',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    boxShadow: '0 8px 28px rgba(0,0,0,.35)'
  });

  const hudLabel = document.createElement('span');
  hudLabel.textContent = hudHintText;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = cancelText;
  Object.assign(cancelBtn.style, {
    background: '#374151',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '4px 10px',
    cursor: 'pointer',
    font: '600 12px/1 system-ui, sans-serif'
  });
  hud.append(hudLabel, cancelBtn);
  document.documentElement.append(overlay, hud);

  let activeTarget = null;
  const cleanup = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    hud.remove();
    delete window.__wpbPickerCleanup;
  };
  window.__wpbPickerCleanup = cleanup;

  const onMove = (e) => {
    if (hud.contains(e.target)) {
      overlay.style.display = 'none';
      return;
    }
    const target = pickTargetEl(e.target);
    if (!target || target === document.documentElement) return;
    activeTarget = target;
    const rect = target.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: 'block',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
    const previewSel = buildSelector(target);
    hudLabel.textContent = previewSel ? `${hudHintText} -> ${previewSel}` : hudHintText;
  };

  const safeSendMessage = (payload) => {
    try {
      Promise.resolve(chrome.runtime.sendMessage(payload)).catch(() => {});
    } catch {
      // ignore closed extension context
    }
  };

  const onClick = (e) => {
    if (hud.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const target = activeTarget || pickTargetEl(e.target);
    const selector = buildSelector(target);
    cleanup();
    safeSendMessage({ type: 'wpb-selector-picked', requestId, selector });
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
      safeSendMessage({ type: 'wpb-selector-cancelled', requestId });
    }
  };

  cancelBtn.addEventListener('click', () => {
    cleanup();
    safeSendMessage({ type: 'wpb-selector-cancelled', requestId });
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

export async function handleStartSelectorPicker(field) {
  if (!chrome?.tabs?.query || !chrome?.scripting?.executeScript) {
    showBanner(t('msgPickerFailed', { error: 'chrome.scripting unavailable' }), 'error');
    return;
  }

  const fieldMap = {
    list: { inputId: 'opt-list-selector', targetLabel: t('pickerTargetList'), mode: 'list' },
    content: { inputId: 'opt-content-selector', targetLabel: t('pickerTargetContent'), mode: 'content' },
    exclude: { inputId: 'opt-exclude-selector', targetLabel: t('pickerTargetExclude'), mode: 'exclude' }
  };
  const cfg = fieldMap[field];
  if (!cfg) return;

  if (state.pickerRequest?.tabId) {
    await chrome.scripting
      .executeScript({
        target: { tabId: state.pickerRequest.tabId },
        func: () => window.__wpbPickerCleanup?.()
      })
      .catch(() => {});
    state.pickerRequest = null;
  }

  const tabs = await chrome.tabs.query({});
  const httpTabs = tabs.filter((tb) => /^https?:\/\//i.test(tb.url || ''));
  if (httpTabs.length === 0) {
    showBanner(t('msgPickerNoTab'), 'error');
    return;
  }

  const targetHost = normalizeRuleDomain($('starting-url').value.trim());
  const matchingTab =
    httpTabs.find((tb) => targetHost && normalizeRuleDomain(tb.url) === targetHost) ||
    httpTabs.find((tb) => tb.active) ||
    httpTabs[0];

  const requestId = `pick_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  state.pickerRequest = { requestId, field, ...cfg, tabId: matchingTab.id };

  try {
    await chrome.tabs.update(matchingTab.id, { active: true });
    if (matchingTab.windowId && chrome.windows?.update) {
      await chrome.windows.update(matchingTab.windowId, { focused: true }).catch(() => {});
    }
    await chrome.scripting.executeScript({
      target: { tabId: matchingTab.id },
      func: injectWebPullBookPicker,
      args: [requestId, t('pickerHudHint', { target: cfg.targetLabel }), t('pickerHudCancel'), cfg.mode]
    });
  } catch (err) {
    state.pickerRequest = null;
    showBanner(t('msgPickerFailed', { error: err.message }), 'error');
  }
}

export function registerPickerMessageListener() {
  if (!chrome?.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || !state.pickerRequest || msg.requestId !== state.pickerRequest.requestId) return;
    if (sender?.tab?.id != null && sender.tab.id !== state.pickerRequest.tabId) return;
    const req = state.pickerRequest;
    state.pickerRequest = null;

    if (msg.type === 'wpb-selector-picked' && msg.selector) {
      const input = $(req.inputId);
      if (input) {
        if (req.field === 'exclude' && input.value.trim()) {
          const parts = input.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (!parts.includes(msg.selector)) parts.push(msg.selector);
          input.value = parts.join(', ');
        } else {
          input.value = msg.selector;
        }
        readOptionsFromUi();
        saveOptions();
      }
      chrome.tabs?.getCurrent?.((selfTab) => {
        if (selfTab?.id) {
          Promise.resolve(chrome.tabs.update(selfTab.id, { active: true })).catch(() => {});
        }
      });
      appendLog(`Seletor visual (${req.field}): ${msg.selector}`);
      showBanner(t('msgPickerCaptured', { target: req.targetLabel, selector: msg.selector }), 'success');
    }
  });
}
