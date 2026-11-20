/**
 * Generates concise, reusable CSS selectors for interactive picker and heuristic suggestions.
 */

function escapeCssIdent(ident) {
  const s = String(ident || '');
  if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
    return globalThis.CSS.escape(s);
  }
  return s.replace(/([^\w-])/g, '\\$1');
}

function isStableCssClass(cls) {
  if (!cls || cls.length > 48) return false;
  if (/^(?:active|selected|current|open|closed|show|hide|hidden|hover|focus|wpb-)/i.test(cls)) return false;
  if (/^js-/i.test(cls) || /\d{5,}/.test(cls)) return false;
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(cls);
}

function describeSingleElement(el) {
  const tag = el.tagName?.toLowerCase() || 'div';
  const id = (el.getAttribute?.('id') || '').trim();
  if (id && !/\d{5,}/.test(id)) {
    return `#${escapeCssIdent(id)}`;
  }
  const rawClass = typeof el.className === 'string' ? el.className : el.getAttribute?.('class') || '';
  const classTokens = rawClass.trim() ? rawClass.trim().split(/\s+/) : Array.from(el.classList || []);
  const classes = classTokens.filter(isStableCssClass).slice(0, 2);
  if (classes.length > 0) {
    return `${tag}.${classes.map(escapeCssIdent).join('.')}`;
  }
  return tag;
}

/**
 * Generates a concise, reusable CSS selector for an element picked interactively on a page.
 */
export function generateCssSelector(targetEl, mode = 'content') {
  if (!targetEl || !targetEl.ownerDocument) return '';
  const doc = targetEl.ownerDocument;
  let el = targetEl;

  if (mode === 'list') {
    const anchor = el.closest?.('a') || (el.tagName?.toLowerCase() === 'a' ? el : null);
    if (anchor) {
      let cur = anchor.parentElement;
      for (let depth = 0; depth < 4 && cur && cur !== doc.body && cur !== doc.documentElement; depth++) {
        const tag = cur.tagName?.toLowerCase();
        if (tag === 'ul' || tag === 'ol' || cur.querySelectorAll('a[href]').length >= 3) {
          const base = describeSingleElement(cur);
          if (base !== tag || tag === 'nav' || tag === 'ul' || tag === 'ol') {
            return `${base} a`;
          }
        }
        cur = cur.parentElement;
      }
      const aDesc = describeSingleElement(anchor);
      if (aDesc !== 'a') return aDesc;
    }
  }

  const parts = [];
  let cur = el;
  for (let depth = 0; depth < 4 && cur && cur !== doc.body && cur !== doc.documentElement; depth++) {
    const seg = describeSingleElement(cur);
    parts.unshift(seg);
    const candidate = parts.join(' > ');
    try {
      const matched = doc.querySelectorAll(candidate);
      if (seg.startsWith('#') || (mode !== 'exclude' && matched.length === 1)) {
        return candidate;
      }
      if (mode === 'exclude' && matched.length >= 1 && seg.includes('.')) {
        return seg;
      }
    } catch {
      // ignore invalid selector attempt
    }
    cur = cur.parentElement;
  }

  return parts.join(' > ') || describeSingleElement(el);
}
