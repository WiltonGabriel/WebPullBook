import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-shim.js';
import { readZipArchive } from './helpers/zip-reader.js';
import { HtmlSanitizer, serializeChapterXhtml } from '../src/core/sanitizer.js';
import { buildEpubStylesheet } from '../src/core/parser-engine.js';
import { BaseExporter } from '../src/exporters/base-exporter.js';
import { exporterRegistry } from '../src/exporters/index.js';

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0)
);

let restoreDom;
let origFetch;
let origFileReader;

beforeEach(() => {
  restoreDom = installDomGlobals();
  origFetch = globalThis.fetch;
  origFileReader = globalThis.FileReader;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  globalThis.FileReader = origFileReader;
  restoreDom();
});

function buildParsedChapter(idx, volume, htmlBody, baseUrl = 'https://example.com') {
  const doc = new DOMParser().parseFromString(`<html><body><div class="epcontent">${htmlBody}</div></body></html>`, 'text/html');
  const san = new HtmlSanitizer({ skipImages: false }).sanitize(doc.querySelector('.epcontent'), `${baseUrl}/ch/${idx}`);
  const title = `Capítulo ${idx}`;
  const subtitle = idx === 1 ? 'Prólogo' : '';
  return {
    chapter: {
      id: `ch_${idx}`,
      index: idx,
      url: `${baseUrl}/ch/${idx}`,
      displayTitle: subtitle ? `${title} — ${subtitle}` : title,
      volume
    },
    chapterTitle: title,
    subtitle,
    ...san,
    serialize(stylesheetHref, epub3) {
      return serializeChapterXhtml({
        title,
        subtitle,
        xmlDoc: san.xmlDoc,
        nodes: san.nodes,
        stylesheetHref,
        epub3
      });
    }
  };
}

function makeBookContext(overrides = {}) {
  return {
    metadata: {
      startingUrl: 'https://example.com/series/chronicle',
      title: 'Crônica de Teste',
      author: 'Autora Exemplo',
      language: 'pt',
      genres: ['Fantasia', 'Mistério'],
      synopsis: 'Linha um da sinopse.\nLinha dois da sinopse.',
      coverUrl: 'https://example.com/cover.png'
    },
    bookTitle: 'Crônica de Teste',
    seriesName: 'Crônica de Teste',
    seriesIndex: 1,
    parsedChapters: [
      buildParsedChapter(
        1,
        'Volume 01',
        '<p>Texto com <b>negrito</b>, <i>itálico</i> e <s>tachado</s>.</p><img src="https://example.com/art1.png" alt="Arte 1"/><img src="https://example.com/missing.png" alt="Quebrada"/>'
      ),
      buildParsedChapter(
        2,
        'Volume 02',
        '<blockquote><p>Um aviso antigo.</p></blockquote><pre>codigo()</pre><ul><li>Item A</li><li>Item B</li></ul><hr/><p>Fim.</p>'
      )
    ],
    options: {
      createEpub3: true,
      restrictCoverJpeg: false,
      compressImages: false,
      useSvgForImages: false,
      addInfoPage: true,
      stylesheet: buildEpubStylesheet({ fontFamily: 'serif', textAlign: 'left', lineHeight: 1.6, paragraphIndent: true })
    },
    groupNestedVolumes: true,
    onLog: () => {},
    ...overrides
  };
}

test('ExporterRegistry exposes all 4 exporters and BaseExporter requires exportBook override', async () => {
  const list = exporterRegistry.list();
  assert.deepEqual(
    list.map((e) => e.id),
    ['epub', 'html', 'md', 'txt']
  );
  assert.equal(exporterRegistry.get('unknown-format').id, 'epub');

  const base = new BaseExporter({ id: 'base', name: 'Base', extension: 'bin', mimeType: 'application/octet-stream' });
  await assert.rejects(() => base.exportBook({}), /must be implemented/);
});

test('EpubExporter generates valid EPUB 3 archive with nested volumes, metadata, deduplicated images, and strict XML', async () => {
  const logs = [];
  globalThis.fetch = async (url) => {
    if (String(url).includes('missing.png')) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });
  };

  const blob = await exporterRegistry.get('epub').exportBook(
    makeBookContext({ onLog: (m) => logs.push(m) })
  );
  const zip = await readZipArchive(blob);

  // Entry #0 must be uncompressed mimetype
  assert.equal(zip.entries[0].name, 'mimetype');
  assert.equal(zip.entries[0].method, 0);
  assert.equal(zip.entries[0].text(), 'application/epub+zip');

  // Required OCF entries
  assert.ok(zip.files.has('META-INF/container.xml'));
  assert.ok(zip.files.has('OEBPS/content.opf'));
  assert.ok(zip.files.has('OEBPS/toc.ncx'));
  assert.ok(zip.files.has('OEBPS/nav.xhtml'));
  assert.ok(zip.files.has('OEBPS/text/cover.xhtml'));
  assert.ok(zip.files.has('OEBPS/text/info.xhtml'));
  assert.ok(zip.files.has('OEBPS/text/ch_0001.xhtml'));
  assert.ok(zip.files.has('OEBPS/text/ch_0002.xhtml'));
  assert.ok(zip.files.has('OEBPS/images/cover.png'));
  assert.ok(zip.files.has('OEBPS/images/img_0001.png'));

  const opf = zip.files.get('OEBPS/content.opf').text();
  assert.match(opf, /version="3\.0"/);
  assert.match(opf, /<dc:subject>Fantasia<\/dc:subject>/);
  assert.match(opf, /belongs-to-collection/);
  assert.match(opf, /properties="cover-image"/);

  const nav = zip.files.get('OEBPS/nav.xhtml').text();
  assert.match(nav, /Volume 01/);
  assert.match(nav, /Volume 02/);

  const ch1 = zip.files.get('OEBPS/text/ch_0001.xhtml').text();
  assert.match(ch1, /src="\.\.\/images\/img_0001\.png"/);
  // Failed image fetch removes broken <img> cleanly and logs warning
  assert.doesNotMatch(ch1, /missing\.png/);
  assert.ok(logs.some((l) => l.includes('missing.png')));

  // Every XML/XHTML/OPF/NCX file in archive must parse cleanly with strict XML parser
  for (const entry of zip.entries) {
    if (/\.(xml|opf|ncx|xhtml)$/i.test(entry.name)) {
      const parsed = new DOMParser().parseFromString(entry.text(), 'application/xhtml+xml');
      assert.equal(parsed.querySelector('parsererror'), null, `XML error in ${entry.name}`);
    }
  }
});

