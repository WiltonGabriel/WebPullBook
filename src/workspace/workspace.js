import {
  DEFAULT_EPUB_CSS,
  buildEpubStylesheet,
  buildOutputPath,
  canUseTabScripting,
  downloadAndParseChapter,
  extractVolumeLabel,
  extractVolumeNumber,
  fetchDocumentWithOptions,
  normalizeSpaces,
  normalizeUrl,
  sanitizeFilename,
  sleep,
  toHighResCoverUrl
} from '../core/parser-engine.js';
import {
  DEFAULT_CACHE_TTL_DAYS,
  cacheStore,
  hydrateCachedChapter,
  serializeNodesForCache
} from '../core/cache-store.js';
import { getParserById, loadSeriesWithParser, parserRegistry } from '../parsers/index.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import { exporterRegistry } from '../exporters/index.js';
import { applyI18nToDom, translate } from './i18n.js';

const DEFAULT_OPTIONS = {
  uiLang: 'pt',
  theme: 'system',
  readerPreset: 'custom',
  outputFormat: 'epub',
  saveTargetMode: 'downloads',
  customDirName: '',
  rootFolderName: 'WebPullBook',
  folderLayout: 'root-title',
  customFolderTemplate: '%Root%/%Author%/%Title%',
  customFilename: '%Filename%',
  noSaveAs: true,
  removeIllegal: true,
  createEpub3: true,
  addInfoPage: true,
  removeNavLinks: true,
  parserId: 'auto',
  customListSelector: '',
  customContentSelector: '',
  customExcludeSelector: '',
  customStripPatterns: '',
  crawlNextLinks: true,
  delayMs: 350,
  concurrency: 1,
  maxRetries: 2,
  safeMode: false,
  safeRpm: 22,
  safeBatchSize: 25,
  autoPauseOnRateLimit: true,
  cacheTtlDays: DEFAULT_CACHE_TTL_DAYS,
  maxChaptersPerEpub: 10000,
  compressedResolution: 1080,
  compressedFormat: 'jpg',
  imageQuality: 85,
  restrictCoverJpeg: true,
  compressImages: false,
  grayscaleImages: false,
  skipImages: false,
  useSvgForImages: false,
  continueOnError: true,
  renderWithTab: false,
  renderWaitMs: 950,
  autoFallbackTab: true,
  preferOpenTabDom: true,
  skip404: false,
  fontFamily: 'reader-default',
  textAlign: 'justify',
  lineHeight: 1.55,
  paragraphIndent: false,
  stylesheet: DEFAULT_EPUB_CSS
};

const READER_PRESETS = {
  modern: {
    outputFormat: 'epub',
    createEpub3: true,
    restrictCoverJpeg: true,
    compressImages: false,
    grayscaleImages: false,
    skipImages: false,
    useSvgForImages: false,
    compressedResolution: 1080,
    fontFamily: 'reader-default'
  },
  kindle: {
    outputFormat: 'epub',
    createEpub3: false,
    restrictCoverJpeg: true,
    compressImages: true,
    grayscaleImages: false,
    skipImages: false,
    useSvgForImages: false,
    compressedResolution: 1200,
    fontFamily: 'reader-default',
    textAlign: 'justify'
  },
  kobo: {
    outputFormat: 'epub',
    createEpub3: true,
    restrictCoverJpeg: true,
    compressImages: true,
    grayscaleImages: true,
    skipImages: false,
    useSvgForImages: false,
    compressedResolution: 1080,
    fontFamily: 'reader-default'
  },
  textonly: {
    outputFormat: 'epub',
    createEpub3: true,
    restrictCoverJpeg: true,
    compressImages: false,
    grayscaleImages: false,
    skipImages: true,
    useSvgForImages: false
  },
  legacy: {
    outputFormat: 'epub',
    createEpub3: false,
    restrictCoverJpeg: true,
    compressImages: true,
    grayscaleImages: false,
    skipImages: false,
    useSvgForImages: false,
    compressedResolution: 1080,
    fontFamily: 'reader-default'
  }
};

function detectMatchingReaderPreset(opts) {
  for (const [key, cfg] of Object.entries(READER_PRESETS)) {
    const matches = Object.entries(cfg).every(([field, expected]) => opts[field] === expected);
    if (matches) return key;
  }
  return 'custom';
}

function normalizeRuleDomain(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

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
  seriesRequiresTab: false,
  chapters: [],
  chapterCache: new Map(),
  library: [],
  domainRules: {},
  appliedRuleDomain: '',
  customDirHandle: null,
  customDirPermission: 'none',
  options: { ...DEFAULT_OPTIONS },
  volumeFilter: null,
  showUrls: false,
  lastClickedIdx: -1,
  running: false,
  paused: false,
  abortController: null,
  logs: [],
  logSeq: 0,
  lastReport: null
};

const $ = (id) => document.getElementById(id);

function t(key, vars = {}) {
  return translate(state.options.uiLang || 'pt', key, vars);
}

function getCacheKey(chapterUrl) {
  return `${normalizeUrl(chapterUrl)}|${state.activeParser?.id || 'auto'}|${Boolean(state.options.skipImages)}|${Boolean(state.options.removeNavLinks)}|${state.options.customContentSelector || ''}|${state.options.customExcludeSelector || ''}`;
}

