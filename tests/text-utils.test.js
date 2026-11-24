import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-shim.js';
import {
  buildOutputPath,
  ensureAscendingChapterOrder,
  extractVolumeLabel,
  generateCssSelector,
  sanitizePathSegment,
  toHighResCoverUrl
} from '../src/core/parser-engine.js';

let restoreDom;

beforeEach(() => {
  restoreDom = installDomGlobals();
});

afterEach(() => {
  restoreDom();
});

test('buildOutputPath and sanitizePathSegment handle custom root folders, presets, tokens, and unsafe segments', () => {
  assert.equal(sanitizePathSegment('..'), '');
  assert.equal(sanitizePathSegment('  Nome.. '), 'Nome');
  assert.equal(sanitizePathSegment('CON'), '_CON');

  assert.equal(
    buildOutputPath({
      baseFilename: 'Crônica',
      title: 'Crônica',
      author: 'Ana',
      extension: 'epub',
      options: {}
    }),
    'WebPullBook/Crônica/Crônica.epub'
  );

  assert.equal(
    buildOutputPath({
      baseFilename: 'Crônica',
      title: 'Fate/Stay Night',
      author: 'Nasu',
      extension: 'epub',
      options: {
        rootFolderName: 'Biblioteca/LightNovels',
        folderLayout: 'root-author-title'
      }
    }),
    'Biblioteca/LightNovels/Nasu/Fate_Stay Night/Crônica.epub'
  );

  assert.equal(
    buildOutputPath({
      baseFilename: 'Livro',
      title: 'Livro',
      author: 'Autor',
      extension: 'html',
      options: { rootFolderName: 'MeusLivros', folderLayout: 'root-format-title' }
    }),
    'MeusLivros/HTML/Livro/Livro.html'
  );

  assert.equal(
    buildOutputPath({
      baseFilename: 'Livro',
      title: 'Livro',
      extension: 'epub',
      options: { rootFolderName: 'Leitura', folderLayout: 'root-only' }
    }),
    'Leitura/Livro.epub'
  );

  assert.equal(
    buildOutputPath({
      baseFilename: 'Livro',
      title: 'Livro',
      author: 'Autor',
      extension: 'epub',
      options: { folderLayout: 'title-only', rootFolderName: 'Ignored' }
    }),
    'Livro/Livro.epub'
  );

  assert.equal(
    buildOutputPath({
      baseFilename: 'Livro',
      title: 'Livro',
      extension: 'epub',
      options: { subfolder: false }
    }),
    'Livro.epub'
  );

  assert.equal(
    buildOutputPath({
      baseFilename: 'Saga',
      title: 'Saga',
      author: 'João',
      volumeLabel: 'Volume 02',
      language: 'pt',
      extension: 'epub',
      options: {
        rootFolderName: '../../Hacks',
        folderLayout: 'custom',
        customFolderTemplate: '%Language%/%Author%/%Title%/%Volume%'
      }
    }),
    'pt/João/Saga/Volume 02/Saga - Volume 02.epub'
  );

  assert.equal(
    buildOutputPath({
      baseFilename: 'Saga',
      title: 'Saga',
      author: 'João',
      volumeLabel: '',
      language: 'pt',
      extension: 'epub',
      options: {
        folderLayout: 'custom',
        customFolderTemplate: '../%Author%/%Volume%/%Title%'
      }
    }),
    'João/Saga/Saga.epub'
  );
});

test('generateCssSelector produces reusable list, content, and exclude selectors', () => {
  const doc = new DOMParser().parseFromString(
    `<html><body>
      <main id="reader-shell">
        <ul class="chapters-nav">
          <li><a href="/c1">Capítulo 1</a></li>
          <li><a href="/c2">Capítulo 2</a></li>
          <li><a href="/c3">Capítulo 3</a></li>
        </ul>
        <article class="chapter-body">
          <div class="promo-banner active">Anúncio</div>
          <p class="story-line">Era uma vez.</p>
        </article>
      </main>
    </body></html>`,
    'text/html'
  );

  const firstLink = doc.querySelector('.chapters-nav a');
  const articleEl = doc.querySelector('.chapter-body');
  const adBanner = doc.querySelector('.promo-banner');

  const listSel = generateCssSelector(firstLink, 'list');
  assert.equal(listSel, 'ul.chapters-nav a');
  assert.equal(doc.querySelectorAll(listSel).length, 3);

  const contentSel = generateCssSelector(articleEl, 'content');
  assert.equal(contentSel, 'article.chapter-body');
  assert.equal(doc.querySelectorAll(contentSel).length, 1);

  const excludeSel = generateCssSelector(adBanner, 'exclude');
  assert.equal(excludeSel, 'div.promo-banner');
  assert.equal(doc.querySelectorAll(excludeSel).length, 1);
});

