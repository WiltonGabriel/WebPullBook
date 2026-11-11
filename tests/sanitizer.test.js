import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-shim.js';
import {
  HtmlSanitizer,
  XHTML_NS,
  escapeXml,
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
