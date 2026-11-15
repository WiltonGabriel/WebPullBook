import { DEFAULT_EPUB_CSS, normalizeUrl, sanitizeFilename } from '../core/parser-engine.js';
import { DEFAULT_CACHE_TTL_DAYS } from '../core/cache-store.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import { translate } from './i18n.js';

export const DEFAULT_OPTIONS = {
  uiLang: 'pt',
  theme: 'system',
  readerPreset: 'modern',
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
  popupFootnotes: true,
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

export const READER_PRESETS = {
  modern: {
    outputFormat: 'epub',
    createEpub3: true,
    popupFootnotes: true,
    restrictCoverJpeg: true,
    compressImages: false,
    grayscaleImages: false,
    skipImages: false,
    useSvgForImages: false,
    compressedResolution: 1080,
    fontFamily: 'reader-default',
    textAlign: 'justify'
  },
  kindle: {
    outputFormat: 'epub',
    createEpub3: false,
    popupFootnotes: false,
    restrictCoverJpeg: true,
    compressImages: true,
    grayscaleImages: false,
    skipImages: false,
    useSvgForImages: false,
    compressedResolution: 1200,
    fontFamily: 'reader-default',
    textAlign: 'justify'
  },
  'kindle-modern': {
    outputFormat: 'epub',
    createEpub3: true,
    popupFootnotes: true,
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
    popupFootnotes: true,
    restrictCoverJpeg: true,
    compressImages: true,
    grayscaleImages: false,
    skipImages: false,
    useSvgForImages: false,
    compressedResolution: 1080,
    fontFamily: 'reader-default',
    textAlign: 'justify'
  },
  textonly: {
    outputFormat: 'epub',
    createEpub3: true,
    popupFootnotes: true,
    restrictCoverJpeg: true,
    compressImages: false,
    grayscaleImages: false,
    skipImages: true,
    useSvgForImages: false
  },
  legacy: {
    outputFormat: 'epub',
    createEpub3: false,
    popupFootnotes: false,
    restrictCoverJpeg: true,
    compressImages: true,
    grayscaleImages: false,
    skipImages: false,
    useSvgForImages: false,
    compressedResolution: 1080,
    fontFamily: 'reader-default',
    textAlign: 'justify'
  }
};

export const state = {
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
  autoFilledSelectors: null,
  autoSpaDomain: '',
  customDirHandle: null,
  customDirPermission: 'none',
  options: { ...DEFAULT_OPTIONS },
  volumeFilter: null,
  showUrls: false,
  lastClickedIdx: -1,
  activePreviewChapter: null,
  activePreviewEditable: false,
  pickerRequest: null,
  running: false,
  batchRunning: false,
  paused: false,
  abortController: null,
  logs: [],
  logSeq: 0,
  logFilter: 'all',
  lastReport: null,
  onCacheChanged: null,
  onLibraryUpdateAfterExport: null
};

export const $ = (id) => document.getElementById(id);

export function t(key, vars = {}) {
  return translate(state.options.uiLang || 'pt', key, vars);
}

export function detectMatchingReaderPreset(opts) {
  for (const [key, cfg] of Object.entries(READER_PRESETS)) {
    if (presetMatches(key, opts)) return key;
  }
  return 'custom';
}

function presetMatches(key, opts) {
  const cfg = READER_PRESETS[key];
  return Boolean(cfg) && Object.entries(cfg).every(([field, expected]) => opts[field] === expected);
}

/**
 * Presets are fixed. A preset stays selected only while every one of its fields still matches;
 * 'custom' is sticky until the user explicitly picks a preset again.
 */
export function resolveReaderPreset(opts) {
  const key = opts.readerPreset;
  if (key === 'custom') return 'custom';
  if (presetMatches(key, opts)) return key;
  return detectMatchingReaderPreset(opts);
}

export function normalizeRuleDomain(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function getCacheKey(chapterUrl) {
  return `${normalizeUrl(chapterUrl)}|${state.activeParser?.id || 'auto'}|${Boolean(state.options.skipImages)}|${Boolean(state.options.removeNavLinks)}|${state.options.customContentSelector || ''}|${state.options.customExcludeSelector || ''}`;
}

export function getCurrentSeriesKey() {
  const raw = state.metadata.startingUrl || $('starting-url').value.trim();
  const norm = raw ? normalizeUrl(raw) : '';
  return norm || `local:${sanitizeFilename(state.metadata.title || 'webpullbook', true)}`;
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTimeRemaining(expiresAt) {
  const diff = Math.max(0, (expiresAt || 0) - Date.now());
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d ${hours % 24}h`;
  return `${Math.max(1, hours)}h`;
}

export function switchTab(targetTab) {
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
