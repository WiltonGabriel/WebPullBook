import { buildOutputPath, sanitizeFilename } from '../core/parser-engine.js';
import { DEFAULT_CACHE_TTL_DAYS } from '../core/cache-store.js';
import { getParserById, parserRegistry } from '../parsers/index.js';
import { exporterRegistry } from '../exporters/index.js';
import {
  $,
  DEFAULT_OPTIONS,
  READER_PRESETS,
  detectMatchingReaderPreset,
  normalizeRuleDomain,
  state,
  t
} from './state.js';
import { appendLog, showBanner } from './logger.js';

const VALID_THEMES = new Set(['light', 'dark', 'sepia', 'midnight']);
const HANDLE_DB_NAME = 'WebPullBookHandles';
const HANDLE_STORE_NAME = 'handles';
const OUTPUT_DIR_KEY = 'outputDir';

function resolveEffectiveTheme(theme) {
  if (VALID_THEMES.has(theme)) return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemeChoice(theme) {
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

export async function loadSavedDirectoryHandle() {
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

export async function persistDirectoryHandle(handle) {
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

export async function clearSavedDirectoryHandle() {
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

export async function checkCustomDirStatus() {
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

export function updateSaveLocationUi() {
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

export function updatePathPreview() {
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

export async function saveOptions() {
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ wpbOptions: state.options });
  }
}

export async function loadOptions(onLoadedLanguage) {
  if (chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbOptions');
    if (res?.wpbOptions) {
      const stored = { ...res.wpbOptions };
      if (stored.folderLayout === undefined && stored.subfolder === false) {
        stored.folderLayout = 'flat';
      }
      delete stored.subfolder;
      // Preserve color on reader presets by never leaving grayscale forced
      stored.grayscaleImages = false;
      state.options = { ...DEFAULT_OPTIONS, ...stored };
    }
  }
  state.customDirHandle = await loadSavedDirectoryHandle();
  await checkCustomDirStatus();
  syncOptionsToUi();
  applyThemeChoice(state.options.theme);
  if (onLoadedLanguage) onLoadedLanguage(state.options.uiLang);
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

export async function loadLibrary(onRenderLibrary) {
  if (chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbLibrary');
    if (Array.isArray(res?.wpbLibrary)) {
      state.library = res.wpbLibrary;
    }
  }
  if (onRenderLibrary) onRenderLibrary();
}

export async function saveLibrary({ removeId = null, upsertEntry = null } = {}, onRenderLibrary) {
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
  if (onRenderLibrary) onRenderLibrary();
}

export async function loadDomainRules() {
  if (chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbDomainRules');
    if (res?.wpbDomainRules && typeof res.wpbDomainRules === 'object') {
      state.domainRules = { ...res.wpbDomainRules };
    }
  }
  renderDomainRules();
}

export async function saveDomainRules() {
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ wpbDomainRules: state.domainRules });
  }
  renderDomainRules();
}

export function applyDomainRuleToInputs(domain) {
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

export function applyDomainRuleForUrl(rawUrl) {
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
    appendLog(`[RULE] Regra salva aplicada automaticamente para "${domain}".`);
    return true;
  }
  return false;
}

export function renderDomainRules() {
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

export async function handleSaveDomainRule() {
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
  appendLog(`[RULE] Regra de seletores salva para "${domain}".`);
  showBanner(t('msgDomainRuleSaved', { domain }), 'success');
}

export function updateTypographyPreview() {
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

export function updateReaderPresetWarning() {
  const warnEl = $('legacy-preset-warning');
  if (!warnEl) return;
  const isLegacy = ($('reader-preset')?.value || state.options.readerPreset) === 'legacy';
  warnEl.classList.toggle('hidden', !isLegacy);
}

export function applyReaderPreset(presetKey) {
  const cfg = READER_PRESETS[presetKey];
  if (!cfg) {
    state.options.readerPreset = 'custom';
    updateReaderPresetWarning();
    return;
  }
  state.options = { ...state.options, ...cfg, readerPreset: presetKey };
  syncOptionsToUi();
}

export function populateRegistries() {
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

export function updatePackButtonLabel() {
  const exporter = exporterRegistry.get($('output-format').value || 'epub');
  $('btn-pack-epub').textContent =
    exporter.id === 'epub'
      ? t('btnPackEpub')
      : t('btnExportFmt', { ext: exporter.extension.toUpperCase() });
}

export function updateCoverPreview() {
  const url = $('meta-cover-url').value.trim();
  const img = $('cover-preview');
  const placeholder = $('cover-placeholder');
  const formatNote = $('cover-format-note');
  const restrictJpeg = Boolean($('opt-cover-jpeg')?.checked ?? state.options.restrictCoverJpeg);

  if (url) {
    img.src = url;
    img.hidden = false;
    placeholder.classList.add('hidden');
    const isWebpOrAvif =
      /\.(?:webp|avif)(?:$|\?)/i.test(url) || /^data:image\/(?:webp|avif);/i.test(url);
    if (formatNote) formatNote.classList.toggle('hidden', !(isWebpOrAvif && !restrictJpeg));
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    placeholder.classList.remove('hidden');
    if (formatNote) formatNote.classList.add('hidden');
  }
}

export function syncOptionsToUi() {
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
  $('opt-popup-footnotes').checked = o.popupFootnotes !== false;
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
  updateCoverPreview();
}

export function readOptionsFromUi() {
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
    popupFootnotes: $('opt-popup-footnotes').checked,
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
    grayscaleImages: false,
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

export function syncMetadataToUi() {
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

export function readMetadataFromUi() {
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
