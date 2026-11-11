/**
 * Zero-dependency HTML5 & strict XHTML/XML DOM shim for running browser-targeted
 * WebPullBook parsers, sanitizer, and exporters directly under `node:test`.
 */

export const NODE_TYPES = Object.freeze({
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_FRAGMENT_NODE: 11
});

const VOID_HTML_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  times: '\u00d7',
  divide: '\u00f7',
  deg: '\u00b0'
};

function decodeEntities(str) {
  return String(str).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (full, ent) => {
    if (ent[0] === '#') {
      const cp = ent[1] === 'x' || ent[1] === 'X'
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
        return String.fromCodePoint(cp);
      }
      return full;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ent) ? NAMED_ENTITIES[ent] : full;
  });
}

function escapeXmlText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttr(str) {
  return escapeXmlText(str).replace(/"/g, '&quot;');
}

export class ShimNode {
  constructor(nodeType, ownerDocument = null) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === NODE_TYPES.ELEMENT_NODE
      ? this.parentNode
      : null;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === NODE_TYPES.ELEMENT_NODE);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get lastElementChild() {
    const ch = this.children;
    return ch[ch.length - 1] || null;
  }

  get nextElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const idx = siblings.indexOf(this);
    return idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1] : null;
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }

  appendChild(node) {
    if (!node) return node;
    if (node.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT_NODE) {
      const items = [...node.childNodes];
      for (const item of items) {
        this.appendChild(item);
      }
      return node;
    }
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    if (this.ownerDocument || this.nodeType === NODE_TYPES.DOCUMENT_NODE) {
      const doc = this.nodeType === NODE_TYPES.DOCUMENT_NODE ? this : this.ownerDocument;
      propagateOwnerDocument(node, doc);
    }
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const idx = this.childNodes.indexOf(node);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      node.parentNode = null;
    }
    return node;
  }

  append(...nodes) {
    const doc = this.nodeType === NODE_TYPES.DOCUMENT_NODE ? this : this.ownerDocument;
    for (const item of nodes) {
      if (typeof item === 'string') {
        this.appendChild(new ShimText(item, doc));
      } else if (item) {
        this.appendChild(item);
      }
    }
  }

  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) {
      this.removeChild(child);
    }
    this.append(...nodes);
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  replaceWith(...nodes) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const doc = this.ownerDocument;
    const idx = parent.childNodes.indexOf(this);
    if (idx === -1) return;
    const expanded = [];
    for (const n of nodes) {
      if (typeof n === 'string') {
        expanded.push(new ShimText(n, doc));
      } else if (n?.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT_NODE) {
        expanded.push(...n.childNodes);
        n.childNodes.length = 0;
      } else if (n) {
        expanded.push(n);
      }
    }
    this.parentNode = null;
    for (const item of expanded) {
      if (item.parentNode) item.parentNode.removeChild(item);
      item.parentNode = parent;
      propagateOwnerDocument(item, doc);
    }
    parent.childNodes.splice(idx, 1, ...expanded);
  }

  get textContent() {
    if (this.nodeType === NODE_TYPES.TEXT_NODE) return this.nodeValue;
    if (this.nodeType === NODE_TYPES.COMMENT_NODE) return '';
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(val) {
    const str = String(val ?? '');
    const doc = this.nodeType === NODE_TYPES.DOCUMENT_NODE ? this : this.ownerDocument;
    for (const c of [...this.childNodes]) c.parentNode = null;
    this.childNodes.length = 0;
    if (str) {
      this.appendChild(new ShimText(str, doc));
    }
  }

  cloneNode(_deep = false) {
    throw new Error('cloneNode must be implemented by subclass');
  }
}

function propagateOwnerDocument(node, doc) {
  node.ownerDocument = doc;
  for (const child of node.childNodes) {
    propagateOwnerDocument(child, doc);
  }
}

export class ShimText extends ShimNode {
  constructor(data = '', ownerDocument = null) {
    super(NODE_TYPES.TEXT_NODE, ownerDocument);
    this.nodeValue = String(data);
  }

  get data() {
    return this.nodeValue;
  }

  set data(v) {
    this.nodeValue = String(v);
  }

  cloneNode() {
    return new ShimText(this.nodeValue, this.ownerDocument);
  }
}

