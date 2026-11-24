const HTML5_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

function expandXmlSelfClosingForHtml5(xhtmlStr) {
  let out = '';
  let i = 0;
  while (i < xhtmlStr.length) {
    const lt = xhtmlStr.indexOf('<', i);
    if (lt === -1) {
      out += xhtmlStr.slice(i);
      break;
    }
    out += xhtmlStr.slice(i, lt);
    let gt = -1;
    let quote = null;
    for (let j = lt + 1; j < xhtmlStr.length; j++) {
      const ch = xhtmlStr[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        gt = j;
        break;
      }
    }
    if (gt === -1) {
      out += xhtmlStr.slice(lt);
      break;
    }
    let tagText = xhtmlStr.slice(lt + 1, gt);
    tagText = tagText.replace(/\s+xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    const trimmed = tagText.trimEnd();
    if (!trimmed.startsWith('/') && !trimmed.startsWith('!') && !trimmed.startsWith('?') && trimmed.endsWith('/')) {
      const tagMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9:-]*)/);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';
      if (tagName && !HTML5_VOID_TAGS.has(tagName)) {
        const withoutSlash = trimmed.slice(0, -1).trimEnd();
        out += `<${withoutSlash}></${tagName}>`;
        i = gt + 1;
        continue;
      }
    }
    out += `<${tagText}>`;
    i = gt + 1;
  }
  return out;
}

function wrapMarkdownInline(text, prefix, suffix) {
  if (!text) return '';
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;
  return `${lead}${prefix}${core}${suffix}${trail}`;
}

function escapeMarkdownLinkText(text) {
  return String(text || '').replace(/([\\[\]])/g, '\\$1');
}

function escapeMarkdownUrl(url) {
  return String(url || '').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s+/g, '%20');
}

