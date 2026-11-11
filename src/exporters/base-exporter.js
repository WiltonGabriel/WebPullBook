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

  serializeNodesToInnerHtml(nodes) {
    const serializer = new XMLSerializer();
    return nodes.map((n) => serializer.serializeToString(n)).join('\n');
  }

  nodesToMarkdown(nodes) {
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
        const alt = node.getAttribute('alt') || 'Image';
        const src = node.getAttribute('src') || '';
        return `![${alt}](${src})`;
      }
      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        return href ? `[${childrenText().trim()}](${href})` : childrenText();
      }
      if (tag === 'b' || tag === 'strong' || cls.includes('wpb-bold')) {
        const t = childrenText().trim();
        return t ? `**${t}**` : '';
      }
      if (tag === 'i' || tag === 'em' || cls.includes('wpb-italic')) {
        const t = childrenText().trim();
        return t ? `*${t}*` : '';
      }
      if (tag === 's' || tag === 'del' || cls.includes('wpb-strike')) {
        const t = childrenText().trim();
        return t ? `~~${t}~~` : '';
      }
      if (tag === 'code') {
        return `\`${childrenText()}\``;
      }
      if (tag === 'pre') {
        return `\n\`\`\`\n${node.textContent || ''}\n\`\`\`\n\n`;
      }
      if (tag === 'blockquote') {
        const inner = childrenText().trim().split('\n').map((l) => `> ${l}`).join('\n');
        return `\n${inner}\n\n`;
      }
      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(6, Math.max(2, parseInt(tag[1], 10)));
        return `\n${'#'.repeat(level)} ${childrenText().trim()}\n\n`;
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
        return childrenText();
      }
      if (tag === 'p' || tag === 'div') {
        const t = childrenText().replace(/[ \t]+\n/g, '\n').trim();
        return t ? `${t}\n\n` : '';
      }
      return childrenText();
    };

    return nodes.map((n) => convertNode(n)).join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  nodesToPlainText(nodes) {
    const out = [];
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.nodeValue || '').trim();
        if (t) out.push(t);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName.toLowerCase();
      if (tag === 'hr') {
        out.push('---');
        continue;
      }
      const clone = node.cloneNode(true);
      for (const br of clone.querySelectorAll('br')) {
        br.replaceWith('\n');
      }
      if (tag === 'ul' || tag === 'ol') {
        let idx = 1;
        for (const li of clone.querySelectorAll(':scope > li')) {
          const prefix = tag === 'ol' ? `${idx++}. ` : '* ';
          out.push(`${prefix}${li.textContent.trim()}`);
        }
        continue;
      }
      const txt = (clone.textContent || '').replace(/[ \t]+/g, ' ').trim();
      if (txt) out.push(txt);
    }
    return out.join('\n\n');
  }
}
