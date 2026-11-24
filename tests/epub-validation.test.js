import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installDomGlobals } from './helpers/dom-env.js';
import { resolveEpubCheckRunner, runEpubCheck } from './helpers/epubcheck.js';
import { loadSeriesWithParser } from '../src/parsers/index.js';
import { exporterRegistry } from '../src/exporters/index.js';
import { buildEpubStylesheet } from '../src/core/parser-engine.js';
import { sanitizeChapterContent, serializeChapterXhtml } from '../src/core/sanitizer.js';

const FIXTURES_DIR = path.resolve('tests/fixtures');
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0)
);

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

let restoreDom;
let origFetch;

beforeEach(() => {
  restoreDom = installDomGlobals();
  origFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  restoreDom();
});

test('Generated EPUB 3 (nested volumes + SVG cover) and EPUB 2 pass W3C EPUBCheck validation', async (t) => {
  const runner = resolveEpubCheckRunner();
  if (!runner) {
    if (process.env.REQUIRE_EPUBCHECK === '1') {
      assert.fail('REQUIRE_EPUBCHECK=1 is set, but EPUBCheck was not found.');
    }
    t.skip('EPUBCheck not installed locally (install to .tools/epubcheck or set EPUBCHECK_JAR)');
    return;
  }

  const routes = {
    'https://novel.example.org/series/torre-cinzenta/': readFixture('wp-lightnovel-index.html'),
    'https://novel.example.org/series/torre-cinzenta/cap-01/': readFixture('wp-lightnovel-chapter.html'),
    'https://novel.example.org/series/torre-cinzenta/cap-02/': readFixture('wp-lightnovel-chapter.html'),
    'https://novel.example.org/series/torre-cinzenta/cap-03/': readFixture('wp-lightnovel-chapter.html'),
    'https://novel.example.org/series/torre-cinzenta/cap-04/': readFixture('wp-lightnovel-chapter.html')
  };

  globalThis.fetch = async (url) => {
    const key = String(url);
    if (routes[key]) {
      return new Response(routes[key], { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (/\.(png|jpg|webp)(\?|$)/i.test(key)) {
      return new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('Not Found', { status: 404 });
  };

  const { parser, series } = await loadSeriesWithParser('https://novel.example.org/series/torre-cinzenta/');

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpb-epubcheck-suite-'));
  try {
    const scenarios = [
      {
        name: 'epub3-nested.epub',
        createEpub3: true,
        useSvgForImages: false,
        groupNestedVolumes: true
      },
      {
        name: 'epub3-svg-flat.epub',
        createEpub3: true,
        useSvgForImages: true,
        groupNestedVolumes: false
      },
      {
        name: 'epub2-nested.epub',
        createEpub3: false,
        useSvgForImages: false,
        groupNestedVolumes: true
      }
    ];

    for (const sc of scenarios) {
      // Re-parse chapters cleanly per scenario because buildEpubBlob mutates img src in-place
      const freshChapters = [];
      for (const ch of series.chapters) {
        freshChapters.push(await parser.downloadChapter(ch));
      }

      const blob = await exporterRegistry.get('epub').exportBook({
        metadata: series,
        bookTitle: series.title,
        seriesName: series.title,
        seriesIndex: 1,
        parsedChapters: freshChapters,
        options: {
          createEpub3: sc.createEpub3,
          restrictCoverJpeg: false,
          compressImages: false,
          useSvgForImages: sc.useSvgForImages,
          addInfoPage: true,
          stylesheet: buildEpubStylesheet()
        },
        groupNestedVolumes: sc.groupNestedVolumes
      });

      const epubFile = path.join(outDir, sc.name);
      fs.writeFileSync(epubFile, Buffer.from(await blob.arrayBuffer()));
      const result = runEpubCheck(epubFile);
      assert.equal(result.ok, true, `EPUBCheck failed for ${sc.name}:\n${result.output}`);
    }

    // Validate EPUB 3 pop-up footnotes across both <p id="fn"> and <ol><li id="fn"> structures
    const footnoteHtml = `
      <html><body><div id="ch-root">
        <p>Main narrative with paragraph note<sup><a id="ref-p" href="#fn-p">1</a></sup>,
           inline list note<sup><a id="ref-li1" href="#fn-li1">2</a></sup>, and
           block list note<sup><a id="ref-li2" href="#fn-li2">3</a></sup>.</p>
        <p id="fn-p"><a href="#ref-p">1</a> — Standalone paragraph footnote.</p>
        <ol>
          <li id="fn-li1">Inline list footnote <a href="#ref-li1">↩</a></li>
          <li id="fn-li2"><p>Block-wrapped list footnote <a href="#ref-li2">↩</a></p></li>
        </ol>
      </div></body></html>`;
    const fnDoc = new DOMParser().parseFromString(footnoteHtml, 'text/html');
    const fnSanitized = sanitizeChapterContent(fnDoc.querySelector('#ch-root'), 'https://novel.example.org/fn-ch');
    const fnParsedChapter = {
      chapter: {
        id: 'ch_fn',
        index: 1,
        url: 'https://novel.example.org/fn-ch',
        displayTitle: 'Chapter with Footnotes',
        volume: 'Volume 01'
      },
      chapterTitle: 'Chapter with Footnotes',
      subtitle: '',
      ...fnSanitized,
      serialize(stylesheetHref, epub3, { popupFootnotes = false } = {}) {
        return serializeChapterXhtml({
          title: 'Chapter with Footnotes',
          subtitle: '',
          xmlDoc: fnSanitized.xmlDoc,
          nodes: fnSanitized.nodes,
          stylesheetHref,
          epub3,
          popupFootnotes
        });
      }
    };

    const fnBlob = await exporterRegistry.get('epub').exportBook({
      metadata: { ...series, coverUrl: '', coverThumbUrl: '' },
      bookTitle: 'Footnote Validation Book',
      seriesName: '',
      seriesIndex: 1,
      parsedChapters: [fnParsedChapter],
      options: {
        createEpub3: true,
        popupFootnotes: true,
        restrictCoverJpeg: false,
        compressImages: false,
        addInfoPage: true,
        stylesheet: buildEpubStylesheet()
      },
      groupNestedVolumes: false
    });
    const fnEpubFile = path.join(outDir, 'epub3-popup-footnotes.epub');
    fs.writeFileSync(fnEpubFile, Buffer.from(await fnBlob.arrayBuffer()));
    const fnResult = runEpubCheck(fnEpubFile);
    assert.equal(fnResult.ok, true, `EPUBCheck failed for epub3-popup-footnotes.epub:\n${fnResult.output}`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