function formatInlineCodeMarkdown(text) {
  const raw = String(text || '');
  const matches = raw.match(/`+/g) || [];
  const maxRun = matches.reduce((m, s) => Math.max(m, s.length), 0);
  const fence = '`'.repeat(maxRun + 1);
  const needsSpace = raw.startsWith('`') || raw.endsWith('`');
  return needsSpace ? `${fence} ${raw} ${fence}` : `${fence}${raw}${fence}`;
}

/**
 * Base class for all WebPullBook output format exporters.
 */
export class BaseExporter {
  constructor({ id, name, extension, mimeType }) {
    this.id = id;
    this.name = name;
    this.extension = extension;
    this.mimeType = mimeType;
  }

  async exportBook(_context) {
    throw new Error(`${this.constructor.name}.exportBook() must be implemented`);
  }

  serializeNodesToInnerHtml(nodes, { chapterScopePrefix = '' } = {}) {
    const serializer = new XMLSerializer();
    return nodes
      .map((n) => {
        let target = n;
        if (chapterScopePrefix && n?.nodeType === Node.ELEMENT_NODE && typeof n.cloneNode === 'function') {
          target = n.cloneNode(true);
          const scopeNode = (el) => {
            const id = el.getAttribute?.('id');
            if (id) el.setAttribute('id', `${chapterScopePrefix}${id}`);
            const href = el.getAttribute?.('href');
            if (href && href.startsWith('#') && href.length > 1) {
              el.setAttribute('href', `#${chapterScopePrefix}${href.slice(1)}`);
            }
          };
          scopeNode(target);
          for (const desc of target.querySelectorAll?.('[id], a[href^="#"]') || []) {
            scopeNode(desc);
          }
        }
        return expandXmlSelfClosingForHtml5(serializer.serializeToString(target));
      })
      .join('\n');
  }

  nodesToMarkdown(nodes) {
    const applyClassInlineStyles = (text, cls) => {
      let out = text;
      if (!out || !cls) return out;
      if (cls.includes('wpb-bold')) out = wrapMarkdownInline(out, '**', '**');
      if (cls.includes('wpb-italic')) out = wrapMarkdownInline(out, '*', '*');
      if (cls.includes('wpb-strike')) out = wrapMarkdownInline(out, '~~', '~~');
      return out;
    };

    const convertTable = (tableEl) => {
      const rows = Array.from(tableEl.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const matrix = rows.map((tr) =>
        Array.from(tr.children || [])
          .filter((c) => {
            const ct = c.tagName?.toLowerCase();
            return ct === 'th' || ct === 'td';
          })
          .map((cell) =>
            Array.from(cell.childNodes)
              .map((c) => convertNode(c, 0))
              .join('')
              .replace(/\s*\n+\s*/g, ' ')
              .replace(/\|/g, '\\|')
              .trim()
          )
      );
      const colCount = matrix.reduce((m, r) => Math.max(m, r.length), 0);
      if (colCount === 0) return '';
      const padRow = (r) => Array.from({ length: colCount }, (_, idx) => r[idx] || '');
      const header = padRow(matrix[0]);
      const sep = Array.from({ length: colCount }, () => '---');
      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...matrix.slice(1).map((r) => `| ${padRow(r).join(' | ')} |`)
      ];
      return `\n${lines.join('\n')}\n\n`;
    };

    const convertNode = (node, listDepth = 0) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue || '';
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();
      const cls = node.getAttribute('class') || '';
      const childrenText = () => Array.from(node.childNodes).map((c) => convertNode(c, listDepth)).join('');

      if (tag === 'br') return '  \n';
      if (tag === 'hr') return '\n---\n\n';
      if (tag === 'img') {
        const alt = escapeMarkdownLinkText(node.getAttribute('alt') || 'Image');
        const src = escapeMarkdownUrl(node.getAttribute('src') || '');
        return `![${alt}](${src})`;
      }
      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        const inner = childrenText().trim();
        return href ? `[${escapeMarkdownLinkText(inner)}](${escapeMarkdownUrl(href)})` : childrenText();
      }
      if (tag === 'b' || tag === 'strong') {
        return wrapMarkdownInline(childrenText(), '**', '**');
      }
      if (tag === 'i' || tag === 'em') {
        return wrapMarkdownInline(childrenText(), '*', '*');
      }
      if (tag === 's' || tag === 'del') {
        return wrapMarkdownInline(childrenText(), '~~', '~~');
      }
      if (tag === 'code') {
        return formatInlineCodeMarkdown(childrenText());
      }
      if (tag === 'pre') {
        const body = node.textContent || '';
        const matches = body.match(/`{3,}/g) || [];
        const fence = '`'.repeat(matches.reduce((m, s) => Math.max(m, s.length), 2) + 1);
        return `\n${fence}\n${body}\n${fence}\n\n`;
      }
      if (tag === 'table') {
        return convertTable(node);
      }
      if (tag === 'dl') {
        const lines = [];
        for (const child of node.children || []) {
          const ct = child.tagName?.toLowerCase();
          const val = Array.from(child.childNodes).map((c) => convertNode(c, listDepth)).join('').trim();
          if (!val) continue;
          if (ct === 'dt') lines.push(`**${val}**`);
          else if (ct === 'dd') lines.push(`: ${val}`);
        }
        return lines.length > 0 ? `\n${lines.join('\n')}\n\n` : '';
      }
      if (tag === 'blockquote') {
        const inner = applyClassInlineStyles(childrenText().trim(), cls);
        const quoted = inner.split('\n').map((l) => `> ${l}`).join('\n');
        return `\n${quoted}\n\n`;
      }
      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(6, Math.max(2, parseInt(tag[1], 10)));
        const inner = applyClassInlineStyles(childrenText().trim(), cls);
        return `\n${'#'.repeat(level)} ${inner}\n\n`;
      }
      if (tag === 'ul' || tag === 'ol') {
        const isOrdered = tag === 'ol';
        let idx = 1;
        const lines = [];
        for (const child of node.children) {
          if (child.tagName.toLowerCase() === 'li') {
            const prefix = isOrdered ? `${idx++}. ` : '- ';
            const indent = '  '.repeat(listDepth);
            lines.push(`${indent}${prefix}${convertNode(child, listDepth + 1).trim()}`);
          }
        }
        return `\n${lines.join('\n')}\n\n`;
      }
      if (tag === 'li') {
        return applyClassInlineStyles(childrenText(), cls);
      }
      if (tag === 'p' || tag === 'div' || tag === 'figure' || tag === 'figcaption') {
        const t = applyClassInlineStyles(childrenText().replace(/[ \t]+\n/g, '\n').trim(), cls);
        return t ? `${t}\n\n` : '';
      }
      return applyClassInlineStyles(childrenText(), cls);
    };

    return nodes.map((n) => convertNode(n)).join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  nodesToPlainText(nodes) {
    const out = [];
    const inlineWithBreaks = (node) => {
      const clone = node.cloneNode(true);
      for (const br of clone.querySelectorAll?.('br') || []) {
        br.replaceWith('\n');
      }
      return (clone.textContent || '')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter((line, idx, arr) => line.length > 0 || (idx > 0 && idx < arr.length - 1))
        .join('\n')
        .trim();
    };

    const BLOCK_CONTAINERS = new Set(['div', 'blockquote', 'figure', 'dl', 'aside']);
    const emitBlock = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.nodeValue || '').replace(/[ \t]+/g, ' ').trim();
        if (t) out.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'hr') {
        out.push('---');
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        let idx = 1;
        for (const li of node.querySelectorAll(':scope > li')) {
          const prefix = tag === 'ol' ? `${idx++}. ` : '* ';
          const txt = inlineWithBreaks(li);
          if (txt) out.push(`${prefix}${txt}`);
        }
        return;
      }
      if (tag === 'table') {
        const rowLines = [];
        for (const tr of node.querySelectorAll('tr')) {
          const cells = Array.from(tr.children || [])
            .filter((c) => {
              const ct = c.tagName?.toLowerCase();
              return ct === 'th' || ct === 'td';
            })
            .map((cell) => inlineWithBreaks(cell))
            .filter(Boolean);
          if (cells.length > 0) rowLines.push(cells.join('\t'));
        }
        if (rowLines.length > 0) out.push(rowLines.join('\n'));
        return;
      }
      if (BLOCK_CONTAINERS.has(tag)) {
        const hasChildBlocks = Array.from(node.children || []).some((c) => {
          const ct = c.tagName?.toLowerCase();
          return (
            BLOCK_CONTAINERS.has(ct) ||
            ct === 'p' ||
            ct === 'ul' ||
            ct === 'ol' ||
            ct === 'table' ||
            ct === 'hr' ||
            ct === 'pre' ||
            ct === 'dt' ||
            ct === 'dd' ||
            /^h[1-6]$/.test(ct)
          );
        });
        if (hasChildBlocks) {
          for (const child of node.childNodes) emitBlock(child);
          return;
        }
      }
      if (tag === 'pre') {
        const preText = (node.textContent || '').trim();
        if (preText) out.push(preText);
        return;
      }
      const txt = inlineWithBreaks(node);
      if (txt) out.push(txt);
    };

    for (const node of nodes) {
      emitBlock(node);
    }
    return out.join('\n\n');
  }
}
