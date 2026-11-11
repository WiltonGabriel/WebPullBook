import {
  DEFAULT_EPUB_CSS,
  buildEpubStylesheet,
  downloadAndParseChapter,
  extractVolumeNumber,
  normalizeSpaces,
  normalizeUrl,
  sanitizeFilename,
  toHighResCoverUrl
} from '../core/parser-engine.js';
import { getParserById, loadSeriesWithParser, parserRegistry } from '../parsers/index.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import { exporterRegistry } from '../exporters/index.js';
import { applyI18nToDom, translate } from './i18n.js';

const DEFAULT_OPTIONS = {
  uiLang: 'pt',
  theme: 'system',
  outputFormat: 'epub',
  customFilename: '%Filename%',
  subfolder: true,
  noSaveAs: true,
  removeIllegal: true,
  createEpub3: true,
  addInfoPage: true,
  removeNavLinks: true,
  parserId: 'auto',
  customListSelector: '',
  customContentSelector: '',
  customExcludeSelector: '',
  delayMs: 350,
  maxChaptersPerEpub: 10000,
  compressedResolution: 1080,
  compressedFormat: 'jpg',
  restrictCoverJpeg: true,
  compressImages: false,
  skipImages: false,
  useSvgForImages: false,
  continueOnError: true,
  renderWithTab: false,
  skip404: false,
  fontFamily: 'reader-default',
  textAlign: 'justify',
  lineHeight: 1.55,
  paragraphIndent: false,
  stylesheet: DEFAULT_EPUB_CSS
};

const state = {
  metadata: {
    startingUrl: '',
    title: '',
    author: '',
    language: 'pt',
    filename: '',
    coverUrl: '',
    coverThumbUrl: '',
    genres: [],
    synopsis: '',
    status: ''
  },
  activeParser: genericHtmlParser,
  chapters: [],
  chapterCache: new Map(),
  library: [],
  options: { ...DEFAULT_OPTIONS },
  volumeFilter: null,
  showUrls: false,
  lastClickedIdx: -1,
  running: false,
  paused: false,
  abortController: null,
  logs: []
};

const $ = (id) => document.getElementById(id);

function t(key, vars = {}) {
  return translate(state.options.uiLang || 'pt', key, vars);
}

function getCacheKey(chapterUrl) {
  return `${normalizeUrl(chapterUrl)}|${state.activeParser?.id || 'auto'}|${Boolean(state.options.skipImages)}|${Boolean(state.options.removeNavLinks)}|${state.options.customContentSelector || ''}|${state.options.customExcludeSelector || ''}`;
}

function appendLog(msg) {
  const stamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  state.logs.push(`[${stamp}] ${msg}`);
  if (state.logs.length > 2000) state.logs.shift();
  $('log-output').textContent = state.logs.join('\n');
  const badge = $('log-badge');
  badge.textContent = String(state.logs.length);
  badge.classList.remove('hidden');
}

function showBanner(msg, type = 'info') {
  const banner = $('status-banner');
  banner.textContent = msg;
  banner.className = `banner ${type}`;
  banner.classList.remove('hidden');
}

function hideBanner() {
  $('status-banner').classList.add('hidden');
}

function switchTab(targetTab) {
  for (const b of document.querySelectorAll('.tab-btn')) {
    b.classList.toggle('active', b.dataset.tab === targetTab);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('hidden', panel.id !== `tab-${targetTab}`);
  }
}

function applyThemeChoice(theme) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) return;
  if (theme === 'dark' || theme === 'light') {
    meta.content = theme;
    try {
      localStorage.setItem('wpb-color-scheme', theme);
    } catch {
      // ignore
    }
  } else {
    meta.content = 'light dark';
    try {
      localStorage.removeItem('wpb-color-scheme');
    } catch {
      // ignore
    }
  }
}

async function saveOptions() {
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ wpbOptions: state.options });
  }
}

async function loadOptions() {
  if (chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbOptions');
    if (res?.wpbOptions) {
      state.options = { ...DEFAULT_OPTIONS, ...res.wpbOptions };
    }
  }
  syncOptionsToUi();
  applyThemeChoice(state.options.theme);
  applyLanguageChoice(state.options.uiLang);
}

async function loadLibrary() {
  if (chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbLibrary');
    if (Array.isArray(res?.wpbLibrary)) {
      state.library = res.wpbLibrary;
    }
  }
  renderLibrary();
}

async function saveLibrary() {
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ wpbLibrary: state.library });
  }
  renderLibrary();
}

function applyLanguageChoice(lang) {
  const normalized = lang === 'en' ? 'en' : 'pt';
  state.options.uiLang = normalized;
  $('ui-lang-top').value = normalized;
  $('opt-ui-lang').value = normalized;
  applyI18nToDom(normalized);
  populateRegistries();
  syncOptionsToUi();
  syncMetadataToUi();
  renderAllChapterViews();
  renderLibrary();
  if (state.logs.length === 0) {
    $('log-output').textContent = t('logsEmpty');
  }
}

