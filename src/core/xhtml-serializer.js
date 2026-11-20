/**
 * XHTML chapter serializer, XML escaping, and EPUB 3 pop-up footnote enhancer.
 */

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';
export const EPUB_NS = 'http://www.idpf.org/2007/ops';

function enhancePopupFootnotesInDoc(xmlDoc, contentDiv) {
  const idMap = new Map();
  for (const el of contentDiv.querySelectorAll('[id]')) {
    const id = el.getAttribute('id');
    if (id) idMap.set(id, el);
  }
  if (idMap.size === 0) return;

  const isNoteContainerTag = (tag) => tag === 'p' || tag === 'div' || tag === 'li';
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

    const aText = (a.textContent || '').trim();
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
      if (typeof container.replaceWith === 'function') {
        container.replaceWith(aside);
      } else {
        container.parentNode.insertBefore(aside, container);
        container.remove();
      }
      if (containerTag === 'li') {
        const p = xmlDoc.createElementNS(XHTML_NS, 'p');
        while (container.firstChild) p.appendChild(container.firstChild);
        aside.appendChild(p);
      } else {
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
  const html = xmlDoc.documentElement;
  html.setAttribute('xmlns', XHTML_NS);
  if (epub3) {
    html.setAttribute('xmlns:epub', EPUB_NS);
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
  if (epub3 && popupFootnotes) {
    enhancePopupFootnotesInDoc(xmlDoc, contentDiv);
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
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
