import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-shim.js';
import { readZipArchive } from './helpers/zip-reader.js';
import { HtmlSanitizer, serializeChapterXhtml } from '../src/core/sanitizer.js';
import { buildEpubStylesheet } from '../src/core/parser-engine.js';
import { hashImageBytes, isAnimatedImage, sniffImageMime } from '../src/core/image-processor.js';
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
  // EPUB 2 default includes visible TOC page at the start of the book (before ch_0001)
  assert.ok(zip.files.has('OEBPS/text/toc.xhtml'));
  assert.ok(opf.indexOf('idref="toc-page"') > -1 && opf.indexOf('idref="toc-page"') < opf.indexOf('idref="ch_0001"'));
});

test('EpubExporter places Table of Contents at book start, supports custom Info Page and customizable End-of-Book Page', async () => {
  globalThis.fetch = async () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });

  // 1. Default EPUB 3: nav.xhtml is in spine BEFORE ch_0001 and end.xhtml is AFTER chapters, with custom fields
  const ctxStart = makeBookContext();
  ctxStart.options.tocTitle = 'Índice Personalizado';
  ctxStart.options.infoPageTitle = 'Ficha da Obra';
  ctxStart.options.infoShowSynopsis = false;
  ctxStart.options.infoShowGenres = false;
  ctxStart.options.infoShowSource = false;
  ctxStart.options.endPageTitle = 'Fim do Volume';
  ctxStart.options.endPageMessage = 'Até o próximo volume!\nBoa leitura.';
  ctxStart.options.endShowSource = false;
  ctxStart.options.endShowGenerator = false;
  const zipStart = await readZipArchive(await exporterRegistry.get('epub').exportBook(ctxStart));
  const opfStart = zipStart.files.get('OEBPS/content.opf').text();
  assert.ok(
    opfStart.indexOf('idref="nav"') > -1 && opfStart.indexOf('idref="nav"') < opfStart.indexOf('idref="ch_0001"'),
    'TOC (nav) should always appear before Chapter 1 in EPUB 3 spine'
  );
  assert.ok(
    opfStart.indexOf('idref="end-page"') > opfStart.indexOf('idref="ch_0002"'),
    'End-of-Book page should appear after the last chapter in spine'
  );
  assert.match(opfStart, /<reference type="toc" title="Índice Personalizado" href="nav\.xhtml"\/>/);
  const navStart = zipStart.files.get('OEBPS/nav.xhtml').text();
  assert.match(navStart, /<h1>Índice Personalizado<\/h1>/);
  assert.match(navStart, /href="text\/end\.xhtml">Fim do Volume<\/a>/);
  const infoStart = zipStart.files.get('OEBPS/text/info.xhtml').text();
  assert.match(infoStart, /<h1>Ficha da Obra<\/h1>/);
  assert.doesNotMatch(infoStart, /Sinopse/);
  assert.doesNotMatch(infoStart, /Gêneros:/);
  assert.doesNotMatch(infoStart, /Fonte:/);
  const endStart = zipStart.files.get('OEBPS/text/end.xhtml').text();
  assert.match(endStart, /<h1>Fim do Volume<\/h1>/);
  assert.match(endStart, /Até o próximo volume!/);
  assert.match(endStart, /Boa leitura\./);
  assert.match(endStart, /Crônica de Teste/);
  assert.doesNotMatch(endStart, /Fonte:/);
  assert.doesNotMatch(endStart, /WebPullBook/);

  // 2. Disabling includeTocPage, addInfoPage & addEndPage removes them from spine (while keeping nav in EPUB 3 manifest)
  const ctxMinimal = makeBookContext();
  ctxMinimal.options.includeTocPage = false;
  ctxMinimal.options.addInfoPage = false;
  ctxMinimal.options.addEndPage = false;
  const zipMin = await readZipArchive(await exporterRegistry.get('epub').exportBook(ctxMinimal));
  const opfMin = zipMin.files.get('OEBPS/content.opf').text();
  assert.equal(zipMin.files.has('OEBPS/text/info.xhtml'), false);
  assert.equal(zipMin.files.has('OEBPS/text/end.xhtml'), false);
  assert.ok(zipMin.files.has('OEBPS/nav.xhtml'), 'EPUB 3 manifest still keeps nav.xhtml for spec compliance');
  assert.doesNotMatch(opfMin, /idref="nav"/);
  assert.doesNotMatch(opfMin, /idref="info-page"/);
  assert.doesNotMatch(opfMin, /idref="end-page"/);
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
      // Distinct valid PNG bytes so content-hash deduplication treats it as a separate image from auth-cdn.png
      const distinctPng = new Uint8Array(PNG_1X1.length + 1);
      distinctPng.set(PNG_1X1, 0);
      distinctPng[PNG_1X1.length] = 0x00;
      return new Response(distinctPng, { status: 200, headers: { 'content-type': 'image/png' } });
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