export class ShimComment extends ShimNode {
  constructor(data = '', ownerDocument = null) {
    super(NODE_TYPES.COMMENT_NODE, ownerDocument);
    this.nodeValue = String(data);
  }

  cloneNode() {
    return new ShimComment(this.nodeValue, this.ownerDocument);
  }
}

export class ShimDocumentFragment extends ShimNode {
  constructor(ownerDocument = null) {
    super(NODE_TYPES.DOCUMENT_FRAGMENT_NODE, ownerDocument);
  }

  cloneNode(deep = false) {
    const frag = new ShimDocumentFragment(this.ownerDocument);
    if (deep) {
      for (const child of this.childNodes) {
        frag.appendChild(child.cloneNode(true));
      }
    }
    return frag;
  }

  querySelector(selector) {
    return querySelectorFirst(this, selector, this);
  }

  querySelectorAll(selector) {
    return querySelectorAllNodes(this, selector, this);
  }
}

export class ShimElement extends ShimNode {
  constructor(tagName, ownerDocument = null, namespaceURI = null) {
    super(NODE_TYPES.ELEMENT_NODE, ownerDocument);
    this.namespaceURI = namespaceURI;
    this.tagName = namespaceURI ? String(tagName) : String(tagName).toUpperCase();
    this._localName = String(tagName).toLowerCase();
    this._attrs = new Map();
  }

