/**
 * XHTML chapter serializer, XML escaping, and EPUB 3 pop-up footnote enhancer.
 */

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';
export const EPUB_NS = 'http://www.idpf.org/2007/ops';

const XML_UNSAFE_CHECK_RX = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\ufffe\uffff]/;

/**
 * Remove characters forbidden by XML 1.0 (C0 controls except TAB/LF/CR, U+FFFE/U+FFFF,
 * and unpaired UTF-16 surrogates) while preserving valid supplementary-plane surrogate pairs.
 */
export function stripInvalidXmlChars(str) {
  const s = String(str ?? '');
  if (!s || !XML_UNSAFE_CHECK_RX.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (
      (code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    out += s[i];
  }
  return out;
}

function normalizeXhtmlForEpub2(xmlDoc, contentDiv) {
  const INLINE_ONLY_TAGS = new Set([
    'a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'sup', 'sub', 'small', 'span', 'code', 'br', 'img'
  ]);

  for (const fig of Array.from(contentDiv.querySelectorAll('figure'))) {
    const div = xmlDoc.createElementNS(XHTML_NS, 'div');
    const existingCls = (fig.getAttribute('class') || '').trim();
    div.setAttribute('class', existingCls ? `${existingCls} wpb-figure` : 'wpb-figure');
    if (fig.hasAttribute('id')) div.setAttribute('id', fig.getAttribute('id'));
    while (fig.firstChild) div.appendChild(fig.firstChild);
    fig.replaceWith(div);
  }

  for (const cap of Array.from(contentDiv.querySelectorAll('figcaption'))) {
    const p = xmlDoc.createElementNS(XHTML_NS, 'p');
    const existingCls = (cap.getAttribute('class') || '').trim();
    p.setAttribute('class', existingCls ? `${existingCls} wpb-figcaption` : 'wpb-figcaption');
    if (cap.hasAttribute('id')) p.setAttribute('id', cap.getAttribute('id'));
    while (cap.firstChild) p.appendChild(cap.firstChild);
    cap.replaceWith(p);
  }

  // XHTML 1.1 Strict requires block elements (e.g., <p>) inside <blockquote>, not bare inline/text nodes
  for (const bq of Array.from(contentDiv.querySelectorAll('blockquote'))) {
    const children = Array.from(bq.childNodes);
    const hasBareInline = children.some(
      (c) =>
        (c.nodeType === 3 && (c.nodeValue || '').trim().length > 0) ||
        (c.nodeType === 1 && INLINE_ONLY_TAGS.has(c.tagName?.toLowerCase()))
    );
    if (!hasBareInline) continue;

    const rebuilt = [];
    let pendingInline = [];
    const flushInline = () => {
      const hasSignificant = pendingInline.some(
        (n) => (n.nodeType === 3 && (n.nodeValue || '').trim().length > 0) || n.nodeType === 1
      );
      if (hasSignificant) {
        const p = xmlDoc.createElementNS(XHTML_NS, 'p');
        for (const n of pendingInline) p.appendChild(n);
        rebuilt.push(p);
      }
      pendingInline = [];
    };

    for (const child of children) {
      const tag = child.nodeType === 1 ? child.tagName?.toLowerCase() : '';
      if (child.nodeType === 3 || (child.nodeType === 1 && INLINE_ONLY_TAGS.has(tag))) {
        pendingInline.push(child);
      } else {
        flushInline();
        rebuilt.push(child);
      }
    }
    flushInline();
    for (const node of rebuilt) bq.appendChild(node);
  }
}

function enhancePopupFootnotesInDoc(xmlDoc, contentDiv) {
  const idMap = new Map();
  for (const el of contentDiv.querySelectorAll('[id]')) {
    const id = el.getAttribute('id');
    if (id) idMap.set(id, el);
  }
  if (idMap.size === 0) return;

  const isNoteContainerTag = (tag) => tag === 'p' || tag === 'div' || tag === 'li';
  const BLOCK_CHILD_TAGS = new Set([
    'p', 'div', 'blockquote', 'pre', 'ul', 'ol', 'dl', 'table',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'figure', 'aside'
  ]);
  const hasBlockElementChild = (el) =>
    Array.from(el.childNodes || []).some(
      (child) => child.nodeType === 1 && BLOCK_CHILD_TAGS.has(child.tagName?.toLowerCase())
    );
  const setEpubType = (el, val) => {
    if (typeof el.setAttributeNS === 'function') {
      el.setAttributeNS(EPUB_NS, 'epub:type', val);
    } else {
      el.setAttribute('epub:type', val);
    }
  };
  const isDescendantOrSame = (parent, child) => {
    let cur = child;
    while (cur) {
      if (cur === parent) return true;
      cur = cur.parentNode;
    }
    return false;
  };
  const asideByContainer = new Map();

  for (const a of contentDiv.querySelectorAll('a[href^="#"]')) {
    if (a.closest('aside')) continue;
    const href = a.getAttribute('href') || '';
    const targetId = href.slice(1);
    if (!targetId) continue;

    const target = idMap.get(targetId);
    if (!target) continue;
    if (target.closest?.('aside')) continue;

    const aText = (a.textContent || '').trim();
    if (/^(?:↩|↑|⏎|back|voltar)$/i.test(aText)) continue;
    if (/^(?:(?:fn|note|nota|foot)[_-]?ref|ref[-_])/i.test(targetId)) continue;

    const looksLikeRef =
      Boolean(a.closest('sup')) ||
      /^(?:\[\d+\]|\(?\d{1,3}\)?|[¹²³⁴⁵⁶⁷⁸⁹⁰]+|\*{1,3}|†|‡|§|nota\s*\d*|note\s*\d*|fn\s*\d*)$/i.test(aText) ||
      /^(?:fn|note|nota|foot)/i.test(targetId);
    if (!looksLikeRef) continue;

    let container = target;
    while (container.parentElement && container.parentElement !== contentDiv) {
      if (isNoteContainerTag(container.tagName?.toLowerCase())) break;
      container = container.parentElement;
    }
    const containerTag = container.tagName?.toLowerCase();
    if (!isNoteContainerTag(containerTag) && container.tagName?.toLowerCase() !== 'aside') continue;
    if (container === contentDiv || isDescendantOrSame(container, a) || isDescendantOrSame(a, container)) continue;

    setEpubType(a, 'noteref');

    if (asideByContainer.has(container)) continue;

    if (target !== container) {
      target.removeAttribute('id');
      if (
        target.tagName?.toLowerCase() === 'a' &&
        !target.getAttribute('href') &&
        target.childNodes.length === 0
      ) {
        target.remove();
      }
    } else {
      container.removeAttribute('id');
    }

    let aside = container.tagName?.toLowerCase() === 'aside' ? container : null;
    if (!aside) {
      aside = xmlDoc.createElementNS(XHTML_NS, 'aside');
      setEpubType(aside, 'footnote');
      aside.setAttribute('id', targetId);
      if (containerTag === 'li') {
        // Keep <li> in place inside <ol>/<ul> so EPUB 3 XHTML remains valid (never place <aside> directly inside <ol>/<ul>).
        if (hasBlockElementChild(container)) {
          while (container.firstChild) aside.appendChild(container.firstChild);
        } else {
          const p = xmlDoc.createElementNS(XHTML_NS, 'p');
          while (container.firstChild) p.appendChild(container.firstChild);
          aside.appendChild(p);
        }
        container.appendChild(aside);
      } else {
        if (typeof container.replaceWith === 'function') {
          container.replaceWith(aside);
        } else {
          container.parentNode.insertBefore(aside, container);
          container.remove();
        }
        aside.appendChild(container);
      }
    } else {
      setEpubType(aside, 'footnote');
      aside.setAttribute('id', targetId);
    }
    asideByContainer.set(container, aside);
  }
}

export function serializeChapterXhtml({
  title,
  subtitle = '',
  xmlDoc,
  nodes,
  stylesheetHref = '../styles/stylesheet.css',
  epub3 = true,
  popupFootnotes = false
}) {
  const safeTitle = stripInvalidXmlChars(title) || 'Chapter';
  const safeSubtitle = stripInvalidXmlChars(subtitle);

  const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
  const html = xmlDoc.documentElement;
  if (typeof html.setAttributeNS === 'function') {
    html.setAttributeNS(XMLNS_NS, 'xmlns', XHTML_NS);
    if (epub3) {
      html.setAttributeNS(XMLNS_NS, 'xmlns:epub', EPUB_NS);
    } else if (typeof html.removeAttributeNS === 'function') {
      html.removeAttributeNS(XMLNS_NS, 'xmlns:epub');
    } else {
      html.removeAttribute('xmlns:epub');
    }
  } else {
    html.setAttribute('xmlns', XHTML_NS);
    if (epub3) {
      html.setAttribute('xmlns:epub', EPUB_NS);
    } else {
      html.removeAttribute('xmlns:epub');
    }
  }

  const head = xmlDoc.createElementNS(XHTML_NS, 'head');
  const metaCharset = xmlDoc.createElementNS(XHTML_NS, 'meta');
  if (epub3) {
    metaCharset.setAttribute('charset', 'utf-8');
  } else {
    metaCharset.setAttribute('http-equiv', 'Content-Type');
    metaCharset.setAttribute('content', 'application/xhtml+xml; charset=utf-8');
  }
  head.appendChild(metaCharset);

  const titleEl = xmlDoc.createElementNS(XHTML_NS, 'title');
  titleEl.textContent = safeTitle;
  head.appendChild(titleEl);

  const linkEl = xmlDoc.createElementNS(XHTML_NS, 'link');
  linkEl.setAttribute('rel', 'stylesheet');
  linkEl.setAttribute('type', 'text/css');
  linkEl.setAttribute('href', stylesheetHref);
  head.appendChild(linkEl);

  const body = xmlDoc.createElementNS(XHTML_NS, 'body');
  const h2 = xmlDoc.createElementNS(XHTML_NS, 'h2');
  h2.setAttribute('class', 'chapter-title');
  h2.textContent = safeTitle;
  body.appendChild(h2);

  if (safeSubtitle && safeSubtitle !== safeTitle) {
    const pSub = xmlDoc.createElementNS(XHTML_NS, 'p');
    pSub.setAttribute('class', 'chapter-subtitle');
    pSub.textContent = safeSubtitle;
    body.appendChild(pSub);
  }

  const contentDiv = xmlDoc.createElementNS(XHTML_NS, 'div');
  contentDiv.setAttribute('class', 'chapter-content');
  for (const n of nodes) {
    if (!n) continue;
    const adopted =
      typeof xmlDoc.importNode === 'function'
        ? xmlDoc.importNode(n, true)
        : typeof n.cloneNode === 'function'
          ? n.cloneNode(true)
          : n;
    contentDiv.appendChild(adopted);
  }
  if (epub3 && popupFootnotes) {
    enhancePopupFootnotesInDoc(xmlDoc, contentDiv);
  } else if (!epub3) {
    normalizeXhtmlForEpub2(xmlDoc, contentDiv);
  }
  body.appendChild(contentDiv);

  html.replaceChildren(head, body);

  // Serialize documentElement (not xmlDoc) and strip any leading XML PI/DOCTYPE so browsers
  // never emit a duplicate `<?xml ...?>` declaration after line 1.
  const serialized = new XMLSerializer()
    .serializeToString(xmlDoc.documentElement)
    .replace(/^(?:\s*<\?xml[^?]*\?>|\s*<!DOCTYPE[^>]*>)+/i, '')
    .trimStart();
  const doctype = epub3
    ? '<!DOCTYPE html>'
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
  return `<?xml version="1.0" encoding="utf-8"?>\n${doctype}\n${serialized}`;
}

export function escapeXml(str) {
  return stripInvalidXmlChars(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
