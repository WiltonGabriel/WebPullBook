/**
 * Object-oriented DOM sanitizer that converts untrusted chapter HTML into strict,
 * e-reader-friendly XHTML while preserving semantic typography and inline spacing.
 */

import { EPUB_NS, XHTML_NS, escapeXml, serializeChapterXhtml } from './xhtml-serializer.js';

export { EPUB_NS, XHTML_NS, escapeXml, serializeChapterXhtml };

const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'br', 'hr',
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'sup', 'sub', 'small',
  'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img', 'figure', 'figcaption'
]);

const UNWRAP_TAGS = new Set(['center', 'article', 'section', 'main', 'header', 'footer']);

const INLINE_TAGS = new Set([
  'span', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'sup', 'sub', 'small', 'code', 'a'
]);

const BLOCK_TAGS = new Set([
  'p', 'div', 'blockquote', 'pre', 'ul', 'ol', 'dl', 'table',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'figure'
]);

const DIRECT_IMAGE_URL_RX = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#].*)?$/i;

function normalizeHrefForCompare(rawUrl, baseUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim(), baseUrl);
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function decodeCloudflareEmail(hex) {
  const clean = String(hex || '').trim();
  if (!/^[0-9a-f]{4,}$/i.test(clean) || clean.length % 2 !== 0) return '';
  const key = parseInt(clean.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16) ^ key);
  }
  return out;
}

function hasBlockChild(el) {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(child.tagName.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function unwrapInlineWithBlocks(inlineEl, xmlDoc) {
  const frag = xmlDoc.createDocumentFragment();
  while (inlineEl.firstChild) {
    frag.appendChild(inlineEl.firstChild);
  }
  return frag;
}

const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'object', 'embed',
  'svg', 'canvas', 'form', 'input', 'button', 'select', 'textarea',
  'ins', 'template', 'audio', 'video'
]);

const NAV_LINK_PATTERNS = [
  /pr[oó]ximo\s+cap[íi]tulo/i,
  /cap[íi]tulo\s+anterior/i,
  /next\s+chapter/i,
  /previous\s+chapter/i,
  /prev\s+chapter/i,
  /^pr[oó]ximo$/i,
  /^anterior$/i,
  /^next$/i,
  /^prev(?:ious)?$/i,
  /[íi]ndice|sum[áa]rio|table\s+of\s+contents|lista\s+de\s+cap[íi]tulos/i
];

/**
 * Parse top-level `<style>` rules in a document to detect CSS classes that hide elements
 * unconditionally (e.g., anti-scraping decoy elements with `display: none`).
 */