test('EpubExporter and HtmlExporter accept inline data: URI local/generated covers without network fetch', async () => {
  const dataCover =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('Network should not be called for data: cover');
  };

  const ctx = makeBookContext({
    metadata: {
      startingUrl: 'https://example.com/book',
      title: 'Local Cover Book',
      author: 'Autora',
      language: 'pt',
      coverUrl: dataCover,
      genres: [],
      synopsis: ''
    },
    options: {
      createEpub3: true,
      addInfoPage: false,
      restrictCoverJpeg: false,
      compressImages: false,
      useSvgForImages: false
    },
    parsedChapters: [buildParsedChapter(1, 'Volume 01', '<p>Texto sem imagens externas.</p>')]
  });

  const epubBlob = await exporterRegistry.get('epub').exportBook(ctx);
  const zip = await readZipArchive(epubBlob);
  assert.equal(fetchCalled, false);
  assert.ok(zip.files.has('OEBPS/images/cover.png'));

  const htmlBlob = await exporterRegistry.get('html').exportBook(ctx);
  const htmlText = await htmlBlob.text();
  assert.equal(fetchCalled, false);
  assert.ok(htmlText.includes(dataCover));
});

test('sniffImageMime detects real magic bytes and catches mislabeled HTML payloads', () => {
  assert.equal(sniffImageMime(PNG_1X1), 'image/png');
  assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif');
  assert.equal(
    sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    'image/webp'
  );
  assert.equal(
    sniffImageMime(new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])),
    'image/avif'
  );
  assert.equal(sniffImageMime(new TextEncoder().encode('<!DOCTYPE html><html><body>Denied</body></html>')), 'text/html');
});

test('EpubExporter falls back to raw bytes when canvas conversion fails, sniffs octet-stream MIME, retries non-403 anonymously, and logs [IMG]', async () => {
  const origCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => {
    throw new Error('Simulated codec decode failure');
  };

  try {
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('strict-cdn.png') && opts.credentials === 'include') {
        return new Response('Bad Request', { status: 400 });
      }
      if (u.includes('strict-cdn.png') || u.includes('cover-raw.png')) {
        return new Response(PNG_1X1, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' }
        });
      }
      return new Response('Not Found', { status: 404 });
    };

    const logs = [];
    const warnings = [];
    const ctx = makeBookContext({
      metadata: {
        startingUrl: 'https://example.com/img-resilience',
        title: 'Imagem Resiliente',
        author: 'Autora',
        language: 'pt',
        coverUrl: 'https://example.com/cover-raw.png',
        genres: [],
        synopsis: ''
      },
      options: {
        createEpub3: true,
        addInfoPage: false,
        restrictCoverJpeg: false,
        compressImages: true,
        compressedResolution: 1200,
        useSvgForImages: false
      },
      parsedChapters: [
        buildParsedChapter(1, 'Volume 01', '<p>Ilustração:</p><img src="https://example.com/strict-cdn.png" alt="Art"/>')
      ],
      onLog: (msg, level) => logs.push({ msg, level }),
      onWarning: (w) => warnings.push(w)
    });

    const zip = await readZipArchive(await exporterRegistry.get('epub').exportBook(ctx));
    const opf = zip.files.get('OEBPS/content.opf').text();

    // Both cover and chapter image must survive canvas failure and get real image/png MIME from magic bytes
    assert.ok(zip.files.has('OEBPS/images/cover.png'), 'Cover must fall back to raw PNG instead of being dropped');
    assert.ok(zip.files.has('OEBPS/images/img_0001.png'), 'Chapter image must fall back to raw PNG instead of being dropped');
    assert.match(opf, /href="images\/cover\.png" media-type="image\/png"/);
    assert.match(opf, /href="images\/img_0001\.png" media-type="image\/png"/);
    assert.equal(warnings.length, 0, 'Canvas fallback should keep the image without dropping it as a missing image warning');
    assert.ok(logs.some((l) => /\[IMG\] Capa OK/.test(l.msg)), 'Should emit [IMG] cover diagnostic log');
    assert.ok(logs.some((l) => /\[IMG\] Cap\. 1 OK/.test(l.msg)), 'Should emit [IMG] chapter image diagnostic log');
    assert.ok(logs.some((l) => /\[IMG\] Conversão via canvas falhou/.test(l.msg)), 'Should emit [IMG] canvas fallback warning');
  } finally {
    globalThis.createImageBitmap = origCreateImageBitmap;
  }
});

