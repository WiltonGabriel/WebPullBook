import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-shim.js';
import {
  HtmlSanitizer,
  XHTML_NS,
  escapeXml,
  extractHiddenClassesFromStyles,
  sanitizeChapterContent,
  serializeChapterXhtml
} from '../src/core/sanitizer.js';

let restoreDom;

beforeEach(() => {
  restoreDom = installDomGlobals();
});

afterEach(() => {
  restoreDom();
});

function parseHtmlBodyFragment(html) {
  const doc = new DOMParser().parseFromString(`<html><body><div id="root">${html}</div></body></html>`, 'text/html');
  return doc.querySelector('#root');
}

test('HtmlSanitizer preserves semantic formatting and maps inline styles to wpb-* classes', () => {
  const root = parseHtmlBodyFragment(`
    <p style="text-align: center; font-weight: bold;">Título Interno</p>
    <p style="font-style: italic; text-decoration: underline; color: #ff0000; font-size: 14px;">Texto estilizado</p>
    <p><big>Grande</big> <small>Pequeno</small> <font size="2">Legado</font></p>
    <center><p>Centralizado</p></center>
    <blockquote><p>Citação</p></blockquote>
    <table><tr><th colspan="2">Cabeçalho</th></tr><tr><td>A</td><td rowspan="2">B</td></tr></table>
  `);

  const { xmlDoc, nodes } = sanitizeChapterContent(root, 'https://example.com/cap-1');
  const xhtml = serializeChapterXhtml({
    title: 'Capítulo 1',
    subtitle: 'Subtítulo',
    xmlDoc,
    nodes,
    epub3: true
  });

  // Strict XML parse must succeed with zero parsererror
  const parsed = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  assert.equal(parsed.querySelector('parsererror'), null);

  assert.match(xhtml, /class="wpb-center wpb-bold"/);
  assert.match(xhtml, /class="wpb-italic wpb-underline"/);
  assert.match(xhtml, /class="wpb-lg"/);
  assert.match(xhtml, /class="wpb-sm"/);
  assert.match(xhtml, /<div class="wpb-center">/);
  assert.match(xhtml, /colspan="2"/);
  assert.match(xhtml, /rowspan="2"/);
  // Raw style attributes and fixed px/colors must NOT leak
  assert.doesNotMatch(xhtml, /style="/);
  assert.doesNotMatch(xhtml, /#ff0000/);
  assert.doesNotMatch(xhtml, /14px/);
  assert.equal(parsed.documentElement.getAttribute('xmlns'), XHTML_NS);
});

test('HtmlSanitizer strips XSS vectors, dangerous protocols, and unsafe attributes', () => {
  const root = parseHtmlBodyFragment(`
    <script>window.pwn = true;</script>
    <style>body { background: url(javascript:alert(1)); }</style>
    <iframe srcdoc="<script>alert(1)</script>"></iframe>
    <svg onload="alert(1)"><script>alert(2)</script></svg>
    <object data="evil.swf"></object>
    <embed src="evil.swf">
    <p onclick="alert(1)" onmouseover="steal()" style="background: expression(alert(1))">Texto seguro</p>
    <a href="javascript:alert(1)" onclick="alert(2)">Link malicioso</a>
    <a href="data:text/html,<script>alert(1)</script>">Link data HTML</a>
    <a href="https://example.com/ok" onclick="evil()">Link válido</a>
    <img src="javascript:alert(1)" onerror="alert(2)" alt="XSS img">
    <img data-src="data:text/html,<script>alert(1)</script>" alt="Bad data img">
    <img src="data:image/svg+xml,<svg onload=alert(1)>" alt="SVG data img">
    <img data-lazy-src="/assets/ok.png" onerror="alert(1)" alt="Imagem legítima">
  `);

  const { xmlDoc, nodes, images } = sanitizeChapterContent(root, 'https://example.com/obra/cap-1');
  const xhtml = serializeChapterXhtml({
    title: 'Teste XSS',
    xmlDoc,
    nodes,
    epub3: true
  });

  const parsed = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  assert.equal(parsed.querySelector('parsererror'), null);

  assert.doesNotMatch(xhtml, /<script/i);
  assert.doesNotMatch(xhtml, /<iframe/i);
  assert.doesNotMatch(xhtml, /<svg/i);
  assert.doesNotMatch(xhtml, /<object/i);
  assert.doesNotMatch(xhtml, /<embed/i);
  assert.doesNotMatch(xhtml, /javascript:/i);
  assert.doesNotMatch(xhtml, /data:text\/html/i);
  assert.doesNotMatch(xhtml, /\bonclick=/i);
  assert.doesNotMatch(xhtml, /\bonerror=/i);
  assert.doesNotMatch(xhtml, /\bonload=/i);
  assert.doesNotMatch(xhtml, /\bonmouseover=/i);

  // Malicious href unwrapped to text content, safe link preserved
  assert.match(xhtml, /Link malicioso/);
  assert.match(xhtml, /Link data HTML/);
  assert.match(xhtml, /<a href="https:\/\/example\.com\/ok">Link válido<\/a>/);

  // Only the legitimate image survives
  assert.equal(images.length, 1);
  assert.equal(images[0].originalUrl, 'https://example.com/assets/ok.png');
});

test('HtmlSanitizer handles invalid excludeSelector, hidden/ad/nav elements, skipImages, and zero-width chars', () => {
  const root = parseHtmlBodyFragment(`
    <div hidden>Oculto</div>
    <p style="display: none">Escondido CSS</p>
    <div class="ads">Anúncio</div>
    <div class="naveg"><a href="/prev">Capítulo Anterior</a> | <a href="/next">Próximo Capítulo</a></div>
    <p class="author-note">Nota removida</p>
    <p>Texto\u200b com\ufeff largura zero</p>
    <img src="https://example.com/pic.jpg" alt="Foto">
  `);

  const sanitizer = new HtmlSanitizer({
    skipImages: true,
    removeNavLinks: true,
    excludeSelector: '.author-note'
  });
  const res = sanitizer.sanitize(root, 'https://example.com/cap-2');
  const text = res.nodes.map((n) => n.textContent).join(' ');

  assert.doesNotMatch(text, /Oculto/);
  assert.doesNotMatch(text, /Escondido CSS/);
  assert.doesNotMatch(text, /Anúncio/);
  assert.doesNotMatch(text, /Próximo Capítulo/);
  assert.doesNotMatch(text, /Nota removida/);
  assert.match(text, /Texto com largura zero/);
  assert.equal(res.images.length, 0);

  // Invalid CSS excludeSelector must not throw
  const invalidSelSan = new HtmlSanitizer({ excludeSelector: 'div[[[invalid' });
  const res2 = invalidSelSan.sanitize(parseHtmlBodyFragment('<p>Conteúdo resiliente</p>'), 'https://example.com/c');
  assert.equal(res2.nodes.length, 1);
  assert.equal(res2.nodes[0].textContent, 'Conteúdo resiliente');
});

test('serializeChapterXhtml emits XHTML 1.1 head meta for EPUB 2 and escapes XML chars', () => {
  const root = parseHtmlBodyFragment('<p>A &amp; B &lt; C</p>');
  const { xmlDoc, nodes } = sanitizeChapterContent(root, 'https://example.com/ch');
  const xhtml2 = serializeChapterXhtml({
    title: 'Cap <1> & "Teste"',
    xmlDoc,
    nodes,
    epub3: false
  });

  assert.match(xhtml2, /XHTML 1\.1/);
  assert.match(xhtml2, /http-equiv="Content-Type"/);
  assert.doesNotMatch(xhtml2, /<meta charset=/);
  assert.equal((xhtml2.match(/<\?xml/g) || []).length, 1);
  assert.equal(escapeXml(`a&b<c>"d"'e'`), 'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
});

test('extractHiddenClassesFromStyles detects top-level hidden classes while ignoring @media rules', () => {
  const doc = new DOMParser().parseFromString(`
    <html><head><style>
      .decoyA { display: none; speak: never; }
      .decoyB, .decoyC { visibility: hidden; }
      @media print { .printHidden { display: none; } }
    </style></head><body>
      <div id="root">
        <p class="decoyA">Watermark A</p>
        <p class="decoyB">Watermark B</p>
        <p class="printHidden">Visible in reader</p>
      </div>
    </body></html>`, 'text/html');

  const hiddenClasses = extractHiddenClassesFromStyles(doc);
  assert.equal(hiddenClasses.has('decoyA'), true);
  assert.equal(hiddenClasses.has('decoyB'), true);
  assert.equal(hiddenClasses.has('decoyC'), true);
  assert.equal(hiddenClasses.has('printHidden'), false);

  const res = sanitizeChapterContent(doc.querySelector('#root'), 'https://example.com/ch', { hiddenClasses });
  const text = res.nodes.map((n) => n.textContent).join(' ');
  assert.doesNotMatch(text, /Watermark A/);
  assert.doesNotMatch(text, /Watermark B/);
  assert.match(text, /Visible in reader/);
});

test('HtmlSanitizer preserves referenced intra-chapter footnote anchors and drops unreferenced bookmarks', () => {
  const root = parseHtmlBodyFragment(`
    <h3><a name="_Toc452663782"></a>Seção 1</h3>
    <p>Texto com nota<a id="nota1v"></a><a href="#nota1">¹</a> e âncora órfã<a id="unused"></a>.</p>
    <hr>
    <p><a id="nota1"></a><a href="#nota1v">1</a> – Explicação da nota.</p>
  `);

  const { xmlDoc, nodes } = sanitizeChapterContent(root, 'https://example.com/cap-1');
  const xhtml = serializeChapterXhtml({
    title: 'Notas',
    xmlDoc,
    nodes,
    epub3: true
  });

  const parsed = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  assert.equal(parsed.querySelector('parsererror'), null);

  assert.match(xhtml, /<a id="nota1v"(?:\s*\/>|><\/a>)<a href="#nota1">¹<\/a>/);
  assert.match(xhtml, /<a id="nota1"(?:\s*\/>|><\/a>)<a href="#nota1v">1<\/a>/);
  assert.doesNotMatch(xhtml, /_Toc452663782/);
  assert.doesNotMatch(xhtml, /id="unused"/);
});

test('serializeChapterXhtml converts footnote targets to EPUB 3 pop-up aside elements when popupFootnotes=true', () => {
  const root = parseHtmlBodyFragment(`
    <p>Texto principal<a id="fnref1"></a><a href="#fn1">[1]</a> com detalhes.</p>
    <p id="fn1"><a href="#fnref1">1</a> – Detalhe da nota de rodapé.</p>
  `);

  const { xmlDoc, nodes } = sanitizeChapterContent(root, 'https://example.com/cap-1');
  const xhtml = serializeChapterXhtml({
    title: 'Notas Pop-up',
    xmlDoc,
    nodes,
    epub3: true,
    popupFootnotes: true
  });

  const parsed = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  assert.equal(parsed.querySelector('parsererror'), null);

  assert.match(xhtml, /xmlns:epub="http:\/\/www\.idpf\.org\/2007\/ops"/);
  assert.match(xhtml, /epub:type="noteref"/);
  assert.match(xhtml, /<aside\b[^>]*epub:type="footnote"[^>]*id="fn1"/);

  // Ensure ID is not duplicated on both <aside> and inner elements
  const fn1Matches = xhtml.match(/\bid="fn1"/g) || [];
  assert.equal(fn1Matches.length, 1);
});

test('serializeChapterXhtml keeps <ol>/<ul> valid by nesting EPUB 3 footnote <aside> inside <li> without nested <p>', () => {
  const root = parseHtmlBodyFragment(`
    <p>Trecho com notas<sup><a id="fnref1" href="#fn1">1</a></sup> e<sup><a id="fnref2" href="#fn2">2</a></sup>.</p>
    <ol>
      <li id="fn1">Nota inline simples <a href="#fnref1">↩</a></li>
      <li id="fn2"><p>Nota já embrulhada em parágrafo <a href="#fnref2">↩</a></p></li>
    </ol>
  `);

  const { xmlDoc, nodes } = sanitizeChapterContent(root, 'https://example.com/cap-fn');
  const xhtml = serializeChapterXhtml({
    title: 'Notas em Lista',
    xmlDoc,
    nodes,
    epub3: true,
    popupFootnotes: true
  });

  const parsed = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  assert.equal(parsed.querySelector('parsererror'), null);

  // <ol> must contain only <li> children, never direct <aside> children
  assert.equal(parsed.querySelector('ol > aside'), null);
  const listItems = parsed.querySelectorAll('ol > li');
  assert.equal(listItems.length, 2);
  assert.equal(listItems[0].querySelector('aside[id="fn1"] > p') !== null, true);
  assert.equal(listItems[1].querySelector('aside[id="fn2"] > p') !== null, true);
  // Never nest <p> inside <p>
  assert.equal(parsed.querySelector('p p'), null);
  assert.equal((xhtml.match(/epub:type="noteref"/g) || []).length, 2);
  assert.equal((xhtml.match(/epub:type="footnote"/g) || []).length, 2);
});

test('HtmlSanitizer resolves srcset, picture sources, skips 1x1 placeholders, and keeps lazy images with hidden classes', () => {
  const root = parseHtmlBodyFragment(`
    <p>
      <img
        class="lazyload"
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
        data-srcset="https://cdn.example.com/art-400.jpg 400w, https://cdn.example.com/art-1600.jpg 1600w"
        alt="HiRes"
      />
    </p>
    <picture>
      <source srcset="https://cdn.example.com/pic-1x.webp 1x, https://cdn.example.com/pic-2x.webp 2x" />
      <img src="/static/blank.gif" alt="PictureArt" />
    </picture>
  `);

  const res = sanitizeChapterContent(root, 'https://example.com/ch/1', {
    hiddenClasses: new Set(['lazyload'])
  });
  assert.equal(res.images.length, 2);
  assert.equal(res.images[0].originalUrl, 'https://cdn.example.com/art-1600.jpg');
  assert.equal(res.images[1].originalUrl, 'https://cdn.example.com/pic-2x.webp');
});

test('HtmlSanitizer strips adjacent nextPrevUrls, decodes __cf_email__, converts wp-block-spacer, unwraps blocks in inline tags, deduplicates leading heading, and upgrades thumb links', () => {
  const root = parseHtmlBodyFragment(`
    <h2>Capítulo 5: A Ponte</h2>
    <p><a href="https://example.com/cap-4">← A Floresta Sombria</a> | <a href="https://example.com/cap-6">O Castelo →</a></p>
    <p>Contato: <a class="__cf_email__" data-cfemail="7a1b1e1713143a1f021b170a161f54191517">[email&#160;protected]</a></p>
    <div class="wp-block-spacer" style="height:40px"></div>
    <span aria-hidden="true">Decoy hidden icon</span>
    <span><p>Parágrafo dentro de span inválido</p></span>
    <p><a href="https://cdn.example.com/full-art.jpg"><img src="https://cdn.example.com/thumb-art-300x200.jpg" alt="Cena"/></a></p>
  `);

  const res = sanitizeChapterContent(root, 'https://example.com/cap-5', {
    nextPrevUrls: ['https://example.com/cap-4', 'https://example.com/cap-6'],
    chapterTitle: 'Capítulo 5: A Ponte'
  });

  const xhtml = serializeChapterXhtml({
    title: 'Capítulo 5: A Ponte',
    xmlDoc: res.xmlDoc,
    nodes: res.nodes,
    epub3: true
  });

  // Duplicate leading <h2> removed (only the serialized chapter-title <h2> remains)
  assert.equal((xhtml.match(/Capítulo 5: A Ponte/g) || []).length, 2, 'Title appears only in <title> and <h2 class="chapter-title">');
  // Adjacent chapter links removed even with custom chapter-name text
  assert.doesNotMatch(xhtml, /A Floresta Sombria/);
  assert.doesNotMatch(xhtml, /O Castelo/);
  // Cloudflare obfuscated email decoded ("admin@example.com")
  assert.match(xhtml, /admin@example\.com/);
  // wp-block-spacer converted to <hr />
  assert.match(xhtml, /<hr\s*\/>/);
  // aria-hidden decoy stripped
  assert.doesNotMatch(xhtml, /Decoy hidden icon/);
  // Block <p> unwrapped out of inline <span>
  assert.doesNotMatch(xhtml, /<span>\s*<p>/);
  assert.match(xhtml, /<p>Parágrafo dentro de span inválido<\/p>/);
  // Wrapping <a href="full-art.jpg"> promoted with fallback to thumbnail
  assert.equal(res.images.length, 1);
  assert.equal(res.images[0].originalUrl, 'https://cdn.example.com/full-art.jpg');
  assert.equal(res.images[0].fallbackUrl, 'https://cdn.example.com/thumb-art-300x200.jpg');
});

test('dom-shim evaluates :empty, CSS escapes, modern pseudo-classes, and rejects unknown pseudo-classes', () => {
  const doc = new DOMParser().parseFromString(`
    <html><body>
      <div id="empty-root"><!-- comment only --></div>
      <div id="filled-root"><p>Real SSR content</p></div>
      <div id="text-root"> </div>
      <section id="ns:panel" class="md:w-1/2 card"><span class="badge">A</span><em>B</em></section>
    </body></html>`, 'text/html');

  assert.ok(doc.querySelector('#empty-root:empty'));
  assert.equal(doc.querySelector('#filled-root:empty'), null);
  assert.equal(doc.querySelector('#text-root:empty'), null);

  assert.equal(doc.querySelector('#ns\\:panel')?.tagName, 'SECTION');
  assert.equal(doc.querySelector('.md\\:w-1\\/2.card')?.id, 'ns:panel');
  assert.ok(doc.querySelector('section:has(> span.badge)'));
  assert.equal(doc.querySelector('section:has(> p)'), null);
  assert.ok(doc.querySelector(':is(section, article).card'));
  assert.ok(doc.querySelector('em:first-of-type'));

  assert.throws(() => doc.querySelector('div:nonexistent-pseudo'), SyntaxError);
});
