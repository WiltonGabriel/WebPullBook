/**
 * Object-oriented DOM sanitizer that converts untrusted chapter HTML into strict,
 * e-reader-friendly XHTML while preserving semantic typography and inline spacing.
 */

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

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

export class HtmlSanitizer {
  constructor(options = {}) {
    this.skipImages = Boolean(options.skipImages);
    this.removeNavLinks = options.removeNavLinks !== false;
    this.excludeSelector = (options.excludeSelector || '').trim();
  }

  isHiddenElement(el) {
    const style = (el.getAttribute('style') || '').toLowerCase();
    if (el.hasAttribute('hidden')) return true;
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) {
      return true;
    }
    const cls = (el.getAttribute('class') || '').toLowerCase();
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

  resolveImageUrl(imgEl, baseUrl) {
    const candidates = [
      imgEl.getAttribute('data-lazy-src'),
      imgEl.getAttribute('data-src'),
      imgEl.getAttribute('data-original'),
      imgEl.getAttribute('src')
    ];
    for (const cand of candidates) {
      if (!cand) continue;
      const trimmed = cand.trim();
      if (!trimmed || trimmed.startsWith('data:image/svg+xml')) continue;
      try {
        return new URL(trimmed, baseUrl).toString();
      } catch {
        // Ignore malformed URLs
      }
    }
    return null;
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

    const cloneClean = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const cleanText = (node.nodeValue || '').replace(/[\u200b-\u200d\ufeff]/g, '');
        return cleanText ? xmlDoc.createTextNode(cleanText) : null;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;

      const rawTag = node.tagName.toLowerCase();
      if (DROP_TAGS.has(rawTag) || this.isHiddenElement(node) || this.isNavContainer(node)) {
        return null;
      }

      if (rawTag === 'img') {
        if (this.skipImages) return null;
        const resolvedUrl = this.resolveImageUrl(node, baseUrl);
        if (!resolvedUrl) return null;
        const cleanImg = xmlDoc.createElementNS(XHTML_NS, 'img');
        cleanImg.setAttribute('src', resolvedUrl);
        const alt = (node.getAttribute('alt') || '').trim();
        cleanImg.setAttribute('alt', alt || 'Illustration');
        images.push({ originalUrl: resolvedUrl, element: cleanImg });
        return cleanImg;
      }

      if (rawTag === 'a') {
        const linkText = (node.textContent || '').trim();
        if (this.removeNavLinks && NAV_LINK_PATTERNS.some((rx) => rx.test(linkText))) {
          return null;
        }
        const hrefRaw = node.getAttribute('href') || '';
        let safeHref = '';
        try {
          const u = new URL(hrefRaw, baseUrl);
          if (u.protocol === 'http:' || u.protocol === 'https:') {
            safeHref = u.toString();
          }
        } catch {
          safeHref = '';
        }
        if (!safeHref) {
          const frag = xmlDoc.createDocumentFragment();
          for (const child of node.childNodes) {
            const cloned = cloneClean(child);
            if (cloned) frag.appendChild(cloned);
          }
          return frag;
        }
        const cleanA = xmlDoc.createElementNS(XHTML_NS, 'a');
        cleanA.setAttribute('href', safeHref);
        for (const child of node.childNodes) {
          const cloned = cloneClean(child);
          if (cloned) cleanA.appendChild(cloned);
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
        const hasContent = cleanEl.textContent.trim().length > 0 || cleanEl.querySelector('img, br, hr');
        if (!hasContent) {
          if (INLINE_TAGS.has(targetTag) && cleanEl.textContent.length > 0) {
            return xmlDoc.createTextNode(' ');
          }
          return null;
        }
      }

      return cleanEl;
    };

    const outNodes = [];
    for (const child of workRoot.childNodes) {
      const cleaned = cloneClean(child);
      if (cleaned) outNodes.push(cleaned);
    }

    return { xmlDoc, nodes: outNodes, images };
  }
}

export function sanitizeChapterContent(contentRoot, baseUrl, options = {}) {
  return new HtmlSanitizer(options).sanitize(contentRoot, baseUrl);
}

export function serializeChapterXhtml({
  title,
  subtitle = '',
  xmlDoc,
  nodes,
  stylesheetHref = '../styles/stylesheet.css',
  epub3 = true
}) {
  const html = xmlDoc.documentElement;
  html.setAttribute('xmlns', XHTML_NS);
  if (epub3) {
    html.setAttribute('xmlns:epub', 'http://www.idpf.org/2007/ops');
  }

  const head = xmlDoc.createElementNS(XHTML_NS, 'head');
  const metaCharset = xmlDoc.createElementNS(XHTML_NS, 'meta');
  metaCharset.setAttribute('charset', 'utf-8');
  head.appendChild(metaCharset);

  const titleEl = xmlDoc.createElementNS(XHTML_NS, 'title');
  titleEl.textContent = title;
  head.appendChild(titleEl);

  const linkEl = xmlDoc.createElementNS(XHTML_NS, 'link');
  linkEl.setAttribute('rel', 'stylesheet');
  linkEl.setAttribute('type', 'text/css');
  linkEl.setAttribute('href', stylesheetHref);
  head.appendChild(linkEl);

  const body = xmlDoc.createElementNS(XHTML_NS, 'body');
  const h2 = xmlDoc.createElementNS(XHTML_NS, 'h2');
  h2.setAttribute('class', 'chapter-title');
  h2.textContent = title;
  body.appendChild(h2);

  if (subtitle && subtitle !== title) {
    const pSub = xmlDoc.createElementNS(XHTML_NS, 'p');
    pSub.setAttribute('class', 'chapter-subtitle');
    pSub.textContent = subtitle;
    body.appendChild(pSub);
  }

  const contentDiv = xmlDoc.createElementNS(XHTML_NS, 'div');
  contentDiv.setAttribute('class', 'chapter-content');
  for (const n of nodes) {
    contentDiv.appendChild(n);
  }
  body.appendChild(contentDiv);

  html.replaceChildren(head, body);

  const serialized = new XMLSerializer().serializeToString(xmlDoc);
  const doctype = epub3
    ? '<!DOCTYPE html>'
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
  return `<?xml version="1.0" encoding="utf-8"?>\n${doctype}\n${serialized}`;
}

export function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