test('EpubExporter deduplicates identical images across different URLs by content hash, detects animated APNG/WebP, and rewrites internal chapter hyperlinks', async () => {
  // APNG & Animated WebP binary detection
  const fakeApng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x08, 0x61, 0x63, 0x54, 0x4c, 0x00, 0x00
  ]);
  const fakeAnimWebp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x41, 0x4e, 0x49, 0x4d, 0x00, 0x00
  ]);
  assert.equal(isAnimatedImage(fakeApng, 'image/png'), true);
  assert.equal(isAnimatedImage(fakeAnimWebp, 'image/webp'), true);
  assert.equal(isAnimatedImage(PNG_1X1, 'image/png'), false);
  assert.equal(hashImageBytes(PNG_1X1), hashImageBytes(new Uint8Array(PNG_1X1)));

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('divider-a.png') || u.includes('divider-b.png')) {
      return new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('Not Found', { status: 404 });
  };

  const ctx = makeBookContext({
    metadata: {
      startingUrl: 'https://example.com/book',
      title: 'Deduplicação & Links Internos',
      author: 'Autora',
      language: 'pt',
      coverUrl: '',
      genres: [],
      synopsis: ''
    },
    parsedChapters: [
      buildParsedChapter(
        1,
        'Volume 01',
        '<p>Consulte a <a href="https://example.com/ch/2#cena">nota no apêndice 2</a>.</p><img src="https://cdn.example.com/divider-a.png" alt="Sep"/>'
      ),
      buildParsedChapter(
        2,
        'Volume 01',
        '<p id="cena">Voltar para <a href="https://example.com/ch/1">capítulo 1</a> ou <a href="https://external.org/ref">externo</a>.</p><img src="https://cdn.example.com/divider-b.png" alt="Sep"/>'
      )
    ]
  });

  const zip = await readZipArchive(await exporterRegistry.get('epub').exportBook(ctx));
  // Identical bytes from divider-a.png and divider-b.png must be stored ONCE
  assert.ok(zip.files.has('OEBPS/images/img_0001.png'));
  assert.equal(zip.files.has('OEBPS/images/img_0002.png'), false, 'Duplicate image content across URLs must be deduplicated');

  const ch1 = zip.files.get('OEBPS/text/ch_0001.xhtml').text();
  const ch2 = zip.files.get('OEBPS/text/ch_0002.xhtml').text();
  assert.match(ch1, /href="ch_0002\.xhtml#cena"/, 'Cross-chapter link should become internal EPUB link preserving fragment');
  assert.match(ch2, /href="ch_0001\.xhtml"/, 'Back-reference link to chapter 1 should become internal EPUB link');
  assert.match(ch2, /href="https:\/\/external\.org\/ref"/, 'External links outside the book must stay absolute');
});