function populateRegistries() {
  const parserSel = $('opt-parser');
  const currentVal = parserSel.value || state.options.parserId || 'auto';
  const autoOpt = document.createElement('option');
  autoOpt.value = 'auto';
  autoOpt.textContent = t('parserAutoOption');
  const parserOpts = [autoOpt];
  for (const p of parserRegistry.list()) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    parserOpts.push(opt);
  }
  parserSel.replaceChildren(...parserOpts);
  parserSel.value = currentVal;

  const fmtSel = $('output-format');
  const currentFmt = fmtSel.value || state.options.outputFormat || 'epub';
  const fmtOpts = exporterRegistry.list().map((exp) => {
    const opt = document.createElement('option');
    opt.value = exp.id;
    opt.textContent = exp.name;
    return opt;
  });
  fmtSel.replaceChildren(...fmtOpts);
  fmtSel.value = currentFmt;
}

function updatePackButtonLabel() {
  const exporter = exporterRegistry.get($('output-format').value || 'epub');
  $('btn-pack-epub').textContent =
    exporter.id === 'epub'
      ? t('btnPackEpub')
      : t('btnExportFmt', { ext: exporter.extension.toUpperCase() });
}

function updateFailedButtonsState() {
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

function syncOptionsToUi() {
  const o = state.options;
  $('ui-lang-top').value = o.uiLang || 'pt';
  $('opt-ui-lang').value = o.uiLang || 'pt';
  $('output-format').value = o.outputFormat || 'epub';
  $('opt-theme').value = o.theme;
  $('opt-custom-filename').value = o.customFilename;
  $('opt-subfolder').checked = o.subfolder;
  $('opt-no-save-as').checked = o.noSaveAs;
  $('opt-remove-illegal').checked = o.removeIllegal;
  $('opt-epub3').checked = o.createEpub3;
  $('opt-add-info').checked = o.addInfoPage;
  $('opt-remove-nav').checked = o.removeNavLinks;
  $('opt-parser').value = o.parserId;
  $('opt-list-selector').value = o.customListSelector;
  $('opt-content-selector').value = o.customContentSelector;
  $('opt-exclude-selector').value = o.customExcludeSelector;
  $('opt-delay').value = o.delayMs;
  $('opt-max-chapters').value = o.maxChaptersPerEpub;
  $('opt-img-res').value = o.compressedResolution;
  $('opt-img-fmt').value = o.compressedFormat;
  $('opt-continue-on-error').checked = o.continueOnError !== false;
  $('opt-render-with-tab').checked = Boolean(o.renderWithTab);
  $('opt-cover-jpeg').checked = o.restrictCoverJpeg;
  $('opt-compress-images').checked = o.compressImages;
  $('opt-skip-images').checked = o.skipImages;
  $('opt-use-svg').checked = o.useSvgForImages;
  $('opt-skip-404').checked = o.skip404;
  $('opt-font-family').value = o.fontFamily || 'reader-default';
  $('opt-text-align').value = o.textAlign || 'justify';
  $('opt-line-height').value = o.lineHeight ?? 1.55;
  $('opt-paragraph-indent').checked = Boolean(o.paragraphIndent);
  $('opt-stylesheet').value = o.stylesheet;
  updatePackButtonLabel();
}

function readOptionsFromUi() {
  state.options = {
    uiLang: $('opt-ui-lang').value || 'pt',
    theme: $('opt-theme').value,
    outputFormat: $('output-format').value || 'epub',
    customFilename: $('opt-custom-filename').value.trim() || '%Filename%',
    subfolder: $('opt-subfolder').checked,
    noSaveAs: $('opt-no-save-as').checked,
    removeIllegal: $('opt-remove-illegal').checked,
    createEpub3: $('opt-epub3').checked,
    addInfoPage: $('opt-add-info').checked,
    removeNavLinks: $('opt-remove-nav').checked,
    parserId: $('opt-parser').value || 'auto',
    customListSelector: $('opt-list-selector').value.trim(),
    customContentSelector: $('opt-content-selector').value.trim(),
    customExcludeSelector: $('opt-exclude-selector').value.trim(),
    delayMs: Math.max(0, parseInt($('opt-delay').value, 10) || 0),
    maxChaptersPerEpub: Math.max(1, parseInt($('opt-max-chapters').value, 10) || 10000),
    compressedResolution: Math.max(200, parseInt($('opt-img-res').value, 10) || 1080),
    compressedFormat: $('opt-img-fmt').value,
    continueOnError: $('opt-continue-on-error').checked,
    renderWithTab: $('opt-render-with-tab').checked,
    restrictCoverJpeg: $('opt-cover-jpeg').checked,
    compressImages: $('opt-compress-images').checked,
    skipImages: $('opt-skip-images').checked,
    useSvgForImages: $('opt-use-svg').checked,
    skip404: $('opt-skip-404').checked,
    fontFamily: $('opt-font-family').value || 'reader-default',
    textAlign: $('opt-text-align').value || 'justify',
    lineHeight: Math.min(2.4, Math.max(1.1, parseFloat($('opt-line-height').value) || 1.55)),
    paragraphIndent: $('opt-paragraph-indent').checked,
    stylesheet: $('opt-stylesheet').value
  };
  if (state.options.parserId !== 'auto') {
    state.activeParser = getParserById(state.options.parserId) || state.activeParser;
  }
}

function updateCoverPreview() {
  const url = $('meta-cover-url').value.trim();
  const img = $('cover-preview');
  const placeholder = $('cover-placeholder');
  if (url) {
    img.src = url;
    img.hidden = false;
    placeholder.classList.add('hidden');
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    placeholder.classList.remove('hidden');
  }
}

function syncMetadataToUi() {
  const m = state.metadata;
  $('starting-url').value = m.startingUrl || '';
  $('meta-title').value = m.title || '';
  $('meta-author').value = m.author || '';
  $('meta-language').value = m.language || 'pt';
  $('meta-filename').value = m.filename || sanitizeFilename(m.title || '', true);
  $('meta-cover-url').value = m.coverUrl || '';
  $('meta-genres').value = (m.genres || []).join(', ');
  $('meta-synopsis').value = m.synopsis || '';
  $('parser-badge').textContent = t('parserBadge', { name: state.activeParser.name });
  $('series-status-pill').textContent =
    m.status || (state.chapters.length ? t('statusCapsCount', { count: state.chapters.length }) : t('statusWaitingUrl'));
  updateCoverPreview();
}

function readMetadataFromUi() {
  state.metadata.startingUrl = $('starting-url').value.trim();
  state.metadata.title = $('meta-title').value.trim() || 'WebPullBook';
  state.metadata.author = $('meta-author').value.trim() || '<unknown>';
  state.metadata.language = $('meta-language').value.trim() || 'pt';
  state.metadata.filename = $('meta-filename').value.trim() || sanitizeFilename(state.metadata.title, true);
  state.metadata.coverUrl = $('meta-cover-url').value.trim();
  state.metadata.genres = $('meta-genres').value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  state.metadata.synopsis = $('meta-synopsis').value.trim();
}

function getVolumeGroups() {
  const map = new Map();
  for (const ch of state.chapters) {
    const vol = ch.volume || 'Volume 01';
    if (!map.has(vol)) map.set(vol, []);
    map.get(vol).push(ch);
  }
  return Array.from(map.entries()).map(([volume, chapters]) => ({ volume, chapters }));
}

function renderVolumeChips() {
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

function populateRangeSelects() {
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

  const selectedIndices = state.chapters
    .map((c, idx) => (c.included ? idx : -1))
    .filter((i) => i >= 0);
  if (selectedIndices.length > 0) {
    firstSel.value = String(selectedIndices[0]);
    lastSel.value = String(selectedIndices[selectedIndices.length - 1]);
  }
}

function getVisibleChapters() {
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
  const pill = document.createElement('span');
  const cached = state.chapterCache.has(getCacheKey(ch.url));
  const st = ch.status || (cached ? 'ok' : 'pending');

  if (st === 'ok') {
    pill.className = 'status-pill ok';
    pill.textContent = cached ? t('statusCached') : t('statusOk');
  } else if (st === 'error') {
    pill.className = 'status-pill error';
    pill.textContent = t('statusError');
    if (ch.errorMsg) pill.title = ch.errorMsg;
  } else if (st === 'downloading') {
    pill.className = 'status-pill downloading';
    pill.textContent = t('statusDownloading');
  } else if (st === 'skipped') {
    pill.className = 'status-pill';
    pill.textContent = t('statusSkipped');
  } else {
    pill.className = 'status-pill';
    pill.textContent = t('statusPending');
  }
  return pill;
}

function renderChaptersTable() {
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
    if (state.showUrls) {
      const urlSpan = document.createElement('span');
      urlSpan.className = 'chap-url-line';
      urlSpan.textContent = ch.url;
      tdTitle.appendChild(urlSpan);
    }

    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    tdStatus.appendChild(buildStatusPill(ch));

    tr.append(tdCheck, tdIdx, tdVol, tdTitle, tdStatus);
    fragment.appendChild(tr);
  }

  tbody.replaceChildren(fragment);
}

function renderAllChapterViews() {
  renderVolumeChips();
  renderChaptersTable();
}

function renderLibrary() {
  const grid = $('library-grid');
  const badge = $('library-badge');
  if (state.library.length > 0) {
    badge.textContent = String(state.library.length);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (state.library.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted sm';
    empty.textContent = t('libraryEmpty');
    grid.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of state.library) {
    const card = document.createElement('article');
    card.className = 'lib-card';

    if (item.coverUrl) {
      const img = document.createElement('img');
      img.className = 'lib-cover';
      img.src = item.coverUrl;
      img.alt = '';
      card.appendChild(img);
    } else {
      const noCov = document.createElement('div');
      noCov.className = 'lib-cover';
      noCov.textContent = t('noCover');
      card.appendChild(noCov);
    }

    const body = document.createElement('div');
    body.className = 'lib-body';

    const h3 = document.createElement('h3');
    h3.className = 'lib-title';
    h3.textContent = item.title || item.startingUrl;
    h3.title = item.title || item.startingUrl;

    const pMeta = document.createElement('p');
    pMeta.className = 'lib-meta';
    pMeta.textContent = `${item.author || '<unknown>'} • ${t('libChaptersInfo', { total: item.totalChapters || 0 })}`;

    const pLast = document.createElement('p');
    pLast.className = 'lib-meta';
    pLast.textContent = item.lastDownloadedTitle
      ? t('libLastReadInfo', { title: item.lastDownloadedTitle })
      : t('libNoLastRead');

    const actions = document.createElement('div');
    actions.className = 'lib-actions';

    const btnCheckNew = document.createElement('button');
    btnCheckNew.type = 'button';
    btnCheckNew.className = 'btn primary sm';
    btnCheckNew.textContent = t('btnLibCheckNew');
    btnCheckNew.addEventListener('click', () => handleCheckLibrarySeries(item, true));

    const btnOpen = document.createElement('button');
    btnOpen.type = 'button';
    btnOpen.className = 'btn secondary sm';
    btnOpen.textContent = t('btnLibOpen');
    btnOpen.addEventListener('click', () => handleCheckLibrarySeries(item, false));

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn ghost sm';
    btnRemove.textContent = t('btnLibRemove');
    btnRemove.addEventListener('click', async () => {
      state.library = state.library.filter((x) => x.id !== item.id);
      await saveLibrary();
      showBanner(t('msgRemovedFromLibrary'), 'info');
    });

    actions.append(btnCheckNew, btnOpen, btnRemove);
    body.append(h3, pMeta, pLast, actions);
    card.appendChild(body);
    fragment.appendChild(card);
  }

  grid.replaceChildren(fragment);
}

async function saveCurrentSeriesToLibrary() {
  readMetadataFromUi();
  const url = normalizeUrl(state.metadata.startingUrl || $('starting-url').value.trim());
  if (!url && state.chapters.length === 0) {
    showBanner(t('msgSelectAtLeastOne'), 'error');
    return;
  }

  const id = url || `local:${sanitizeFilename(state.metadata.title, true)}`;
  const existingIdx = state.library.findIndex((item) => item.id === id);
  const downloadedChapters = state.chapters.filter(
    (c) => c.status === 'ok' || state.chapterCache.has(getCacheKey(c.url))
  );
  const lastCh =
    downloadedChapters[downloadedChapters.length - 1] ||
    state.chapters[state.chapters.length - 1] ||
    null;

  const entry = {
    id,
    startingUrl: url,
    title: state.metadata.title || 'WebPullBook',
    author: state.metadata.author || '<unknown>',
    coverUrl: state.metadata.coverUrl || '',
    language: state.metadata.language || 'pt',
    parserId: state.activeParser?.id || 'auto',
    totalChapters: state.chapters.length,
    knownUrls: state.chapters.map((c) => normalizeUrl(c.url)),
    lastDownloadedUrl: lastCh ? normalizeUrl(lastCh.url) : existingIdx >= 0 ? state.library[existingIdx].lastDownloadedUrl : '',
    lastDownloadedTitle: lastCh ? lastCh.displayTitle : existingIdx >= 0 ? state.library[existingIdx].lastDownloadedTitle : '',
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    state.library[existingIdx] = entry;
  } else {
    state.library.unshift(entry);
  }

  await saveLibrary();
  appendLog(`Biblioteca atualizada: "${entry.title}" (${entry.totalChapters} capítulos).`);
  showBanner(t('msgSavedToLibrary', { title: entry.title, count: entry.totalChapters }), 'success');
}

async function updateLibraryAfterExport(packagedChapters) {
  const url = normalizeUrl(state.metadata.startingUrl);
  if (!url || packagedChapters.length === 0) return;
  const idx = state.library.findIndex((item) => item.id === url || item.startingUrl === url);
  if (idx < 0) return;

  const lastPackaged = packagedChapters[packagedChapters.length - 1];
  const knownSet = new Set(state.library[idx].knownUrls || []);
  for (const ch of state.chapters) {
    knownSet.add(normalizeUrl(ch.url));
  }

  state.library[idx] = {
    ...state.library[idx],
    title: state.metadata.title || state.library[idx].title,
    author: state.metadata.author || state.library[idx].author,
    coverUrl: state.metadata.coverUrl || state.library[idx].coverUrl,
    totalChapters: Math.max(state.chapters.length, state.library[idx].totalChapters || 0),
    knownUrls: Array.from(knownSet),
    lastDownloadedUrl: normalizeUrl(lastPackaged.url),
    lastDownloadedTitle: lastPackaged.displayTitle,
    updatedAt: new Date().toISOString()
  };
  await saveLibrary();
}

async function handleCheckLibrarySeries(entry, selectOnlyNew = true) {
  switchTab('main');
  if (!entry.startingUrl) return;
  $('starting-url').value = entry.startingUrl;
  await handleLoadSeries(entry.startingUrl);

  if (!selectOnlyNew || state.chapters.length === 0) return;

  const knownSet = new Set((entry.knownUrls || []).map((u) => normalizeUrl(u)));
  const lastIdx = entry.lastDownloadedUrl
    ? state.chapters.findIndex((c) => normalizeUrl(c.url) === normalizeUrl(entry.lastDownloadedUrl))
    : -1;

  let newCount = 0;
  state.chapters.forEach((ch, idx) => {
    const norm = normalizeUrl(ch.url);
    const isNew = !knownSet.has(norm) || (lastIdx >= 0 && idx > lastIdx);
    ch.included = isNew;
    if (isNew) newCount++;
  });

  if (newCount > 0) {
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(t('msgNewChaptersFound', { newCount }), 'success');
  } else {
    state.chapters.forEach((ch) => {
      ch.included = true;
    });
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(t('msgNoNewChapters', { total: state.chapters.length }), 'info');
  }
}

async function handleMergeOpenTabs() {
  hideBanner();
  try {
    let tabs = [];
    if (chrome?.tabs?.query) {
      tabs = await chrome.tabs.query({ currentWindow: true });
      if (!tabs || tabs.length === 0) {
        tabs = await chrome.tabs.query({});
      }
    }

    const currentWorkspaceUrl = window.location.href.split('?')[0];
    const validTabs = tabs.filter((tab) => {
      const u = tab.url || '';
      return /^https?:\/\//i.test(u) && !u.startsWith(currentWorkspaceUrl);
    });

    if (validTabs.length === 0) {
      showBanner(t('msgNoTabsFound'), 'error');
      return;
    }

    state.activeParser = genericHtmlParser;
    const defaultTitle =
      state.options.uiLang === 'en'
        ? `Open Tabs Anthology (${validTabs.length})`
        : `Coletânea de Abas (${validTabs.length})`;

    state.metadata = {
      startingUrl: validTabs[0].url,
      title: defaultTitle,
      author: 'WebPullBook',
      language: state.options.uiLang === 'en' ? 'en' : 'pt',
      filename: sanitizeFilename(defaultTitle, true),
      coverUrl: '',
      coverThumbUrl: '',
      genres: [],
      synopsis: validTabs.map((tab, i) => `${i + 1}. ${tab.title || tab.url}`).join('\n'),
      status: `${validTabs.length} tabs`
    };

    state.chapters = validTabs.map((tab, i) => {
      const cleanUrl = normalizeUrl(tab.url);
      const tabTitle = normalizeSpaces(tab.title) || cleanUrl;
      return {
        id: `ch_${i + 1}`,
        index: i + 1,
        url: cleanUrl,
        tabId: typeof tab.id === 'number' ? tab.id : null,
        numText: `${i + 1}`,
        titleText: tabTitle,
        dateText: '',
        displayTitle: `${i + 1}. ${tabTitle}`,
        volume: 'Volume 01',
        included: true,
        status: 'pending',
        errorMsg: ''
      };
    });

    const singleRadio = document.querySelector('input[name="pack-mode"][value="single"]');
    if (singleRadio) singleRadio.checked = true;

    state.volumeFilter = null;
    state.lastClickedIdx = -1;
    syncMetadataToUi();
    populateRangeSelects();
    renderAllChapterViews();

    appendLog(`Modo Juntar Abas: ${validTabs.length} aba(s) carregadas como capítulos.`);
    showBanner(t('msgTabsMerged', { count: validTabs.length }), 'success');
  } catch (err) {
    appendLog(`Erro ao juntar abas: ${err.message}`);
    showBanner(`Erro: ${err.message}`, 'error');
  }
}

async function handleLoadSeries(url) {
  hideBanner();
  readOptionsFromUi();
  const btn = $('btn-load-series');
  btn.disabled = true;
  btn.textContent = t('btnLoadingSeries');
  appendLog(`Carregando URL: ${url}`);

  try {
    const { parser, series } = await loadSeriesWithParser(url, state.options);
    state.activeParser = parser;
    state.metadata = {
      ...series,
      filename: sanitizeFilename(series.title, true)
    };
    state.chapters = series.chapters.map((ch) => ({
      ...ch,
      status: state.chapterCache.has(getCacheKey(ch.url)) ? 'ok' : 'pending',
      errorMsg: ''
    }));
    state.volumeFilter = null;
    state.lastClickedIdx = -1;

    const vols = getVolumeGroups().length;
    const modeRadio = document.querySelector(`input[name="pack-mode"][value="${vols > 1 ? 'by-volume' : 'single'}"]`);
    if (modeRadio) modeRadio.checked = true;

    syncMetadataToUi();
    populateRangeSelects();
    renderAllChapterViews();

    appendLog(
      `Obra carregada (${parser.name}): "${series.title}" | Autor: ${series.author} | ${series.chapters.length} capítulos em ${vols} volume(s).`
    );
    if (series.chapters.length === 0) {
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
    appendLog(`ERRO ao carregar obra: ${err.message}`);
    showBanner(t('msgLoadError', { error: err.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnLoadSeries');
  }
}

function formatOutputFilename({ baseFilename, title, author, volumeLabel, suffix, extension = 'epub' }) {
  const template = state.options.customFilename || '%Filename%';
  let raw = template
    .replace(/%Filename%/gi, baseFilename)
    .replace(/%Title%/gi, title)
    .replace(/%Author%/gi, author)
    .replace(/%Volume%/gi, volumeLabel || '');

  if (volumeLabel && !/%Volume%/i.test(template)) {
    raw = `${raw} - ${volumeLabel}`;
  }
  if (suffix) {
    raw = `${raw} ${suffix}`;
  }

  const cleanFile = sanitizeFilename(raw, state.options.removeIllegal);
  if (state.options.subfolder) {
    const folder = sanitizeFilename(baseFilename || title, true);
    return `WebPullBook/${folder}/${cleanFile}.${extension}`;
  }
  return `${cleanFile}.${extension}`;
}

async function downloadBlobToChrome(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    if (chrome?.downloads?.download) {
      const downloadId = await chrome.downloads.download({
        url,
        filename,
        saveAs: !state.options.noSaveAs,
        conflictAction: 'uniquify'
      });
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(listener);
          resolve();
        };
        const listener = (delta) => {
          if (
            delta.id === downloadId &&
            delta.state &&
            (delta.state.current === 'complete' || delta.state.current === 'interrupted')
          ) {
            finish();
          }
        };
        chrome.downloads.onChanged.addListener(listener);
        const timer = setTimeout(finish, 3000);
        if (chrome.downloads.search) {
          chrome.downloads.search({ id: downloadId }).then((items) => {
            if (items?.[0]?.state === 'complete' || items?.[0]?.state === 'interrupted') {
              finish();
            }
          }).catch(() => {});
        }
      });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop();
      a.click();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

async function waitWhilePaused(signal) {
  while (state.paused) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function handlePackEpub() {
  if (state.running) return;
  readMetadataFromUi();
  readOptionsFromUi();

  const selected = state.chapters.filter((c) => c.included);
  if (selected.length === 0) {
    showBanner(t('msgSelectAtLeastOne'), 'error');
    return;
  }

  state.running = true;
  state.paused = false;
  state.abortController = new AbortController();
  const { signal } = state.abortController;

  $('btn-pack-epub').disabled = true;
  $('btn-retry-failed').classList.add('hidden');
  $('run-controls').classList.remove('hidden');
  $('progress-box').classList.remove('hidden');
  $('btn-pause').textContent = t('btnPause');
  hideBanner();

  await saveOptions();

  const mode = document.querySelector('input[name="pack-mode"]:checked')?.value || 'by-volume';
  const jobs = [];

  if (mode === 'by-volume') {
    const volMap = new Map();
    for (const ch of selected) {
      const vol = ch.volume || 'Volume 01';
      if (!volMap.has(vol)) volMap.set(vol, []);
      volMap.get(vol).push(ch);
    }
    for (const [vol, list] of volMap.entries()) {
      jobs.push({
        volumeLabel: vol,
        bookTitle: `${state.metadata.title} — ${vol}`,
        seriesName: state.metadata.title,
        seriesIndex: extractVolumeNumber(vol),
        chapters: list,
        groupNestedVolumes: false
      });
    }
  } else {
    const maxPer = state.options.maxChaptersPerEpub;
    if (selected.length > maxPer) {
      let part = 1;
      for (let i = 0; i < selected.length; i += maxPer) {
        const slice = selected.slice(i, i + maxPer);
        jobs.push({
          volumeLabel: `Parte ${String(part).padStart(2, '0')}`,
          bookTitle: `${state.metadata.title} — Parte ${part}`,
          seriesName: state.metadata.title,
          seriesIndex: part,
          chapters: slice,
          groupNestedVolumes: true
        });
        part++;
      }
    } else {
      jobs.push({
        volumeLabel: '',
        bookTitle: state.metadata.title,
        seriesName: '',
        seriesIndex: 1,
        chapters: selected,
        groupNestedVolumes: true
      });
    }
  }

  const totalChaptersAll = selected.length;
  let completedGlobal = 0;
  let filesGenerated = 0;
  let totalOkChapters = 0;
  let totalFailedChapters = 0;
  const allPackagedChapters = [];
  const exporter = exporterRegistry.get(state.options.outputFormat);
  const extUpper = exporter.extension.toUpperCase();

  try {
    appendLog(
      `Iniciando exportação (${exporter.name}): ${jobs.length} arquivo(s) ${extUpper}, ${totalChaptersAll} capítulos no total.`
    );

    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      const parsedChapters = [];

      for (let c = 0; c < job.chapters.length; c++) {
        await waitWhilePaused(signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const ch = job.chapters[c];
        const cacheKey = getCacheKey(ch.url);
        $('progress-label').textContent = `(${j + 1}/${jobs.length}) ${job.volumeLabel || extUpper}`;
        $('progress-detail').textContent = `${ch.displayTitle} (${completedGlobal + 1}/${totalChaptersAll})`;
        const pct = Math.round((completedGlobal / totalChaptersAll) * 100);
        $('progress-bar').value = pct;
        $('progress-pct').textContent = `${pct}%`;

        if (state.chapterCache.has(cacheKey)) {
          const cachedParsed = state.chapterCache.get(cacheKey);
          ch.status = 'ok';
          ch.errorMsg = '';
          parsedChapters.push(cachedParsed);
          allPackagedChapters.push(ch);
          totalOkChapters++;
          completedGlobal++;
          continue;
        }

        ch.status = 'downloading';
        renderChaptersTable();

        try {
          const parsed = await downloadAndParseChapter(ch, state.activeParser, state.options, signal);
          state.chapterCache.set(cacheKey, parsed);
          ch.status = 'ok';
          ch.errorMsg = '';
          parsedChapters.push(parsed);
          allPackagedChapters.push(ch);
          totalOkChapters++;
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          if (err.status === 404 && state.options.skip404) {
            ch.status = 'skipped';
            ch.errorMsg = 'HTTP 404';
            appendLog(`404 pulado: ${ch.url}`);
          } else if (state.options.continueOnError !== false) {
            ch.status = 'error';
            ch.errorMsg = err.message;
            totalFailedChapters++;
            appendLog(`FALHA no capítulo "${ch.displayTitle}" (${ch.url}): ${err.message}`);
          } else {
            ch.status = 'error';
            ch.errorMsg = err.message;
            totalFailedChapters++;
            throw err;
          }
        }

        completedGlobal++;
        renderChaptersTable();

        if (state.options.delayMs > 0 && completedGlobal < totalChaptersAll) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, state.options.delayMs);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          });
        }
      }

      if (parsedChapters.length === 0) {
        appendLog(`Pulando ${job.bookTitle}: nenhum capítulo disponível.`);
        continue;
      }

      $('progress-label').textContent = `${extUpper}: ${job.bookTitle}...`;
      const outBlob = await exporter.exportBook({
        metadata: state.metadata,
        bookTitle: job.bookTitle,
        seriesName: job.seriesName,
        seriesIndex: job.seriesIndex,
        parsedChapters,
        options: state.options,
        groupNestedVolumes: job.groupNestedVolumes,
        onLog: appendLog,
        signal
      });

      const outName = formatOutputFilename({
        baseFilename: state.metadata.filename,
        title: state.metadata.title,
        author: state.metadata.author,
        volumeLabel: job.volumeLabel,
        extension: exporter.extension
      });

      await downloadBlobToChrome(outBlob, outName);
      filesGenerated++;
      appendLog(`Arquivo salvo: ${outName} (${(outBlob.size / 1024).toFixed(1)} KB, ${parsedChapters.length} caps)`);
    }

    if (allPackagedChapters.length > 0) {
      await updateLibraryAfterExport(allPackagedChapters);
    }

    $('progress-bar').value = 100;
    $('progress-pct').textContent = '100%';
    $('progress-label').textContent = t('progressDone');
    $('progress-detail').textContent = `${filesGenerated} ${extUpper}`;

    if (filesGenerated > 0 && totalFailedChapters === 0) {
      showBanner(
        t('msgPackComplete', {
          files: filesGenerated,
          ext: extUpper,
          ok: totalOkChapters
        }),
        'success'
      );
    } else if (filesGenerated > 0 && totalFailedChapters > 0) {
      showBanner(
        t('msgPackPartialWarning', {
          files: filesGenerated,
          ext: extUpper,
          failed: totalFailedChapters
        }),
        'info'
      );
    } else {
      showBanner(t('msgPackAllFailed', { failed: totalFailedChapters }), 'error');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      appendLog('Empacotamento cancelado pelo usuário.');
      showBanner(t('msgPackCancelled'), 'info');
    } else {
      appendLog(`ERRO durante empacotamento: ${err.message}`);
      showBanner(`Erro: ${err.message}`, 'error');
    }
  } finally {
    state.running = false;
    state.paused = false;
    state.abortController = null;
    $('run-controls').classList.add('hidden');
    renderChaptersTable();
  }
}

function wireEvents() {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }

  $('load-series-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('starting-url').value.trim();
    if (url) handleLoadSeries(url);
  });

  $('btn-merge-tabs').addEventListener('click', handleMergeOpenTabs);
  $('btn-save-library').addEventListener('click', saveCurrentSeriesToLibrary);
  $('btn-save-library-tab').addEventListener('click', saveCurrentSeriesToLibrary);

  $('ui-lang-top').addEventListener('change', async () => {
    const newLang = $('ui-lang-top').value;
    $('opt-ui-lang').value = newLang;
    applyLanguageChoice(newLang);
    await saveOptions();
  });

  $('opt-ui-lang').addEventListener('change', async () => {
    const newLang = $('opt-ui-lang').value;
    $('ui-lang-top').value = newLang;
    applyLanguageChoice(newLang);
    await saveOptions();
  });

  $('meta-title').addEventListener('input', () => {
    $('meta-filename').value = sanitizeFilename($('meta-title').value, true);
  });

  $('meta-cover-url').addEventListener('change', updateCoverPreview);
  $('btn-clear-cover').addEventListener('click', () => {
    $('meta-cover-url').value = '';
    state.metadata.coverUrl = '';
    state.metadata.coverThumbUrl = '';
    updateCoverPreview();
  });
  $('btn-hires-cover').addEventListener('click', () => {
    const cur = $('meta-cover-url').value.trim();
    if (cur) {
      $('meta-cover-url').value = toHighResCoverUrl(cur);
      updateCoverPreview();
    }
  });

  $('btn-filter-clear-vol').addEventListener('click', () => {
    state.volumeFilter = null;
    renderAllChapterViews();
  });

  const applyRangeSelection = () => {
    const a = parseInt($('first-chapter').value, 10);
    const b = parseInt($('last-chapter').value, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    state.chapters.forEach((ch, idx) => {
      ch.included = idx >= min && idx <= max;
    });
    renderAllChapterViews();
  };
  $('first-chapter').addEventListener('change', applyRangeSelection);
  $('last-chapter').addEventListener('change', applyRangeSelection);
  $('chapter-filter').addEventListener('input', renderChaptersTable);

  $('master-checkbox').addEventListener('change', () => {
    const target = $('master-checkbox').checked;
    for (const { ch } of getVisibleChapters()) {
      ch.included = target;
    }
    renderAllChapterViews();
  });

  $('btn-select-all').addEventListener('click', () => {
    state.chapters.forEach((c) => {
      c.included = true;
    });
    renderAllChapterViews();
  });
  $('btn-unselect-all').addEventListener('click', () => {
    state.chapters.forEach((c) => {
      c.included = false;
    });
    renderAllChapterViews();
  });
  $('btn-reverse-order').addEventListener('click', () => {
    state.chapters.reverse();
    populateRangeSelects();
    renderAllChapterViews();
  });
  $('btn-select-failed').addEventListener('click', () => {
    state.chapters.forEach((c) => {
      c.included = c.status === 'error';
    });
    populateRangeSelects();
    renderAllChapterViews();
  });

  $('toggle-show-urls').addEventListener('change', () => {
    state.showUrls = $('toggle-show-urls').checked;
    renderChaptersTable();
  });

  $('btn-copy-urls').addEventListener('click', async () => {
    const urls = state.chapters
      .filter((c) => c.included)
      .map((c) => c.url)
      .join('\n');
    if (!urls) return;
    await navigator.clipboard.writeText(urls);
    showBanner(t('msgCopiedUrls', { count: urls.split('\n').length }), 'success');
  });

  $('btn-pack-epub').addEventListener('click', handlePackEpub);
  $('btn-retry-failed').addEventListener('click', handlePackEpub);
  $('btn-pause').addEventListener('click', () => {
    state.paused = !state.paused;
    $('btn-pause').textContent = state.paused ? t('btnResume') : t('btnPause');
  });
  $('btn-cancel').addEventListener('click', () => {
    state.abortController?.abort();
  });

  // Volume manual dialog
  const volDialog = $('volume-modal');
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

  // Edit URLs dialog
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

  $('output-format').addEventListener('change', async () => {
    readOptionsFromUi();
    updatePackButtonLabel();
    await saveOptions();
  });

  const typoIds = ['opt-font-family', 'opt-text-align', 'opt-line-height', 'opt-paragraph-indent'];
  for (const tid of typoIds) {
    $(tid).addEventListener('change', async () => {
      readOptionsFromUi();
      const regenerated = buildEpubStylesheet({
        fontFamily: state.options.fontFamily,
        textAlign: state.options.textAlign,
        lineHeight: state.options.lineHeight,
        paragraphIndent: state.options.paragraphIndent
      });
      $('opt-stylesheet').value = regenerated;
      state.options.stylesheet = regenerated;
      await saveOptions();
    });
  }

  const advInputs = document.querySelectorAll('#tab-advanced input, #tab-advanced select, #tab-advanced textarea');
  for (const el of advInputs) {
    if (typoIds.includes(el.id) || el.id === 'opt-ui-lang') continue;
    el.addEventListener('change', async () => {
      readOptionsFromUi();
      applyThemeChoice(state.options.theme);
      await saveOptions();
    });
  }

  $('btn-reset-css').addEventListener('click', async () => {
    $('opt-font-family').value = 'reader-default';
    $('opt-text-align').value = 'justify';
    $('opt-line-height').value = '1.55';
    $('opt-paragraph-indent').checked = false;
    $('opt-stylesheet').value = DEFAULT_EPUB_CSS;
    readOptionsFromUi();
    await saveOptions();
  });

  $('btn-export-opts').addEventListener('click', () => {
    readOptionsFromUi();
    const blob = new Blob([JSON.stringify(state.options, null, 2)], { type: 'application/json' });
    downloadBlobToChrome(blob, 'webpullbook-options.json');
  });

  $('input-import-opts').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      state.options = { ...DEFAULT_OPTIONS, ...parsed };
      syncOptionsToUi();
      applyThemeChoice(state.options.theme);
      applyLanguageChoice(state.options.uiLang);
      await saveOptions();
      showBanner('OK', 'success');
    } catch (err) {
      showBanner(`JSON Error: ${err.message}`, 'error');
    }
  });

  $('btn-clear-logs').addEventListener('click', () => {
    state.logs = [];
    $('log-output').textContent = t('logsCleared');
    $('log-badge').classList.add('hidden');
  });
  $('btn-download-logs').addEventListener('click', () => {
    const blob = new Blob([state.logs.join('\n')], { type: 'text/plain;charset=utf-8' });
    downloadBlobToChrome(blob, 'webpullbook-log.txt');
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'wpb-color-scheme') {
      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) meta.content = e.newValue || 'light dark';
    }
  });
}

async function init() {
  populateRegistries();
  await loadOptions();
  await loadLibrary();
  wireEvents();

  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get('url');
  if (initialUrl && /^https?:\/\//i.test(initialUrl)) {
    $('starting-url').value = initialUrl;
    await handleLoadSeries(initialUrl);
  }
}

init();