test('EpubExporter supports EPUB 2 mode without nav.xhtml or package xml:lang', async () => {
  globalThis.fetch = async () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });

  const ctx = makeBookContext();
  ctx.options.createEpub3 = false;
  const blob = await exporterRegistry.get('epub').exportBook(ctx);
  const zip = await readZipArchive(blob);

  assert.equal(zip.files.has('OEBPS/nav.xhtml'), false);
  const opf = zip.files.get('OEBPS/content.opf').text();
  assert.match(opf, /version="2\.0"/);
  assert.doesNotMatch(opf, /<package[^>]*xml:lang=/);

  const ch1 = zip.files.get('OEBPS/text/ch_0001.xhtml').text();
  assert.match(ch1, /XHTML 1\.1/);
});

test('HtmlExporter creates offline single-file HTML with embedded cover and TOC', async () => {
  globalThis.fetch = async () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = 'data:image/png;base64,iVBORw0KGgo=';
      queueMicrotask(() => this.onload?.());
    }
  };

  const blob = await exporterRegistry.get('html').exportBook(makeBookContext());
  const html = await blob.text();

  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /href="#ch-1"/);
  assert.match(html, /href="#ch-2"/);
  assert.match(html, /Um aviso antigo/);
});

test('MarkdownExporter and TxtExporter render readable formatted documents', async () => {
  const ctx = makeBookContext();

  const md = await (await exporterRegistry.get('md').exportBook(ctx)).text();
  assert.match(md, /^# Crônica de Teste/m);
  assert.match(md, /\*\*negrito\*\*/);
  assert.match(md, /\*itálico\*/);
  assert.match(md, /~~tachado~~/);
  assert.match(md, /> Um aviso antigo\./);
  assert.match(md, /```\ncodigo\(\)\n```/);
  assert.match(md, /- Item A/);

  const txt = await (await exporterRegistry.get('txt').exportBook(ctx)).text();
  assert.match(txt, /^Crônica de Teste/m);
  assert.match(txt, /Autor: Autora Exemplo/);
  assert.match(txt, /\* Item A/);
  assert.match(txt, /---/);
});

test('EpubExporter retries image fetch with anonymous credentials on HTTP 403 and emits structured warnings', async () => {
  const seenFetchOpts = [];
  globalThis.fetch = async (url, opts = {}) => {
    seenFetchOpts.push({ url: String(url), credentials: opts.credentials });
    if (String(url).includes('auth-cdn.png')) {
      if (opts.credentials === 'include') {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('Forbidden', { status: 403 });
  };

  const warnings = [];
  const ctx = makeBookContext({
    metadata: {
      startingUrl: 'https://example.com/s',
      title: 'Fallback Teste',
      author: 'Autor',
      language: 'pt',
      genres: [],
      synopsis: '',
      coverUrl: ''
    },
    parsedChapters: [
      buildParsedChapter(
        1,
        'Volume 01',
        '<p>Texto.</p><img src="https://example.com/auth-cdn.png" alt="OK"/><img src="https://example.com/blocked.png" alt="Blocked"/><img src="https://i0.wp.com/example.com/soft-html.png?resize=300,300" alt="Soft"/>'
      )
    ],
    onWarning: (w) => warnings.push(w)
  });

  // Return HTML 200 on i0.wp.com soft-html URL so it falls back to unproxied URL
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('i0.wp.com/example.com/soft-html.png')) {
      return new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (u === 'https://example.com/soft-html.png') {
      return new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return prevFetch(url, opts);
  };

  const blob = await exporterRegistry.get('epub').exportBook(ctx);
  const zip = await readZipArchive(blob);

  // auth-cdn.png succeeded via anonymous fallback and soft-html.png recovered via unproxied fallback
  assert.ok(zip.files.has('OEBPS/images/img_0001.png'));
  assert.ok(zip.files.has('OEBPS/images/img_0002.png'));
  assert.ok(seenFetchOpts.some((o) => o.url.includes('auth-cdn.png') && o.credentials === 'omit'));

  // blocked.png failed completely, was removed from XHTML, and triggered a structured warning
  const ch1 = zip.files.get('OEBPS/text/ch_0001.xhtml').text();
  assert.doesNotMatch(ch1, /blocked\.png/);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'chapter-image');
  assert.equal(warnings[0].severity, 'light');
  assert.equal(warnings[0].chapterIndex, 1);
  assert.equal(warnings[0].chapterUrl, 'https://example.com/ch/1');
});
