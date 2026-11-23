import { normalizeSpaces } from './text-utils.js';

/**
 * Shared DOM, JSON, and URL helpers reused across parser adapters and selector utilities.
 */

export function resolveAbsoluteUrl(rawUrl, baseUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return '';
  try {
    const resolved = new URL(raw, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return '';
    }
    return resolved.toString();
  } catch {
    return '';
  }
}

export function extractUniqueTexts(root, selector) {
  if (!root?.querySelectorAll) return [];
  const out = [];
  const seen = new Set();
  for (const el of root.querySelectorAll(selector)) {
    const text = normalizeSpaces(el.textContent);
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

export function isDescendantOf(child, ancestor) {
  let cur = child?.parentElement;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parentElement;
  }
  return false;
}

export function extractJsonArraySlice(text, startBracketIdx) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startBracketIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(startBracketIdx, i + 1);
      }
    }
  }
  return null;
}

export function extractWindowJsonArray(doc, varName) {
  if (!doc?.querySelectorAll || !varName) return [];
  const escapedVar = String(varName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`window\\.${escapedVar}\\s*=\\s*\\[`);
  for (const script of doc.querySelectorAll('script')) {
    const text = script.textContent || '';
    const match = pattern.exec(text);
    if (!match) continue;
    const bracketIdx = text.indexOf('[', match.index);
    if (bracketIdx === -1) continue;
    const slice = extractJsonArraySlice(text, bracketIdx);
    if (!slice) continue;
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Ignore malformed inline JSON
    }
  }
  return [];
}
