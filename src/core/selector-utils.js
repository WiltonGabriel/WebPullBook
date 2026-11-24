import { isDescendantOf } from './parser-helpers.js';

/**
 * Generates concise, reusable CSS selectors for interactive picker and heuristic suggestions.
 */

const STATE_CLASS_RX = /^(?:active|selected|current|open|closed|show|hide|hidden|hover|focus|wpb-)/i;
const UTILITY_CLASS_RX =
  /^(?:flex|inline-flex|grid|block|inline-block|hidden|relative|absolute|fixed|sticky|container|mx-auto|(?:m|p|px|py|pt|pb|pl|pr|mt|mb|ml|mr|gap|space-[xy]|w|h|min-w|min-h|max-w|max-h|bg|border|rounded|shadow|overflow|items|justify|self|col|row|z)-.+|text-(?:xs|sm|base|lg|xl|\d+xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|truncate|ellipsis|clip|transparent|current|black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?|\[.+\])|_[a-zA-Z0-9-]+_(?=[^_]*\d)[a-zA-Z0-9]{4,}|_(?=.*\d)[a-zA-Z0-9_-]{4,}|[a-zA-Z0-9-]+_(?=[^_]*\d)[a-zA-Z0-9]{5,})$/;

export function escapeCssIdent(ident) {
  const s = String(ident || '');
  if (typeof globalThis.CSS !== 'undefined' && typeof globalThis.CSS.escape === 'function') {
    return globalThis.CSS.escape(s);
  }
  if (!s) return '';
  if (s === '-') return '\\-';
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (i === 0 && code >= 0x30 && code <= 0x39) {
      out += `\\${code.toString(16)} `;
      continue;
    }
    if (i === 1 && s[0] === '-' && code >= 0x30 && code <= 0x39) {
      out += `\\${code.toString(16)} `;
      continue;
    }
    if (/[\w-]/.test(ch)) {
      out += ch;
    } else {
      out += `\\${ch}`;
    }
  }
  return out;
}

export function isStableCssId(id) {
  return Boolean(id) && !/^\d/.test(id) && !/^:?r\d+:?$/i.test(id) && !/\d{5,}|_(?=.*\d)[a-zA-Z0-9]{5,}$/.test(id);
}

export function isStableCssClass(cls) {
  if (!cls || cls.length > 48) return false;
  if (STATE_CLASS_RX.test(cls) || UTILITY_CLASS_RX.test(cls)) return false;
  if (/^js-/i.test(cls) || /\d{5,}/.test(cls)) return false;
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(cls);
}

export function describeSingleElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = el.tagName?.toLowerCase() || 'div';
  const id = (el.getAttribute?.('id') || '').trim();
  if (isStableCssId(id)) {
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
 * Generates a readable CSS selector by matching an element (or scoped child suffix) cleanly against doc.
 */
export function buildReadableSelector(el, doc, suffix = '') {
  if (!el || !doc) return '';
  const candidates = [];
  const base = describeSingleElement(el);
  if (base) candidates.push(base);

  let ancestor = el.parentElement;
  let chain = base;
  for (let depth = 0; depth < 3 && ancestor && ancestor.tagName?.toLowerCase() !== 'html'; depth++) {
    const part = describeSingleElement(ancestor);
    chain = `${part} > ${chain}`;
    candidates.push(chain);
    if (part.startsWith('#') || part.includes('.')) {
      candidates.push(`${part} ${base}`);
    }
    if (ancestor.tagName?.toLowerCase() === 'body') break;
    ancestor = ancestor.parentElement;
  }

  for (const sel of candidates) {
    const full = suffix ? `${sel} ${suffix}` : sel;
    try {
      const matched = doc.querySelectorAll(full);
      if (suffix) {
        if (matched.length > 0 && Array.from(matched).every((node) => node === el || isDescendantOf(node, el))) {
          return full;
        }
      } else if (matched.length === 1 && matched[0] === el) {
        return full;
      } else if (matched.length > 0 && matched[0] === el && (sel.startsWith('#') || sel.includes('.'))) {
        return full;
      }
    } catch {
      // Skip invalid candidate selector
    }
  }

  const fallback = candidates[candidates.length - 1] || base;
  return suffix && fallback ? `${fallback} ${suffix}` : fallback;
}

/**
 * Generates a concise, reusable CSS selector for an element picked interactively on a page.
 */
export function generateCssSelector(targetEl, mode = 'content') {
  if (!targetEl || !targetEl.ownerDocument) return '';
  const doc = targetEl.ownerDocument;
  const el = targetEl;

  if (mode === 'list') {
    const anchor = el.closest?.('a') || (el.tagName?.toLowerCase() === 'a' ? el : null);
    if (anchor) {
      let cur = anchor.parentElement;
      for (let depth = 0; depth < 4 && cur && cur !== doc.body && cur !== doc.documentElement; depth++) {
        const tag = cur.tagName?.toLowerCase();
        if (tag === 'ul' || tag === 'ol' || cur.querySelectorAll('a[href]').length >= 3) {
          const base = describeSingleElement(cur);
          if (base !== tag) {
            return `${base} a`;
          }
          const readable = buildReadableSelector(cur, doc, 'a');
          if (readable && readable !== `${tag} a`) {
            return readable;
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
        return depth === 0 ? seg : candidate;
      }
    } catch {
      // ignore invalid selector attempt
    }
    cur = cur.parentElement;
  }

  return parts.join(' > ') || describeSingleElement(el);
}
