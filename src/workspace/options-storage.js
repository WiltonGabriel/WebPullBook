import { sanitizeFilename } from '../core/parser-engine.js';
import { DEFAULT_CACHE_TTL_DAYS } from '../core/cache-store.js';
import { getParserById, parserRegistry } from '../parsers/index.js';
import { exporterRegistry } from '../exporters/index.js';
import {
  $,
  DEFAULT_OPTIONS,
  READER_PRESETS,
  resolveReaderPreset,
  state,
  t
} from './state.js';
import {
  checkCustomDirStatus,
  clearSavedDirectoryHandle,
  loadSavedDirectoryHandle,
  persistDirectoryHandle,
  updatePathPreview,
  updateSaveLocationUi
} from './directory-handle.js';

export {
  checkCustomDirStatus,
  clearSavedDirectoryHandle,
  loadSavedDirectoryHandle,
  persistDirectoryHandle,
  updatePathPreview,
  updateSaveLocationUi
};

const VALID_THEMES = new Set(['light', 'dark', 'sepia', 'midnight']);

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
  const isLegacy = ($('reader-preset')?.value || state.options.readerPreset) === 'legacy';
  for (const warnId of ['legacy-preset-warning', 'adv-legacy-preset-warning']) {
    const warnEl = $(warnId);
    if (warnEl) warnEl.classList.toggle('hidden', !isLegacy);
  }
}

export function applyReaderPreset(presetKey) {
  const cfg = READER_PRESETS[presetKey];
  if (!cfg) {
    state.options.readerPreset = 'custom';
    if ($('reader-preset')) $('reader-preset').value = 'custom';
    if ($('adv-reader-preset')) $('adv-reader-preset').value = 'custom';
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
  if ($('opt-library-view-mode')) {
    $('opt-library-view-mode').value = o.libraryViewMode === 'by-site' ? 'by-site' : 'unified';
  }
  $('opt-root-folder').value = o.rootFolderName !== undefined ? o.rootFolderName : 'WebPullBook';
  $('opt-folder-layout').value = o.folderLayout || 'root-title';
  $('opt-folder-template').value = o.customFolderTemplate || '%Root%/%Author%/%Title%';
  $('opt-custom-filename').value = o.customFilename;
  $('opt-no-save-as').checked = o.noSaveAs;
  $('opt-remove-illegal').checked = o.removeIllegal;
  $('opt-epub3').checked = o.createEpub3;
  $('opt-popup-footnotes').checked = o.popupFootnotes !== false;
  $('opt-add-info').checked = o.addInfoPage !== false;
  $('opt-include-toc').checked = o.includeTocPage !== false;
  $('opt-toc-position').value = o.tocPosition === 'end' ? 'end' : 'start';
  $('opt-toc-title').value = o.tocTitle || '';
  $('opt-info-title').value = o.infoPageTitle || '';
  $('opt-info-show-title').checked = o.infoShowTitle !== false;
  $('opt-info-show-author').checked = o.infoShowAuthor !== false;
  $('opt-info-show-genres').checked = o.infoShowGenres !== false;
  $('opt-info-show-source').checked = o.infoShowSource !== false;
  $('opt-info-show-synopsis').checked = o.infoShowSynopsis !== false;
  $('opt-remove-nav').checked = o.removeNavLinks;
  $('opt-parser').value = o.parserId;
  $('opt-list-selector').value = o.customListSelector;
  $('opt-content-selector').value = o.customContentSelector;
  $('opt-exclude-selector').value = o.customExcludeSelector;
  $('opt-strip-regex').value = o.customStripPatterns || '';
  $('opt-crawl-next').checked = o.crawlNextLinks !== false;
  $('opt-delay').value = o.delayMs;
  if ($('opt-delay-quick')) $('opt-delay-quick').value = o.delayMs;
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
  const detectedPreset = resolveReaderPreset(o);
  o.readerPreset = detectedPreset;
  $('reader-preset').value = detectedPreset;
  if ($('adv-reader-preset')) $('adv-reader-preset').value = detectedPreset;
  updateReaderPresetWarning();
  updateTypographyPreview();
  updatePackButtonLabel();
  updateSaveLocationUi();
  updatePathPreview();
  updateCoverPreview();
}

export function readOptionsFromUi({ markCustom = false } = {}) {
  const prevPreset = state.options.readerPreset;
  const ttlParsed = parseInt($('opt-cache-ttl').value, 10);
  const concurrencyParsed = parseInt($('opt-concurrency').value, 10);
  const retriesParsed = parseInt($('opt-retries').value, 10);
  const renderWaitParsed = parseInt($('opt-render-wait-ms').value, 10);
  const qualityParsed = parseInt($('opt-image-quality').value, 10);
  state.options = {
    readerPreset: markCustom ? 'custom' : prevPreset,
    uiLang: $('ui-lang-top').value || 'pt',
    theme: $('ui-theme-top').value || 'system',
    libraryViewMode: $('opt-library-view-mode')?.value === 'by-site' ? 'by-site' : 'unified',
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
    includeTocPage: $('opt-include-toc').checked,
    tocPosition: $('opt-toc-position').value === 'end' ? 'end' : 'start',
    tocTitle: $('opt-toc-title').value.trim(),
    infoPageTitle: $('opt-info-title').value.trim(),
    infoShowTitle: $('opt-info-show-title').checked,
    infoShowAuthor: $('opt-info-show-author').checked,
    infoShowGenres: $('opt-info-show-genres').checked,
    infoShowSource: $('opt-info-show-source').checked,
    infoShowSynopsis: $('opt-info-show-synopsis').checked,
    removeNavLinks: $('opt-remove-nav').checked,
    parserId: $('opt-parser').value || 'auto',
    customListSelector: $('opt-list-selector').value.trim(),
    customContentSelector: $('opt-content-selector').value.trim(),
    customExcludeSelector: $('opt-exclude-selector').value.trim(),
    customStripPatterns: $('opt-strip-regex').value,
    crawlNextLinks: $('opt-crawl-next').checked,
    delayMs: Math.max(0, Math.min(30000, parseInt($('opt-delay').value, 10) || 0)),
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
  state.options.readerPreset = resolveReaderPreset(state.options);
  $('reader-preset').value = state.options.readerPreset;
  if ($('adv-reader-preset')) $('adv-reader-preset').value = state.options.readerPreset;
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