  get localName() {
    return this._localName;
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(v) {
    this.setAttribute('id', v);
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(v) {
    this.setAttribute('class', v);
  }

  get attributes() {
    return Array.from(this._attrs.entries()).map(([name, value]) => ({ name, value }));
  }

  getAttribute(name) {
    const key = this.namespaceURI ? name : String(name).toLowerCase();
    return this._attrs.has(key) ? this._attrs.get(key) : null;
  }

  setAttribute(name, value) {
    const key = this.namespaceURI ? name : String(name).toLowerCase();
    this._attrs.set(key, String(value));
  }

  hasAttribute(name) {
    const key = this.namespaceURI ? name : String(name).toLowerCase();
    return this._attrs.has(key);
  }

  removeAttribute(name) {
    const key = this.namespaceURI ? name : String(name).toLowerCase();
    this._attrs.delete(key);
  }

  cloneNode(deep = false) {
    const copy = new ShimElement(this._localName, this.ownerDocument, this.namespaceURI);
    for (const [k, v] of this._attrs.entries()) {
      copy._attrs.set(k, v);
    }
    if (deep) {
      for (const child of this.childNodes) {
        copy.appendChild(child.cloneNode(true));
      }
    }
    return copy;
  }

  matches(selector) {
    return matchesSelectorList(this, selector, this);
  }

  closest(selector) {
    let cur = this;
    while (cur && cur.nodeType === NODE_TYPES.ELEMENT_NODE) {
      if (matchesSelectorList(cur, selector, cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return querySelectorFirst(this, selector, this);
  }

  querySelectorAll(selector) {
    return querySelectorAllNodes(this, selector, this);
  }

  getElementsByTagNameNS(ns, localName) {
    const out = [];
    const targetLocal = String(localName).toLowerCase();
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === NODE_TYPES.ELEMENT_NODE) {
          if (
            (ns === '*' || child.namespaceURI === ns) &&
            (targetLocal === '*' || child._localName === targetLocal)
          ) {
            out.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  get innerHTML() {
    return this.childNodes.map((c) => serializeNode(c, false)).join('');
  }

  get outerHTML() {
    return serializeNode(this, false);
  }
}

export class ShimDocument extends ShimNode {
  constructor(isXml = false, namespaceURI = null) {
    super(NODE_TYPES.DOCUMENT_NODE, null);
    this.ownerDocument = this;
    this.isXml = isXml;
    this.namespaceURI = namespaceURI;
    this.implementation = {
      createDocument: (ns, qualifiedName, _doctype = null) => {
        const xmlDoc = new ShimDocument(true, ns);
        if (qualifiedName) {
          const root = xmlDoc.createElementNS(ns, qualifiedName);
          if (ns) root.setAttribute('xmlns', ns);
          xmlDoc.appendChild(root);
        }
        return xmlDoc;
      }
    };
  }

  get documentElement() {
    return this.firstElementChild;
  }

  get head() {
    return this.documentElement?.children.find((c) => c._localName === 'head') || null;
  }

  get body() {
    return this.documentElement?.children.find((c) => c._localName === 'body') || null;
  }

  get title() {
    return this.querySelector('title')?.textContent || '';
  }

  createElement(tagName) {
    return new ShimElement(tagName, this, null);
  }

  createElementNS(ns, qualifiedName) {
    return new ShimElement(qualifiedName, this, ns);
  }

  createTextNode(data) {
    return new ShimText(data, this);
  }

  createComment(data) {
    return new ShimComment(data, this);
  }

  createDocumentFragment() {
    return new ShimDocumentFragment(this);
  }

  getElementsByTagNameNS(ns, localName) {
    const out = [];
    const targetLocal = String(localName).toLowerCase();
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === NODE_TYPES.ELEMENT_NODE) {
          if (
            (ns === '*' || child.namespaceURI === ns) &&
            (targetLocal === '*' || child._localName === targetLocal)
          ) {
            out.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return querySelectorFirst(this, selector, this.documentElement || this);
  }

  querySelectorAll(selector) {
    return querySelectorAllNodes(this, selector, this.documentElement || this);
  }
}

/* ---------------- CSS Selector Engine ---------------- */

function splitTopLevel(str, delimiter) {
  const parts = [];
  let current = '';
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = null;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < str.length) {
        current += str[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '[') bracketDepth++;
    else if (ch === ']') {
      bracketDepth--;
      if (bracketDepth < 0) throw new SyntaxError(`Invalid selector: ${str}`);
    } else if (ch === '(') parenDepth++;
    else if (ch === ')') {
      parenDepth--;
      if (parenDepth < 0) throw new SyntaxError(`Invalid selector: ${str}`);
    }

    if (ch === delimiter && bracketDepth === 0 && parenDepth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (quote || bracketDepth !== 0 || parenDepth !== 0) {
    throw new SyntaxError(`Invalid selector: ${str}`);
  }
  if (current.trim()) parts.push(current.trim());
  else if (parts.length > 0 && str.trim().endsWith(delimiter)) {
    throw new SyntaxError(`Trailing delimiter in selector: ${str}`);
  }
  return parts;
}

function tokenizeComplexSelector(sel) {
  const tokens = [];
  let i = 0;
  const s = sel.trim();
  if (!s) throw new SyntaxError('Empty selector');

  while (i < s.length) {
    if (/\s/.test(s[i])) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i < s.length && !['>', '+', '~'].includes(s[i])) {
        tokens.push({ type: 'combinator', value: ' ' });
      }
      continue;
    }
    if (s[i] === '>' || s[i] === '+' || s[i] === '~') {
      const comb = s[i++];
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) throw new SyntaxError(`Dangling combinator in selector: ${sel}`);
      tokens.push({ type: 'combinator', value: comb });
      continue;
    }

    // Read one compound selector
    let compound = '';
    let bDepth = 0;
    let pDepth = 0;
    let q = null;
    while (i < s.length) {
      const ch = s[i];
      if (q) {
        compound += ch;
        if (ch === '\\' && i + 1 < s.length) compound += s[++i];
        else if (ch === q) q = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        q = ch;
        compound += ch;
        i++;
        continue;
      }
      if (ch === '[') bDepth++;
      else if (ch === ']') bDepth--;
      else if (ch === '(') pDepth++;
      else if (ch === ')') pDepth--;
      if (bDepth === 0 && pDepth === 0 && (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~')) {
        break;
      }
      compound += ch;
      i++;
    }
    if (!compound) throw new SyntaxError(`Invalid selector token in: ${sel}`);
    tokens.push({ type: 'compound', value: parseCompoundSelector(compound) });
  }

  return tokens;
}

function parseCompoundSelector(str) {
  const parts = {
    tag: null,
    id: null,
    classes: [],
    attrs: [],
    pseudos: []
  };
  let i = 0;

  // Optional tag or * at beginning
  if (str[0] === '*') {
    parts.tag = '*';
    i = 1;
  } else if (/^[a-zA-Z_-]/.test(str)) {
    const m = str.match(/^[a-zA-Z0-9_-]+/);
    parts.tag = m[0].toLowerCase();
    i = m[0].length;
  }

  while (i < str.length) {
    const ch = str[i];
    if (ch === '#') {
      i++;
      const m = str.slice(i).match(/^[a-zA-Z0-9_-]+/);
      if (!m) throw new SyntaxError(`Invalid #id in selector: ${str}`);
      parts.id = m[0];
      i += m[0].length;
    } else if (ch === '.') {
      i++;
      const m = str.slice(i).match(/^[a-zA-Z0-9_-]+/);
      if (!m) throw new SyntaxError(`Invalid .class in selector: ${str}`);
      parts.classes.push(m[0]);
      i += m[0].length;
    } else if (ch === '[') {
      const end = findMatchingDelimiter(str, i, '[', ']');
      const inner = str.slice(i + 1, end).trim();
      parts.attrs.push(parseAttrSelector(inner));
      i = end + 1;
    } else if (ch === ':') {
      i++;
      if (str[i] === ':') i++;
      const m = str.slice(i).match(/^[a-zA-Z-]+/);
      if (!m) throw new SyntaxError(`Invalid pseudo-class in selector: ${str}`);
      const name = m[0].toLowerCase();
      i += m[0].length;
      let arg = null;
      if (str[i] === '(') {
        const end = findMatchingDelimiter(str, i, '(', ')');
        arg = str.slice(i + 1, end).trim();
        i = end + 1;
      }
      parts.pseudos.push({ name, arg });
    } else {
      throw new SyntaxError(`Unexpected character "${ch}" in selector: ${str}`);
    }
  }

  return parts;
}

function findMatchingDelimiter(str, startIdx, openCh, closeCh) {
  let depth = 0;
  let quote = null;
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\' && i + 1 < str.length) i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new SyntaxError(`Unclosed "${openCh}" in selector: ${str}`);
}

function parseAttrSelector(inner) {
  const m = inner.match(/^([a-zA-Z0-9_:-]+)(?:\s*([*^$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\]]+))(?:\s+([iIsS]))?)?$/);
  if (!m) throw new SyntaxError(`Invalid attribute selector: [${inner}]`);
  return {
    name: m[1].toLowerCase(),
    op: m[2] || null,
    val: m[3] ?? m[4] ?? m[5] ?? '',
    caseInsensitive: (m[6] || '').toLowerCase() === 'i'
  };
}

function matchesCompound(el, compound, scopeNode) {
  if (!el || el.nodeType !== NODE_TYPES.ELEMENT_NODE) return false;
  if (compound.tag && compound.tag !== '*' && el._localName !== compound.tag) {
    return false;
  }
  if (compound.id !== null && el.id !== compound.id) {
    return false;
  }
  if (compound.classes.length > 0) {
    const clsList = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    for (const c of compound.classes) {
      if (!clsList.includes(c)) return false;
    }
  }
  for (const attr of compound.attrs) {
    if (!el.hasAttribute(attr.name)) return false;
    if (attr.op) {
      let actual = el.getAttribute(attr.name) ?? '';
      let expected = attr.val;
      if (attr.caseInsensitive) {
        actual = actual.toLowerCase();
        expected = expected.toLowerCase();
      }
      if (attr.op === '=' && actual !== expected) return false;
      if (attr.op === '*=' && (!expected || !actual.includes(expected))) return false;
      if (attr.op === '^=' && (!expected || !actual.startsWith(expected))) return false;
      if (attr.op === '$=' && (!expected || !actual.endsWith(expected))) return false;
      if (attr.op === '~=' && !actual.split(/\s+/).includes(expected)) return false;
      if (attr.op === '|=' && actual !== expected && !actual.startsWith(`${expected}-`)) return false;
    }
  }
  for (const pseudo of compound.pseudos) {
    if (pseudo.name === 'scope') {
      if (el !== scopeNode) return false;
    } else if (pseudo.name === 'not') {
      if (matchesSelectorList(el, pseudo.arg || '', scopeNode)) return false;
    } else if (pseudo.name === 'first-child') {
      if (!el.parentNode || el.parentNode.children[0] !== el) return false;
    } else if (pseudo.name === 'last-child') {
      const ch = el.parentNode?.children || [];
      if (ch[ch.length - 1] !== el) return false;
    } else if (pseudo.name === 'nth-child' || pseudo.name === 'nth-last-child') {
      const ch = el.parentNode?.children || [];
      const idx = ch.indexOf(el);
      if (idx === -1) return false;
      const pos = pseudo.name === 'nth-child' ? idx + 1 : ch.length - idx;
      if (!matchesNth(pos, pseudo.arg)) return false;
    }
  }
  return true;
}

function matchesNth(pos, expr) {
  const clean = String(expr || '').trim().toLowerCase();
  if (clean === 'odd') return pos % 2 === 1;
  if (clean === 'even') return pos % 2 === 0;
  if (/^\d+$/.test(clean)) return pos === parseInt(clean, 10);
  const m = clean.match(/^([+-]?\d*)n(?:\s*([+-]\s*\d+))?$/);
  if (!m) return false;
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseInt(m[1], 10);
  const b = m[2] ? parseInt(m[2].replace(/\s+/g, ''), 10) : 0;
  if (a === 0) return pos === b;
  const diff = pos - b;
  return diff % a === 0 && diff / a >= 0;
}

function matchesTokenSequence(el, tokens, idx, scopeNode) {
  const token = tokens[idx];
  if (!token || token.type !== 'compound') return false;
  if (!matchesCompound(el, token.value, scopeNode)) return false;
  if (idx === 0) return true;

  const comb = tokens[idx - 1];
  const prevIdx = idx - 2;
  if (!comb || comb.type !== 'combinator' || prevIdx < 0) return false;

  if (comb.value === '>') {
    return Boolean(el.parentElement && matchesTokenSequence(el.parentElement, tokens, prevIdx, scopeNode));
  }
  if (comb.value === ' ') {
    let cur = el.parentElement;
    while (cur) {
      if (matchesTokenSequence(cur, tokens, prevIdx, scopeNode)) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  if (comb.value === '+') {
    return Boolean(
      el.previousElementSibling &&
      matchesTokenSequence(el.previousElementSibling, tokens, prevIdx, scopeNode)
    );
  }
  if (comb.value === '~') {
    let cur = el.previousElementSibling;
    while (cur) {
      if (matchesTokenSequence(cur, tokens, prevIdx, scopeNode)) return true;
      cur = cur.previousElementSibling;
    }
    return false;
  }
  return false;
}

function compileSelectorList(selector) {
  const parts = splitTopLevel(String(selector || ''), ',');
  if (parts.length === 0) throw new SyntaxError('Empty selector');
  return parts.map((p) => tokenizeComplexSelector(p));
}

function matchesSelectorList(el, selectorOrCompiled, scopeNode) {
  const compiled = Array.isArray(selectorOrCompiled)
    ? selectorOrCompiled
    : compileSelectorList(selectorOrCompiled);
  return compiled.some((tokens) => matchesTokenSequence(el, tokens, tokens.length - 1, scopeNode));
}

function querySelectorAllNodes(root, selector, scopeNode) {
  const compiled = compileSelectorList(selector);
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === NODE_TYPES.ELEMENT_NODE) {
        if (matchesSelectorList(child, compiled, scopeNode)) {
          out.push(child);
        }
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function querySelectorFirst(root, selector, scopeNode) {
  const compiled = compileSelectorList(selector);
  let found = null;
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (found) return;
      if (child.nodeType === NODE_TYPES.ELEMENT_NODE) {
        if (matchesSelectorList(child, compiled, scopeNode)) {
          found = child;
          return;
        }
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}

/* ---------------- HTML & Strict XML Parsers ---------------- */

function parseAttributes(attrSource, isXml) {
  const attrs = new Map();
  const s = attrSource.trim();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const nameMatch = s.slice(i).match(/^([^\s=/>"']+)/);
    if (!nameMatch) {
      if (isXml) throw new Error(`Invalid attribute syntax near: ${s.slice(i)}`);
      i++;
      continue;
    }
    const rawName = nameMatch[1];
    const key = isXml ? rawName : rawName.toLowerCase();
    i += rawName.length;
    while (i < s.length && /\s/.test(s[i])) i++;

    let val = '';
    if (s[i] === '=') {
      i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i++];
        const end = s.indexOf(q, i);
        if (end === -1) {
          if (isXml) throw new Error(`Unclosed attribute quote for ${rawName}`);
          val = s.slice(i);
          i = s.length;
        } else {
          val = s.slice(i, end);
          i = end + 1;
        }
      } else {
        if (isXml) throw new Error(`Unquoted attribute value in XML for ${rawName}`);
        const valMatch = s.slice(i).match(/^([^\s>]+)/);
        val = valMatch ? valMatch[1] : '';
        i += val.length;
      }
    } else if (isXml) {
      throw new Error(`Boolean attribute without value in XML: ${rawName}`);
    }

    if (isXml && attrs.has(key)) {
      throw new Error(`Duplicate XML attribute: ${key}`);
    }
    attrs.set(key, decodeEntities(val));
  }
  return attrs;
}

function findTagEnd(src, startIdx) {
  let quote = null;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

function parseHtml(html) {
  const doc = new ShimDocument(false, null);
  const stack = [];
  let rootHtml = null;
  let i = 0;

  const currentParent = () => (stack.length > 0 ? stack[stack.length - 1] : rootHtml || doc);

  const ensureHtmlStructure = () => {
    if (!rootHtml) {
      rootHtml = doc.createElement('html');
      doc.appendChild(rootHtml);
    }
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const tail = html.slice(i);
      if (tail) {
        if (!rootHtml && !tail.trim()) break;
        ensureHtmlStructure();
        currentParent().appendChild(doc.createTextNode(decodeEntities(tail)));
      }
      break;
    }

    if (lt > i) {
      const txt = html.slice(i, lt);
      if (txt && (rootHtml || txt.trim())) {
        ensureHtmlStructure();
        currentParent().appendChild(doc.createTextNode(decodeEntities(txt)));
      }
    }

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const commentEnd = end === -1 ? html.length : end + 3;
      const body = end === -1 ? html.slice(lt + 4) : html.slice(lt + 4, end);
      if (rootHtml) currentParent().appendChild(doc.createComment(body));
      i = commentEnd;
      continue;
    }

    if (/^<!doctype/i.test(html.slice(lt, lt + 10))) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const gt = findTagEnd(html, lt + 1);
    if (gt === -1) {
      ensureHtmlStructure();
      currentParent().appendChild(doc.createTextNode(html.slice(lt)));
      break;
    }

    const inside = html.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (!inside || inside.startsWith('!') || inside.startsWith('?')) continue;

    if (inside.startsWith('/')) {
      const closeTag = inside.slice(1).trim().toLowerCase().split(/\s+/)[0];
      for (let sIdx = stack.length - 1; sIdx >= 0; sIdx--) {
        if (stack[sIdx]._localName === closeTag) {
          stack.length = sIdx;
          break;
        }
      }
      continue;
    }

    const selfClosing = inside.endsWith('/');
    const cleanInside = selfClosing ? inside.slice(0, -1) : inside;
    const tagMatch = cleanInside.match(/^([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*)$/);
    if (!tagMatch) continue;

    const tagName = tagMatch[1].toLowerCase();
    const attrSource = tagMatch[2] || '';
    const attrs = parseAttributes(attrSource, false);

    if (tagName === 'html') {
      if (!rootHtml) {
        rootHtml = doc.createElement('html');
        for (const [k, v] of attrs.entries()) rootHtml.setAttribute(k, v);
        doc.appendChild(rootHtml);
      } else {
        for (const [k, v] of attrs.entries()) {
          if (!rootHtml.hasAttribute(k)) rootHtml.setAttribute(k, v);
        }
      }
      stack.length = 0;
      stack.push(rootHtml);
      continue;
    }

    ensureHtmlStructure();
    const el = doc.createElement(tagName);
    for (const [k, v] of attrs.entries()) el.setAttribute(k, v);

    // Avoid nesting head/body inside each other if unclosed
    if ((tagName === 'head' || tagName === 'body') && stack.some((s) => s._localName === 'html')) {
      stack.length = 1;
    }

    currentParent().appendChild(el);

    if (RAW_TEXT_TAGS.has(tagName) && !selfClosing) {
      const closeRx = new RegExp(`</${tagName}\\s*>`, 'i');
      const rest = html.slice(i);
      const m = closeRx.exec(rest);
      const rawEnd = m ? i + m.index : html.length;
      const rawContent = html.slice(i, rawEnd);
      if (rawContent) {
        const textVal = tagName === 'title' ? decodeEntities(rawContent) : rawContent;
        el.appendChild(doc.createTextNode(textVal));
      }
      i = m ? rawEnd + m[0].length : html.length;
      continue;
    }

    if (!selfClosing && !VOID_HTML_TAGS.has(tagName)) {
      stack.push(el);
    }
  }

  ensureHtmlStructure();
  return doc;
}

function makeParserErrorDoc(message) {
  const errDoc = new ShimDocument(true, null);
  const errEl = errDoc.createElement('parsererror');
  errEl.textContent = message;
  errDoc.appendChild(errEl);
  return errDoc;
}

function parseXmlStrict(xml, mimeType) {
  const defaultNs = mimeType === 'application/xhtml+xml' ? 'http://www.w3.org/1999/xhtml' : null;
  const doc = new ShimDocument(true, defaultNs);
  const stack = [];
  let rootCount = 0;
  let i = 0;

  try {
    while (i < xml.length) {
      const lt = xml.indexOf('<', i);
      if (lt === -1) {
        const tail = xml.slice(i);
        if (tail.trim()) {
          if (stack.length === 0) throw new Error('Text outside root XML element');
          stack[stack.length - 1].appendChild(doc.createTextNode(decodeXmlEntities(tail)));
        }
        break;
      }

      if (lt > i) {
        const txt = xml.slice(i, lt);
        if (stack.length === 0) {
          if (txt.trim()) throw new Error('Text outside root XML element');
        } else {
          stack[stack.length - 1].appendChild(doc.createTextNode(decodeXmlEntities(txt)));
        }
      }

      if (xml.startsWith('<?', lt)) {
        const end = xml.indexOf('?>', lt + 2);
        if (end === -1) throw new Error('Unclosed XML processing instruction');
        i = end + 2;
        continue;
      }

      if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt + 4);
        if (end === -1) throw new Error('Unclosed XML comment');
        const commentText = xml.slice(lt + 4, end);
        if (commentText.includes('--')) throw new Error('Invalid "--" inside XML comment');
        if (stack.length > 0) stack[stack.length - 1].appendChild(doc.createComment(commentText));
        i = end + 3;
        continue;
      }

      if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt + 9);
        if (end === -1) throw new Error('Unclosed CDATA section');
        if (stack.length === 0) throw new Error('CDATA outside root element');
        stack[stack.length - 1].appendChild(doc.createTextNode(xml.slice(lt + 9, end)));
        i = end + 3;
        continue;
      }

      if (/^<!DOCTYPE/i.test(xml.slice(lt, lt + 10))) {
        const end = xml.indexOf('>', lt);
        if (end === -1) throw new Error('Unclosed DOCTYPE');
        i = end + 1;
        continue;
      }

      const gt = findTagEnd(xml, lt + 1);
      if (gt === -1) throw new Error('Unclosed XML tag');
      const inside = xml.slice(lt + 1, gt).trim();
      i = gt + 1;

      if (inside.startsWith('/')) {
        const closeName = inside.slice(1).trim();
        if (stack.length === 0) throw new Error(`Unexpected closing tag </${closeName}>`);
        const top = stack.pop();
        if (top.tagName !== closeName) {
          throw new Error(`Mismatched closing tag </${closeName}> for <${top.tagName}>`);
        }
        continue;
      }

      const selfClosing = inside.endsWith('/');
      const cleanInside = selfClosing ? inside.slice(0, -1) : inside;
      const tagMatch = cleanInside.match(/^([a-zA-Z_:][a-zA-Z0-9_.:-]*)([\s\S]*)$/);
      if (!tagMatch) throw new Error(`Invalid XML tag name: <${inside}>`);

      const tagName = tagMatch[1];
      const attrs = parseAttributes(tagMatch[2] || '', true);
      const currentNs = attrs.get('xmlns') || (stack.length > 0 ? stack[stack.length - 1].namespaceURI : defaultNs);
      const el = doc.createElementNS(currentNs, tagName);
      for (const [k, v] of attrs.entries()) el.setAttribute(k, v);

      if (stack.length === 0) {
        rootCount++;
        if (rootCount > 1) throw new Error('Multiple root XML elements');
        doc.appendChild(el);
      } else {
        stack[stack.length - 1].appendChild(el);
      }

      if (!selfClosing) stack.push(el);
    }

    if (stack.length > 0) {
      throw new Error(`Unclosed XML element <${stack[stack.length - 1].tagName}>`);
    }
    if (!doc.documentElement) {
      throw new Error('Empty XML document');
    }
    return doc;
  } catch (err) {
    return makeParserErrorDoc(err.message);
  }
}

function decodeXmlEntities(str) {
  // Verify no stray unescaped ampersands
  const stripped = String(str).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, '');
  if (stripped.includes('&')) {
    throw new Error('Unescaped "&" in XML text');
  }
  return decodeEntities(str);
}

/* ---------------- Serialization ---------------- */

function serializeNode(node, isXml) {
  if (!node) return '';
  if (node.nodeType === NODE_TYPES.TEXT_NODE) {
    return escapeXmlText(node.nodeValue);
  }
  if (node.nodeType === NODE_TYPES.COMMENT_NODE) {
    return `<!--${node.nodeValue}-->`;
  }
  if (node.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT_NODE) {
    return node.childNodes.map((c) => serializeNode(c, isXml)).join('');
  }
  if (node.nodeType === NODE_TYPES.DOCUMENT_NODE) {
    return node.childNodes.map((c) => serializeNode(c, node.isXml || isXml)).join('');
  }
  if (node.nodeType === NODE_TYPES.ELEMENT_NODE) {
    const xmlMode = isXml || Boolean(node.namespaceURI);
    const tag = xmlMode ? node.tagName : node._localName;
    const attrParts = [];
    let hasXmlns = false;
    for (const [k, v] of node._attrs.entries()) {
      if (k === 'xmlns') hasXmlns = true;
      attrParts.push(`${k}="${escapeXmlAttr(v)}"`);
    }
    if (xmlMode && node.namespaceURI && !hasXmlns) {
      const parentNs = node.parentNode?.namespaceURI || null;
      if (!node.parentNode || node.parentNode.nodeType === NODE_TYPES.DOCUMENT_NODE || parentNs !== node.namespaceURI) {
        attrParts.unshift(`xmlns="${escapeXmlAttr(node.namespaceURI)}"`);
      }
    }
    const open = attrParts.length > 0 ? `<${tag} ${attrParts.join(' ')}` : `<${tag}`;
    if (node.childNodes.length === 0 && (xmlMode || VOID_HTML_TAGS.has(node._localName))) {
      return xmlMode ? `${open} />` : `${open}>`;
    }
    const inner = node.childNodes.map((c) => serializeNode(c, xmlMode)).join('');
    return `${open}>${inner}</${tag}>`;
  }
  return '';
}

export class ShimDOMParser {
  parseFromString(str, mimeType = 'text/html') {
    if (mimeType === 'text/html') {
      return parseHtml(String(str ?? ''));
    }
    if (
      mimeType === 'application/xhtml+xml' ||
      mimeType === 'application/xml' ||
      mimeType === 'text/xml'
    ) {
      return parseXmlStrict(String(str ?? ''), mimeType);
    }
    throw new Error(`Unsupported DOMParser mimeType: ${mimeType}`);
  }
}

export class ShimXMLSerializer {
  serializeToString(node) {
    return serializeNode(node, Boolean(node?.isXml || node?.namespaceURI));
  }
}

export function installDomGlobals() {
  const prev = {
    document: globalThis.document,
    DOMParser: globalThis.DOMParser,
    XMLSerializer: globalThis.XMLSerializer,
    Node: globalThis.Node
  };

  globalThis.Node = NODE_TYPES;
  globalThis.DOMParser = ShimDOMParser;
  globalThis.XMLSerializer = ShimXMLSerializer;
  globalThis.document = new ShimDocument(false, null);

  return () => {
    globalThis.document = prev.document;
    globalThis.DOMParser = prev.DOMParser;
    globalThis.XMLSerializer = prev.XMLSerializer;
    globalThis.Node = prev.Node;
  };
}