test('toHighResCoverUrl unwraps Jetpack proxy and strips resize and numeric w/h query params', () => {
  assert.equal(
    toHighResCoverUrl('https://i0.wp.com/example.com/uploads/cover.jpg?resize=200,300&w=200'),
    'https://example.com/uploads/cover.jpg'
  );
  assert.equal(
    toHighResCoverUrl('https://cdn.example.org/img/cover.webp?w=300&h=450&token=abc&w=auto'),
    'https://cdn.example.org/img/cover.webp?token=abc&w=auto'
  );
  assert.equal(
    toHighResCoverUrl('https://cdn.example.org/img/cover.jpg?resize=600,900&h=900'),
    'https://cdn.example.org/img/cover.jpg'
  );
});

test('buildOutputPath replaces tokens single-pass and sanitizePathSegment strips separators even when removeIllegal=false', () => {
  const pathStr = buildOutputPath({
    baseFilename: 'Crônica',
    title: '%Author% Chronicles',
    author: 'Author Real',
    extension: 'epub',
    options: {
      folderLayout: 'custom',
      customFolderTemplate: '%Title%/%Author%',
      customFilename: '%Filename%'
    }
  });
  assert.equal(pathStr, '%Author% Chronicles/Author Real/Crônica.epub');
  assert.equal(sanitizePathSegment('dir/sub\\file\x00name', false), 'dir_sub_file_name');
  assert.equal(sanitizePathSegment('CON.epub', true), '_CON.epub');
  assert.equal(extractVolumeLabel('', 'Book - 03: Arrival'), 'Volume 03');
  assert.equal(extractVolumeLabel('', 'Livro - 02: Partida'), 'Volume 02');
});

test('ensureAscendingChapterOrder preserves ascending multi-digit sequences without prefix misreads', () => {
  const chs = [
    { url: 'https://e.org/c2', displayTitle: 'Chapter 2', numText: '2' },
    { url: 'https://e.org/c10', displayTitle: 'Chapter 10', numText: '10' },
    { url: 'https://e.org/c11', displayTitle: 'Chapter 11', numText: '11' }
  ];
  const reversed = [...chs].reverse();
  const ordered = ensureAscendingChapterOrder(reversed);
  assert.deepEqual(ordered.map((c) => c.numText), ['2', '10', '11']);
});

test('dom-shim enforces strict XML attribute/entity/namespace checks, HTML head/body, cloneNode case, [attr~=], and :has() scope', () => {
  const htmlDoc = new DOMParser().parseFromString('<p>Snippet</p>', 'text/html');
  assert.equal(htmlDoc.head?.tagName, 'HEAD');
  assert.equal(htmlDoc.body?.tagName, 'BODY');
  assert.equal(htmlDoc.body?.querySelector('p')?.textContent, 'Snippet');

  const dom = new DOMParser().parseFromString(
    `<div class="empty" data-tokens="">
       <div class="outer"><section class="target"><span class="inner">X</span></section></div>
     </div>`,
    'text/html'
  );
  assert.equal(dom.querySelector('[data-tokens~=""]'), null);
  assert.equal(dom.querySelector('section.target:has(.outer .inner)'), null);
  assert.ok(dom.querySelector('section.target:has(> .inner)'));

  const xmlDoc = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="g1" /></svg>',
    'application/xml'
  );
  const grad = xmlDoc.getElementsByTagName('linearGradient')[0];
  assert.equal(grad?.tagName, 'linearGradient');
  assert.equal(grad?.cloneNode(true).tagName, 'linearGradient');

  const badAttrXml = new DOMParser().parseFromString('<root a="x<y" />', 'application/xml');
  assert.ok(badAttrXml.querySelector('parsererror'));
  const badNsXml = new DOMParser().parseFromString('<unknown:tag />', 'application/xml');
  assert.ok(badNsXml.querySelector('parsererror'));
  const badCharRefXml = new DOMParser().parseFromString('<root>&#0;</root>', 'application/xml');
  assert.ok(badCharRefXml.querySelector('parsererror'));
});