export function extractHiddenClassesFromStyles(doc) {
  const hidden = new Set();
  if (!doc?.querySelectorAll) return hidden;

  for (const styleEl of doc.querySelectorAll('style')) {
    const rawCss = String(styleEl.textContent || '').replace(/\/\*[\s\S]*?\*\//g, '');
    // Skip @-rule blocks (@media, @supports, @keyframes) so responsive rules aren't treated as always-hidden
    let stripped = '';
    let i = 0;
    while (i < rawCss.length) {
      if (rawCss[i] === '@') {
        const braceIdx = rawCss.indexOf('{', i);
        const semiIdx = rawCss.indexOf(';', i);
        if (semiIdx !== -1 && (braceIdx === -1 || semiIdx < braceIdx)) {
          i = semiIdx + 1;
          continue;
        }
        if (braceIdx !== -1) {
          let depth = 1;
          let j = braceIdx + 1;
          while (j < rawCss.length && depth > 0) {
            if (rawCss[j] === '{') depth++;
            else if (rawCss[j] === '}') depth--;
            j++;
          }
          i = j;
          continue;
        }
      }
      stripped += rawCss[i++];
    }

    for (const m of stripped.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decls = m[2];
      if (!/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(decls)) {
        continue;
      }
      for (const part of m[1].split(',')) {
        const clsMatch = part.trim().match(/^\.([A-Za-z0-9_-]+)$/);
        if (clsMatch) hidden.add(clsMatch[1]);
      }
    }
  }

  return hidden;
}

export class HtmlSanitizer {
  constructor(options = {}) {
    this.skipImages = Boolean(options.skipImages);
    this.removeNavLinks = options.removeNavLinks !== false;
    this.excludeSelector = (options.excludeSelector || '').trim();
    this.hiddenClasses = options.hiddenClasses instanceof Set
      ? options.hiddenClasses
      : new Set(options.hiddenClasses || []);
    this.nextPrevUrls = new Set();
    if (options.nextPrevUrls) {
      for (const u of options.nextPrevUrls) {
        const norm = normalizeHrefForCompare(u);
        if (norm) this.nextPrevUrls.add(norm);
      }
    }
    this.chapterTitle = String(options.chapterTitle || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  isHiddenElement(el) {
    const style = (el.getAttribute('style') || '').toLowerCase();
    if (el.hasAttribute('hidden')) return true;
    if (el.getAttribute('aria-hidden') === 'true' && !el.querySelector?.('img')) return true;
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) {
      return true;
    }
    const isLazyImg =
      el.tagName?.toLowerCase() === 'img' &&
      (el.hasAttribute('data-src') ||
        el.hasAttribute('data-lazy-src') ||
        el.hasAttribute('data-original') ||
        el.hasAttribute('data-orig-file') ||
        el.hasAttribute('data-srcset') ||
        el.hasAttribute('data-lazy'));
    const rawCls = el.getAttribute('class') || '';
    if (!isLazyImg && this.hiddenClasses.size > 0 && rawCls) {
      for (const token of rawCls.trim().split(/\s+/)) {
        if (token && this.hiddenClasses.has(token)) return true;
      }
    }
    const cls = rawCls.toLowerCase();
    return /(^|\s)(code-block|ads|ad-slot|adsby|share-?buttons|naveg|nextprev|wp-block-buttons)(\s|$)/.test(cls);
  }

  isNavContainer(el) {
    if (!this.removeNavLinks) return false;
    const links = el.querySelectorAll('a');
    if (links.length === 0) return false;
    const text = (el.textContent || '').trim();
    if (text.length > 140) return false;
    return Array.from(links).some((a) => NAV_LINK_PATTERNS.some((rx) => rx.test((a.textContent || '').trim())));
  }

  parseSrcsetBestUrl(rawSrcset) {
    const raw = String(rawSrcset || '').trim();
    if (!raw || /^data:/i.test(raw)) return null;
    let bestUrl = null;
    let bestScore = -1;
    for (const part of raw.split(',')) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const url = tokens[0];
      if (!url || /^data:/i.test(url)) continue;
      const desc = tokens[1] || '';
      const numMatch = desc.match(/^(\d+(?:\.\d+)?)(w|x)$/i);
      const score = numMatch
        ? Number(numMatch[1]) * (numMatch[2].toLowerCase() === 'x' ? 1000 : 1)
        : 0;
      if (score >= bestScore) {
        bestScore = score;
        bestUrl = url;
      }
    }
    return bestUrl;
  }

  resolveImageUrl(imgEl, baseUrl) {
    const pictureSources = [];
    if (imgEl.parentElement?.tagName?.toLowerCase() === 'picture') {
      for (const source of imgEl.parentElement.querySelectorAll('source')) {
        pictureSources.push(
          this.parseSrcsetBestUrl(source.getAttribute('data-srcset')),
          this.parseSrcsetBestUrl(source.getAttribute('srcset'))
        );
      }
    }

    const candidates = [
      imgEl.getAttribute('data-orig-file'),
      imgEl.getAttribute('data-lazy-src'),
      imgEl.getAttribute('data-src'),
      imgEl.getAttribute('data-original'),
      imgEl.getAttribute('data-cfsrc'),
      imgEl.getAttribute('data-full-url'),
      imgEl.getAttribute('data-url'),
      imgEl.getAttribute('data-lazy'),
      imgEl.getAttribute('data-image'),
      this.parseSrcsetBestUrl(imgEl.getAttribute('data-srcset')),
      this.parseSrcsetBestUrl(imgEl.getAttribute('srcset')),
      ...pictureSources,
      imgEl.getAttribute('src')
    ];

    let fallbackDataUrl = null;
    let fallbackPlaceholderHttp = null;
    for (const cand of candidates) {
      if (!cand) continue;
      const trimmed = cand.trim();
      if (!trimmed || /^data:image\/svg\+xml/i.test(trimmed)) continue;
      if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(trimmed)) {
        if (!fallbackDataUrl) fallbackDataUrl = trimmed;
        continue;
      }
      try {
        const u = new URL(trimmed, baseUrl);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          const resolved = u.toString();
          if (/(?:^|\/)(?:blank|spacer|transparent|pixel|1x1|loading|placeholder)\.(?:gif|png|svg)(?:$|\?)/i.test(u.pathname)) {
            if (!fallbackPlaceholderHttp) fallbackPlaceholderHttp = resolved;
            continue;
          }
          return resolved;
        }
      } catch {
        // Ignore malformed URLs
      }
    }
    return fallbackDataUrl || fallbackPlaceholderHttp || null;
  }

  /**
   * Map safe typographic inline styles (alignment, bold, italic, underline, strike, relative scale)
   * into normalized EPUB utility classes without leaking raw fixed colors or pixel font sizes.
   */
  extractSemanticClasses(node, tag) {
    const classes = [];
    const style = (node.getAttribute('style') || '').toLowerCase();

    if (tag === 'center') {
      classes.push('wpb-center');
    }

    if (style) {
      const alignMatch = style.match(/text-align\s*:\s*(center|right)/i);
      if (alignMatch) classes.push(`wpb-${alignMatch[1].toLowerCase()}`);

      if (/font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(style)) classes.push('wpb-bold');
      if (/font-style\s*:\s*(italic|oblique)/i.test(style)) classes.push('wpb-italic');
      if (/text-decoration(?:-line)?\s*:[^;]*underline/i.test(style)) classes.push('wpb-underline');
      if (/text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style)) classes.push('wpb-strike');
      if (/font-family\s*:[^;]*mono/i.test(style)) classes.push('wpb-mono');

      if (/font-size\s*:\s*(x?-?small|smaller)/i.test(style)) {
        classes.push('wpb-sm');
      } else if (/font-size\s*:\s*(x?-?large|larger)/i.test(style)) {
        classes.push('wpb-lg');
      } else {
        const emMatch = style.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*em/i);
        if (emMatch) {
          const val = parseFloat(emMatch[1]);
          if (val <= 0.85) classes.push('wpb-sm');
          else if (val >= 1.2) classes.push('wpb-lg');
        }
      }
    }

    if (tag === 'font') {
      const sizeAttr = parseInt(node.getAttribute('size') || '', 10);
      if (!Number.isNaN(sizeAttr)) {
        if (sizeAttr <= 2) classes.push('wpb-sm');
        else if (sizeAttr >= 4) classes.push('wpb-lg');
      }
    }

    return [...new Set(classes)];
  }

  sanitize(contentRoot, baseUrl) {
    const xmlDoc = document.implementation.createDocument(XHTML_NS, 'html', null);
    const images = [];

    const workRoot = contentRoot.cloneNode(true);
    if (this.excludeSelector) {
      try {
        for (const el of workRoot.querySelectorAll(this.excludeSelector)) {
          el.remove();
        }
      } catch {
        // Ignore invalid user CSS selector
      }
    }

    const validIdRx = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
    const existingIds = new Set();
    for (const el of workRoot.querySelectorAll('[id]')) {
      const id = (el.getAttribute('id') || '').trim();
      if (validIdRx.test(id)) existingIds.add(id);
    }
    const activeFragments = new Set();
    for (const a of workRoot.querySelectorAll('a[href^="#"]')) {
      const frag = (a.getAttribute('href') || '').trim().slice(1);
      if (validIdRx.test(frag) && existingIds.has(frag)) {
        activeFragments.add(frag);
      }
    }
    const emittedIds = new Set();

    const cloneClean = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        // eslint-disable-next-line no-control-regex
        const cleanText = (node.nodeValue || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\ufeff]/g, '');
        return cleanText ? xmlDoc.createTextNode(cleanText) : null;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;

      const rawTag = node.tagName.toLowerCase();
      if (rawTag === 'o:p' || rawTag.startsWith('o:')) {
        return null;
      }
      if (DROP_TAGS.has(rawTag) || this.isHiddenElement(node) || this.isNavContainer(node)) {
        return null;
      }

      // Decode Cloudflare obfuscated email addresses (__cf_email__ / data-cfemail)
      const cfHex = node.getAttribute('data-cfemail');
      if (cfHex) {
        const decodedEmail = decodeCloudflareEmail(cfHex);
        if (decodedEmail) {
          return xmlDoc.createTextNode(decodedEmail);
        }
      }

      // Convert WordPress Gutenberg spacer blocks into semantic scene breaks (<hr />)
      if (rawTag === 'div' && /\bwp-block-spacer\b/i.test(node.getAttribute('class') || '')) {
        return xmlDoc.createElementNS(XHTML_NS, 'hr');
      }

      if (rawTag === 'img') {
        if (this.skipImages) return null;
        let resolvedUrl = this.resolveImageUrl(node, baseUrl);
        if (!resolvedUrl) return null;
        let fallbackUrl = null;
        // If a thumbnail <img> is wrapped in <a href="high-res.jpg">, prefer the high-res image with fallback to thumb
        const parentA = node.parentElement?.tagName?.toLowerCase() === 'a' ? node.parentElement : null;
        const parentHref = (parentA?.getAttribute('href') || '').trim();
        if (parentHref && DIRECT_IMAGE_URL_RX.test(parentHref)) {
          try {
            const absParent = new URL(parentHref, baseUrl).toString();
            if (/^https?:\/\//i.test(absParent) && absParent !== resolvedUrl) {
              fallbackUrl = resolvedUrl;
              resolvedUrl = absParent;
            }
          } catch {
            // keep resolvedUrl
          }
        }
        const cleanImg = xmlDoc.createElementNS(XHTML_NS, 'img');
        cleanImg.setAttribute('src', resolvedUrl);
        const alt = (node.getAttribute('alt') || '').trim();
        cleanImg.setAttribute('alt', alt || 'Illustration');
        images.push({ originalUrl: resolvedUrl, fallbackUrl, element: cleanImg });
        return cleanImg;
      }

      if (rawTag === 'a') {
        const linkText = (node.textContent || '').trim();
        if (this.removeNavLinks && NAV_LINK_PATTERNS.some((rx) => rx.test(linkText))) {
          return null;
        }
        const rawId = (node.getAttribute('id') || '').trim();
        const safeId = activeFragments.has(rawId) && !emittedIds.has(rawId) ? rawId : '';
        const hrefRaw = (node.getAttribute('href') || '').trim();
        let safeHref = '';
        if (hrefRaw.startsWith('#')) {
          const frag = hrefRaw.slice(1);
          if (activeFragments.has(frag)) {
            safeHref = `#${frag}`;
          }
        } else if (hrefRaw) {
          try {
            const u = new URL(hrefRaw, baseUrl);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              safeHref = u.toString();
            }
          } catch {
            safeHref = '';
          }
        }
        // Remove adjacent Next/Previous chapter links by exact URL match regardless of link text
        if (this.removeNavLinks && safeHref && this.nextPrevUrls.size > 0 && !node.querySelector('img')) {
          const normSafe = normalizeHrefForCompare(safeHref, baseUrl);
          if (normSafe && this.nextPrevUrls.has(normSafe)) {
            return null;
          }
        }
        if (!safeHref && !safeId) {
          const frag = xmlDoc.createDocumentFragment();
          for (const child of node.childNodes) {
            const cloned = cloneClean(child);
            if (cloned) frag.appendChild(cloned);
          }
          return frag;
        }
        const cleanA = xmlDoc.createElementNS(XHTML_NS, 'a');
        if (safeId) {
          cleanA.setAttribute('id', safeId);
          emittedIds.add(safeId);
        }
        if (safeHref) {
          cleanA.setAttribute('href', safeHref);
        }
        for (const child of node.childNodes) {
          const cloned = cloneClean(child);
          if (cloned) cleanA.appendChild(cloned);
        }
        if (INLINE_TAGS.has('a') && hasBlockChild(cleanA)) {
          return unwrapInlineWithBlocks(cleanA, xmlDoc);
        }
        return cleanA;
      }

      // Map legacy formatting tags (<big>, <center>, <font>) cleanly to semantic XHTML
      let targetTag = rawTag;
      const semanticClasses = this.extractSemanticClasses(node, rawTag);
      if (rawTag === 'big') {
        targetTag = 'span';
        semanticClasses.push('wpb-lg');
      } else if (rawTag === 'font') {
        targetTag = 'span';
      } else if (rawTag === 'center') {
        targetTag = 'div';
      }

      if (UNWRAP_TAGS.has(targetTag) || !ALLOWED_TAGS.has(targetTag)) {
        const frag = xmlDoc.createDocumentFragment();
        for (const child of node.childNodes) {
          const cloned = cloneClean(child);
          if (cloned) frag.appendChild(cloned);
        }
        return frag;
      }

      const cleanEl = xmlDoc.createElementNS(XHTML_NS, targetTag);
      const rawId = (node.getAttribute('id') || '').trim();
      if (activeFragments.has(rawId) && !emittedIds.has(rawId)) {
        cleanEl.setAttribute('id', rawId);
        emittedIds.add(rawId);
      }
      if (semanticClasses.length > 0) {
        cleanEl.setAttribute('class', [...new Set(semanticClasses)].join(' '));
      }

      if (targetTag === 'td' || targetTag === 'th') {
        const colspan = node.getAttribute('colspan');
        const rowspan = node.getAttribute('rowspan');
        if (colspan && /^\d+$/.test(colspan)) cleanEl.setAttribute('colspan', colspan);
        if (rowspan && /^\d+$/.test(rowspan)) cleanEl.setAttribute('rowspan', rowspan);
      }

      for (const child of node.childNodes) {
        const cloned = cloneClean(child);
        if (cloned) cleanEl.appendChild(cloned);
      }

      if (targetTag !== 'br' && targetTag !== 'hr' && targetTag !== 'td' && targetTag !== 'th') {
        const hasContent =
          cleanEl.textContent.trim().length > 0 ||
          cleanEl.hasAttribute('id') ||
          cleanEl.querySelector('img, br, hr, [id]');
        if (!hasContent) {
          if (INLINE_TAGS.has(targetTag) && cleanEl.textContent.length > 0) {
            return xmlDoc.createTextNode(' ');
          }
          return null;
        }
      }

      if (INLINE_TAGS.has(targetTag) && hasBlockChild(cleanEl)) {
        return unwrapInlineWithBlocks(cleanEl, xmlDoc);
      }

      return cleanEl;
    };

    const outNodes = [];
    for (const child of workRoot.childNodes) {
      const cleaned = cloneClean(child);
      if (!cleaned) continue;
      if (cleaned.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        for (const fragChild of Array.from(cleaned.childNodes)) {
          outNodes.push(fragChild);
        }
      } else {
        outNodes.push(cleaned);
      }
    }

    // Remove duplicate leading chapter title heading when serializeChapterXhtml will already emit it
    if (this.chapterTitle && outNodes.length > 0) {
      const firstEl = outNodes.find(
        (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && (n.nodeValue || '').trim())
      );
      if (
        firstEl?.nodeType === Node.ELEMENT_NODE &&
        /^h[1-3]$/i.test(firstEl.tagName) &&
        !firstEl.querySelector('img')
      ) {
        const headingText = (firstEl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (headingText && headingText === this.chapterTitle) {
          const idx = outNodes.indexOf(firstEl);
          if (idx !== -1) outNodes.splice(idx, 1);
        }
      }
    }

    return { xmlDoc, nodes: outNodes, images };
  }
}

export function sanitizeChapterContent(contentRoot, baseUrl, options = {}) {
  return new HtmlSanitizer(options).sanitize(contentRoot, baseUrl);
}