function getCurrentSeriesKey() {
  const raw = state.metadata.startingUrl || $('starting-url').value.trim();
  const norm = raw ? normalizeUrl(raw) : '';
  return norm || `local:${sanitizeFilename(state.metadata.title || 'webpullbook', true)}`;
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimeRemaining(expiresAt) {
  const diff = Math.max(0, (expiresAt || 0) - Date.now());
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ${hours % 24}h`;
  return `${Math.max(1, hours)}h`;
}

function detectLogLevel(msg, explicitLevel) {
  if (explicitLevel) return explicitLevel;
  if (/^(?:ERRO|FALHA|BLOQUEIO)/i.test(msg)) return 'error';
  if (/^Aviso:/i.test(msg)) return 'warn';
  return 'info';
}

function updateLogBadges() {
  const total = state.logs.length;
  const warnCount = state.logs.filter((l) => l.level === 'warn').length;
  const errCount = state.logs.filter((l) => l.level === 'error').length;

  const totalBadge = $('log-badge');
  totalBadge.textContent = String(total);
  totalBadge.classList.toggle('hidden', total === 0);

  const warnBadge = $('log-warn-badge');
  if (warnBadge) {
    warnBadge.textContent = String(warnCount);
    warnBadge.classList.toggle('hidden', warnCount === 0);
  }

  const errBadge = $('log-error-badge');
  if (errBadge) {
    errBadge.textContent = String(errCount);
    errBadge.classList.toggle('hidden', errCount === 0);
  }
}

function appendTextWithLinks(parentEl, text) {
  const str = String(text ?? '');
  const urlRx = /https?:\/\/[^\s<>"']+/gi;
  let lastIdx = 0;
  let match;

  while ((match = urlRx.exec(str)) !== null) {
    if (match.index > lastIdx) {
      parentEl.appendChild(document.createTextNode(str.slice(lastIdx, match.index)));
    }
    let rawUrl = match[0];
    let suffix = '';
    while (rawUrl.length > 8 && /[),.:;!?]$/.test(rawUrl)) {
      suffix = rawUrl.slice(-1) + suffix;
      rawUrl = rawUrl.slice(0, -1);
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const a = document.createElement('a');
        a.href = parsed.toString();
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'log-link';
        a.textContent = rawUrl;
        parentEl.appendChild(a);
      } else {
        parentEl.appendChild(document.createTextNode(rawUrl));
      }
    } catch {
      parentEl.appendChild(document.createTextNode(rawUrl));
    }
    if (suffix) {
      parentEl.appendChild(document.createTextNode(suffix));
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < str.length) {
    parentEl.appendChild(document.createTextNode(str.slice(lastIdx)));
  }
}

function createExternalLink(url, label, className = 'report-ext-link') {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = className;
  a.textContent = label;
  return a;
}

function renderLogsOutput() {
  const box = $('log-output');
  if (!box) return;
  if (state.logs.length === 0) {
    box.textContent = t('logsEmpty');
    return;
  }
  const frag = document.createDocumentFragment();
  for (const entry of state.logs) {
    const line = document.createElement('div');
    line.id = entry.id;
    line.className = `log-line log-${entry.level}`;
    appendTextWithLinks(line, `[${entry.time}] ${entry.msg}`);
    frag.appendChild(line);
  }
  box.replaceChildren(frag);
}

function appendLog(msg, level) {
  const stamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  const id = `log-${++state.logSeq}`;
  const entry = {
    id,
    time: stamp,
    level: detectLogLevel(msg, level),
    msg
  };
  state.logs.push(entry);
  if (state.logs.length > 2000) state.logs.shift();
  renderLogsOutput();
  updateLogBadges();
  return id;
}

function jumpToLog(logId) {
  switchTab('logs');
  if (!logId) return;
  const target = document.getElementById(logId);
  if (!target) return;
  for (const el of document.querySelectorAll('.log-line.log-highlight')) {
    el.classList.remove('log-highlight');
  }
  target.classList.add('log-highlight');
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function showBanner(msg, type = 'info') {
  const banner = $('status-banner');
  banner.textContent = msg;
  banner.className = `banner ${type}`;
  banner.classList.remove('hidden');
}

function hideBanner() {
  $('status-banner').classList.add('hidden');
  const rep = $('export-report');
  if (rep) rep.classList.add('hidden');
}

function renderExportReport({ okCount, chapterErrors, imageWarnings }) {
  state.lastReport = { okCount, chapterErrors, imageWarnings };
  const box = $('export-report');
  if (!box) return;
  const errCount = chapterErrors.length;
  const warnCount = imageWarnings.length;

  let tone = 'is-ok';
  let summaryText = t('reportAllCleanTitle');
  if (errCount > 0) {
    tone = 'is-error';
    summaryText = t('reportGraveTitle', { errors: errCount, warns: warnCount });
  } else if (warnCount > 0) {
    tone = 'is-warn';
    summaryText = t('reportLightTitle', { ok: okCount, warns: warnCount });
  }

  box.className = `export-report ${tone}`;
  const head = document.createElement('div');
  head.className = 'export-report-head';

  const strong = document.createElement('strong');
  strong.textContent = summaryText;

  const counts = document.createElement('div');
  counts.className = 'export-report-counts';

  const errPill = document.createElement('span');
  errPill.className = `status-pill${errCount > 0 ? ' error' : ''}`;
  errPill.textContent = t('reportErrorsCount', { count: errCount });

  const warnPill = document.createElement('span');
  warnPill.className = `status-pill${warnCount > 0 ? ' warn' : ''}`;
  warnPill.textContent = t('reportWarningsCount', { count: warnCount });

  counts.append(errPill, warnPill);
  head.append(strong, counts);

  const items = [];
  for (const e of chapterErrors) {
    items.push({
      type: 'error',
      tag: t('reportGraveTag', { num: e.chapterIndex }),
      label: e.chapterTitle,
      detail: e.message,
      logId: e.logId,
      chapterUrl: e.chapterUrl || '',
      mediaUrl: ''
    });
  }
  for (const w of imageWarnings) {
    items.push({
      type: 'warn',
      tag: w.kind === 'cover' ? t('reportLightCoverTag') : t('reportLightChapterTag', { num: w.chapterIndex }),
      label: w.chapterTitle || w.url,
      detail: w.message,
      logId: w.logId,
      chapterUrl: w.chapterUrl || '',
      mediaUrl: w.url || ''
    });
  }

  if (items.length === 0) {
    box.replaceChildren(head);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'report-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'report-item';

    const tagSpan = document.createElement('span');
    tagSpan.className = `report-tag ${item.type}`;
    tagSpan.textContent = item.tag;

    const textSpan = document.createElement('span');
    const shortDetail = item.detail.length > 90 ? `${item.detail.slice(0, 87)}...` : item.detail;
    textSpan.textContent = `${item.label} — ${shortDetail}`;

    li.append(tagSpan, textSpan);
    if (item.logId) {
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'report-jump-btn';
      jumpBtn.textContent = t('reportJumpLog');
      jumpBtn.addEventListener('click', () => jumpToLog(item.logId));
      li.appendChild(jumpBtn);
    }
    const chLink = createExternalLink(item.chapterUrl, t('reportOpenChapter'));
    if (chLink) li.appendChild(chLink);
    const mediaLink = createExternalLink(item.mediaUrl, t('reportOpenImage'));
    if (mediaLink) li.appendChild(mediaLink);
    list.appendChild(li);
  }

  box.replaceChildren(head, list);
}

const VALID_THEMES = new Set(['light', 'dark', 'sepia', 'midnight']);

function resolveEffectiveTheme(theme) {
  if (VALID_THEMES.has(theme)) return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function switchTab(targetTab) {
  for (const b of document.querySelectorAll('.tab-btn')) {
    const isSelected = b.dataset.tab === targetTab;
    b.classList.toggle('active', isSelected);
    b.setAttribute('aria-selected', String(isSelected));
    b.tabIndex = isSelected ? 0 : -1;
    if (isSelected) {
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    const isVisible = panel.id === `tab-${targetTab}`;
    panel.classList.toggle('hidden', !isVisible);
    panel.hidden = !isVisible;
  }
}

function applyThemeChoice(theme) {
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (VALID_THEMES.has(theme)) {
    root.dataset.theme = theme;
    if (meta) {
      meta.content = theme === 'dark' || theme === 'midnight' ? 'dark' : 'light';
    }
    try {
      localStorage.setItem('wpb-color-scheme', theme);
    } catch {
      // ignore
    }
  } else {
    delete root.dataset.theme;
    if (meta) meta.content = 'light dark';
    try {
      localStorage.removeItem('wpb-color-scheme');
    } catch {
      // ignore
    }
  }
  const topThemeEl = $('ui-theme-top');
  if (topThemeEl) {
    topThemeEl.value = resolveEffectiveTheme(theme);
  }
}

const HANDLE_DB_NAME = 'WebPullBookHandles';
const HANDLE_STORE_NAME = 'handles';
const OUTPUT_DIR_KEY = 'outputDir';

function openHandleDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
          db.createObjectStore(HANDLE_STORE_NAME);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadSavedDirectoryHandle() {
  const db = await openHandleDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
      const req = tx.objectStore(HANDLE_STORE_NAME).get(OUTPUT_DIR_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistDirectoryHandle(handle) {
  const db = await openHandleDb();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
      tx.objectStore(HANDLE_STORE_NAME).put(handle, OUTPUT_DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearSavedDirectoryHandle() {
  state.customDirHandle = null;
  state.customDirPermission = 'none';
  const db = await openHandleDb();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
      tx.objectStore(HANDLE_STORE_NAME).delete(OUTPUT_DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function checkCustomDirStatus() {
  if (!state.customDirHandle) {
    state.customDirPermission = 'none';
    return 'none';
  }
  try {
    if (typeof state.customDirHandle.queryPermission === 'function') {
      state.customDirPermission = await state.customDirHandle.queryPermission({ mode: 'readwrite' });
    } else {
      state.customDirPermission = 'granted';
    }
  } catch {
    state.customDirPermission = 'denied';
  }
  return state.customDirPermission;
}

function updateSaveLocationUi() {
  const pill = $('save-folder-status');
  const clearBtn = $('btn-use-downloads-folder');
  if (!pill || !clearBtn) return;

  const isCustom = state.options.saveTargetMode === 'custom-dir';
  const folderName = state.customDirHandle?.name || state.options.customDirName || 'WebPullBook';

  pill.classList.remove('is-warning');
  if (!isCustom) {
    pill.textContent = t('saveTargetDownloads');
    clearBtn.classList.add('hidden');
    return;
  }

  clearBtn.classList.remove('hidden');
  if (!state.customDirHandle) {
    pill.textContent = t('saveTargetCustomMissing', { name: folderName });
    pill.classList.add('is-warning');
  } else if (state.customDirPermission === 'granted') {
    pill.textContent = t('saveTargetCustomReady', { name: folderName });
  } else {
    pill.textContent = t('saveTargetCustomPrompt', { name: folderName });
  }
}

function updatePathPreview() {
  const previewEl = $('path-preview-text');
  if (!previewEl) return;

  const layout = $('opt-folder-layout')?.value || state.options.folderLayout || 'root-title';
  const customWrap = $('custom-folder-template-wrap');
  if (customWrap) {
    customWrap.classList.toggle('hidden', layout !== 'custom');
  }

  const fmtId = $('output-format')?.value || state.options.outputFormat || 'epub';
  const exporter = exporterRegistry.get(fmtId);
  const title = $('meta-title')?.value.trim() || state.metadata.title || t('previewSampleTitle');
  const author = $('meta-author')?.value.trim() || state.metadata.author || t('previewSampleAuthor');
  const baseFilename = $('meta-filename')?.value.trim() || state.metadata.filename || title;
  const language = $('meta-language')?.value.trim() || state.metadata.language || 'pt';

  const relPath = buildOutputPath({
    baseFilename,
    title,
    author,
    extension: exporter.extension,
    language,
    options: {
      ...state.options,
      rootFolderName: $('opt-root-folder')?.value ?? state.options.rootFolderName,
      folderLayout: layout,
      customFolderTemplate: $('opt-folder-template')?.value ?? state.options.customFolderTemplate,
      customFilename: $('opt-custom-filename')?.value.trim() || '%Filename%',
      removeIllegal: $('opt-remove-illegal')?.checked !== false
    }
  });

  const basePrefix =
    state.options.saveTargetMode === 'custom-dir' && (state.customDirHandle?.name || state.options.customDirName)
      ? state.customDirHandle?.name || state.options.customDirName
      : 'Downloads';
  previewEl.textContent = `${basePrefix}/${relPath}`;
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
      const stored = { ...res.wpbOptions };
      if (stored.folderLayout === undefined && stored.subfolder === false) {
        stored.folderLayout = 'flat';
      }
      delete stored.subfolder;
      state.options = { ...DEFAULT_OPTIONS, ...stored };
    }
  }
  state.customDirHandle = await loadSavedDirectoryHandle();
  await checkCustomDirStatus();
  syncOptionsToUi();
  applyThemeChoice(state.options.theme);
  applyLanguageChoice(state.options.uiLang);
}

function mergeLibraryArrays(remoteList, localList) {
  const map = new Map();
  for (const item of remoteList || []) {
    if (item?.id) map.set(item.id, item);
  }
  for (const item of localList || []) {
    if (item?.id) map.set(item.id, item);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
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

async function saveLibrary({ removeId = null, upsertEntry = null } = {}) {
  if (chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbLibrary');
    let merged = Array.isArray(res?.wpbLibrary) ? [...res.wpbLibrary] : [...state.library];
    if (removeId) {
      merged = merged.filter((x) => x.id !== removeId);
    }
    if (upsertEntry) {
      merged = mergeLibraryArrays(merged, [upsertEntry]);
    }
    state.library = merged;
    await chrome.storage.local.set({ wpbLibrary: state.library });
  }
  renderLibrary();
}

async function loadDomainRules() {
  if (chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbDomainRules');
    if (res?.wpbDomainRules && typeof res.wpbDomainRules === 'object') {
      state.domainRules = { ...res.wpbDomainRules };
    }
  }
  renderDomainRules();
}

async function saveDomainRules() {
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ wpbDomainRules: state.domainRules });
  }
  renderDomainRules();
}

function applyDomainRuleToInputs(domain) {
  const rule = state.domainRules[domain];
  if (!rule) return false;
  $('opt-list-selector').value = rule.listSelector || '';
  $('opt-content-selector').value = rule.contentSelector || '';
  $('opt-exclude-selector').value = rule.excludeSelector || '';
  $('opt-strip-regex').value = rule.stripPatterns || '';
  if (typeof rule.renderWithTab === 'boolean') {
    $('opt-render-with-tab').checked = rule.renderWithTab;
  }
  state.appliedRuleDomain = domain;
  readOptionsFromUi();
  return true;
}

function applyDomainRuleForUrl(rawUrl) {
  const domain = normalizeRuleDomain(rawUrl);
  if (!domain) return false;
  if (state.appliedRuleDomain && state.appliedRuleDomain !== domain) {
    const prev = state.domainRules[state.appliedRuleDomain];
    if (prev) {
      if ($('opt-list-selector').value === (prev.listSelector || '')) $('opt-list-selector').value = '';
      if ($('opt-content-selector').value === (prev.contentSelector || '')) $('opt-content-selector').value = '';
      if ($('opt-exclude-selector').value === (prev.excludeSelector || '')) $('opt-exclude-selector').value = '';
      if ($('opt-strip-regex').value === (prev.stripPatterns || '')) $('opt-strip-regex').value = '';
    }
    state.appliedRuleDomain = '';
  }
  if (state.domainRules[domain]) {
    applyDomainRuleToInputs(domain);
    appendLog(`Regra salva aplicada automaticamente para "${domain}".`);
    return true;
  }
  return false;
}

function renderDomainRules() {
  const container = $('domain-rules-list');
  if (!container) return;
  const entries = Object.values(state.domainRules || {}).sort((a, b) => a.domain.localeCompare(b.domain));
  if (entries.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted sm';
    empty.textContent = t('domainRulesEmpty');
    container.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const rule of entries) {
    const chip = document.createElement('div');
    chip.className = 'domain-rule-chip';
    const label = document.createElement('span');
    label.textContent = rule.domain;
    label.title = [
      rule.listSelector ? `list: ${rule.listSelector}` : '',
      rule.contentSelector ? `content: ${rule.contentSelector}` : '',
      rule.excludeSelector ? `exclude: ${rule.excludeSelector}` : ''
    ]
      .filter(Boolean)
      .join(' | ');

    const btnApply = document.createElement('button');
    btnApply.type = 'button';
    btnApply.className = 'btn ghost sm';
    btnApply.textContent = t('btnRuleApply');
    btnApply.addEventListener('click', () => {
      applyDomainRuleToInputs(rule.domain);
      showBanner(t('msgDomainRuleApplied', { domain: rule.domain }), 'success');
    });

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn ghost sm';
    btnDel.textContent = t('btnRuleDelete');
    btnDel.addEventListener('click', async () => {
      delete state.domainRules[rule.domain];
      if (state.appliedRuleDomain === rule.domain) state.appliedRuleDomain = '';
      await saveDomainRules();
      showBanner(t('msgDomainRuleDeleted', { domain: rule.domain }), 'info');
    });

    chip.append(label, btnApply, btnDel);
    frag.appendChild(chip);
  }
  container.replaceChildren(frag);
}

async function handleSaveDomainRule() {
  readOptionsFromUi();
  const domain = normalizeRuleDomain($('starting-url').value.trim() || state.metadata.startingUrl);
  const hasSelectors = Boolean(
    state.options.customListSelector ||
      state.options.customContentSelector ||
      state.options.customExcludeSelector ||
      state.options.customStripPatterns
  );
  if (!domain || !hasSelectors) {
    showBanner(t('msgDomainRuleNoUrl'), 'error');
    return;
  }
  state.domainRules[domain] = {
    domain,
    listSelector: state.options.customListSelector,
    contentSelector: state.options.customContentSelector,
    excludeSelector: state.options.customExcludeSelector,
    stripPatterns: state.options.customStripPatterns,
    renderWithTab: Boolean(state.options.renderWithTab),
    updatedAt: new Date().toISOString()
  };
  state.appliedRuleDomain = domain;
  await saveDomainRules();
  appendLog(`Regra de seletores salva para o domínio "${domain}".`);
  showBanner(t('msgDomainRuleSaved', { domain }), 'success');
}

function updateTypographyPreview() {
  const el = $('typo-live-preview');
  if (!el) return;
  const font = $('opt-font-family').value || 'reader-default';
  const align = $('opt-text-align').value || 'justify';
  const lineH = Math.min(2.4, Math.max(1.1, parseFloat($('opt-line-height').value) || 1.55));
  const indent = $('opt-paragraph-indent').checked;

  el.style.fontFamily =
    font === 'serif'
      ? 'Georgia, "Times New Roman", serif'
      : font === 'sans'
        ? 'system-ui, -apple-system, "Segoe UI", sans-serif'
        : 'inherit';
  el.style.textAlign = align;
  el.style.lineHeight = String(lineH);
  el.classList.toggle('indent', indent);
}

function updateReaderPresetWarning() {
  const warnEl = $('legacy-preset-warning');
  if (!warnEl) return;
  const isLegacy = ($('reader-preset')?.value || state.options.readerPreset) === 'legacy';
  warnEl.classList.toggle('hidden', !isLegacy);
}

function applyReaderPreset(presetKey) {
  const cfg = READER_PRESETS[presetKey];
  if (!cfg) {
    state.options.readerPreset = 'custom';
    updateReaderPresetWarning();
    return;
  }
  state.options = { ...state.options, ...cfg, readerPreset: presetKey };
  syncOptionsToUi();
}

function applyLanguageChoice(lang) {
  const normalized = lang === 'en' ? 'en' : 'pt';
  state.options.uiLang = normalized;
  $('ui-lang-top').value = normalized;
  applyI18nToDom(normalized);
  populateRegistries();
  syncOptionsToUi();
  syncMetadataToUi();
  renderAllChapterViews();
  renderLibrary();
  renderDomainRules();
  renderCacheSessions();
  if (state.logs.length === 0) {
    $('log-output').textContent = t('logsEmpty');
  }
  if (state.lastReport && !$('export-report')?.classList.contains('hidden')) {
    renderExportReport(state.lastReport);
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
  $('output-format').value = o.outputFormat || 'epub';
  $('ui-theme-top').value = o.theme || 'system';
  $('opt-root-folder').value = o.rootFolderName !== undefined ? o.rootFolderName : 'WebPullBook';
  $('opt-folder-layout').value = o.folderLayout || 'root-title';
  $('opt-folder-template').value = o.customFolderTemplate || '%Root%/%Author%/%Title%';
  $('opt-custom-filename').value = o.customFilename;
  $('opt-no-save-as').checked = o.noSaveAs;
  $('opt-remove-illegal').checked = o.removeIllegal;
  $('opt-epub3').checked = o.createEpub3;
  $('opt-add-info').checked = o.addInfoPage;
  $('opt-remove-nav').checked = o.removeNavLinks;
  $('opt-parser').value = o.parserId;
  $('opt-list-selector').value = o.customListSelector;
  $('opt-content-selector').value = o.customContentSelector;
  $('opt-exclude-selector').value = o.customExcludeSelector;
  $('opt-strip-regex').value = o.customStripPatterns || '';
  $('opt-crawl-next').checked = o.crawlNextLinks !== false;
  $('opt-delay').value = o.delayMs;
  $('opt-concurrency').value = o.concurrency ?? 1;
  $('opt-retries').value = o.maxRetries ?? 2;
  $('opt-safe-mode').checked = Boolean(o.safeMode);
  $('opt-safe-mode-quick').checked = Boolean(o.safeMode);
  $('opt-safe-rpm').value = o.safeRpm ?? 22;
  $('opt-safe-batch').value = o.safeBatchSize ?? 25;
  $('opt-render-wait-ms').value = o.renderWaitMs ?? 950;
  $('opt-auto-pause-ratelimit').checked = o.autoPauseOnRateLimit !== false;
  $('opt-cache-ttl').value = String(o.cacheTtlDays ?? DEFAULT_CACHE_TTL_DAYS);
  $('opt-max-chapters').value = o.maxChaptersPerEpub;
  $('opt-img-res').value = o.compressedResolution;
  $('opt-img-fmt').value = o.compressedFormat;
  $('opt-image-quality').value = o.imageQuality ?? 85;
  $('opt-continue-on-error').checked = o.continueOnError !== false;
  $('opt-render-with-tab').checked = Boolean(o.renderWithTab);
  $('opt-auto-fallback-tab').checked = o.autoFallbackTab !== false;
  $('opt-prefer-open-tab-dom').checked = o.preferOpenTabDom !== false;
  $('opt-cover-jpeg').checked = o.restrictCoverJpeg;
  $('opt-compress-images').checked = o.compressImages;
  $('opt-grayscale-images').checked = Boolean(o.grayscaleImages);
  $('opt-skip-images').checked = o.skipImages;
  $('opt-use-svg').checked = o.useSvgForImages;
  $('opt-skip-404').checked = o.skip404;
  $('opt-font-family').value = o.fontFamily || 'reader-default';
  $('opt-text-align').value = o.textAlign || 'justify';
  $('opt-line-height').value = o.lineHeight ?? 1.55;
  $('opt-paragraph-indent').checked = Boolean(o.paragraphIndent);
  $('opt-stylesheet').value = o.stylesheet;
  $('reader-preset').value = detectMatchingReaderPreset(o);
  updateReaderPresetWarning();
  updateTypographyPreview();
  updatePackButtonLabel();
  updateSaveLocationUi();
  updatePathPreview();
}

function readOptionsFromUi() {
  const ttlParsed = parseInt($('opt-cache-ttl').value, 10);
  const concurrencyParsed = parseInt($('opt-concurrency').value, 10);
  const retriesParsed = parseInt($('opt-retries').value, 10);
  const renderWaitParsed = parseInt($('opt-render-wait-ms').value, 10);
  const qualityParsed = parseInt($('opt-image-quality').value, 10);
  state.options = {
    uiLang: $('ui-lang-top').value || 'pt',
    theme: $('ui-theme-top').value || 'system',
    outputFormat: $('output-format').value || 'epub',
    saveTargetMode: state.options.saveTargetMode || 'downloads',
    customDirName: state.options.customDirName || '',
    rootFolderName: $('opt-root-folder').value.trim(),
    folderLayout: $('opt-folder-layout').value || 'root-title',
    customFolderTemplate: $('opt-folder-template').value.trim() || '%Root%/%Author%/%Title%',
    customFilename: $('opt-custom-filename').value.trim() || '%Filename%',
    noSaveAs: $('opt-no-save-as').checked,
    removeIllegal: $('opt-remove-illegal').checked,
    createEpub3: $('opt-epub3').checked,
    addInfoPage: $('opt-add-info').checked,
    removeNavLinks: $('opt-remove-nav').checked,
    parserId: $('opt-parser').value || 'auto',
    customListSelector: $('opt-list-selector').value.trim(),
    customContentSelector: $('opt-content-selector').value.trim(),
    customExcludeSelector: $('opt-exclude-selector').value.trim(),
    customStripPatterns: $('opt-strip-regex').value,
    crawlNextLinks: $('opt-crawl-next').checked,
    delayMs: Math.max(0, parseInt($('opt-delay').value, 10) || 0),
    concurrency: Number.isNaN(concurrencyParsed) ? 1 : Math.max(1, Math.min(6, concurrencyParsed)),
    maxRetries: Number.isNaN(retriesParsed) ? 2 : Math.max(0, Math.min(5, retriesParsed)),
    safeMode: $('opt-safe-mode').checked,
    safeRpm: Math.max(5, Math.min(120, parseInt($('opt-safe-rpm').value, 10) || 22)),
    safeBatchSize: Math.max(0, Math.min(500, parseInt($('opt-safe-batch').value, 10) || 0)),
    autoPauseOnRateLimit: $('opt-auto-pause-ratelimit').checked,
    cacheTtlDays: Number.isNaN(ttlParsed) ? DEFAULT_CACHE_TTL_DAYS : ttlParsed,
    maxChaptersPerEpub: Math.max(1, parseInt($('opt-max-chapters').value, 10) || 10000),
    compressedResolution: Math.max(200, parseInt($('opt-img-res').value, 10) || 1080),
    compressedFormat: $('opt-img-fmt').value,
    imageQuality: Number.isNaN(qualityParsed) ? 85 : Math.max(40, Math.min(98, qualityParsed)),
    continueOnError: $('opt-continue-on-error').checked,
    renderWithTab: $('opt-render-with-tab').checked,
    renderWaitMs: Number.isNaN(renderWaitParsed) ? 950 : Math.max(0, Math.min(5000, renderWaitParsed)),
    autoFallbackTab: $('opt-auto-fallback-tab').checked,
    preferOpenTabDom: $('opt-prefer-open-tab-dom').checked,
    restrictCoverJpeg: $('opt-cover-jpeg').checked,
    compressImages: $('opt-compress-images').checked,
    grayscaleImages: $('opt-grayscale-images').checked,
    skipImages: $('opt-skip-images').checked,
    useSvgForImages: $('opt-use-svg').checked,
    skip404: $('opt-skip-404').checked,
    fontFamily: $('opt-font-family').value || 'reader-default',
    textAlign: $('opt-text-align').value || 'justify',
    lineHeight: Math.min(2.4, Math.max(1.1, parseFloat($('opt-line-height').value) || 1.55)),
    paragraphIndent: $('opt-paragraph-indent').checked,
    stylesheet: $('opt-stylesheet').value
  };
  state.options.readerPreset = detectMatchingReaderPreset(state.options);
  $('reader-preset').value = state.options.readerPreset;
  updateReaderPresetWarning();
  if (state.options.parserId !== 'auto') {
    state.activeParser = getParserById(state.options.parserId) || state.activeParser;
  }
  updatePathPreview();
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

function extractChapterNumberHint(ch) {
  const txt = `${ch.numText || ''} ${ch.displayTitle || ''} ${ch.titleText || ''}`;
  const m = txt.match(/(?:cap(?:[ií]tulo|\.?)|ch(?:apter|\.?)|ep(?:is[oó]dio|\.?)|#)\s*0*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  const tail = String(ch.url || '').match(/[-_/]0*(\d+)\/?$/);
  return tail ? parseInt(tail[1], 10) : null;
}

async function handleRedetectVolumes() {
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

    // 1. Re-scan startingUrl DOM (trying SPA tab render if static only yielded 1 volume)
    if (state.metadata.startingUrl && /^https?:\/\//i.test(state.metadata.startingUrl)) {
      try {
        const tryStatic = await loadSeriesWithParser(state.metadata.startingUrl, state.options);
        const staticVols = new Set((tryStatic.series.chapters || []).map((c) => c.volume || 'Volume 01'));
        let bestChapters = tryStatic.series.chapters || [];

        if (staticVols.size <= 1 && !state.options.renderWithTab && canUseTabScripting()) {
          try {
            const trySpa = await loadSeriesWithParser(state.metadata.startingUrl, {
              ...state.options,
              renderWithTab: true
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
        appendLog(`Aviso ao re-escanear página da obra para volumes: ${err.message}`, 'warn');
      }
    }

    // 2. Apply freshly scanned DOM volumes and re-check chapter title/URL patterns
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

    // 3. Generic boundary heuristic: if still 1 volume, split automatically on chapter #1 restarts (e.g. Cap 50 -> Cap 1)
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
    appendLog(`Detecção de volumes executada: ${totalVols} volume(s) identificado(s).`);
    showBanner(t('msgVolumesRedetected', { count: totalVols }), totalVols > 1 ? 'success' : 'info');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnRedetectVolumes');
  }
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

function renderAllChapterViews() {
  renderVolumeChips();
  renderChaptersTable();
}

function updateLibraryBadgeCount(sessionsCount = 0) {
  const total = state.library.length + sessionsCount;
  const badge = $('library-badge');
  if (total > 0) {
    badge.textContent = String(total);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function renderCacheSessions() {
  const grid = $('cache-sessions-grid');
  const pill = $('cache-stats-pill');
  if (!grid || !pill) return;

  const { sessions, totalChapters, totalBytes } = await cacheStore.listSessionsWithStats();
  pill.textContent = t('cacheStatsPill', { count: totalChapters, size: formatBytes(totalBytes) });
  updateLibraryBadgeCount(sessions.length);

  if (sessions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted sm';
    empty.textContent = t('cacheSessionsEmpty');
    grid.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const sess of sessions) {
    const card = document.createElement('article');
    card.className = 'lib-card';

    if (sess.metadata?.coverUrl) {
      const img = document.createElement('img');
      img.className = 'lib-cover';
      img.src = sess.metadata.coverUrl;
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
    h3.textContent = sess.metadata?.title || sess.seriesKey;
    h3.title = sess.metadata?.title || sess.seriesKey;

    const pMeta = document.createElement('p');
    pMeta.className = 'lib-meta';
    pMeta.textContent = t('cacheProgressInfo', {
      cached: sess.cachedCount,
      total: sess.chapters?.length || 0,
      size: formatBytes(sess.bytes)
    });

    const pExp = document.createElement('p');
    pExp.className = 'lib-meta';
    pExp.textContent = t('cacheExpiresInfo', { time: formatTimeRemaining(sess.expiresAt) });

    const actions = document.createElement('div');
    actions.className = 'lib-actions';

    const btnResume = document.createElement('button');
    btnResume.type = 'button';
    btnResume.className = 'btn primary sm';
    btnResume.textContent = t('btnResumeDownload');
    btnResume.addEventListener('click', () => restoreCachedSession(sess, false));

    const btnPackCached = document.createElement('button');
    btnPackCached.type = 'button';
    btnPackCached.className = 'btn secondary sm';
    btnPackCached.textContent = t('btnPackCachedOnly');
    btnPackCached.addEventListener('click', () => restoreCachedSession(sess, true));

    const btnPurge = document.createElement('button');
    btnPurge.type = 'button';
    btnPurge.className = 'btn ghost sm';
    btnPurge.textContent = t('btnPurgeSeriesCache');
    btnPurge.addEventListener('click', async () => {
      await cacheStore.deleteSeriesCache(sess.seriesKey);
      for (const ch of sess.chapters || []) {
        state.chapterCache.delete(getCacheKey(ch.url));
      }
      if (getCurrentSeriesKey() === sess.seriesKey) {
        for (const ch of state.chapters) {
          ch.status = 'pending';
        }
        renderChaptersTable();
      }
      await renderCacheSessions();
    });

    actions.append(btnResume, btnPackCached, btnPurge);
    body.append(h3, pMeta, pExp, actions);
    card.appendChild(body);
    fragment.appendChild(card);
  }

  grid.replaceChildren(fragment);
}

async function restoreCachedSession(sess, onlyCached = false) {
  switchTab('main');
  state.activeParser = getParserById(sess.parserId) || genericHtmlParser;
  state.seriesRequiresTab = Boolean(sess.metadata?.requiresTabRender);
  state.metadata = {
    ...sess.metadata,
    filename: sess.metadata?.filename || sanitizeFilename(sess.metadata?.title || 'WebPullBook', true)
  };

  const keys = (sess.chapters || []).map((c) => getCacheKey(c.url));
  const diskMap = await cacheStore.hasChapters(keys);

  let cachedHitCount = 0;
  state.chapters = (sess.chapters || []).map((ch) => {
    const key = getCacheKey(ch.url);
    const diskRec = diskMap.get(key);
    if (diskRec) {
      state.chapterCache.set(key, {
        chapterTitle: diskRec.chapterTitle,
        subtitle: diskRec.subtitle,
        contentXml: diskRec.contentXml
      });
      cachedHitCount++;
    }
    const isOk = Boolean(diskRec || state.chapterCache.has(key));
    return {
      ...ch,
      included: onlyCached ? isOk : ch.included !== false,
      status: isOk ? 'ok' : ch.status === 'error' ? 'error' : 'pending'
    };
  });

  state.volumeFilter = null;
  state.lastClickedIdx = -1;
  const vols = getVolumeGroups().length;
  const modeRadio = document.querySelector(`input[name="pack-mode"][value="${vols > 1 ? 'by-volume' : 'single'}"]`);
  if (modeRadio) modeRadio.checked = true;

  syncMetadataToUi();
  populateRangeSelects();
  renderAllChapterViews();
  showBanner(t('msgSessionRestored', { title: state.metadata.title, cached: cachedHitCount }), 'success');
}

function renderLibrary() {
  const grid = $('library-grid');
  if (!grid) return;

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

    const titleRow = document.createElement('div');
    titleRow.className = 'lib-title-row';

    const h3 = document.createElement('h3');
    h3.className = 'lib-title';
    h3.textContent = item.title || item.startingUrl;
    h3.title = item.title || item.startingUrl;
    titleRow.appendChild(h3);

    if (typeof item.newChaptersCount === 'number' && item.lastCheckedAt) {
      const statusPill = document.createElement('span');
      statusPill.className = `pill lib-status-pill ${item.newChaptersCount > 0 ? 'ok' : 'muted'}`;
      statusPill.textContent =
        item.newChaptersCount > 0
          ? t('libStatusNewCount', { count: item.newChaptersCount })
          : t('libStatusUpToDate');
      titleRow.appendChild(statusPill);
    }

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
      await saveLibrary({ removeId: item.id });
      await renderCacheSessions();
      showBanner(t('msgRemovedFromLibrary'), 'info');
    });

    actions.append(btnCheckNew, btnOpen, btnRemove);
    body.append(titleRow, pMeta, pLast, actions);
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

  const id = getCurrentSeriesKey();
  const existing = state.library.find((item) => item.id === id);
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
    lastDownloadedUrl: lastCh ? normalizeUrl(lastCh.url) : existing?.lastDownloadedUrl || '',
    lastDownloadedTitle: lastCh ? lastCh.displayTitle : existing?.lastDownloadedTitle || '',
    updatedAt: new Date().toISOString()
  };

  await saveLibrary({ upsertEntry: entry });
  await renderCacheSessions();
  appendLog(`Biblioteca atualizada: "${entry.title}" (${entry.totalChapters} capítulos).`);
  showBanner(t('msgSavedToLibrary', { title: entry.title, count: entry.totalChapters }), 'success');
}

async function updateLibraryAfterExport(packagedChapters) {
  const id = getCurrentSeriesKey();
  if (!id || packagedChapters.length === 0) return;

  let existing = state.library.find((item) => item.id === id);
  if (!existing && chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbLibrary');
    existing = (res?.wpbLibrary || []).find((item) => item.id === id);
  }
  if (!existing) return;

  const lastPackaged = packagedChapters[packagedChapters.length - 1];
  const knownSet = new Set(existing.knownUrls || []);
  for (const ch of state.chapters) {
    knownSet.add(normalizeUrl(ch.url));
  }

  const updatedEntry = {
    ...existing,
    title: state.metadata.title || existing.title,
    author: state.metadata.author || existing.author,
    coverUrl: state.metadata.coverUrl || existing.coverUrl,
    totalChapters: Math.max(state.chapters.length, existing.totalChapters || 0),
    knownUrls: Array.from(knownSet),
    lastDownloadedUrl: normalizeUrl(lastPackaged.url),
    lastDownloadedTitle: lastPackaged.displayTitle,
    updatedAt: new Date().toISOString()
  };
  await saveLibrary({ upsertEntry: updatedEntry });
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

async function handleCheckAllLibrary() {
  const entries = [...state.library].filter((item) => Boolean(item.startingUrl));
  if (entries.length === 0) {
    showBanner(t('msgCheckAllEmpty'), 'info');
    return;
  }

  const btn = $('btn-check-all-library');
  btn.disabled = true;
  let withNew = 0;
  let totalNew = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      btn.textContent = t('btnCheckingAllLibrary', { done: i + 1, total: entries.length });
      try {
        const domain = normalizeRuleDomain(entry.startingUrl);
        const rule = domain ? state.domainRules[domain] : null;
        const effectiveOpts = rule
          ? {
              ...state.options,
              customListSelector: rule.listSelector || state.options.customListSelector,
              customContentSelector: rule.contentSelector || state.options.customContentSelector,
              customExcludeSelector: rule.excludeSelector || state.options.customExcludeSelector,
              renderWithTab: typeof rule.renderWithTab === 'boolean' ? rule.renderWithTab : false
            }
          : { ...state.options, renderWithTab: false };

        const { series } = await loadSeriesWithParser(entry.startingUrl, effectiveOpts);
        const knownSet = new Set((entry.knownUrls || []).map((u) => normalizeUrl(u)));
        const lastIdx = entry.lastDownloadedUrl
          ? series.chapters.findIndex((c) => normalizeUrl(c.url) === normalizeUrl(entry.lastDownloadedUrl))
          : -1;
        let newCount = 0;
        series.chapters.forEach((ch, idx) => {
          const norm = normalizeUrl(ch.url);
          if (!knownSet.has(norm) || (lastIdx >= 0 && idx > lastIdx)) {
            newCount++;
          }
        });
        if (newCount > 0) {
          withNew++;
          totalNew += newCount;
        }
        await saveLibrary({
          upsertEntry: {
            ...entry,
            totalChapters: series.chapters.length || entry.totalChapters,
            newChaptersCount: newCount,
            lastCheckedAt: new Date().toISOString()
          }
        });
        appendLog(
          `Biblioteca: "${entry.title}" -> ${newCount > 0 ? `+${newCount} capítulo(s) novo(s)` : 'em dia'}.`
        );
      } catch (err) {
        appendLog(`Aviso ao checar "${entry.title}": ${err.message}`, 'warn');
      }
      await sleep(250);
    }
    showBanner(t('msgCheckAllDone', { withNew, totalNew }), withNew > 0 ? 'success' : 'info');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnCheckAllLibrary');
  }
}

async function handleUploadCoverFile(file) {
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

function handleGenerateCover() {
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

  // Deep slate gradient matching WebPullBook brand palette
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#162032');
  grad.addColorStop(1, '#263447');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Spine stripe & highlight
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 0, 56, h);
  ctx.fillStyle = 'rgba(96, 165, 250, 0.45)';
  ctx.fillRect(56, 0, 8, h);

  // Inner frame
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(102, 72, w - 150, h - 144);

  // Title typography
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 58px Georgia, serif';
  ctx.textBaseline = 'top';
  const titleLines = wrapCanvasText(ctx, title, w - 230);
  let y = 210;
  for (const line of titleLines) {
    ctx.fillText(line, 148, y);
    y += 76;
  }

  // Divider accent
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(148, Math.min(820, y + 32), 140, 6);

  // Author & footer
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

async function openChapterPreviewForTarget(ch, parser = state.activeParser) {
  if (!ch) return;

  const dialog = $('preview-modal');
  const titleEl = $('preview-modal-title');
  const metaEl = $('preview-modal-meta');
  const contentEl = $('preview-modal-content');

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
        renderWithTab: state.options.renderWithTab || state.seriesRequiresTab
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
  } catch (err) {
    metaEl.textContent = t('msgPreviewError', { error: err.message });
    const errP = document.createElement('p');
    errP.className = 'muted';
    errP.textContent = err.message;
    contentEl.replaceChildren(errP);
  }
}

async function openChapterPreview(chapterIdx = -1) {
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

let mergeCandidates = [];

async function queryMergeableTabs(allWindows = false) {
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

function renderMergeTabsList() {
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
    eyeBtn.textContent = '👁';
    eyeBtn.title = t('btnPreviewTitle');
    eyeBtn.addEventListener('click', () => {
      openChapterPreviewForTarget(
        {
          url: item.url,
          tabId: item.tabId,
          displayTitle: normalizeSpaces(item.title) || item.url
        },
        genericHtmlParser
      );
    });

    actions.append(upBtn, downBtn, eyeBtn);
    row.append(cb, idxSpan, mainCol, volInput, actions);
    frag.appendChild(row);
  });

  listEl.replaceChildren(frag);
  updateMergeTabsHeaderState();
}

function applyMergedTabsSelection() {
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

  state.activeParser = genericHtmlParser;
  state.seriesRequiresTab = false;
  state.metadata = {
    startingUrl: chosen[0].url,
    title: defaultTitle,
    author: 'WebPullBook',
    language: state.options.uiLang === 'en' ? 'en' : 'pt',
    filename: sanitizeFilename(defaultTitle, true),
    coverUrl: '',
    coverThumbUrl: '',
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
  syncMetadataToUi();
  populateRangeSelects();
  renderAllChapterViews();

  $('merge-tabs-modal').close('confirm');
  appendLog(`Modo Juntar Abas: ${chosen.length} aba(s) carregadas (${mode}).`);
  showBanner(t('msgTabsMerged', { count: chosen.length }), 'success');
}

async function handleMergeOpenTabs() {
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
    appendLog(`Erro ao juntar abas: ${err.message}`);
    showBanner(`Erro: ${err.message}`, 'error');
  }
}

async function hydrateChaptersFromCache(chapters) {
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

async function handleLoadSeries(url) {
  hideBanner();
  applyDomainRuleForUrl(url);
  readOptionsFromUi();
  const btn = $('btn-load-series');
  btn.disabled = true;
  btn.textContent = t('btnLoadingSeries');
  appendLog(`Carregando URL: ${url}`);

  try {
    const { parser, series } = await loadSeriesWithParser(url, state.options);
    state.activeParser = parser;
    state.seriesRequiresTab = Boolean(series.requiresTabRender);
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

async function handleAutoDetectSelectors() {
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
    let indexDoc = await fetchDocumentWithOptions(url, { renderWithTab: state.options.renderWithTab });
    let scan = genericHtmlParser.suggestSelectors({ indexDoc, targetUrl: url });
    if (scan.listCount === 0 && !state.options.renderWithTab) {
      try {
        const renderedDoc = await fetchDocumentWithOptions(url, { renderWithTab: true });
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
        chapterDoc = await fetchDocumentWithOptions(sampleUrl, { renderWithTab: state.options.renderWithTab });
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
      `Heurística: list="${fullScan.listSelector || '-'}" (${fullScan.listCount}), content="${fullScan.contentSelector || '-'}" (${fullScan.contentChars} chars), exclude="${fullScan.excludeSelector || '-'}"`
    );
    showBanner(
      t('msgAutoDetectResult', {
        listCount: fullScan.listCount,
        contentChars: fullScan.contentChars
      }),
      fullScan.listCount > 0 || fullScan.contentChars > 0 ? 'success' : 'info'
    );
  } catch (err) {
    appendLog(`Erro na heurística: ${err.message}`, 'error');
    showBanner(t('msgAutoDetectFailed', { error: err.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnAutoDetectSelectors');
  }
}

function formatOutputFilename({ baseFilename, title, author, volumeLabel, suffix, extension = 'epub' }) {
  return buildOutputPath({
    baseFilename,
    title,
    author: author || t('authorUnknownPlaceholder'),
    volumeLabel,
    suffix,
    extension,
    language: state.metadata.language,
    options: state.options
  });
}

async function resolveUniqueFileNameInDir(dirHandle, filename) {
  const dotIdx = filename.lastIndexOf('.');
  const stem = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? filename : `${stem} (${attempt})${ext}`;
    try {
      await dirHandle.getFileHandle(candidate, { create: false });
    } catch (err) {
      if (err?.name === 'NotFoundError') {
        return candidate;
      }
      return filename;
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}

async function writeBlobToDirectoryHandle(rootHandle, relativePath, blob) {
  const parts = String(relativePath || '').split('/').filter(Boolean);
  const rawName = parts.pop() || 'webpullbook-ebook.epub';
  let dir = rootHandle;
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const uniqueName = await resolveUniqueFileNameInDir(dir, rawName);
  const fileHandle = await dir.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return parts.length > 0 ? `${parts.join('/')}/${uniqueName}` : uniqueName;
}

async function ensureCustomDirWritable() {
  if (state.options.saveTargetMode !== 'custom-dir') {
    return null;
  }
  if (!state.customDirHandle) {
    state.customDirHandle = await loadSavedDirectoryHandle();
  }
  if (!state.customDirHandle) {
    await checkCustomDirStatus();
    updateSaveLocationUi();
    return null;
  }
  try {
    let perm = await checkCustomDirStatus();
    if (perm !== 'granted' && typeof state.customDirHandle.requestPermission === 'function') {
      perm = await state.customDirHandle.requestPermission({ mode: 'readwrite' });
      state.customDirPermission = perm;
    }
    updateSaveLocationUi();
    if (perm === 'granted') {
      return state.customDirHandle;
    }
  } catch (err) {
    appendLog(`Permissão de pasta local falhou: ${err.message}`, 'warn');
  }
  const folderLabel = state.customDirHandle?.name || state.options.customDirName || 'WebPullBook';
  appendLog(t('msgCustomFolderFallback', { name: folderLabel }), 'warn');
  showBanner(t('msgCustomFolderFallback', { name: folderLabel }), 'info');
  return null;
}

async function saveBookOutput(blob, relativePath, activeDirHandle = null) {
  if (activeDirHandle) {
    try {
      const writtenPath = await writeBlobToDirectoryHandle(activeDirHandle, relativePath, blob);
      return `${activeDirHandle.name}/${writtenPath}`;
    } catch (err) {
      appendLog(`Falha ao gravar na pasta personalizada (${err.message}); usando Downloads.`, 'warn');
    }
  }
  await downloadBlobToChrome(blob, relativePath);
  return `Downloads/${relativePath}`;
}

async function handlePickSaveFolder() {
  if (typeof window.showDirectoryPicker !== 'function') {
    showBanner(t('saveTargetUnsupported'), 'error');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: 'webpullbook-output',
      mode: 'readwrite'
    });
    state.customDirHandle = handle;
    state.customDirPermission = 'granted';
    state.options.saveTargetMode = 'custom-dir';
    state.options.customDirName = handle.name;
    await persistDirectoryHandle(handle);
    await saveOptions();
    updateSaveLocationUi();
    updatePathPreview();
    showBanner(t('msgCustomFolderSaved', { name: handle.name }), 'success');
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showBanner(err.message, 'error');
    }
  }
}

async function handleUseDownloadsFolder() {
  state.options.saveTargetMode = 'downloads';
  state.options.customDirName = '';
  await clearSavedDirectoryHandle();
  await saveOptions();
  updateSaveLocationUi();
  updatePathPreview();
  showBanner(t('msgCustomFolderCleared'), 'info');
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

async function enforceSafeThrottle(networkTimestamps, networkFetchCount, signal) {
  readOptionsFromUi();
  const effectiveBaseDelay = Math.max(
    state.options.delayMs || 0,
    state.activeParser?.minDelayMs || 0
  );
  if (!state.options.safeMode) {
    if (effectiveBaseDelay > 0) {
      await sleep(effectiveBaseDelay, signal);
    }
    return;
  }

  // Batch cooldown rest every N network chapters
  const batchN = state.options.safeBatchSize ?? 25;
  if (batchN > 0 && networkFetchCount > 0 && networkFetchCount % batchN === 0) {
    $('progress-detail').textContent = `Modo Seguro: pausa curta de respiro (10s)...`;
    await sleep(10000, signal);
  }

  // Humanized jitter (1.8s - 3.2s or configured/parser min delay if larger)
  const minDelay = Math.max(effectiveBaseDelay, 1800);
  const jittered = minDelay + Math.round(Math.random() * 1400);
  await sleep(jittered, signal);

  // Rolling 60-second RPM ceiling
  const maxRpm = Math.max(5, state.options.safeRpm || 22);
  const now = Date.now();
  while (networkTimestamps.length > 0 && now - networkTimestamps[0] >= 60000) {
    networkTimestamps.shift();
  }
  if (networkTimestamps.length >= maxRpm) {
    const waitMs = Math.max(500, 60500 - (now - networkTimestamps[0]));
    $('progress-detail').textContent = `Modo Seguro: aguardando janela RPM (${Math.ceil(waitMs / 1000)}s)...`;
    await sleep(waitMs, signal);
  }
}

async function persistSessionSnapshot() {
  if (state.options.cacheTtlDays <= 0 || state.chapters.length === 0) return;
  await cacheStore.putSession({
    seriesKey: getCurrentSeriesKey(),
    metadata: state.metadata,
    parserId: state.activeParser?.id || 'auto',
    chapters: state.chapters,
    ttlDays: state.options.cacheTtlDays
  });
}

async function getChapterFromCaches(ch, cacheKey) {
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

async function handlePackEpub() {
  if (state.running) return;
  readMetadataFromUi();
  readOptionsFromUi();

  const selected = state.chapters.filter((c) => c.included);
  if (selected.length === 0) {
    showBanner(t('msgSelectAtLeastOne'), 'error');
    return;
  }

  const activeDirHandle = await ensureCustomDirWritable();

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
  await persistSessionSnapshot();

  const mode = document.querySelector('input[name="pack-mode"]:checked')?.value || 'by-volume';
  const jobs = [];

  if (mode === 'by-volume') {
    const volMap = new Map();
    for (const ch of selected) {
      const vol = ch.volume || 'Volume 01';
      if (!volMap.has(vol)) volMap.set(vol, []);
      volMap.get(vol).push(ch);
    }
    const isSeparateBook = Boolean(state.metadata.separateBooksMode);
    for (const [vol, list] of volMap.entries()) {
      jobs.push({
        volumeLabel: vol,
        bookTitle: isSeparateBook ? vol : `${state.metadata.title} — ${vol}`,
        seriesName: isSeparateBook ? '' : state.metadata.title,
        seriesIndex: isSeparateBook ? 1 : extractVolumeNumber(vol),
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
  let networkFetchCount = 0;
  const networkTimestamps = [];
  const allPackagedChapters = [];
  const chapterErrors = [];
  const imageWarnings = [];
  const exporter = exporterRegistry.get(state.options.outputFormat);
  const extUpper = exporter.extension.toUpperCase();
  const seriesKey = getCurrentSeriesKey();

  for (const ch of selected) {
    ch.warnings = [];
    if (ch.status === 'error') {
      ch.logId = '';
    }
  }

  try {
    const batchWidth = state.options.safeMode
      ? 1
      : Math.max(1, Math.min(6, Number(state.options.concurrency) || 1));

    appendLog(
      `Iniciando exportação (${exporter.name}): ${jobs.length} arquivo(s) ${extUpper}, ${totalChaptersAll} capítulos no total${state.options.safeMode ? ' [Modo Seguro]' : batchWidth > 1 ? ` [${batchWidth}x paralelo]` : ''}.`
    );

    const processSingleChapterFetch = async (ch) => {
      const cacheKey = getCacheKey(ch.url);
      const cachedHydrated = await getChapterFromCaches(ch, cacheKey);
      if (cachedHydrated) {
        ch.status = 'ok';
        ch.errorMsg = '';
        ch.logId = '';
        return { kind: 'ok', ch, hydrated: cachedHydrated, fromNetwork: false };
      }

      ch.status = 'downloading';
      renderChaptersTable();

      try {
        networkTimestamps.push(Date.now());
        const chapterFetchOptions = state.seriesRequiresTab
          ? { ...state.options, renderWithTab: true }
          : state.options;
        const parsed = await downloadAndParseChapter(ch, state.activeParser, chapterFetchOptions, signal);
        networkFetchCount++;

        const cacheRec = {
          chapterTitle: parsed.chapterTitle,
          subtitle: parsed.subtitle,
          contentXml: serializeNodesForCache(parsed.nodes)
        };
        state.chapterCache.set(cacheKey, cacheRec);
        await cacheStore.putChapter({
          key: cacheKey,
          seriesKey,
          chapterUrl: ch.url,
          chapterTitle: cacheRec.chapterTitle,
          subtitle: cacheRec.subtitle,
          nodes: parsed.nodes,
          ttlDays: state.options.cacheTtlDays
        });

        ch.status = 'ok';
        ch.errorMsg = '';
        ch.logId = '';
        return { kind: 'ok', ch, hydrated: hydrateCachedChapter(ch, cacheRec), fromNetwork: true };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if ((err.isRateLimit || err.isAntiBotChallenge) && state.options.autoPauseOnRateLimit !== false) {
          ch.status = 'error';
          ch.errorMsg = err.message;
          ch.logId = appendLog(
            err.isAntiBotChallenge
              ? `VERIFICAÇÃO ANTI-BOT detectada em "${ch.displayTitle}" (${ch.url}) — pausando fila automaticamente!`
              : `BLOQUEIO DE TAXA (${err.status || 503}) detectado em "${ch.displayTitle}" (${ch.url}) — pausando fila automaticamente!`,
            'error'
          );
          return {
            kind: 'pause',
            ch,
            fromNetwork: true,
            pauseTrigger: err.isAntiBotChallenge
              ? { kind: 'antibot', url: ch.url }
              : { kind: 'ratelimit', status: err.status || 429 }
          };
        }
        if (err.status === 404 && state.options.skip404) {
          ch.status = 'skipped';
          ch.errorMsg = 'HTTP 404';
          ch.logId = appendLog(`404 pulado: ${ch.url}`, 'warn');
          return { kind: 'skipped', ch, fromNetwork: true };
        }
        ch.status = 'error';
        ch.errorMsg = err.message;
        totalFailedChapters++;
        ch.logId = appendLog(`FALHA no capítulo "${ch.displayTitle}" (${ch.url}): ${err.message}`, 'error');
        chapterErrors.push({
          chapterIndex: ch.index,
          chapterTitle: ch.displayTitle,
          chapterUrl: ch.url,
          message: err.message,
          logId: ch.logId
        });
        if (state.options.continueOnError === false) throw err;
        return { kind: 'error', ch, fromNetwork: true };
      }
    };

    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      const parsedChapters = [];

      let c = 0;
      while (c < job.chapters.length) {
        await waitWhilePaused(signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const waveStart = c;
        const wave = job.chapters.slice(c, c + batchWidth);
        const firstCh = wave[0];
        $('progress-label').textContent = `(${j + 1}/${jobs.length}) ${job.volumeLabel || extUpper}`;
        $('progress-detail').textContent = `${firstCh.displayTitle} (${completedGlobal + 1}/${totalChaptersAll})`;
        const pct = Math.round((completedGlobal / totalChaptersAll) * 100);
        $('progress-bar').value = pct;
        $('progress-pct').textContent = `${pct}%`;

        const waveResults = await Promise.all(wave.map((ch) => processSingleChapterFetch(ch)));
        let waveHadNetwork = false;
        let pausedAtOffset = -1;

        for (let k = 0; k < waveResults.length; k++) {
          const res = waveResults[k];
          if (res.fromNetwork) waveHadNetwork = true;
          if (res.kind === 'pause') {
            pausedAtOffset = k;
            renderChaptersTable();
            await persistSessionSnapshot();
            networkTimestamps.length = 0;
            state.paused = true;
            $('btn-pause').textContent = t('btnResume');
            showBanner(
              res.pauseTrigger.kind === 'antibot'
                ? t('msgAntiBotPaused', { url: res.pauseTrigger.url })
                : t('msgRateLimitPaused', { status: res.pauseTrigger.status }),
              'error'
            );
            await renderCacheSessions();
            await waitWhilePaused(signal);
            hideBanner();
            break;
          }
          if (res.kind === 'ok') {
            parsedChapters.push(res.hydrated);
            allPackagedChapters.push(res.ch);
            totalOkChapters++;
          }
          completedGlobal++;
        }

        renderChaptersTable();
        if (pausedAtOffset >= 0) {
          c = waveStart + pausedAtOffset;
          continue;
        }
        if (waveHadNetwork && networkFetchCount % 5 === 0) {
          await persistSessionSnapshot();
        }
        c += wave.length;
        if (waveHadNetwork && completedGlobal < totalChaptersAll) {
          await enforceSafeThrottle(networkTimestamps, networkFetchCount, signal);
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
        onWarning: (w) => {
          imageWarnings.push(w);
          if (w.chapterId) {
            const chRef = state.chapters.find((c) => c.id === w.chapterId);
            if (chRef) {
              chRef.warnings = chRef.warnings || [];
              chRef.warnings.push(w);
            }
          }
        },
        signal
      });

      const outName = formatOutputFilename({
        baseFilename: state.metadata.filename,
        title: state.metadata.title,
        author: state.metadata.author,
        volumeLabel: job.volumeLabel,
        extension: exporter.extension
      });

      const savedPath = await saveBookOutput(outBlob, outName, activeDirHandle);
      filesGenerated++;
      appendLog(`Arquivo salvo: ${savedPath} (${(outBlob.size / 1024).toFixed(1)} KB, ${parsedChapters.length} caps)`);
    }

    if (allPackagedChapters.length > 0) {
      await updateLibraryAfterExport(allPackagedChapters);
    }
    await persistSessionSnapshot();
    await renderCacheSessions();

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
        imageWarnings.length > 0 ? 'info' : 'success'
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
    renderExportReport({
      okCount: totalOkChapters,
      chapterErrors,
      imageWarnings
    });
  } catch (err) {
    await persistSessionSnapshot();
    await renderCacheSessions();
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
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'library') renderCacheSessions();
    });
  }

  const tablist = document.querySelector('.tabs[role="tablist"]');
  if (tablist) {
    tablist.addEventListener('keydown', (e) => {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx !== -1) {
        e.preventDefault();
        const nextTab = tabs[nextIdx];
        switchTab(nextTab.dataset.tab);
        if (nextTab.dataset.tab === 'library') renderCacheSessions();
        nextTab.focus();
      }
    });
  }

  $('load-series-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('starting-url').value.trim();
    if (url) handleLoadSeries(url);
  });

  $('btn-merge-tabs').addEventListener('click', handleMergeOpenTabs);
  $('merge-select-all').addEventListener('change', () => {
    const checked = $('merge-select-all').checked;
    for (const item of mergeCandidates) item.included = checked;
    renderMergeTabsList();
  });
  $('merge-all-windows').addEventListener('change', async () => {
    const detected = await queryMergeableTabs($('merge-all-windows').checked);
    const prevSelected = new Map(mergeCandidates.map((m) => [m.url, m]));
    mergeCandidates = detected.map((item) => {
      const old = prevSelected.get(item.url);
      return old ? { ...item, included: old.included, title: old.title, customVolume: old.customVolume, customBookTitle: old.customBookTitle } : item;
    });
    renderMergeTabsList();
  });
  $('merge-organize-mode').addEventListener('change', () => {
    renderMergeTabsList();
  });
  $('btn-confirm-merge-tabs').addEventListener('click', applyMergedTabsSelection);
  $('btn-save-library').addEventListener('click', saveCurrentSeriesToLibrary);
  $('btn-save-library-tab').addEventListener('click', saveCurrentSeriesToLibrary);
  $('btn-check-all-library').addEventListener('click', handleCheckAllLibrary);

  $('opt-safe-mode-quick').addEventListener('change', async () => {
    const val = $('opt-safe-mode-quick').checked;
    $('opt-safe-mode').checked = val;
    readOptionsFromUi();
    await saveOptions();
  });
  $('opt-safe-mode').addEventListener('change', async () => {
    const val = $('opt-safe-mode').checked;
    $('opt-safe-mode-quick').checked = val;
    readOptionsFromUi();
    await saveOptions();
  });

  $('opt-cache-ttl').addEventListener('change', async () => {
    readOptionsFromUi();
    await saveOptions();
    if (state.options.cacheTtlDays <= 0) {
      await cacheStore.clearAll();
      state.chapterCache.clear();
      await renderCacheSessions();
      renderChaptersTable();
    }
  });

  $('btn-clear-all-cache').addEventListener('click', async () => {
    await cacheStore.clearAll();
    state.chapterCache.clear();
    for (const ch of state.chapters) {
      if (ch.status === 'ok') ch.status = 'pending';
    }
    await renderCacheSessions();
    renderChaptersTable();
    showBanner(t('msgCacheCleared'), 'info');
  });

  $('ui-lang-top').addEventListener('change', async () => {
    const newLang = $('ui-lang-top').value;
    applyLanguageChoice(newLang);
    await saveOptions();
  });

  $('ui-theme-top').addEventListener('change', async () => {
    const newTheme = $('ui-theme-top').value;
    state.options.theme = newTheme;
    applyThemeChoice(newTheme);
    await saveOptions();
  });

  $('meta-title').addEventListener('input', () => {
    $('meta-filename').value = sanitizeFilename($('meta-title').value, true);
    updatePathPreview();
  });

  for (const liveId of [
    'meta-author',
    'meta-filename',
    'meta-language',
    'opt-root-folder',
    'opt-folder-template',
    'opt-custom-filename'
  ]) {
    $(liveId).addEventListener('input', updatePathPreview);
  }
  $('opt-folder-layout').addEventListener('change', updatePathPreview);
  $('opt-remove-illegal').addEventListener('change', updatePathPreview);
  $('btn-pick-save-folder').addEventListener('click', handlePickSaveFolder);
  $('btn-use-downloads-folder').addEventListener('click', handleUseDownloadsFolder);

  $('meta-cover-url').addEventListener('change', updateCoverPreview);
  $('btn-upload-cover').addEventListener('click', () => {
    $('input-upload-cover').click();
  });
  $('input-upload-cover').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await handleUploadCoverFile(file);
      } catch (err) {
        showBanner(err.message, 'error');
      }
    }
    e.target.value = '';
  });
  $('btn-generate-cover').addEventListener('click', handleGenerateCover);
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
  $('btn-preview-chapter').addEventListener('click', () => openChapterPreview(-1));
  $('reader-preset').addEventListener('change', async () => {
    applyReaderPreset($('reader-preset').value);
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
      updateTypographyPreview();
      await saveOptions();
    });
  }

  const advInputs = document.querySelectorAll('#tab-advanced input, #tab-advanced select, #tab-advanced textarea');
  for (const el of advInputs) {
    if (typoIds.includes(el.id) || el.id === 'opt-safe-mode') continue;
    el.addEventListener('change', async () => {
      readOptionsFromUi();
      await saveOptions();
    });
  }

  const confirmResetDialog = $('confirm-reset-modal');
  let pendingResetAction = null;

  const openConfirmResetModal = ({ title, desc, confirmLabel, onConfirm }) => {
    $('confirm-reset-title').textContent = title;
    $('confirm-reset-desc').textContent = desc;
    $('btn-confirm-reset-all').textContent = confirmLabel;
    pendingResetAction = onConfirm;
    confirmResetDialog.showModal();
  };

  const resetOptionSection = (sectionHeadingKey, keys, afterReset) => {
    const sectionName = t(sectionHeadingKey);
    openConfirmResetModal({
      title: t('modalResetSectionTitle', { section: sectionName }),
      desc: t('modalResetSectionDesc', { section: sectionName }),
      confirmLabel: t('btnConfirmResetSection'),
      onConfirm: () => {
        for (const key of keys) {
          state.options[key] = DEFAULT_OPTIONS[key];
        }
        const tail = afterReset ? afterReset() : null;
        syncOptionsToUi();
        showBanner(t('msgSectionReset', { section: sectionName }), 'info');
        confirmResetDialog.close('confirm');
        Promise.resolve(tail).then(() => saveOptions());
      }
    });
  };

  $('btn-reset-files').addEventListener('click', () =>
    resetOptionSection(
      'advFilesHeading',
      [
        'saveTargetMode',
        'customDirName',
        'rootFolderName',
        'folderLayout',
        'customFolderTemplate',
        'customFilename',
        'maxChaptersPerEpub',
        'noSaveAs',
        'removeIllegal',
        'createEpub3',
        'addInfoPage',
        'removeNavLinks'
      ],
      async () => {
        await clearSavedDirectoryHandle();
        updateSaveLocationUi();
        updatePathPreview();
      }
    )
  );

  $('btn-reset-extraction').addEventListener('click', () =>
    resetOptionSection('advExtractionHeading', [
      'parserId',
      'customListSelector',
      'customContentSelector',
      'customExcludeSelector',
      'customStripPatterns',
      'crawlNextLinks'
    ])
  );

  $('btn-reset-network').addEventListener('click', () =>
    resetOptionSection('advNetworkOnlyHeading', [
      'delayMs',
      'concurrency',
      'maxRetries',
      'safeRpm',
      'safeBatchSize',
      'renderWaitMs',
      'safeMode',
      'autoPauseOnRateLimit',
      'continueOnError',
      'skip404',
      'renderWithTab',
      'autoFallbackTab',
      'preferOpenTabDom'
    ])
  );

  $('btn-reset-images').addEventListener('click', () =>
    resetOptionSection('advImagesHeading', [
      'compressedResolution',
      'compressedFormat',
      'imageQuality',
      'restrictCoverJpeg',
      'compressImages',
      'grayscaleImages',
      'skipImages',
      'useSvgForImages'
    ])
  );

  $('btn-reset-css').addEventListener('click', () =>
    resetOptionSection(
      'advTypoHeading',
      ['fontFamily', 'textAlign', 'lineHeight', 'paragraphIndent', 'stylesheet'],
      updateTypographyPreview
    )
  );

  $('btn-auto-detect-selectors').addEventListener('click', () => {
    handleAutoDetectSelectors();
  });

  $('btn-save-domain-rule').addEventListener('click', () => {
    handleSaveDomainRule();
  });

  $('btn-export-opts').addEventListener('click', () => {
    readOptionsFromUi();
    const bundle = {
      options: state.options,
      domainRules: state.domainRules
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    downloadBlobToChrome(blob, 'webpullbook-options.json');
  });

  $('input-import-opts').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const importedOpts = parsed?.options && typeof parsed.options === 'object' ? parsed.options : parsed;
      state.options = { ...DEFAULT_OPTIONS, ...importedOpts };
      if (parsed?.domainRules && typeof parsed.domainRules === 'object') {
        state.domainRules = { ...state.domainRules, ...parsed.domainRules };
        await saveDomainRules();
      }
      syncOptionsToUi();
      applyThemeChoice(state.options.theme);
      applyLanguageChoice(state.options.uiLang);
      await saveOptions();
      showBanner('OK', 'success');
    } catch (err) {
      showBanner(`JSON Error: ${err.message}`, 'error');
    }
    e.target.value = '';
  });

  $('btn-reset-all-opts').addEventListener('click', () => {
    openConfirmResetModal({
      title: t('modalResetTitle'),
      desc: t('modalResetDesc'),
      confirmLabel: t('btnConfirmResetAll'),
      onConfirm: () => {
        state.customDirHandle = null;
        state.customDirPermission = 'none';
        state.options = {
          ...DEFAULT_OPTIONS,
          uiLang: state.options.uiLang,
          theme: state.options.theme,
          cacheTtlDays: state.options.cacheTtlDays
        };
        syncOptionsToUi();
        showBanner(t('msgOptionsReset'), 'info');
        confirmResetDialog.close('confirm');
        clearSavedDirectoryHandle().then(() => saveOptions());
      }
    });
  });

  $('btn-confirm-reset-all').addEventListener('click', async () => {
    const action = pendingResetAction;
    pendingResetAction = null;
    if (action) await action();
    if (confirmResetDialog.open) {
      confirmResetDialog.close('confirm');
    }
  });

  $('btn-clear-logs').addEventListener('click', () => {
    state.logs = [];
    $('log-output').textContent = t('logsCleared');
    updateLogBadges();
  });
  $('btn-download-logs').addEventListener('click', () => {
    const plain = state.logs.map((l) => `[${l.time}] ${l.msg}`).join('\n');
    const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
    downloadBlobToChrome(blob, 'webpullbook-log.txt');
  });

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.wpbLibrary?.newValue) {
        state.library = changes.wpbLibrary.newValue;
        renderLibrary();
        renderCacheSessions();
      }
    });
  }

  window.addEventListener('storage', (e) => {
    if (e.key === 'wpb-color-scheme') {
      applyThemeChoice(e.newValue || 'system');
    }
  });

  const darkSchemeMq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (darkSchemeMq) {
    darkSchemeMq.addEventListener('change', () => {
      if (state.options.theme === 'system') {
        applyThemeChoice('system');
      }
    });
  }
}

async function init() {
  populateRegistries();
  await loadOptions();
  await loadDomainRules();
  await cacheStore.pruneExpired();
  await loadLibrary();
  await renderCacheSessions();
  wireEvents();

  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get('url');
  if (initialUrl && /^https?:\/\//i.test(initialUrl)) {
    $('starting-url').value = initialUrl;
    await handleLoadSeries(initialUrl);
  }
}

init();
