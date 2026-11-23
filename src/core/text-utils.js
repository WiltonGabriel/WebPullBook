/**
 * Pure text, URL, path, volume, cover, and synopsis helpers shared across parsers and exporters.
 */

export function normalizeSpaces(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Resolve a relative or absolute URL against `baseUrl` and allow only HTTP(S) protocols.
 */
export function resolveSafeHttpUrl(rawHref, baseUrl = '') {
  const trimmed = String(rawHref ?? '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  try {
    const u = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function parseChapterOrderNum(ch) {
  const candidates = [ch?.numText, ch?.displayTitle, ch?.titleText];
  for (const text of candidates) {
    if (!text) continue;
    const m =
      String(text).match(/(?:cap(?:[íi]tulo)?|chapter|ch\.?|ep\.?|#|parte)\s*(\d+(?:\.\d+)?)/i) ||
      String(text).match(/^\s*(\d+(?:\.\d+)?)\b/);
    if (m) return parseFloat(m[1]);
  }
  const urlMatch = String(ch?.url || '').match(/(\d+(?:\.\d+)?)\/?$/);
  return urlMatch ? parseFloat(urlMatch[1]) : null;
}

export function ensureAscendingChapterOrder(chapters, defaultReversed = false) {
  if (!Array.isArray(chapters) || chapters.length < 2) return chapters;
  const nums = chapters.map(parseChapterOrderNum).filter((n) => n !== null && Number.isFinite(n));
  if (nums.length >= 2 && nums[0] !== nums[nums.length - 1]) {
    if (nums[0] > nums[nums.length - 1]) {
      chapters.reverse();
    }
    return chapters;
  }
  if (defaultReversed) chapters.reverse();
  return chapters;
}

export function sanitizeFilename(name, removeIllegal = true) {
  let out = normalizeSpaces(name);
  if (removeIllegal) {
    out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  }
  return out || 'webpullbook-ebook';
}

export const FOLDER_LAYOUT_TEMPLATES = {
  'root-title': '%Root%/%Title%',
  'root-author-title': '%Root%/%Author%/%Title%',
  'root-format-title': '%Root%/%Format%/%Title%',
  'root-only': '%Root%',
  'title-only': '%Title%',
  'author-title': '%Author%/%Title%',
  flat: ''
};

/**
 * Sanitizes a single relative path segment (file stem or directory name) for Chrome Downloads and File System Access API.
 */
export function sanitizePathSegment(name, removeIllegal = true) {
  let out = normalizeSpaces(name);
  if (removeIllegal) {
    out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  }
  out = out.replace(/^[\s.]+|[\s.]+$/g, '');
  if (!out || out === '.' || out === '..') return '';
  if (removeIllegal && /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(out)) {
    out = `_${out}`;
  }
  return out;
}

/**
 * Builds the relative output file path (folders + sanitized filename + extension) from metadata and user folder options.
 */
export function buildOutputPath({
  baseFilename = '',
  title = '',
  author = '',
  volumeLabel = '',
  suffix = '',
  extension = 'epub',
  language = '',
  options = {}
} = {}) {
  const removeIllegal = options.removeIllegal !== false;
  const filenameTemplate = options.customFilename || '%Filename%';
  let rawFile = filenameTemplate
    .replace(/%Filename%/gi, baseFilename || title || 'webpullbook-ebook')
    .replace(/%Title%/gi, title || baseFilename || 'WebPullBook')
    .replace(/%Author%/gi, author || '')
    .replace(/%Volume%/gi, volumeLabel || '');

  if (volumeLabel && !/%Volume%/i.test(filenameTemplate)) {
    rawFile = `${rawFile} - ${volumeLabel}`;
  }
  if (suffix) {
    rawFile = `${rawFile} ${suffix}`;
  }

  const cleanFile = sanitizePathSegment(rawFile, removeIllegal) || 'webpullbook-ebook';
  const cleanExt = String(extension || 'epub').replace(/^\.+/, '').toLowerCase() || 'epub';
  const filePart = `${cleanFile}.${cleanExt}`;

  const layout =
    options.folderLayout != null
      ? options.folderLayout
      : options.subfolder === false
        ? 'flat'
        : 'root-title';

  if (layout === 'flat') {
    return filePart;
  }

  const folderTemplate =
    layout === 'custom'
      ? String(options.customFolderTemplate || '')
      : FOLDER_LAYOUT_TEMPLATES[layout] ?? FOLDER_LAYOUT_TEMPLATES['root-title'];

  if (!folderTemplate.trim()) {
    return filePart;
  }

  const rawRoot = options.rootFolderName !== undefined ? String(options.rootFolderName) : 'WebPullBook';
  const rootSegments = rawRoot
    .split(/[/\\]+/)
    .map((seg) => sanitizePathSegment(seg, true))
    .filter(Boolean);

  const safeTitle = sanitizePathSegment(title || baseFilename || '', true);
  const safeFilename = sanitizePathSegment(baseFilename || title || '', true);
  const safeAuthor = sanitizePathSegment(author || '', true);
  const safeVolume = sanitizePathSegment(volumeLabel || '', true);
  const safeFormat = sanitizePathSegment(cleanExt.toUpperCase(), true);
  const safeLang = sanitizePathSegment(language || '', true);

  const folderSegments = [];
  for (const part of folderTemplate.split(/[/\\]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (/^%Root%$/i.test(trimmed)) {
      folderSegments.push(...rootSegments);
      continue;
    }
    const expanded = trimmed
      .replace(/%Root%/gi, rootSegments.join('_'))
      .replace(/%Title%/gi, safeTitle)
      .replace(/%Filename%/gi, safeFilename)
      .replace(/%Author%/gi, safeAuthor)
      .replace(/%Volume%/gi, safeVolume)
      .replace(/%Format%/gi, safeFormat)
      .replace(/%Language%/gi, safeLang);

    const cleanSeg = sanitizePathSegment(expanded, true);
    if (cleanSeg) {
      folderSegments.push(cleanSeg);
    }
  }

  return folderSegments.length > 0 ? `${folderSegments.join('/')}/${filePart}` : filePart;
}

export function toHighResCoverUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (/^i\d+\.wp\.com$/i.test(u.hostname)) {
      const strippedPath = u.pathname.replace(/^\/+/, '');
      return new URL(`https://${strippedPath}`).toString();
    }
    if (u.searchParams.has('resize')) {
      u.searchParams.delete('resize');
    }
    for (const key of ['w', 'h']) {
      const vals = u.searchParams.getAll(key);
      if (vals.length === 0) continue;
      const kept = vals.filter((v) => !/^\d+$/.test(v));
      if (kept.length !== vals.length) {
        u.searchParams.delete(key);
        for (const v of kept) u.searchParams.append(key, v);
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function extractVolumeLabel(rawLabel, numText = '', href = '') {
  const sources = [rawLabel, numText, href];
  for (const src of sources) {
    if (!src) continue;
    const match = String(src).match(/(?:\bvol(?:ume)?[.\s_-]*|\blivro\s*|\bbook\s*|\btome\s*|[-/]volume-)(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!Number.isNaN(n)) {
        return `Volume ${String(n).padStart(2, '0')}`;
      }
    }
  }
  if (rawLabel && normalizeSpaces(rawLabel)) {
    const clean = normalizeSpaces(rawLabel);
    if (
      !/^(?:(?:todos\s+os\s+|lista\s+de\s+)?cap[íi]tulos?|(?:all\s+|list\s+of\s+)?chapters?|sum[áa]rio|[íi]ndice|table\s+of\s+contents|toc|epis[óo]dios?|episodes?)$/i.test(
        clean
      )
    ) {
      return clean;
    }
  }
  return 'Volume 01';
}

export function extractVolumeNumber(volumeLabel) {
  const m = String(volumeLabel ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

export function extractCleanSynopsis(container) {
  if (!container) return '';
  const clone = container.cloneNode(true);
  for (const rm of clone.querySelectorAll('script, style, .aviso, .notice, .disclaimer')) {
    rm.remove();
  }

  const lines = [];
  for (const child of clone.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'hr') break;
    if (child.querySelector('hr')) break;
    if (/^(aviso|notice|disclaimer)$/i.test(normalizeSpaces(child.textContent))) break;

    if (tag === 'p') {
      const txt = normalizeSpaces(child.textContent);
      if (txt) lines.push(txt);
    } else {
      for (const p of child.querySelectorAll('p')) {
        const txt = normalizeSpaces(p.textContent);
        if (txt) lines.push(txt);
      }
    }
  }

  if (lines.length === 0) {
    return normalizeSpaces(clone.textContent);
  }
  return lines.join('\n\n');
}
